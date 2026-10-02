import { expect, mock, test } from 'claude-code/testing';
import { legacyOwns, usageFields } from '../hooks/protocol.js';

const cwd = '/work/atomic project';
const classic = { session_id: 'session-1', transcript_path: '/transcript.jsonl', cwd };
const views = { schema_version: 1, repository_root: cwd, current_view: 'feature', views: [{ name: 'feature', parent: 'dev' }] };

function backend(on, options: {
  legacy?: boolean; guarded?: boolean; missing?: boolean; failStop?: boolean; surfaces?: string[]; stopPayloads?: any[];
  saved?: Map<string, any>; sessionId?: () => string; root?: () => string;
  intents?: () => { id: string; title: string; status: string }[];
  failIntentLookup?: () => boolean; failStore?: () => boolean;
  sandboxCanonical?: () => string | null;
  workingCopy?: () => string; failRead?: () => boolean;
  onTool?: (event: any) => void; toolResult?: () => any;
  holdRead?: (args: string[]) => Promise<void>;
  holdStore?: (value: any) => Promise<void>; legacyStartMatcher?: string;
  holdGet?: (value: any) => Promise<void>; failLedgerAfterPublication?: () => boolean;
} = {}) {
  const calls: { argv: string[]; init: any }[] = [];
  const saved = options.saved ?? new Map<string, any>();
  const ledger: any[] = [];
  let phase = 'idle';
  let prompt = '';
  function publish(payload: any) {
    if (phase === 'idle' && ledger.length) return;
    const previous = ledger.at(-1)?.provenance_hash ?? null;
    ledger.push({ session_id: payload.session_id, turn_number: ledger.length, goal: prompt,
      provenance_hash: 'PROV' + 'A'.repeat(ledger.length + 4), previous_provenance: previous, change_hashes: [] });
    phase = 'idle';
  }
  const clock = mock.clock(on);
  on('process.run', async ($, e) => {
    calls.push(e);
    if (e.argv[0] === 'node') return { value: { exitCode: 0, stdout: '{"started":true}', stderr: '' } };
    const args = e.argv.slice(2);
    let stdout = '';
    let exitCode = 0;
    if (args[0] === 'view') {
      stdout = JSON.stringify({ ...views, repository_root: options.root?.() ?? cwd });
      if (options.missing || options.failRead?.()) exitCode = 1;
    }
    if (args[0] === 'intent') {
      stdout = JSON.stringify(options.intents?.() ?? [{ id: 'ATOM::user::1', title: 'Mod', status: 'in_progress' }]);
      if (options.failIntentLookup?.()) exitCode = 1;
    }
    if (args[0] === 'status') stdout = options.workingCopy?.() ?? 'M  src/app.rs';
    if (args[0] === 'log') stdout = 'ABCD2345 Recorded Atomic change';
    if (args[0] === 'diff') stdout = '+changed token';
    if (args[0] === 'change') stdout = 'Dependency: ABCD2345\nProvenance: tools\nAttestation: signed';
    if (args[0] === 'session') stdout = JSON.stringify([
      { session_id: args[2], turn_count: ledger.length, latest_provenance: ledger.at(-1)?.provenance_hash ?? null }, ledger,
    ]);
    if (args[0] === 'session' && ledger.length && options.failLedgerAfterPublication?.()) exitCode = 1;
    if (args[0] === 'agent' && args[1] === 'status') stdout = JSON.stringify({ sessions: [
      { session_id: options.sessionId?.() ?? classic.session_id, phase, turn_count: ledger.length },
    ] });
    if (args[0] === 'agent' && args[3] === 'user-prompt-submit') { prompt = JSON.parse(e.init.stdin).prompt || ''; phase = 'active'; }
    if (args[0] === 'agent' && args[3] === 'stop') {
      if (options.failStop) exitCode = 1;
      else {
        const payload = JSON.parse(e.init.stdin);
        publish(payload);
        stdout = JSON.stringify({ session_id: payload.session_id, recorded: false, files: [] });
      }
    }
    await options.holdRead?.(args);
    return { value: { exitCode, stdout, stderr: exitCode ? 'backend unavailable' : '' } };
  });
  on('session.cwd', () => ({ value: cwd }));
  on('session.id', () => ({ value: options.sessionId?.() ?? classic.session_id }));
  on('store.get', async ($, e) => { const value = saved.get(e.key); await options.holdGet?.(value); return { value }; });
  on('store.set', async ($, e) => {
    if (options.failStore?.()) return { deny: 'storage unavailable' };
    await options.holdStore?.(e.value);
    saved.set(e.key, e.value);
    return { value: undefined };
  });
  on('store.delete', ($, e) => {
    if (options.failStore?.()) return { deny: 'storage unavailable' };
    saved.delete(e.key);
    return { value: undefined };
  });
  on('session.surfaces', () => ({ value: options.surfaces ?? [] }));
  on('settings.read', () => ({ value: {
    hooks: {
      ...(options.legacy ? { Stop: [{ hooks: [{ type: 'command', command: (options.guarded ? 'test -d .atomic && ' : '') + 'atomic agent hooks claude-code stop' }] }] } : {}),
      ...(options.legacyStartMatcher ? { SessionStart: [{ matcher: options.legacyStartMatcher, hooks: [{ type: 'command', command: 'atomic agent hooks claude-code session-start' }] }] } : {}),
    },
  } }));
  on('fs.exists', ($, e) => ({ value: e.path.endsWith('/.atomic-sandbox') && Boolean(options.sandboxCanonical?.()) }));
  on('fs.read', () => ({ value: JSON.stringify({ canonical: options.sandboxCanonical?.(), view: 'feature' }) }));
  on('command.register', () => ({ value: undefined }));
  on('tool.register', () => ({ value: undefined }));
  on('tool.call', ($, e) => { options.onTool?.(e); return options.toolResult?.() ?? { result: 'ok' }; });
  on('session.start', () => ({ cwd }));
  on('session.end', () => ({ sessionId: options.sessionId?.() ?? classic.session_id }));
  on('turn.start', ($, e) => ({ turnId: e.turnId }));
  on('turn.complete', () => ({ text: '' }));
  on('turn.abort', () => ({ value: undefined }));
  on('classic.SessionStart', () => ({}));
  on('classic.UserPromptSubmit', () => ({}));
  on('classic.Stop', ($, e) => {
    options.stopPayloads?.push(e);
    if (options.legacy && !options.guarded) publish(e);
    return {};
  });
  on('classic.StopFailure', () => ({}));
  on('classic.SessionEnd', () => ({}));
  on('classic.PostToolUse', () => ({}));
  on('ui.log', () => ({ value: undefined }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.close', () => ({ value: undefined }));
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['engine drawing'] }));
  on('prompt.context', ($, e) => ({ blocks: e.blocks }));
  on('turn.step', async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'answer' };
    return { turnId: e.turnId, index: e.index, answer: 'answer', toolUses: [], stopReason: 'end_turn',
      usage: { model: 'claude-test', input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } };
  });
  return Object.assign(calls, { clock });
}

