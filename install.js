#!/usr/bin/env node

/**
 * atomic-claude install
 *
 * Installs Atomic hooks into ~/.claude/settings.json (via atomic CLI)
 * and symlinks skills and agents into ~/.claude/.
 *
 * Usage:
 *   npx atomic-claude          # install from npm
 *   node install.js            # install from local checkout
 *   node install.js --silent   # postinstall (no output on success)
 *   node install.js --uninstall  # remove hooks, skill links, and agent links
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const silent = process.argv.includes("--silent");
const uninstall = process.argv.includes("--uninstall");

const PKG_DIR = __dirname;
const SKILLS_TARGET = path.join(os.homedir(), ".claude", "skills");
const AGENTS_TARGET = path.join(os.homedir(), ".claude", "agents");
const MANIFEST = path.join(PKG_DIR, "hooks", "claude-code.atomic-hooks.json");

const SKILL_LINKS = [
  {
    src: "skills/atomic-vault/SKILL.md",
    dst: "atomic-vault/SKILL.md",
  },
  {
    src: "skills/atomic-vcs/SKILL.md",
    dst: "atomic-vcs/SKILL.md",
  },
  {
    src: "skills/code-intelligence/SKILL.md",
    dst: "code-intelligence/SKILL.md",
  },
  {
    src: "skills/intent-builder/SKILL.md",
    dst: "intent-builder/SKILL.md",
  },
  {
    src: "skills/codebase-context/SKILL.md",
    dst: "codebase-context/SKILL.md",
  },
];

const AGENT_LINKS = [
  {
    src: "agents/intent.md",
    dst: "intent.md",
  },
];

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function entryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function isOurSymlink(dstPath, expectedSrcPath) {
  try {
    if (!fs.lstatSync(dstPath).isSymbolicLink()) return false;
    const target = fs.readlinkSync(dstPath);
    const resolvedTarget = path.resolve(path.dirname(dstPath), target);
    return resolvedTarget === path.resolve(expectedSrcPath);
  } catch {
    return false;
  }
}

function tryExec(command, args = []) {
  try {
    execFileSync(command, args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function doInstall() {
  // 1. Register hooks by delegating the merge to the atomic binary. The
  //    manifest in this repo is the source of truth — when Claude Code changes
  //    its hook schema, edit the manifest and re-publish; no `atomic` rebuild.
  const hasAtomic = tryExec("atomic", ["--version"]);
  if (hasAtomic) {
    const installed = tryExec("atomic", ["agent", "enable", "--hooks", MANIFEST]);
    if (!silent) {
      console.log(
        installed
          ? "  hooks: registered via atomic agent enable --hooks → ~/.claude/settings.json"
          : "  hooks: enable failed (see output above)",
      );
    }
  } else {
    if (!silent) {
      console.warn("  hooks: skipped (atomic not found on PATH)");
      console.warn(
        `         after installing Atomic, run: atomic agent enable --hooks "${MANIFEST}"`,
      );
    }
  }

  // 2. Symlink skills
  let linked = 0;
  let skipped = 0;

  for (const { src, dst } of SKILL_LINKS) {
    const srcPath = path.join(PKG_DIR, src);
    const dstPath = path.join(SKILLS_TARGET, dst);
    const dstExists = entryExists(dstPath);

    if (!fs.existsSync(srcPath)) {
      if (!silent) console.warn(`  skip: ${src} (not found in package)`);
      continue;
    }

    if (dstExists && !isOurSymlink(dstPath, srcPath)) {
      skipped++;
      if (!silent) console.log(`  keep: ${dst} (user file, not overwriting)`);
      continue;
    }

    if (dstExists) {
      fs.unlinkSync(dstPath);
    }

    ensureDir(dstPath);
    fs.symlinkSync(srcPath, dstPath);
    linked++;
    if (!silent) console.log(`  link: skills/${dst}`);
  }

  // 3. Symlink agents
  let agentsLinked = 0;

  for (const { src, dst } of AGENT_LINKS) {
    const srcPath = path.join(PKG_DIR, src);
    const dstPath = path.join(AGENTS_TARGET, dst);
    const dstExists = entryExists(dstPath);

    if (!fs.existsSync(srcPath)) {
      if (!silent) console.warn(`  skip: ${src} (not found in package)`);
      continue;
    }

    if (dstExists && !isOurSymlink(dstPath, srcPath)) {
      skipped++;
      if (!silent) console.log(`  keep: agents/${dst} (user file, not overwriting)`);
      continue;
    }

    if (dstExists) {
      fs.unlinkSync(dstPath);
    }

    ensureDir(dstPath);
    fs.symlinkSync(srcPath, dstPath);
    agentsLinked++;
    if (!silent) console.log(`  link: agents/${dst}`);
  }

  if (!silent) {
    console.log();
    console.log(
      `✓ atomic-claude installed (${linked} skills, ${agentsLinked} agents linked, ${skipped} skipped)`,
    );
    console.log();
    console.log(
      "Copy CLAUDE.md into your project root to enable the agent prompt:",
    );
    console.log(
      `  cp ${path.join(PKG_DIR, "CLAUDE.md")} /path/to/your/project/`,
    );
    console.log();
  }
}

function doUninstall() {
  // 1. Remove hooks via the same manifest (delegated to the atomic binary)
  const hasAtomic = tryExec("atomic", ["--version"]);
  if (hasAtomic) {
    tryExec("atomic", ["agent", "disable", "--hooks", MANIFEST]);
    if (!silent) console.log("  hooks: removed from ~/.claude/settings.json");
  }

  // 2. Remove skill symlinks
  let removed = 0;

  for (const { src, dst } of SKILL_LINKS) {
    const srcPath = path.join(PKG_DIR, src);
    const dstPath = path.join(SKILLS_TARGET, dst);

    if (isOurSymlink(dstPath, srcPath)) {
      fs.unlinkSync(dstPath);
      removed++;
      if (!silent) console.log(`  unlink: skills/${dst}`);

      const dir = path.dirname(dstPath);
      try {
        fs.rmdirSync(dir);
      } catch {
        /* not empty */
      }
    }
  }

  // 3. Remove agent symlinks
  for (const { src, dst } of AGENT_LINKS) {
    const srcPath = path.join(PKG_DIR, src);
    const dstPath = path.join(AGENTS_TARGET, dst);

    if (isOurSymlink(dstPath, srcPath)) {
      fs.unlinkSync(dstPath);
      removed++;
      if (!silent) console.log(`  unlink: agents/${dst}`);
    }
  }

  if (!silent) {
    console.log();
    console.log(`✓ atomic-claude uninstalled (${removed} links removed)`);
    console.log("  Note: CLAUDE.md in project roots must be removed manually.");
  }
}

if (uninstall) {
  doUninstall();
} else {
  doInstall();
}
