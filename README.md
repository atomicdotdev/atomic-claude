# atomic-claude

[Atomic VCS](https://atomic.dev) integration for [Claude Code](https://code.claude.com).

Automatic turn recording with AI provenance, intent tracking, and knowledge graph skills.

## What it does

- **1 session = 1 view** — a draft view is created automatically when you start Claude Code
- **Every turn records with provenance** — model, vendor, session, turn number, timing
- **Tool executions tracked** — reads, edits, bash calls captured in a causal decision graph
- **Intent workflow** — CLAUDE.md prompt guides problem-first development with vault intents
- **Skills on demand** — `/atomic-vault`, `/atomic-vcs`, and `/code-intelligence` loaded when needed

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

1. **Hooks** — runs `atomic agent enable --hooks hooks/claude-code.atomic-hooks.json` to merge the hook entries (and the `permissions.deny` rule) into `~/.claude/settings.json`. The hook definitions live in this repo's manifest, so updating Claude Code's hook wiring never requires rebuilding `atomic`.
2. **Skills & agents** — symlinks `/atomic-vault`, `/atomic-vcs`, `/code-intelligence` into `~/.claude/skills/` and the `@intent` agent into `~/.claude/agents/`
3. **CLAUDE.md** — must be copied to each project root manually (Claude Code auto-discovers it)

## Prerequisites

- [Atomic VCS](https://atomic.dev) installed and on your PATH (`atomic --version`)
- A project with an `.atomic/` repository (`atomic init`)
- [Claude Code](https://code.claude.com) installed
- `jq` (optional, recommended) — lets the hooks recover the model name from the
  session transcript when Claude Code omits it from the hook payload (see below).
  Without `jq` the hooks still work; the model is just captured only when Claude
  Code provides it.

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
| `skills/atomic-vcs/SKILL.md` | Inspect state & history: `status`, `log`, `change -p`/`-a`, `diff` (`/atomic-vcs` skill) |
| `skills/code-intelligence/SKILL.md` | Knowledge graph query patterns (`/code-intelligence` skill) |
| `install.js` | Installs hooks + symlinks skills into `~/.claude/` |
| `install.sh` | Development install |

## How hooks work

Claude Code has a native hook system in `.claude/settings.json`. This package ships the hook definitions in `hooks/claude-code.atomic-hooks.json`; `atomic agent enable --hooks` merges them in (idempotently, preserving non-Atomic hooks). They call back to `atomic agent hooks claude-code <verb>`:

```
Claude Code session start
  │
  ├── Hook fires SessionStart → Rust creates haikunator-named draft view
  │
  ├── User sends prompt
  │   ├── Hook fires UserPromptSubmit → Rust saves prompt + model on session
  │   │     (model is backfilled from the transcript if the payload omits it)
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

### Model capture on resume

Claude Code only includes the `model` field in the **SessionStart** hook payload,
and even then omits it when a session is resumed, continued, or restarted after
`/clear` or compaction. In those cases the recorded change would show
`Model: unknown` even though a model is clearly in use.

To close that gap, the `SessionStart` and `UserPromptSubmit` hooks read the model
from the session transcript (`transcript_path`, where every assistant message
carries `message.model`) whenever the hook payload doesn't already provide one.
This uses `jq` and degrades gracefully — if `jq` isn't installed or the transcript
has no model yet, the hook behaves exactly as before and recording is unaffected.

## Uninstall

```bash
npx atomic-claude --uninstall
```

Or manually:

```bash
atomic agent disable --hooks /path/to/atomic-claude/hooks/claude-code.atomic-hooks.json
rm ~/.claude/skills/atomic-vault/SKILL.md
rm ~/.claude/skills/atomic-vcs/SKILL.md
rm ~/.claude/skills/code-intelligence/SKILL.md
```

CLAUDE.md files in project roots must be removed manually.

## License

Apache-2.0 — same as [Atomic VCS](https://github.com/atomicdotdev/atomic).