async function step($, agentId?: string) {
  const stream = $.turn.step({ turnId: agentId ? 'child' : 'turn-1', index: 0, model: 'claude-test', messageCount: 1, ...(agentId ? { agentId } : {}) });
  let item = await stream.next();
  while (!item.done) item = await stream.next();
}

test('status and headless review read Atomic data without Git', async ($, on) => {
  const calls = backend(on);
  await $.session.start({ cwd, surface: null, isInteractive: false });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Atomic view: feature (parent: dev)');
  expect(status.text).toContain('ATOM::user::1');
  const review = await $.command.run({ command: 'atomic-review', args: 'ABCD2345' });
  expect(review.text).toContain('Attestation: signed');
  expect(calls.every(call => call.argv[0] === 'atomic')).toBe(true);
  expect(calls.some(call => call.init.cwd === cwd)).toBe(true);
});

test('mod reload does not create another Rust session; classic resume does', async ($, on) => {
  const calls = backend(on);
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  expect(calls.filter(call => call.argv.includes('hooks')).length).toBe(0);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'resume', model: 'claude-test' });
  const starts = calls.filter(call => call.argv.at(-1) === 'session-start');
  expect(starts.length).toBe(1);
  expect(JSON.parse(starts[0].init.stdin).source).toBe('resume');
});

test('standalone Stop forwards transcript and main-loop usage without double counting subagents', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.turn.start({ turnId: 'turn-1', text: 'Implement' });
  await step($);
  await step($, 'agent-1');
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  const stop = calls.find(call => call.argv.includes('stop'));
  const input = JSON.parse(stop!.init.stdin);
  expect(input.transcript_path).toBe(classic.transcript_path);
  expect(input.input_tokens).toBe(10);
  expect(input.cache_read_tokens).toBe(7);
  expect(input.step_count).toBe(1);
  expect(input.cost_usd).toBeUndefined();
});

test('legacy recording owner receives enriched Stop without a second subprocess', async ($, on) => {
  const stopPayloads: any[] = [];
  const calls = backend(on, { legacy: true, stopPayloads });
  await $.session.start({ cwd, surface: null, isInteractive: false });
  await $.turn.start({ turnId: 'turn-1', text: 'Implement' });
  await step($);
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  expect(calls.filter(call => call.argv.includes('stop')).length).toBe(0);
  expect(stopPayloads[0].input_tokens).toBe(10);
  expect(stopPayloads[0].transcript_path).toBe(classic.transcript_path);
});

