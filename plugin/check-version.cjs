#!/usr/bin/env node
const { execFileSync } = require('node:child_process');

const MINIMUM = '2.1.287';

function checkVersion() {
  let output;
  try {
    output = execFileSync('claude', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    return { supported: false, warning: `Cannot check Claude Code (${error.code === 'ENOENT' ? 'claude is not on PATH' : 'claude --version failed'}). Atomic mods require Claude Code ${MINIMUM} or later. Install/update Claude Code, then rerun the installer. Legacy Atomic hooks and skills remain available.` };
  }
  const match = output.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?(?:\s+\(Claude Code\))?$/);
  if (!match) return { supported: false, warning: `Unrecognized Claude Code version output. Atomic mods require ${MINIMUM} or later. Check claude --version and update Claude Code, then rerun the installer. Legacy Atomic hooks and skills remain available.` };
  const parts = match.slice(1, 4).map(Number);
  const minimum = MINIMUM.split('.').map(Number);
  let comparison = 0;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== minimum[i]) { comparison = parts[i] > minimum[i] ? 1 : -1; break; }
  }
  const supported = comparison > 0 || (comparison === 0 && !match[4]);
  return supported ? { supported, version: output } : {
    supported, version: output,
    warning: `Claude Code ${output} does not meet Atomic's mod minimum (${MINIMUM}). Update Claude Code and rerun the installer. Installing legacy Atomic hooks and skills instead; the mod UI will not load.`,
  };
}

module.exports = { MINIMUM, checkVersion };

if (require.main === module) {
  const result = checkVersion();
  if (process.argv.includes('--hook')) {
    if (result.warning) console.log(JSON.stringify({ systemMessage: result.warning }));
  } else {
    if (result.warning) console.warn(`Warning: ${result.warning}`);
    else console.log(`Claude Code ${result.version}: Atomic mods supported (minimum ${MINIMUM}).`);
    process.exitCode = result.supported ? 0 : 1;
  }
}
