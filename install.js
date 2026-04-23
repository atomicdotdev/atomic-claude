#!/usr/bin/env node

/**
 * atomic-claude install
 *
 * Installs Atomic hooks into ~/.claude/settings.json (via atomic CLI)
 * and symlinks skills into ~/.claude/skills/.
 *
 * Usage:
 *   npx atomic-claude          # install from npm
 *   node install.js            # install from local checkout
 *   node install.js --silent   # postinstall (no output on success)
 *   node install.js --uninstall  # remove hooks and skill symlinks
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const silent = process.argv.includes("--silent");
const uninstall = process.argv.includes("--uninstall");

const PKG_DIR = __dirname;
const SKILLS_TARGET = path.join(os.homedir(), ".claude", "skills");

const SKILL_LINKS = [
  {
    src: "skills/atomic-vault/SKILL.md",
    dst: "atomic-vault/SKILL.md",
  },
  {
    src: "skills/code-intelligence/SKILL.md",
    dst: "code-intelligence/SKILL.md",
  },
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isOurSymlink(dstPath) {
  try {
    if (!fs.lstatSync(dstPath).isSymbolicLink()) return false;
    const target = fs.readlinkSync(dstPath);
    return target.startsWith(PKG_DIR);
  } catch {
    return false;
  }
}

function tryExec(cmd) {
  try {
    execSync(cmd, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function doInstall() {
  // 1. Install hooks via atomic CLI
  const hasAtomic = tryExec("atomic --version");
  if (hasAtomic) {
    const installed = tryExec("atomic agent enable --agent claude-code --global");
    if (!silent) {
      if (installed) {
        console.log("  hooks: installed into ~/.claude/settings.json");
      } else {
        console.log("  hooks: already installed (or install failed)");
      }
    }
  } else {
    if (!silent) {
      console.warn("  hooks: skipped (atomic not found on PATH)");
      console.warn("         run 'atomic agent enable --agent claude-code --global' after installing Atomic");
    }
  }

  // 2. Symlink skills
  let linked = 0;
  let skipped = 0;

  for (const { src, dst } of SKILL_LINKS) {
    const srcPath = path.join(PKG_DIR, src);
    const dstPath = path.join(SKILLS_TARGET, dst);

    if (!fs.existsSync(srcPath)) {
      if (!silent) console.warn(`  skip: ${src} (not found in package)`);
      continue;
    }

    if (fs.existsSync(dstPath) && !isOurSymlink(dstPath)) {
      skipped++;
      if (!silent) console.log(`  keep: ${dst} (user file, not overwriting)`);
      continue;
    }

    if (fs.existsSync(dstPath) || isOurSymlink(dstPath)) {
      fs.unlinkSync(dstPath);
    }

    ensureDir(dstPath);
    fs.symlinkSync(srcPath, dstPath);
    linked++;
    if (!silent) console.log(`  link: skills/${dst}`);
  }

  if (!silent) {
    console.log();
    console.log(`✓ atomic-claude installed (${linked} skills linked, ${skipped} skipped)`);
    console.log();
    console.log("Copy CLAUDE.md into your project root to enable the agent prompt:");
    console.log(`  cp ${path.join(PKG_DIR, "CLAUDE.md")} /path/to/your/project/`);
    console.log();
  }
}

function doUninstall() {
  // 1. Remove hooks via atomic CLI
  const hasAtomic = tryExec("atomic --version");
  if (hasAtomic) {
    tryExec("atomic agent disable --agent claude-code --global");
    if (!silent) console.log("  hooks: removed from ~/.claude/settings.json");
  }

  // 2. Remove skill symlinks
  let removed = 0;

  for (const { dst } of SKILL_LINKS) {
    const dstPath = path.join(SKILLS_TARGET, dst);

    if (isOurSymlink(dstPath)) {
      fs.unlinkSync(dstPath);
      removed++;
      if (!silent) console.log(`  unlink: skills/${dst}`);

      const dir = path.dirname(dstPath);
      try { fs.rmdirSync(dir); } catch { /* not empty */ }
    }
  }

  if (!silent) {
    console.log();
    console.log(`✓ atomic-claude uninstalled (${removed} skills removed)`);
    console.log("  Note: CLAUDE.md in project roots must be removed manually.");
  }
}

if (uninstall) {
  doUninstall();
} else {
  doInstall();
}