test('nested-directory legacy guards do not suppress Atomic ancestor discovery', async ($, on) => {
  const calls = backend(on, { legacy: true, guarded: true });
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  expect(calls.filter(call => call.argv.includes('stop')).length).toBe(1);
});

test('compaction preserves current-turn usage while clear resets it', async ($, on) => {
  const stopPayloads: any[] = [];
  backend(on, { legacy: true, stopPayloads });
  await $.turn.start({ turnId: 'turn-1', text: 'Implement' });
  await step($);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'compact' });
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  expect(stopPayloads[0].input_tokens).toBe(10);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'clear' });
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  expect(stopPayloads[1].input_tokens).toBe(0);
});

test('standalone session-end hands Rust finalization to a bounded launcher', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionEnd({ ...classic, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' });
  const worker = calls.find(call => call.argv[0] === 'node');
  expect(worker).toBeDefined();
  expect(worker!.init.timeoutMs).toBe(1000);
  expect(JSON.parse(worker!.init.stdin).event.transcript_path).toBe(classic.transcript_path);
});

test('Atomic context and live band preserve existing host content', async ($, on) => {
  backend(on);
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const context = await $.prompt.context({ blocks: [{ name: 'project', text: 'Existing instructions' }], instructionFiles: [] });
  expect(context.blocks[0].text).toBe('Existing instructions');
  expect(context.blocks[1].text).toContain('graph-and-patch');
  const ui = await $.ui.mount({ plugin: 'atomic', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
    viewport: { columns: 120, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } });
  expect(await ui.find({ type: 'Text', text: 'engine drawing' })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Atomic · feature/ })).toBeDefined();
  await ui.unmount();
});

test('interrupted main turns checkpoint once; subagent completion cannot record the workspace', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.turn.start({ turnId: 'turn-1', text: 'Implement' });
  await step($);
  await $.turn.complete({ turnId: 'child', agentId: 'agent-1', answer: '', durationMs: 10, isAborted: true, reason: 'aborted' });
  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 20, isAborted: true, reason: 'aborted' });
  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 20, isAborted: true, reason: 'aborted' });
  const stops = calls.filter(call => call.argv.includes('stop'));
  expect(stops.length).toBe(1);
  expect(JSON.parse(stops[0].init.stdin).finish_reason).toBe('aborted');
});

test('backend recording failures remain visible instead of reporting success', async ($, on) => {
  backend(on, { failStop: true });
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Recording: failed: backend unavailable');
});

test('non-Atomic workspaces remain untouched and report actionable status', async ($, on) => {
  const calls = backend(on, { missing: true });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  expect(calls.filter(call => call.argv.includes('hooks')).length).toBe(0);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Atomic unavailable');
});

test('review refuses invalid hash arguments before starting a process', async ($, on) => {
  const calls = backend(on);
  const result = await $.command.run({ command: 'atomic-review', args: 'ABCD; touch /tmp/x' });
  expect(result.text).toContain('single Atomic change hash');
  expect(calls.length).toBe(0);
});

test('review pane draws and closes on terminal and desktop', async ($, on) => {
  backend(on, { surfaces: ['terminal'] });
  await $.command.run({ command: 'atomic-review', args: 'ABCD2345' });
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'atomic', surface, component: 'Pane', requestId: 'atomic-review',
      viewport: { columns: 120, rows: 40 }, props: { title: 'Atomic review', isFocused: true, bodyColumns: 80, placement: 'inline', scroll: { offset: 0, bodyRows: 15 }, view: {} } });
    expect(await ui.find({ type: 'Text', text: /Attestation: signed/ })).toBeDefined();
    await ui.press({ key: 'close' });
    await ui.unmount();
  }
});

test('usage aggregation rejects invalid counters and ownership respects tool matchers', async () => {
  expect(usageFields([{ model: 'claude-test', usage: { input_tokens: -1, output_tokens: NaN } }]).input_tokens).toBe(0);
  const settings = { hooks: { PostToolUse: [{ matcher: '^Task$', hooks: [{ type: 'command', command: 'atomic agent hooks claude-code post-task' }] }] } };
  expect(legacyOwns(settings, 'PostToolUse', 'post-task', 'Agent')).toBe(false);
  expect(legacyOwns(settings, 'PostToolUse', 'post-task', 'Task')).toBe(true);
});

