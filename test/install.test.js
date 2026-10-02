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
    assert.equal(fs.realpathSync(agentPath), path.join(root, "plugin", "agents", "intent.md"));

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

function fixture(version) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-claude-version-"));
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  if (version !== null) {
    const cli = path.join(bin, "claude");
    fs.writeFileSync(cli, `#!${process.execPath}\nconsole.log(${JSON.stringify(version)});\n`);
    fs.chmodSync(cli, 0o755);
  }
  return { home, env: { ...process.env, HOME: home, PATH: bin } };
}

for (const version of ["2.1.286 (Claude Code)", "2.1.287-beta (Claude Code)", "invalid", null]) {
  test(`installer warns in silent mode and uses legacy fallback for ${version}`, () => {
    const { home, env } = fixture(version);
    try {
      const result = spawnSync(process.execPath, [installer, "--silent"], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /Warning:.*2\.1\.287/);
      assert.equal(fs.existsSync(path.join(home, ".claude", "skills", "atomic")), false);
      assert.equal(fs.existsSync(path.join(home, ".claude", "agents", "intent.md")), true);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

for (const version of ["2.1.287 (Claude Code)", "2.1.288 (Claude Code)", "2.2.0", "3.0.0"]) {
  test(`installer loads the plugin at supported version ${version}`, () => {
    const { home, env } = fixture(version);
    try {
      const result = spawnSync(process.execPath, [installer, "--silent"], { env, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /recording hooks were not installed/);
      const target = path.join(home, ".claude", "skills", "atomic");
      assert.equal(fs.realpathSync(target), path.join(root, "plugin"));
      const uninstall = spawnSync(process.execPath, [installer, "--silent", "--uninstall"], { env, encoding: "utf8" });
      assert.equal(uninstall.status, 0, uninstall.stderr);
      assert.equal(fs.existsSync(target), false);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test("installer preserves a user-owned plugin directory", () => {
  const { home, env } = fixture("2.1.287");
  const target = path.join(home, ".claude", "skills", "atomic");
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, "SKILL.md"), "User skill");
    const result = spawnSync(process.execPath, [installer, "--silent"], { env, encoding: "utf8" });
    assert.match(result.stderr, /keeping user-owned/);
    assert.equal(fs.readFileSync(path.join(target, "SKILL.md"), "utf8"), "User skill");
    spawnSync(process.execPath, [installer, "--silent", "--uninstall"], { env });
    assert.equal(fs.existsSync(target), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("--check reports compatibility without installing anything", () => {
  const { home, env } = fixture("2.1.286");
  try {
    const result = spawnSync(process.execPath, [installer, "--check"], { env, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /2\.1\.287/);
    assert.equal(fs.existsSync(path.join(home, ".claude")), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("a failing version command warns rather than silently assuming mod support", () => {
  const { home, env } = fixture("2.1.287");
  try {
    fs.appendFileSync(path.join(home, "bin", "claude"), "process.exitCode = 3;\n");
    const result = spawnSync(process.execPath, [installer, "--silent"], { env, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /claude --version failed/);
    assert.equal(fs.existsSync(path.join(home, ".claude", "skills", "atomic")), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test("downgrade removes only the installer-owned mod and retains the legacy agent", () => {
  const { home, env } = fixture("2.1.287");
  try {
    spawnSync(process.execPath, [installer, "--silent"], { env });
    fs.writeFileSync(path.join(home, "bin", "claude"), `#!${process.execPath}\nconsole.log('2.1.286');\n`);
    const result = spawnSync(process.execPath, [installer, "--silent"], { env, encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stderr, /mod minimum/);
    assert.equal(fs.existsSync(path.join(home, ".claude", "skills", "atomic")), false);
    assert.equal(fs.existsSync(path.join(home, ".claude", "agents", "intent.md")), true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

function fakeAtomic(home, mode) {
  const file = path.join(home, 'bin', 'atomic');
  fs.writeFileSync(file, `#!${process.execPath}\nif(process.argv.includes('--version')) console.log('atomic 0.18.3'); else if(process.argv.includes(${JSON.stringify(mode)})){ console.error('Permission denied: settings.json'); process.exitCode=2; }\n`);
  fs.chmodSync(file, 0o755);
}

test('failed hook installation/removal remains visible in silent mode and exits nonzero', () => {
  const { home, env } = fixture('2.1.287');
  try {
    fakeAtomic(home, 'enable');
    let result = spawnSync(process.execPath, [installer, '--silent'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hook installation failed.*Permission denied/);
    fakeAtomic(home, 'never');
    assert.equal(spawnSync(process.execPath, [installer, '--silent'], { env }).status, 0);
    fakeAtomic(home, 'disable');
    result = spawnSync(process.execPath, [installer, '--silent', '--uninstall'], { env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hook removal failed.*Permission denied/);
    const receipt = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'atomic-claude', 'installer.json'), 'utf8'));
    assert.equal(receipt.hooksInstalled, true);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('ownership receipt migrates installed links across package locations and handles downgrade', () => {
  const { home, env } = fixture('2.1.287');
  const packages = path.join(home, 'packages');
  try {
    for (const name of ['a', 'b']) {
      const target = path.join(packages, name);
      fs.mkdirSync(target, { recursive: true });
      fs.copyFileSync(installer, path.join(target, 'install.js'));
      fs.cpSync(path.join(root, 'plugin'), path.join(target, 'plugin'), { recursive: true, filter: src => !src.includes('/.claude-plugin/types') });
    }
    const first = path.join(packages, 'a', 'install.js');
    const second = path.join(packages, 'b', 'install.js');
    assert.equal(spawnSync(process.execPath, [first, '--silent'], { env }).status, 0);
    assert.equal(spawnSync(process.execPath, [second, '--silent'], { env }).status, 0);
    fs.rmSync(path.join(packages, 'a'), { recursive: true });
    assert.equal(fs.realpathSync(path.join(home, '.claude', 'skills', 'atomic')), fs.realpathSync(path.join(packages, 'b', 'plugin')));
    assert.equal(fs.realpathSync(path.join(home, '.claude', 'agents', 'intent.md')), fs.realpathSync(path.join(packages, 'b', 'plugin', 'agents', 'intent.md')));
    fs.writeFileSync(path.join(home, 'bin', 'claude'), `#!${process.execPath}\nconsole.log('2.1.286');\n`);
    // The original installer location can remove links owned by the receipt
    // even though those links now point to the second package location.
    assert.equal(spawnSync(process.execPath, [installer, '--silent'], { env }).status, 0);
    assert.equal(fs.existsSync(path.join(home, '.claude', 'skills', 'atomic')), false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('storage distribution stages inert plugin files instead of populating a user discovery slot', () => {
  const manifest = fs.readFileSync(path.join(root, 'atomic-integration.toml'), 'utf8');
  const destinations = [...manifest.matchAll(/^dst = "([^"]+)"/gm)].map(match => match[1]);
  assert.equal(destinations.some(dst => dst.startsWith('~/.claude/skills/atomic/')), false);
  assert.ok(destinations.includes('~/.atomic/claude-code/activation/install.js'));
  assert.ok(destinations.includes('~/.atomic/claude-code/activation/plugin/.claude-plugin/plugin.json'));
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
