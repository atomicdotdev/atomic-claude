# atomic-claude

[Atomic VCS](https://atomic.dev) integration for [Claude Code](https://code.claude.com).

Automatic turn recording with AI provenance, intent tracking, and knowledge graph skills.

## What it does

- **1 session = 1 view** — a draft view is created automatically when you start Claude Code
- **Every turn records with provenance** — model, vendor, session, turn number, timing
- **Tool executions tracked** — reads, edits, bash calls captured in a causal decision graph
- **Intent workflow** — CLAUDE.md prompt guides problem-first development with vault intents
- **Skills on demand** — `/atomic-vault` and `/code-intelligence` loaded when needed

## Install

### Quick start

```bash
# Clone and install
git clone https://github.com/atomicdotdev/atomic-claude
cd atomic-claude
./install.sh

# Copy the agent prompt into your project
cp CLAUDE.md /path/to/your/project/
```

### From npm (once published)

```bash
npx atomic-claude
```

### What install does

1. **Hooks** — runs `atomic agent enable --agent claude-code --global` to install hook entries into `~/.claude/settings.json`
2. **Skills** — symlinks `/atomic-vault` and `/code-intelligence` into `~/.claude/skills/`
3. **CLAUDE.md** — must be copied to each project root manually (Claude Code auto-discovers it)

## Prerequisites

- [Atomic VCS](https://atomic.dev) installed and on your PATH (`atomic --version`)
- A project with an `.atomic/` repository (`atomic init`)
- [Claude Code](https://code.claude.com) installed

## Usage

```bash
cd my-project
atomic init              # if not already an atomic repo
cp /path/to/atomic-claude/CLAUDE.md .  # copy agent prompt
claude                   # start Claude Code — hooks activate automatically
```

The hooks automatically:

1. Create a draft view when the session starts
2. Track your prompt and model info
3. Record tool executions in a provenance graph
4. Record changes with full AI attestation when a turn ends

You never need to run `atomic add` or `atomic record` — the hooks handle it.

## Viewing provenance

```bash
# Show the causal decision graph (goals → tool calls → patch)
atomic change -p <hash>

# Show inline AI attestation (model, tokens, cost)
atomic change -a <hash>

# Show session-level attestations
atomic agent attest
```

## What's in the package

| File | Purpose |
|------|---------|
| `CLAUDE.md` | Agent prompt — copy to project roots for intent-per-turn workflow |
| `skills/atomic-vault/SKILL.md` | Vault reference (`/atomic-vault` skill) |
| `skills/code-intelligence/SKILL.md` | Knowledge graph query patterns (`/code-intelligence` skill) |
| `install.js` | Installs hooks + symlinks skills into `~/.claude/` |
| `install.sh` | Development install |

## How hooks work

Claude Code has a native hook system in `.claude/settings.json`. The Atomic CLI writes hook entries that call back to `atomic agent hooks claude-code <verb>`:

```
Claude Code session start
  │
  ├── Hook fires SessionStart → Rust creates haikunator-named draft view
  │
  ├── User sends prompt
  │   ├── Hook fires UserPromptSubmit → Rust saves prompt + model on session
  │   ├── Agent works (edits, bash, reads)
  │   │   ├── Hook fires PreToolUse[Task] → Rust tracks sub-agent timing
  │   │   └── Hook fires PostToolUse[Task] → Rust appends to provenance graph
  │   └── Turn ends
  │       └── Hook fires Stop → Rust adds files, records change with provenance
  │
  ├── User sends another prompt → repeat
  │
  └── Session ends
      └── Hook fires SessionEnd → Rust creates attestation
```

## Uninstall

```bash
npx atomic-claude --uninstall
```

Or manually:

```bash
atomic agent disable --agent claude-code --global
rm ~/.claude/skills/atomic-vault/SKILL.md
rm ~/.claude/skills/code-intelligence/SKILL.md
```

CLAUDE.md files in project roots must be removed manually.

## License

Apache-2.0 — same as [Atomic VCS](https://github.com/atomicdotdev/atomic).
