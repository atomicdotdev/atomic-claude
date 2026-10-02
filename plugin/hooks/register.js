import { atom, read, update } from 'claude-code';
import { WORKFLOW, checkpointAdvanced, clip, legacyOwns, usageFields } from './protocol.js';

const workspace = atom({ plugin: 'atomic', key: 'workspace' }, { cwd: '', root: '', repository: '', selectionError: '', view: '', parent: null, status: '', intents: '', inventory: [], intentError: '', error: '' });
const runtime = atom({ plugin: 'atomic', key: 'runtime' }, { session: null, turnId: '', steps: [], completed: '', recording: 'idle', pendingCompletion: null });
const review = atom({ plugin: 'atomic', key: 'review' }, 'Run /atomic-review to load review data.');
const EMPTY_INTENT = { root: '', sessionId: '', generation: 'initial', id: null, label: '', error: '' };
const activeIntent = atom({ plugin: 'atomic', key: 'activeIntent' }, EMPTY_INTENT);
const PANE = 'atomic-review';
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'ToolSearch', 'WebSearch', 'WebFetch', 'AskUserQuestion']);
let liveEpoch = 0;
let foregroundEpoch = 0;
let liveRefresh = { timer: null, running: false, pending: false };
let selectionEpoch = 0;
let selectionOperation = 0;
const selectionWrites = new Map();

function resetLiveRefresh() {
  liveRefresh.timer?.cancel();
  liveEpoch += 1;
  selectionEpoch += 1;
  liveRefresh = { timer: null, running: false, pending: false };
}

function currentLiveRead(token) {
  return !token || (token.live === liveEpoch && token.foreground === foregroundEpoch);
}

function requestLiveRefresh($) {
  const state = liveRefresh;
  state.pending = true;
  if (state.running) return;
  state.timer?.cancel();
  const epoch = liveEpoch;
  state.timer = $.clock.after(100, async () => {
    state.timer = null;
    if (state !== liveRefresh || !state.pending) return;
    state.pending = false;
    state.running = true;
    const token = { live: epoch, foreground: foregroundEpoch };
    try {
      const cwd = await $.session.cwd();
      if (currentLiveRead(token)) await refresh($, cwd, token);
    } catch (error) {
      if (currentLiveRead(token)) await update($, workspace, previous => currentLiveRead(token)
        ? { ...previous, error: `Live refresh failed: ${error.message ?? error}` } : previous);
    } finally {
      state.running = false;
      // A mutation during a read needs one more pass, never parallel polling.
      if (state === liveRefresh && state.pending) requestLiveRefresh($);
    }
  });
}

function intentKey(root, sessionId) {
  // JSON encoding keeps repository and session boundaries unambiguous. This
  // is a key in the plugin store, never a filesystem path or shell argument.
  return 'active-intent:' + JSON.stringify([root, sessionId]);
}

function validIntentId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id);
}

function selectionRecordKey(key, generation) {
  return generation === 'initial' ? key : `${key}:generation:${generation}`;
}

function writeSelection($, key, id) {
  const previous = selectionWrites.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    if (id === null) await $.store.delete(key);
    else await $.store.set(key, { id });
  });
  selectionWrites.set(key, operation);
  operation.finally(() => { if (selectionWrites.get(key) === operation) selectionWrites.delete(key); }).catch(() => {});
  return operation;
}

function currentSelection(epoch, operation = null) { return epoch === selectionEpoch && (operation === null || operation === selectionOperation); }

async function updateIntentLabel($, liveToken = null) {
  const w = await read($, workspace);
  const sessionId = await $.session.id();
  await update($, activeIntent, selected => {
    if (!currentLiveRead(liveToken)) return selected;
    if (w.selectionError) return { ...EMPTY_INTENT, error: w.selectionError };
    if (selected.root !== w.repository) return { ...EMPTY_INTENT };
    if (selected.sessionId && selected.sessionId !== sessionId) return { ...EMPTY_INTENT };
    if (!selected.id) return selected;
    if (w.intentError) return { ...selected, label: `${selected.id} (lookup unavailable)`, error: w.intentError };
    const intent = w.inventory.find(item => item.id === selected.id);
    return intent
      ? { ...selected, label: `${intent.id}: ${intent.title} (${intent.status})`, error: '' }
      : { ...selected, label: `${selected.id} (not found)`, error: 'The explicitly selected intent is not present in this repository.' };
  });
}

