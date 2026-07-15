const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const installer = path.join(root, "install.js");

test("npm installer links and unlinks the intent agent", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-claude-install-"));
  const env = { ...process.env, HOME: home, PATH: "" };

  try {
    const install = spawnSync(process.execPath, [installer, "--silent"], {
      env,
      encoding: "utf8",
    });
    assert.equal(install.status, 0, install.stderr);

    const agentPath = path.join(home, ".claude", "agents", "intent.md");
    assert.equal(fs.lstatSync(agentPath).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(agentPath), path.join(root, "agents", "intent.md"));

    for (const skill of [
      "atomic-vault",
      "atomic-vcs",
      "code-intelligence",
      "intent-builder",
      "codebase-context",
    ]) {
      const skillPath = path.join(home, ".claude", "skills", skill, "SKILL.md");
      assert.equal(fs.lstatSync(skillPath).isSymbolicLink(), true, skill);
    }

    const uninstall = spawnSync(
      process.execPath,
      [installer, "--silent", "--uninstall"],
      { env, encoding: "utf8" },
    );
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.existsSync(agentPath), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("installer preserves a dangling user-owned agent symlink", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-claude-install-"));
  const env = { ...process.env, HOME: home, PATH: "" };
  const agentDir = path.join(home, ".claude", "agents");
  const agentPath = path.join(agentDir, "intent.md");
  const userTarget = path.join(root, "agents", "missing-user-agent.md");

  try {
    fs.mkdirSync(agentDir, { recursive: true });
    fs.symlinkSync(userTarget, agentPath);

    const install = spawnSync(process.execPath, [installer, "--silent"], {
      env,
      encoding: "utf8",
    });
    assert.equal(install.status, 0, install.stderr);
    assert.equal(fs.readlinkSync(agentPath), userTarget);

    const uninstall = spawnSync(
      process.execPath,
      [installer, "--silent", "--uninstall"],
      { env, encoding: "utf8" },
    );
    assert.equal(uninstall.status, 0, uninstall.stderr);
    assert.equal(fs.readlinkSync(agentPath), userTarget);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