const TOOL = 'mcp__atomic__set_active_intent';
const INTENT = 'ATOM::user::1';
const SECOND_INTENT = 'ATOM::user::2';
const inventory = [
  { id: INTENT, title: 'Previous work', status: 'needs-review' },
  { id: SECOND_INTENT, title: 'Explicit current work', status: 'in_progress' },
];
const BAND = { plugin: 'atomic', surface: 'terminal', component: 'AbovePrompt', requestId: 'band',
  viewport: { columns: 120, rows: 40 }, props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as const;

test('repository order and status never infer a current intent in the band', async ($, on) => {
  backend(on, { intents: () => inventory });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
  expect(status.text).toContain('Repository intents:');
  expect(status.text).toContain(INTENT);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Atomic · feature/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /ATOM::user/ })).toBeUndefined();
  await ui.unmount();
});

test('Claude explicitly selects and clears through its tool, without Atomic lifecycle mutations', async ($, on) => {
  const saved = new Map<string, any>();
  const calls = backend(on, { saved, intents: () => inventory });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const selected = await $.tool.call({ tool: TOOL, intent_id: SECOND_INTENT });
  expect(selected.result).toContain('Explicit current work');
  expect(selected.result).toContain('does not approve');
  expect(saved.size).toBe(1);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Explicit current work/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Previous work/ })).toBeUndefined();
  await ui.unmount();
  const cleared = await $.tool.call({ tool: TOOL, intent_id: null });
  expect(cleared.result).toContain('cleared');
  expect(saved.size).toBe(0);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
  expect(calls.filter(call => call.argv[2] === 'intent').every(call => call.argv[3] === 'list')).toBe(true);
  expect(calls.some(call => call.argv[2] === 'session')).toBe(false);
});

test('malformed IDs are rejected before querying and cannot change selection', async ($, on) => {
  const saved = new Map<string, any>();
  const calls = backend(on, { saved });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  const before = calls.length;
  for (const id of ['--status done', 'ATOM; touch /tmp/x', '', 'ATOM\nuser']) {
    const result = await $.tool.call({ tool: TOOL, intent_id: id });
    expect(result.isError).toBe(true);
    expect(result.result).toContain('existing Atomic intent ID');
  }
  expect(calls.length).toBe(before);
  expect([...saved.values()]).toEqual([{ id: INTENT }]);
});

test('well-formed nonexistent IDs are rejected without replacing the existing selection', async ($, on) => {
  const saved = new Map<string, any>();
  backend(on, { saved });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  const result = await $.tool.call({ tool: TOOL, intent_id: 'ATOM::user::999' });
  expect(result.isError).toBe(true);
  expect(result.result).toContain('was not found');
  expect([...saved.values()]).toEqual([{ id: INTENT }]);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): ATOM::user::1: Mod');
});

test('the user command shares validation and supports inspection and clearing', async ($, on) => {
  backend(on);
  const selected = await $.command.run({ command: 'atomic-intent', args: INTENT });
  expect(selected.text).toContain('Active intent: ATOM::user::1');
  const invalid = await $.command.run({ command: 'atomic-intent', args: 'ATOM::user::999' });
  expect(invalid.text).toContain('was not found');
  const inspected = await $.command.run({ command: 'atomic-intent', args: '' });
  expect(inspected.text).toContain('Selected intent (session-local): ATOM::user::1');
  const cleared = await $.command.run({ command: 'atomic-intent', args: '--clear' });
  expect(cleared.text).toContain('cleared');
});

test('explicit selection survives mod reload and same-identity resume, but not a fresh identity', async ($, on) => {
  const saved = new Map<string, any>();
  let sessionId = 'session-1';
  backend(on, { saved, sessionId: () => sessionId });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  let status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): ATOM::user::1');
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'resume' });
  status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): ATOM::user::1');
  sessionId = 'session-2';
  await $.classic.SessionStart({ ...classic, session_id: sessionId, hook_event_name: 'SessionStart', source: 'startup' });
  status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
  expect(saved.size).toBe(1);
});

test('clear removes a selection even if the host reuses the same session identity', async ($, on) => {
  const saved = new Map<string, any>();
  backend(on, { saved });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'clear' });
  expect([...saved.values()].filter(value => value?.id).length).toBe(0);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
});

test('repository-scoped selections do not leak when session IDs are reused across projects', async ($, on) => {
  const saved = new Map<string, any>();
  let root = cwd;
  backend(on, { saved, root: () => root });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  root = '/work/other repository';
  await $.session.start({ cwd, surface: null, isInteractive: false });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
  expect(saved.size).toBe(1);
});

