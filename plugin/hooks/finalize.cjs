// SessionEnd has a 1.5s host budget. A short-lived launcher hands the original
// payload to a detached worker; only Atomic's Rust handler flushes and attests.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input);
    if (typeof payload.cwd !== 'string' || typeof payload.event?.session_id !== 'string') throw new Error('Invalid finalization payload');
    const id = crypto.createHash('sha256').update(payload.cwd + '\0' + payload.event.session_id).digest('hex').slice(0, 24);
    const log = path.join(os.tmpdir(), `atomic-claude-finalize-${id}.log`);
    if (!process.argv.includes('--worker')) {
      const child = spawn(process.execPath, [__filename, '--worker'], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.stdin.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.once('spawn', () => {
        child.stdin.end(input, () => {
          child.unref();
          console.log(JSON.stringify({ started: true, log }));
        });
      });
      return;
    }
    const fd = fs.openSync(log, 'a', 0o600);
    const child = spawn('atomic', ['--no-color', 'agent', 'hooks', 'claude-code', 'session-end'], {
      cwd: payload.cwd, stdio: ['pipe', fd, fd],
    });
    child.on('error', error => { fs.writeSync(fd, `Finalization failed: ${error.message}\n`); fs.closeSync(fd); process.exitCode = 1; });
    child.stdin.on('error', () => {});
    child.once('spawn', () => child.stdin.end(JSON.stringify(payload.event)));
    child.on('exit', code => { fs.writeSync(fd, `Atomic session-end exited ${code}\n`); fs.closeSync(fd); process.exitCode = code === 0 ? 0 : 1; });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