async function loadIntentSelection($, sessionId, reset = false) {
  const epoch = selectionEpoch;
  const operation = selectionOperation;
  const w = await read($, workspace);
  if (!w.repository) { await update($, activeIntent, previous => currentSelection(epoch, operation) ? { ...EMPTY_INTENT, error: w.selectionError } : previous); return; }
  try {
    const id = sessionId || await $.session.id();
    if (typeof id !== 'string' || !id) throw new Error('Claude session identity is unavailable');
    const key = intentKey(w.repository, id);
    const oldGeneration = await $.store.get(key + ':head') ?? 'initial';
    const generation = reset ? crypto.randomUUID() : oldGeneration;
    if (typeof generation !== 'string' || !/^(?:initial|[A-Za-z0-9-]{1,80})$/.test(generation)) throw new Error('Invalid selection generation');
    if (!currentSelection(epoch, operation)) return;
    if (reset) {
      await $.store.set(key + ':head', generation);
      const oldKey = selectionRecordKey(key, oldGeneration);
      if (!selectionWrites.has(oldKey)) await $.store.delete(oldKey);
    }
    const saved = reset ? undefined : await $.store.get(selectionRecordKey(key, generation));
    if (!currentSelection(epoch, operation)) return;
    if (saved !== undefined && !validIntentId(saved?.id)) throw new Error('Invalid stored intent selection');
    await update($, activeIntent, previous => currentSelection(epoch, operation)
      ? { ...EMPTY_INTENT, root: w.repository, sessionId: id, generation, id: saved?.id ?? null } : previous);
    await updateIntentLabel($);
  } catch (error) {
    await update($, activeIntent, previous => currentSelection(epoch, operation)
      ? { ...EMPTY_INTENT, root: w.repository, error: `Intent selection storage unavailable: ${error.message ?? error}` } : previous);
  }
}

async function selectIntent($, id) {
  const epoch = selectionEpoch;
  if (id !== null && !validIntentId(id)) throw new Error('Supply an existing Atomic intent ID, or null to clear the selection.');
  const cwd = await $.session.cwd();
  if (!await refresh($, cwd)) throw new Error(`Atomic unavailable: ${(await read($, workspace)).error}`);
  const w = await read($, workspace);
  if (!w.repository) throw new Error(w.selectionError || 'Atomic repository identity is unavailable');
  if (id !== null) {
    if (w.intentError) throw new Error(`Cannot verify this intent: ${w.intentError}`);
    if (!w.inventory.some(intent => intent.id === id)) throw new Error(`Intent ${id} was not found in this repository. Selection was not changed.`);
  }
  const sessionId = await $.session.id();
  if (typeof sessionId !== 'string' || !sessionId) throw new Error('Claude session identity is unavailable');
  const key = intentKey(w.repository, sessionId);
  const selectedBefore = await read($, activeIntent);
  const generation = selectedBefore.root === w.repository && selectedBefore.sessionId === sessionId
    ? selectedBefore.generation : (await $.store.get(key + ':head') ?? 'initial');
  if (typeof generation !== 'string' || !/^(?:initial|[A-Za-z0-9-]{1,80})$/.test(generation)) throw new Error('Invalid selection generation');
  if (!currentSelection(epoch)) throw new Error('Intent selection superseded by a session reset.');
  const operation = ++selectionOperation;
  const recordKey = selectionRecordKey(key, generation);
  // Persist before publishing the new selection. A failed write cannot claim
  // that an old selection was cleared or a new one was saved.
  await writeSelection($, recordKey, id);
  if (!currentSelection(epoch)) {
    if ((await $.store.get(key + ':head') ?? 'initial') !== generation) await writeSelection($, recordKey, null);
    throw new Error('Intent selection superseded by a session reset.');
  }
  if (operation !== selectionOperation) throw new Error('Intent selection superseded by a newer selection.');
  await update($, activeIntent, previous => currentSelection(epoch) && operation === selectionOperation
    ? { ...EMPTY_INTENT, root: w.repository, sessionId, generation, id } : previous);
  await updateIntentLabel($);
  const selected = await read($, activeIntent);
  return id === null ? 'Active intent cleared for this Claude session.'
    : `Active intent: ${selected.label}\nThis is a session-local display selection; it does not approve the intent or change its Atomic status.`;
}