test('a missing selected intent remains unresolved rather than choosing another repository intent', async ($, on) => {
  let items = inventory;
  backend(on, { intents: () => items });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  items = [inventory[1]];
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain(`Selected intent (session-local): ${INTENT} (not found)`);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /ATOM::user::1 \(not found\)/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Explicit current work/ })).toBeUndefined();
  await ui.unmount();
});

test('unsupported intent lookup keeps workspace visibility and cannot accept an unverified ID', async ($, on) => {
  const saved = new Map<string, any>();
  let unavailable = false;
  backend(on, { saved, failIntentLookup: () => unavailable });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  unavailable = true;
  const result = await $.tool.call({ tool: TOOL, intent_id: SECOND_INTENT });
  expect(result.isError).toBe(true);
  expect(result.result).toContain('Cannot verify');
  expect([...saved.values()]).toEqual([{ id: INTENT }]);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Atomic view: feature');
  expect(status.text).toContain(`${INTENT} (lookup unavailable)`);
  const cleared = await $.tool.call({ tool: TOOL, intent_id: null });
  expect(cleared.result).toContain('cleared');
});

test('subagents cannot overwrite or clear the parent intent', async ($, on) => {
  const saved = new Map<string, any>();
  const calls = backend(on, { saved, intents: () => inventory });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  const before = calls.length;
  for (const id of [SECOND_INTENT, null]) {
    const result = await $.tool.call({ tool: TOOL, intent_id: id, agentId: 'child-agent' });
    expect(result.deny).toContain('Only the main conversation');
  }
  expect(calls.length).toBe(before);
  expect([...saved.values()]).toEqual([{ id: INTENT }]);
});

test('storage failures do not claim a selection was changed or cleared', async ($, on) => {
  const saved = new Map<string, any>();
  let failing = false;
  backend(on, { saved, failStore: () => failing, intents: () => inventory });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  failing = true;
  const result = await $.tool.call({ tool: TOOL, intent_id: SECOND_INTENT });
  expect(result.isError).toBe(true);
  const clear = await $.tool.call({ tool: TOOL, intent_id: null });
  expect(clear.isError).toBe(true);
  expect([...saved.values()]).toEqual([{ id: INTENT }]);
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain(`Selected intent (session-local): ${INTENT}`);
});

test('Atomic sandboxes share the canonical repository namespace while keeping session isolation', async ($, on) => {
  const saved = new Map<string, any>();
  let root = cwd;
  let sandbox = false;
  backend(on, { saved, root: () => root, sandboxCanonical: () => sandbox ? cwd : null });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  root = '/work/materialized sandbox';
  sandbox = true;
  await $.session.start({ cwd, surface: null, isInteractive: false });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): ATOM::user::1');
  expect(saved.size).toBe(1);
});

test('fork starts unselected without deleting the parent session selection', async ($, on) => {
  const saved = new Map<string, any>();
  let sessionId = classic.session_id;
  backend(on, { saved, sessionId: () => sessionId });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  sessionId = 'fork-session';
  await $.classic.SessionStart({ ...classic, session_id: sessionId, hook_event_name: 'SessionStart', source: 'fork' });
  const status = await $.command.run({ command: 'atomic-status', args: '' });
  expect(status.text).toContain('Selected intent (session-local): None');
  expect([...saved.values()].filter(value => value?.id)).toEqual([{ id: INTENT }]);
});

test('a completed Bash action updates selected intent status and dirty state during the turn', async ($, on) => {
  let status = 'backlog';
  let dirty = '';
  const calls = backend(on, {
    intents: () => [{ id: INTENT, title: 'Current work', status }], workingCopy: () => dirty,
    onTool: () => { status = 'in_progress'; dirty = 'M  src/cli.ts'; },
  });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Current work \(backlog\)/ })).toBeDefined();
  await $.tool.call({ tool: 'Bash', command: `atomic intent update ${INTENT} --status planned && atomic intent update ${INTENT} --status in_progress` });
  await calls.clock.advance(100);
  expect(await ui.find({ type: 'Text', text: /Current work \(in_progress\)/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /working-copy changes/ })).toBeDefined();
  expect(calls.filter(call => call.argv[2] === 'intent').every(call => call.argv[3] === 'list')).toBe(true);
  await ui.unmount();
});

test('completed file edits refresh dirty state and bursts share one backend refresh', async ($, on) => {
  let dirty = '';
  const calls = backend(on, { workingCopy: () => dirty, onTool: () => { dirty = 'M  src/cli.ts'; } });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const before = calls.length;
  for (let i = 0; i < 6; i++) await $.tool.call({ tool: 'Edit', file_path: '/work/src/cli.ts', old_string: 'a', new_string: 'b' });
  expect(calls.length).toBe(before);
  await calls.clock.advance(100);
  expect(calls.length - before).toBe(3);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /working-copy changes/ })).toBeDefined();
  await ui.unmount();
});

