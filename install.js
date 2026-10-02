#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { checkVersion } = require('./plugin/check-version.cjs');

const silent = process.argv.includes('--silent');
const root = __dirname;
const home = os.homedir();
const plugin = path.join(root, 'plugin');
const pluginTarget = path.join(home, '.claude', 'skills', 'atomic');
const manifest = path.join(root, 'hooks', 'claude-code.atomic-hooks.json');
const receiptPath = path.join(home, '.claude', 'atomic-claude', 'installer.json');
const components = [
  ...['atomic-vault', 'atomic-vcs', 'code-intelligence', 'intent-builder', 'codebase-context'].map(name => ({
    src: path.join(plugin, 'skills', name, 'SKILL.md'), dst: path.join(home, '.claude', 'skills', name, 'SKILL.md'),
  })),
  { src: path.join(plugin, 'agents', 'intent.md'), dst: path.join(home, '.claude', 'agents', 'intent.md') },
];

function exists(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function pointsTo(dst, src) {
  if (!src) return false;
  try { return fs.lstatSync(dst).isSymbolicLink() && path.resolve(path.dirname(dst), fs.readlinkSync(dst)) === path.resolve(src); }
  catch { return false; }
}

function loadReceipt() {
  if (!exists(receiptPath)) return { schema: 1, links: {}, hooksInstalled: false };
  const data = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  if (data.schema !== 1 || !data.links || typeof data.links !== 'object') throw new Error('Invalid installer ownership receipt; refusing to overwrite it');
  return data;
}

function saveReceipt(receipt) {
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true, mode: 0o700 });
  const tmp = receiptPath + `.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, receiptPath);
}

function owned(dst, src, receipt) {
  return pointsTo(dst, src) || pointsTo(dst, receipt.links[dst]) ||
    (src.startsWith(plugin + path.sep) && pointsTo(dst, path.join(root, path.relative(plugin, src))));
}

function link(dst, src, receipt, directory = false) {
  if (exists(dst) && !owned(dst, src, receipt)) {
    console.warn(`Warning: keeping user-owned ${dst}; this component was not installed.`);
    return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (exists(dst)) fs.unlinkSync(dst);
  fs.symlinkSync(src, dst, directory ? 'dir' : 'file');
  receipt.links[dst] = src;
  if (!silent) console.log(`  link: ${dst}`);
  return true;
}

function atomic(args) {
  try {
    return { ok: true, stdout: execFileSync('atomic', args, { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (error) {
    return { ok: false, missing: error.code === 'ENOENT', diagnostic: String(error.stderr || error.stdout || error.message).trim() };
  }
}

function compatibleAtomic(output) {
  const m = output.trim().match(/^atomic\s+(\d+)\.(\d+)\.(\d+)(?:\s|$)/);
  if (!m) return false;
  const [major, minor, patch] = m.slice(1).map(Number);
  return major > 0 || minor > 18 || (minor === 18 && patch >= 3);
}

function install(receipt) {
  const claude = checkVersion();
  if (claude.warning) console.warn(`Warning: ${claude.warning}`);
  const enabled = claude.supported && link(pluginTarget, plugin, receipt, true);
  if (!claude.supported && owned(pluginTarget, plugin, receipt)) {
    if (exists(pluginTarget)) fs.unlinkSync(pluginTarget);
    delete receipt.links[pluginTarget];
  }
  let partial = false;
  const version = atomic(['--version']);
  if (!version.ok || !compatibleAtomic(version.stdout)) {
    partial = true;
    console.warn(`Warning: recording hooks were not installed. Atomic 0.18.3+ is required. ${version.ok ? 'Unsupported version: ' + version.stdout.trim() : version.diagnostic} Install/update Atomic and rerun this installer.`);
  } else {
    const result = atomic(['agent', 'enable', '--hooks', manifest]);
    if (!result.ok) {
      partial = true;
      process.exitCode = 1;
      console.error(`Atomic hook installation failed: ${result.diagnostic}`);
    } else {
      receipt.hooksInstalled = true;
      if (!silent) console.log('  hooks: installed');
    }
  }
  for (const item of components) if (!link(item.dst, item.src, receipt)) partial = true;
  if (claude.supported && !enabled) partial = true;
  saveReceipt(receipt);
  if (!silent) {
    console.log(partial ? 'Atomic files installed with omissions; see diagnostics above.' : 'Atomic integration installed.');
    console.log(enabled ? 'Restart Claude Code or run /reload-plugins; try /atomic-status.' : `Legacy instructions: copy ${path.join(root, 'CLAUDE.md')} to your project.`);
  }
}

function uninstall(receipt) {
  let hooksRemoved = !receipt.hooksInstalled;
  const version = atomic(['--version']);
  if (version.ok) {
    const result = atomic(['agent', 'disable', '--hooks', manifest]);
    hooksRemoved = result.ok;
    if (!result.ok) { console.error(`Atomic hook removal failed: ${result.diagnostic}`); process.exitCode = 1; }
  } else if (receipt.hooksInstalled) {
    console.error(`Cannot remove installed Atomic hooks: ${version.diagnostic}. Restore Atomic on PATH and retry uninstall.`);
    process.exitCode = 1;
  }
  for (const item of [{ src: plugin, dst: pluginTarget }, ...components]) {
    if (owned(item.dst, item.src, receipt)) {
      if (exists(item.dst)) fs.unlinkSync(item.dst);
      delete receipt.links[item.dst];
    }
  }
  if (hooksRemoved) receipt.hooksInstalled = false;
  saveReceipt(receipt);
  if (!silent) console.log(hooksRemoved ? 'Installer-owned Atomic links and hook entries removed.' : 'Installer-owned links removed; hook removal remains incomplete.');
}

try {
  if (process.argv.includes('--check')) {
    const result = checkVersion();
    if (result.warning) console.warn(`Warning: ${result.warning}`);
    else console.log(`Claude Code ${result.version}: Atomic mods supported.`);
    process.exitCode = result.supported ? 0 : 1;
  } else {
    const receipt = loadReceipt();
    if (process.argv.includes('--uninstall')) uninstall(receipt);
    else install(receipt);
  }
} catch (error) { console.error(`Atomic installer failed: ${error.message}`); process.exitCode = 1; }