async function runAtomic($, args, cwd, stdin) {
  const result = await $.process.run(['atomic', '--no-color', ...args], {
    cwd, timeoutMs: 30000, ...(stdin === undefined ? {} : { stdin }),
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `Atomic exited ${result.exitCode}`);
  return result.stdout;
}

async function refresh($, cwd, liveToken = null) {
  // Foreground refreshes take precedence over already-running background
  // reads. Their results remain authoritative if an older read completes late.
  liveToken = liveToken || { live: liveEpoch, foreground: ++foregroundEpoch };
  try {
    const data = JSON.parse(await runAtomic($, ['view', 'list', '--json'], cwd));
    if (data.schema_version !== 1 || typeof data.repository_root !== 'string' || !data.repository_root || !Array.isArray(data.views)) throw new Error('Unsupported Atomic view response');
    const current = data.views.find(view => view.name === data.current_view);
    if (!current) throw new Error('Atomic did not identify the current view');
    const status = await runAtomic($, ['status', '-s'], cwd);
    let repository = data.repository_root;
    let selectionError = '';
    try {
      // Atomic view JSON identifies the materialized sandbox working root.
      // The verified Atomic pointer format identifies its shared graph root;
      // no view name or Git/worktree metadata participates in the key.
      if (await $.fs.exists(data.repository_root + '/.atomic-sandbox')) {
        const pointer = JSON.parse(await $.fs.read(data.repository_root + '/.atomic-sandbox'));
        if (typeof pointer.canonical !== 'string' || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(pointer.canonical)) throw new Error('Invalid Atomic sandbox canonical root');
        repository = pointer.canonical;
      }
    } catch (error) { repository = ''; selectionError = `Intent repository identity unavailable: ${error.message ?? error}`; }
    let inventory = [];
    let intentError = '';
    try {
      const intents = JSON.parse(await runAtomic($, ['intent', 'list', '--json'], cwd));
      if (!Array.isArray(intents) || intents.some(intent => !validIntentId(intent.id) || typeof intent.title !== 'string' || typeof intent.status !== 'string')) throw new Error('Unsupported Atomic intent response');
      inventory = intents.map(({ id, title, status }) => ({ id, title, status }));
    } catch (error) { intentError = String(error.message ?? error); }
    if (!currentLiveRead(liveToken)) return false;
    await update($, workspace, previous => currentLiveRead(liveToken)
      ? { cwd, root: data.repository_root, repository, selectionError, view: current.name, parent: current.parent,
          status, inventory, intentError, intents: inventory.map(intent => `${intent.id}: ${intent.title} (${intent.status})`).join('\n'), error: '' }
      : previous);
    await updateIntentLabel($, liveToken);
    return currentLiveRead(liveToken);
  } catch (error) {
    if (!currentLiveRead(liveToken)) return false;
    await update($, workspace, previous => !currentLiveRead(liveToken) ? previous : ({
      ...(previous.cwd === cwd && previous.root ? previous : { cwd, root: '', repository: '', selectionError: '', view: '', parent: null, status: '', intents: '', inventory: [], intentError: '' }),
      error: String(error.message ?? error),
    }));
    return false;
  }
}

// Ownership is checked per verb: partially installed legacy hooks are supported.
// Passing modified classic payloads to next preserves transcript/permission fields
// and enriches the actual stdin received by the existing Rust recording handler.
async function dispatch($, e, next, verb, extra = {}, observation = null) {
  const cwd = e.cwd || await $.session.cwd();
  const w = await read($, workspace);
  if (w.cwd !== cwd || !w.root) {
    if (!await refresh($, cwd)) return next(e);
  }
  const payload = { ...e, ...extra };
  const settings = await $.settings.read();
  // Old shell guards only check the immediate cwd. Nested directories must
  // use Atomic's own ancestor discovery instead of yielding to a skipped hook.
  const guarded = (settings.hooks?.[e.hook_event_name] ?? []).some(entry =>
    (entry.hooks ?? []).some(hook => /\btest\s+-d\s+\.atomic\b/.test(hook.command ?? '')));
  const localRepository = !guarded || await $.fs.exists(cwd + '/.atomic') || await $.fs.exists(cwd + '/.atomic-sandbox');
  const subject = e.hook_event_name === 'SessionStart' ? e.source : e.hook_event_name === 'SessionEnd' ? e.reason : e.tool_name;
  if (!observation?.force && (legacyOwns(settings, e.hook_event_name, verb, subject, localRepository) ||
      (['post-task', 'post-todo'].includes(verb) && legacyOwns(settings, e.hook_event_name, 'post-tool', e.tool_name, localRepository)))) return next(payload);
  try {
    if (verb === 'session-end') {
      const worker = await $.process.run(['node', $.plugin.root + '/hooks/finalize.cjs'], {
        cwd, stdin: JSON.stringify({ cwd, event: payload }), timeoutMs: 1000,
      });
      if (worker.exitCode !== 0 || !JSON.parse(worker.stdout).started) throw new Error(worker.stderr || 'Finalization worker did not start');
    } else {
      const stdout = await runAtomic($, ['agent', 'hooks', 'claude-code', verb, ...(verb === 'stop' ? ['--json'] : [])], cwd, JSON.stringify(payload));
      if (observation && verb === 'stop') {
        const receipt = JSON.parse(stdout);
        if (receipt.session_id !== payload.session_id || typeof receipt.recorded !== 'boolean') throw new Error('Invalid Atomic checkpoint acknowledgement');
        observation.receipt = receipt;
      }
    }
  } catch (error) {
    if (observation) observation.error = String(error.message ?? error);
    await update($, runtime, state => ({ ...state, recording: `failed: ${error.message ?? error}` }));
    await $.ui.log(`Atomic ${verb} failed; work remains on disk. ${error.message ?? error}`);
  }
  return next(payload);
}

async function readLedger($, sessionId, cwd) {
  try { return JSON.parse(await runAtomic($, ['session', 'show', sessionId, '--json'], cwd)); }
  catch { return null; }
}

async function checkpoint($, e, next, extra = {}, force = false) {
  const epoch = liveEpoch;
  const state = await read($, runtime);
  const cwd = e.cwd || await $.session.cwd();
  const w = await read($, workspace);
  if (!w.root && !await refresh($, cwd)) return { result: await next(e), confirmed: false, inactive: true };
  const pending = state.pendingCompletion;
  const recovery = pending?.__turn === state.turnId && pending.session_id === e.session_id;
  const steps = recovery && Array.isArray(pending.__steps) ? pending.__steps : state.steps;
  const before = recovery ? pending.__baseline : await readLedger($, e.session_id, cwd);
  // Retain the original baseline across observation failures. Reading a new
  // baseline after publication would make a successful checkpoint invisible.
  const attempt = { ...(state.session || {}), ...e, prompt: state.session?.prompt,
    hook_event_name: 'Stop', __turn: state.turnId, __baseline: before, __steps: steps };
  await update($, runtime, current => ({ ...current, pendingCompletion: attempt }));
  const { __turn, __baseline, __steps, ...payload } = attempt;
  const observation = { force, receipt: null, error: '' };
  await update($, runtime, current => ({ ...current, recording: 'checkpointing' }));
  const existing = recovery ? await readLedger($, e.session_id, cwd) : null;
  const alreadyPublished = recovery && checkpointAdvanced(before, existing, e.session_id);
  const result = alreadyPublished ? await next(payload)
    : await dispatch($, payload, next, 'stop', { ...usageFields(steps), per_request_usage: steps, ...extra }, observation);
  const after = alreadyPublished ? existing : await readLedger($, e.session_id, cwd);
  const duplicate = Boolean(state.completed) && state.completed === state.turnId && steps.length === 0 &&
    before?.[0]?.session_id === e.session_id && after?.[0]?.session_id === e.session_id &&
    before[0].latest_provenance === after[0].latest_provenance;
  const confirmed = checkpointAdvanced(before, after, e.session_id) || observation.receipt?.recorded === true || duplicate;
  if (epoch === liveEpoch) {
    const consumed = new Set(steps.map(step => `${step.turnId}:${step.index}`));
    await update($, runtime, current => ({ ...current,
      steps: confirmed ? current.steps.filter(step => !consumed.has(`${step.turnId}:${step.index}`)) : current.steps,
      completed: confirmed ? state.turnId : current.completed,
      pendingCompletion: confirmed && !observation.error ? null : attempt,
      recording: observation.error ? `failed: ${observation.error}` : confirmed ? 'checkpoint published' : 'checkpoint unconfirmed',
    }));
  }
  return { result, confirmed, inactive: false, after };
}

async function resumeContinuation($, state) {
  if (!state.session?.prompt) throw new Error('Original prompt unavailable for checkpoint continuation');
  const cwd = state.session.cwd || await $.session.cwd();
  const ledger = await readLedger($, state.session.session_id, cwd);
  const status = JSON.parse(await runAtomic($, ['agent', 'status', '--json'], cwd));
  const session = status.sessions?.find(item => item.session_id === state.session.session_id);
  if (!ledger || session?.phase !== 'idle' || session.turn_count !== ledger[1]?.length) throw new Error('Atomic checkpoint cleanup is not complete; continuation was not restarted');
  await runAtomic($, ['agent', 'hooks', 'claude-code', 'user-prompt-submit'], cwd,
    JSON.stringify({ ...state.session, hook_event_name: 'UserPromptSubmit', prompt: state.session.prompt }));
  await update($, runtime, current => ({ ...current, completed: '', recording: 'working' }));
}

async function terminalCheckpoint($, reason, durationMs) {
  const state = await read($, runtime);
  if (!state.session || (state.completed === state.turnId && !state.pendingCompletion)) return;
  const existing = state.pendingCompletion;
  const sameAttempt = existing?.session_id === state.session.session_id && existing.__turn === state.turnId;
  // Host abort completion is part of recovery, not a new interaction. Keep
  // the original publication baseline and forwarded usage snapshot intact.
  const pending = sameAttempt ? existing
    : { ...state.session, hook_event_name: 'Stop', finish_reason: reason, turn_duration_ms: durationMs };
  await update($, runtime, current => ({ ...current, pendingCompletion: pending }));
  await checkpoint($, pending, async () => ({}), { finish_reason: reason, turn_duration_ms: durationMs }, true);
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    // Mod reload registers UI/commands only; it never starts a Rust session.
    resetLiveRefresh();
    await refresh($, e.cwd);
    await loadIntentSelection($);
    await $.tool.register({
      name: 'set_active_intent',
      description: 'Announce the exact Atomic intent the main conversation is actively planning, implementing, or reviewing. Call when choosing or changing the intent you actually work on; pass intent_id: null when leaving it or doing work with no current intent. This only selects a session-local UI hint; it does not approve an intent, update its status, or create an Atomic session binding. Subagents must not select the parent conversation intent.',
      inputSchema: { type: 'object', properties: { intent_id: { type: ['string', 'null'], description: 'Existing Atomic intent ID, or null to clear.' } }, required: ['intent_id'], additionalProperties: false },
    });
    await $.command.register({ name: 'atomic-status', description: 'Show Atomic view, working copy, selected intent, and repository intents', immediate: true });
    await $.command.register({ name: 'atomic-review', description: 'Review Atomic changes, dependencies, diffs, and provenance', argumentHint: '[change hash]', immediate: true });
    await $.command.register({ name: 'atomic-intent', description: 'Inspect, explicitly select, or clear this session’s active intent', argumentHint: '[intent ID | --clear]', immediate: true });
    return next(e);
  });

  on('classic.SessionStart', async ($, e, next) => {
    resetLiveRefresh();
    await update($, runtime, state => e.source === 'compact'
      ? { ...state, session: { ...(state.session || {}), ...e, prompt: state.session?.prompt } }
      : { session: e, turnId: '', steps: [], completed: '', recording: 'idle', pendingCompletion: null });
    const result = await dispatch($, e, next, 'session-start');
    await refresh($, e.cwd || await $.session.cwd());
    // Resume restores only the same identity. A new identity never inherits
    // another session's selection; clear/fork explicitly start unselected.
    await loadIntentSelection($, e.session_id, ['clear', 'fork'].includes(e.source));
    return result;
  });

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const previous = await read($, runtime);
    if (previous.pendingCompletion) {
      const recovery = await checkpoint($, previous.pendingCompletion, async () => ({}), {}, true);
      if (!recovery.confirmed && !recovery.inactive) return { block: 'Atomic could not checkpoint the previous failed interaction. Recover its checkpoint before starting another prompt; its original attribution is preserved.' };
    }
    if (previous.session?.session_id && previous.session.session_id !== e.session_id) resetLiveRefresh();
    await update($, runtime, state => ({ ...state, session: e, steps: [], completed: '', recording: 'working', pendingCompletion: null }));
    const result = await dispatch($, e, next, 'user-prompt-submit');
    const selected = await read($, activeIntent);
    if (selected.sessionId !== e.session_id) await loadIntentSelection($, e.session_id);
    return result;
  });

  on('tool.call', { tool: 'mcp__atomic__set_active_intent' }, async ($, e) => {
    if (e.agentId) return { deny: 'Only the main conversation may select its active intent. Subagents must report their intent to the parent instead.' };
    try { return { result: await selectIntent($, e.intent_id) }; }
    catch (error) { return { result: `Active intent selection failed: ${error.message ?? error}`, isError: true }; }
  });

  on('tool.call', async ($, e, next) => {
    if (e.agentId || READ_ONLY_TOOLS.has(e.tool) || e.tool === 'mcp__atomic__set_active_intent') return next(e);
    let denied = false;
    try {
      const result = await next(e);
      denied = Boolean(result.deny) || (result.isReadOnly === true && !result.isError);
      return result;
    } finally {
      // Failed actions can have partial effects. Read Atomic's actual state;
      // never infer a lifecycle status from command text or a tool result.
      if (!denied) {
        try { requestLiveRefresh($); }
        catch (error) { await update($, workspace, previous => ({ ...previous, error: `Live refresh unavailable: ${error.message ?? error}` })); }
      }
    }
  });

  on('turn.start', async ($, e, next) => {
    await update($, runtime, state => ({ ...state, turnId: e.turnId, steps: [], completed: '', recording: 'working' }));
    return next(e);
  });

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      try {
        let prior = await read($, runtime);
        if (prior.pendingCompletion) {
          const recovery = await checkpoint($, prior.pendingCompletion, async () => ({}), {}, true);
          if (!recovery.confirmed && !recovery.inactive) throw new Error('Previous Atomic checkpoint remains unconfirmed');
          prior = await read($, runtime);
        }
        if (prior.completed === e.turnId) await resumeContinuation($, prior);
      } catch (error) {
        await update($, runtime, current => ({ ...current, recording: `recovery required: ${error.message ?? error}` }));
        await $.ui.log(`Atomic continuation paused: ${error.message ?? error}`);
        await $.turn.abort({ turnId: e.turnId });
        return { turnId: e.turnId, index: e.index, answer: 'Atomic checkpoint recovery is required before continuation.', toolUses: [], stopReason: 'end_turn', usage: null };
      }
    }
    const result = yield* next(e);
    // Subagent requests have their own turn identity; don't charge them to main.
    if (!e.agentId && result.usage) {
      await update($, runtime, state => ({ ...state, steps: [
        ...state.steps.filter(step => step.index !== e.index || step.turnId !== e.turnId),
        { turnId: e.turnId, index: e.index, model: result.usage.model || e.model, usage: result.usage },
      ] }));
    }
    return result;
  });

  on('classic.PreToolUse', async ($, e, next) => {
    if (!['Task', 'Agent'].includes(e.tool)) return next(e);
    const state = await read($, runtime);
    const { tool, tool_use_id, agentId, ...input } = e;
    const payload = { ...(state.session || {}), session_id: await $.session.id(), cwd: await $.session.cwd(),
      hook_event_name: 'PreToolUse', tool_name: tool, tool_use_id, tool_input: input };
    // The native envelope is pinned host data. Adapt only Rust stdin; the
    // continuation must receive the original envelope and permission decision.
    return dispatch($, payload, () => next(e), 'pre-task');
  });

  on('classic.PostToolUse', async ($, e, next) => {
    if (e.agent_id) return next(e); // Parent tool result carries delegated work.
    let result;
    if (['Task', 'Agent'].includes(e.tool_name)) result = await dispatch($, e, next, 'post-task');
    else if (e.tool_name === 'TodoWrite') result = await dispatch($, e, next, 'post-todo');
    else result = await dispatch($, e, next, 'post-tool');
    return result;
  });

  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id) return next(e);
    const { result } = await checkpoint($, e, next);
    await refresh($, e.cwd || await $.session.cwd());
    return result;
  });

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId && (e.isAborted || ['error', 'refusal'].includes(e.reason))) await terminalCheckpoint($, e.isAborted ? 'aborted' : e.reason, e.durationMs);
    return next(e);
  });

  on('classic.StopFailure', async ($, e, next) => {
    if (!e.agent_id) await terminalCheckpoint($, 'error', 0);
    return next(e);
  });

  on('classic.SessionEnd', async ($, e, next) => {
    resetLiveRefresh();
    // Existing settings hooks retain ownership of final flush and attestation.
    // Standalone finalization is handed off so it outlives the host's 1.5s cap.
    return dispatch($, e, next, 'session-end');
  });

  on('session.end', async ($, e, next) => {
    resetLiveRefresh();
    return next(e);
  });

  on('prompt.context', async ($, e, next) => {
    const result = await next(e);
    const w = await read($, workspace);
    if (!w.root) return result;
    return { ...result, blocks: [...result.blocks.filter(block => block.name !== 'atomic'), { name: 'atomic', text: WORKFLOW }] };
  });

  on('command.run', { command: 'atomic-status' }, async ($) => {
    await refresh($, await $.session.cwd());
    const w = await read($, workspace);
    const state = await read($, runtime);
    const selected = await read($, activeIntent);
    return { text: w.root ? clip(`${w.error ? `Atomic refresh failed (showing cached data): ${w.error}\n` : ''}Atomic view: ${w.view}${w.parent ? ` (parent: ${w.parent})` : ''}\nRepository: ${w.root}\nRecording: ${state.recording}\nSelected intent (session-local): ${selected.label || selected.error || 'None'}\n\nWorking copy:\n${w.status || 'Clean'}\n\nRepository intents:\n${w.intentError ? `Lookup unavailable: ${w.intentError}` : w.intents || 'No intents'}`) : `Atomic unavailable: ${w.error}` };
  });

  on('command.run', { command: 'atomic-intent' }, async ($, e) => {
    const arg = e.args.trim();
    try {
      if (arg) return { text: await selectIntent($, arg === '--clear' ? null : arg) };
      if (!await refresh($, await $.session.cwd())) return { text: `Atomic unavailable: ${(await read($, workspace)).error}` };
      await loadIntentSelection($);
      const w = await read($, workspace);
      const selected = await read($, activeIntent);
      return { text: clip(`Selected intent (session-local): ${selected.label || selected.error || 'None'}\nUse /atomic-intent ID to explicitly select, or /atomic-intent --clear.\n\nRepository intents:\n${w.intentError ? `Lookup unavailable: ${w.intentError}` : w.intents || 'No intents'}`) };
    } catch (error) { return { text: `Active intent selection failed: ${error.message ?? error}` }; }
  });

  on('command.run', { command: 'atomic-review' }, async ($, e) => {
    if (e.args && !/^[A-Z2-7]{4,52}$/i.test(e.args.trim())) return { text: 'Supply a single Atomic change hash (4–52 base32 characters), or omit it to review the working copy.' };
    const cwd = await $.session.cwd();
    if (!await refresh($, cwd)) return { text: `Atomic unavailable: ${(await read($, workspace)).error}` };
    try {
      const hash = e.args.trim();
      const text = hash
        ? await runAtomic($, ['change', hash, '-p', '-a', '--show-deps'], cwd)
        : `Recent changes:\n${await runAtomic($, ['log', '-n', '10', '-f', 'oneline'], cwd)}\nWorking-copy token diff:\n${await runAtomic($, ['diff', '--word-diff', '--untracked'], cwd)}\nRepository intents:\n${(await read($, workspace)).intentError || (await read($, workspace)).intents || 'None'}`;
      await update($, review, () => clip(text));
      const surfaces = await $.session.surfaces();
      if (surfaces.some(surface => surface === 'terminal' || surface === 'desktop')) {
        await $.ui.open({ id: PANE, title: 'Atomic review', focus: true, closeOnEscape: true });
        return {};
      }
      return { text: clip(text) };
    } catch (error) { return { text: `Atomic review failed: ${error.message ?? error}` }; }
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const w = await read($, workspace);
    if (!w.root) return next(e);
    const state = await read($, runtime);
    const selected = await read($, activeIntent);
    const { Box, Text } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [await next(e), Text({ children: [
      clip(`Atomic · ${w.view}${w.parent ? ` ← ${w.parent}` : ''} · ${w.error ? 'refresh failed' : w.status ? 'working-copy changes' : 'clean'} · ${state.recording}${selected.label ? ` · ${selected.label}` : selected.error ? ' · intent selection unavailable' : ''}`, 500),
    ] })] });
  });

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e);
    const { Box, Text, Button } = $.ui.resolve(e);
    return Box({ flexDirection: 'column', children: [
      Text({ children: [await read($, review)] }),
      Button({ key: 'close', label: 'Close', onPress: async () => { await $.ui.close({ id: PANE }); } }),
    ] });
  });
}