test('changing a different intent cannot switch or alter the selected intent row', async ($, on) => {
  let otherStatus = 'backlog';
  const calls = backend(on, { intents: () => [
    { id: INTENT, title: 'Current work', status: 'planned' },
    { id: SECOND_INTENT, title: 'Other work', status: otherStatus },
  ], onTool: () => { otherStatus = 'in_progress'; } });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  await $.tool.call({ tool: 'Bash', command: `atomic intent update ${SECOND_INTENT} --status in_progress` });
  await calls.clock.advance(100);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Current work \(planned\)/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Other work/ })).toBeUndefined();
  await ui.unmount();
});

test('reads and denied actions do not refresh, while failed actions can reveal partial effects', async ($, on) => {
  let dirty = '';
  let result: any = { result: 'ok' };
  const calls = backend(on, { workingCopy: () => dirty, toolResult: () => result });
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const before = calls.length;
  await $.tool.call({ tool: 'Read', file_path: '/work/src/cli.ts' });
  result = { deny: 'permission denied' };
  await $.tool.call({ tool: 'Bash', command: 'touch file' });
  await calls.clock.advance(100);
  expect(calls.length).toBe(before);
  result = { result: 'command failed after modifying a file', isError: true };
  dirty = 'M  src/cli.ts';
  await $.tool.call({ tool: 'Bash', command: 'partial-change && false' });
  await calls.clock.advance(100);
  expect(calls.length - before).toBe(3);
});

test('a failed live refresh preserves cached intent data with an error indicator', async ($, on) => {
  let failing = false;
  const calls = backend(on, { failRead: () => failing });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  failing = true;
  await $.tool.call({ tool: 'Bash', command: 'some action' });
  await calls.clock.advance(100);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /refresh failed/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /ATOM::user::1/ })).toBeDefined();
  await ui.unmount();
});

test('session reset and exit cancel queued live reads', async ($, on) => {
  const calls = backend(on);
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  await $.tool.call({ tool: 'Bash', command: 'some action' });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'clear' });
  let before = calls.length;
  await calls.clock.advance(100);
  expect(calls.length).toBe(before);
  await $.tool.call({ tool: 'Bash', command: 'some action' });
  await $.session.end({ reason: 'prompt_input_exit' });
  before = calls.length;
  await calls.clock.advance(100);
  expect(calls.length).toBe(before);
});

test('subagent actions cannot drive parent-context live refresh', async ($, on) => {
  const calls = backend(on);
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true });
  const before = calls.length;
  await $.tool.call({ tool: 'Bash', command: 'child action', agentId: 'child-agent' });
  await calls.clock.advance(100);
  expect(calls.length).toBe(before);
});

test('an older live read cannot overwrite a newer foreground status refresh', async ($, on) => {
  let status = 'planned';
  let hold = false;
  let started: () => void;
  let release: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls = backend(on, {
    intents: () => [{ id: INTENT, title: 'Current work', status }],
    holdRead: async args => {
      if (hold && args[0] === 'intent') { hold = false; started(); await blocked; }
    },
  });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  hold = true;
  await $.tool.call({ tool: 'Bash', command: 'first action' });
  const advancing = calls.clock.advance(100);
  await entered;
  status = 'in_progress';
  await $.command.run({ command: 'atomic-status', args: '' });
  release();
  await advancing;
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Current work \(in_progress\)/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Current work \(planned\)/ })).toBeUndefined();
  await ui.unmount();
});

test('in-flight live reads cannot repaint a newly resumed session', async ($, on) => {
  let sessionId = classic.session_id;
  let items = inventory;
  let hold = false;
  let started: () => void;
  let release: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls = backend(on, {
    sessionId: () => sessionId, intents: () => items,
    holdRead: async args => { if (hold && args[0] === 'intent') { hold = false; started(); await blocked; } },
  });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  hold = true;
  await $.tool.call({ tool: 'Bash', command: 'old-session action' });
  const advancing = calls.clock.advance(100);
  await entered;
  sessionId = 'new-session';
  items = [{ id: SECOND_INTENT, title: 'New session work', status: 'in_progress' }];
  await $.classic.SessionStart({ ...classic, session_id: sessionId, hook_event_name: 'SessionStart', source: 'resume' });
  await $.tool.call({ tool: TOOL, intent_id: SECOND_INTENT });
  release();
  await advancing;
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /New session work \(in_progress\)/ })).toBeDefined();
  expect(await ui.find({ type: 'Text', text: /Previous work/ })).toBeUndefined();
  await ui.unmount();
});

