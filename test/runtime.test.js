const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('Rust hooks record supplied token provenance, reuse views, and finalize through the worker', { timeout: 30000 }, async t => {
  if (spawnSync('atomic', ['--version']).error) return t.skip('Atomic CLI not installed');
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-claude-runtime-'));
  let log;
  function atomic(args, input) {
    const result = spawnSync('atomic', ['--no-color', ...args], { cwd, encoding: 'utf8', input, timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  const event = { cwd, session_id: 'atomic-claude-runtime-test', model: 'claude-test', source: 'startup' };
  function hook(verb, extra = {}) {
    return atomic(['agent', 'hooks', 'claude-code', verb, '--json'], JSON.stringify({ ...event, ...extra }));
  }
  try {
    atomic(['init']);
    hook('session-start');
    const first = JSON.parse(atomic(['view', 'list', '--json']));
    hook('session-start', { source: 'resume' });
    const resumed = JSON.parse(atomic(['view', 'list', '--json']));
    assert.equal(resumed.current_view, first.current_view);
    assert.equal(resumed.views.length, first.views.length);
    hook('user-prompt-submit', { prompt: 'Implement runtime provenance fixture' });
    fs.writeFileSync(path.join(cwd, 'example.txt'), 'Atomic graph-and-patch fixture\n');
    hook('post-tool', { tool_use_id: 'write-1', tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'example.txt') }, tool_response: 'ok' });
    const result = JSON.parse(hook('stop', { input_tokens: 17, output_tokens: 9, cache_read_tokens: 5, step_count: 1 }));
    assert.equal(result.recorded, true);
    const change = JSON.parse(atomic(['change', result.change_hash, '-f', 'json']));
    assert.equal(change.provenance.model, 'claude-test');
    assert.equal(change.provenance.tokens.input, 17);
    assert.equal(change.provenance.tokens.output, 9);
    assert.equal(change.provenance.cost, undefined);
    assert.equal(JSON.parse(hook('stop')).recorded, false, 'repeated Stop must not create another change');
    // A continuing native turn opens another Rust checkpoint with its original
    // prompt and only outstanding usage, rather than cumulative counters.
    hook('user-prompt-submit', { prompt: 'Implement runtime provenance fixture' });
    fs.writeFileSync(path.join(cwd, 'continued.txt'), 'continued edit\n');
    hook('post-tool', { tool_use_id: 'write-2', tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'continued.txt') }, tool_response: 'ok' });
    const continued = JSON.parse(hook('stop', { input_tokens: 17, output_tokens: 9, step_count: 1, finish_reason: 'error' }));
    const continuedChange = JSON.parse(atomic(['change', continued.change_hash, '-f', 'json']));
    assert.equal(change.provenance.tokens.input + continuedChange.provenance.tokens.input, 34);
    assert.equal(continuedChange.provenance.finish_reason, 'error');
    const ledger = JSON.parse(atomic(['session', 'show', event.session_id, '--json']));
    assert.equal(ledger[1].length, 2);
    assert.equal(ledger[1][1].previous_provenance, ledger[1][0].provenance_hash);
    assert.equal(ledger[1][1].goal, 'Implement runtime provenance fixture');
    hook('user-prompt-submit', { prompt: 'A later prompt' });
    fs.writeFileSync(path.join(cwd, 'later.txt'), 'later edit\n');
    hook('post-tool', { tool_use_id: 'write-3', tool_name: 'Write', tool_input: { file_path: path.join(cwd, 'later.txt') }, tool_response: 'ok' });
    const later = JSON.parse(hook('stop', { input_tokens: 3, output_tokens: 1 }));
    const laterChange = JSON.parse(atomic(['change', later.change_hash, '-f', 'json']));
    assert.equal(laterChange.message, 'A later prompt');
    assert.equal(continuedChange.message, 'Implement runtime provenance fixture');
    const launch = spawnSync(process.execPath, [path.join(__dirname, '..', 'plugin', 'hooks', 'finalize.cjs')], {
      cwd, encoding: 'utf8', timeout: 1000, input: JSON.stringify({ cwd, event }),
    });
    assert.equal(launch.status, 0, launch.stderr);
    const launched = JSON.parse(launch.stdout);
    assert.equal(launched.started, true);
    log = launched.log;
    for (let i = 0; i < 100; i++) {
      if (fs.existsSync(log) && fs.readFileSync(log, 'utf8').includes('Atomic session-end exited 0')) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.match(fs.readFileSync(log, 'utf8'), /Atomic session-end exited 0/);
    const sessions = JSON.parse(atomic(['agent', 'status', '--json'])).sessions;
    assert.equal(sessions.find(session => session.session_id === event.session_id).phase, 'ended');
    assert.equal(JSON.parse(atomic(['view', 'list', '--json'])).current_view, first.current_view);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    if (log) fs.rmSync(log, { force: true });
  }
});