test('a mutation during an in-flight live read requests one serial follow-up pass', async ($, on) => {
  let status = 'planned';
  let hold = false;
  let started: () => void;
  let release: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const calls = backend(on, {
    intents: () => [{ id: INTENT, title: 'Current work', status }],
    holdRead: async args => { if (hold && args[0] === 'intent') { hold = false; started(); await blocked; } },
  });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  const before = calls.filter(call => call.argv[2] === 'intent').length;
  hold = true;
  await $.tool.call({ tool: 'Bash', command: 'first mutation' });
  const advancing = calls.clock.advance(100);
  await entered;
  status = 'in_progress';
  await $.tool.call({ tool: 'Bash', command: 'second mutation' });
  expect(calls.filter(call => call.argv[2] === 'intent').length - before).toBe(1);
  release();
  await advancing;
  await calls.clock.advance(100);
  expect(calls.filter(call => call.argv[2] === 'intent').length - before).toBe(2);
  const ui = await $.ui.mount(BAND);
  expect(await ui.find({ type: 'Text', text: /Current work \(in_progress\)/ })).toBeDefined();
  await ui.unmount();
});

test('API-error completion checkpoints pending work before a later prompt changes attribution', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  await step($);
  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 20, reason: 'error', isAborted: false });
  const stop = calls.find(call => call.argv.includes('stop'));
  expect(JSON.parse(stop!.init.stdin).finish_reason).toBe('error');
  expect(JSON.parse(stop!.init.stdin).prompt).toBe('Original prompt');
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Later prompt' });
  expect(calls.filter(call => call.argv.includes('stop')).length).toBe(1);
});

test('continued native turns consume checkpointed usage once and restore the original Rust prompt', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  for (const index of [0, 1]) {
    const stream = $.turn.step({ turnId: 'turn-1', index, model: 'claude-test', messageCount: 1 });
    let item = await stream.next(); while (!item.done) item = await stream.next();
    await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: index > 0 });
  }
  const payloads = calls.filter(call => call.argv.includes('stop')).map(call => JSON.parse(call.init.stdin));
  expect(payloads.map(payload => payload.input_tokens)).toEqual([10, 10]);
  const prompts = calls.filter(call => call.argv.includes('user-prompt-submit')).map(call => JSON.parse(call.init.stdin).prompt);
  expect(prompts).toEqual(['Original prompt', 'Original prompt']);
});

test('native Agent envelope is adapted for Rust without changing host input', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.tool.call({ tool: 'Agent', prompt: 'Review code', description: 'Review', subagent_type: 'general-purpose' });
  const pre = calls.find(call => call.argv.includes('pre-task'));
  expect(pre).toBeDefined();
  const payload = JSON.parse(pre!.init.stdin);
  expect(payload.session_id).toBe(classic.session_id);
  expect(payload.transcript_path).toBe(classic.transcript_path);
  expect(payload.tool_name).toBe('Agent');
  expect(payload.tool_input.prompt).toBe('Review code');
});

test('SessionStart matcher ownership applies to the actual source', async ($, on) => {
  const calls = backend(on, { legacyStartMatcher: '^startup$' });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  expect(calls.filter(call => call.argv.includes('session-start')).length).toBe(0);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'resume' });
  expect(calls.filter(call => call.argv.includes('session-start')).length).toBe(1);
});

test('a delayed selection cannot undo clear or publish into a fresh session', async ($, on) => {
  let hold = true;
  let sessionId = classic.session_id;
  let entered: () => void; let release: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  backend(on, { sessionId: () => sessionId, holdStore: async value => {
    if (hold && value?.id) { hold = false; entered(); await blocked; }
  } });
  await $.session.start({ cwd, surface: null, isInteractive: false });
  const pending = $.tool.call({ tool: TOOL, intent_id: INTENT });
  await started;
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'clear' });
  sessionId = 'fresh-session';
  await $.classic.SessionStart({ ...classic, session_id: sessionId, hook_event_name: 'SessionStart', source: 'startup' });
  release();
  expect((await pending).isError).toBe(true);
  const fresh = await $.command.run({ command: 'atomic-intent', args: '' });
  expect(fresh.text).toContain('Selected intent (session-local): None');
  sessionId = classic.session_id;
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'resume' });
  expect((await $.command.run({ command: 'atomic-intent', args: '' })).text).toContain('Selected intent (session-local): None');
});

test('all foreground reads reject stale publication, not only background reads', async ($, on) => {
  let status = 'planned'; let hold = false;
  let entered: () => void; let release: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  backend(on, { intents: () => [{ id: INTENT, title: 'Current', status }], holdRead: async args => {
    if (hold && args[0] === 'intent') { hold = false; entered(); await blocked; }
  } });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  hold = true;
  const old = $.command.run({ command: 'atomic-status', args: '' });
  await started;
  status = 'in_progress';
  await $.command.run({ command: 'atomic-status', args: '' });
  release();
  expect((await old).text).toContain('Current (in_progress)');
});

test('host-reported read-only Bash suppresses polling while failed read-only actions still refresh', async ($, on) => {
  let result: any = { result: 'ok', isReadOnly: true };
  const calls = backend(on, { toolResult: () => result });
  await $.session.start({ cwd, surface: null, isInteractive: false });
  const before = calls.length;
  await $.tool.call({ tool: 'Bash', command: 'pwd' });
  await calls.clock.advance(100);
  expect(calls.length).toBe(before);
  result = { result: 'failure', isReadOnly: true, isError: true };
  await $.tool.call({ tool: 'Bash', command: 'some failed operation' });
  await calls.clock.advance(100);
  expect(calls.length).toBe(before + 3);
});

test('compaction preserves prompt through checkpoint and same-turn continuation', async ($, on) => {
  const calls = backend(on);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  await step($);
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'compact' });
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  const stream = $.turn.step({ turnId: 'turn-1', index: 1, model: 'claude-test', messageCount: 2 });
  let item = await stream.next(); while (!item.done) item = await stream.next();
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: true });
  const stops = calls.filter(call => call.argv.includes('stop')).map(call => JSON.parse(call.init.stdin));
  expect(stops.map(payload => payload.input_tokens)).toEqual([10, 10]);
  expect(stops.every(payload => payload.prompt === 'Original prompt')).toBe(true);
});

test('lost legacy after-observation recovers its original baseline before a later prompt', async ($, on) => {
  let fail = true;
  const calls = backend(on, { legacy: true, failLedgerAfterPublication: () => fail });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  await step($);
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  fail = false;
  const result = await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Later prompt' });
  expect(result.block).toBeUndefined();
  expect(calls.filter(call => call.argv.includes('stop')).length).toBe(0);
});

test('lost checkpoint observation is resolved before continuing usage collection', async ($, on) => {
  let fail = true;
  const payloads: any[] = [];
  backend(on, { legacy: true, stopPayloads: payloads, failLedgerAfterPublication: () => fail });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  await step($);
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  fail = false;
  const stream = $.turn.step({ turnId: 'turn-1', index: 1, model: 'claude-test', messageCount: 2 });
  let item = await stream.next(); while (!item.done) item = await stream.next();
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: true });
  expect(payloads.map(payload => payload.input_tokens)).toEqual([10, 10]);
});

test('delayed inspection cannot overwrite a newer selection in the same session', async ($, on) => {
  let hold = false;
  let entered: () => void; let release: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  backend(on, { intents: () => inventory, holdGet: async value => {
    if (hold && value?.id) { hold = false; entered(); await blocked; }
  } });
  await $.tool.call({ tool: TOOL, intent_id: INTENT });
  hold = true;
  const inspecting = $.command.run({ command: 'atomic-intent', args: '' });
  await started;
  await $.tool.call({ tool: TOOL, intent_id: SECOND_INTENT });
  release();
  await inspecting;
  expect((await $.command.run({ command: 'atomic-status', args: '' })).text).toContain(`Selected intent (session-local): ${SECOND_INTENT}`);
});

test('host abort completion preserves a published pending checkpoint for recovered later prompts', async ($, on) => {
  let fail = true;
  const calls = backend(on, { legacy: true, failLedgerAfterPublication: () => fail });
  await $.classic.SessionStart({ ...classic, hook_event_name: 'SessionStart', source: 'startup' });
  await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Original prompt' });
  await $.turn.start({ turnId: 'turn-1', text: 'Original prompt' });
  await step($);
  await $.classic.Stop({ ...classic, hook_event_name: 'Stop', stop_hook_active: false });
  const stream = $.turn.step({ turnId: 'turn-1', index: 1, model: 'claude-test', messageCount: 2 });
  let item = await stream.next(); while (!item.done) item = await stream.next();
  expect(item.value.usage).toBe(null);
  await $.turn.complete({ turnId: 'turn-1', answer: '', durationMs: 20, reason: 'aborted', isAborted: true });
  fail = false;
  const later = await $.classic.UserPromptSubmit({ ...classic, hook_event_name: 'UserPromptSubmit', prompt: 'Later prompt' });
  expect(later.block).toBeUndefined();
  const prompts = calls.filter(call => call.argv.includes('user-prompt-submit')).map(call => JSON.parse(call.init.stdin).prompt);
  expect(prompts).toEqual(['Original prompt', 'Later prompt']);
});
