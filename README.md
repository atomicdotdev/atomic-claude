# atomic-claude

[Atomic VCS](https://atomic.dev) integration for [Claude Code](https://code.claude.com).

Automatic turn recording with AI provenance, intent tracking, and knowledge graph skills.

> **Definitive source:** this repository lives on Atomic storage at `https://atomic.atomic.storage/workspaces/oss/projects/atomic-claude/code`. The GitHub repo is a mirror.

## What it does

- **1 session = 1 view** — a draft view is created automatically when you start Claude Code
- **Every turn records with provenance** — model, vendor, session, turn number, timing
- **Tool executions tracked** — reads, edits, bash calls captured in a causal decision graph
- **Memory research before work** — retrieve durable project memory before drafting an intent, with explicit approval before any memory write
- **Intent workflow** — CLAUDE.md prompt guides problem-first development with vault intents
- **Skills on demand** — `/atomic-vault`, `/atomic-vcs`, and `/code-intelligence` loaded when needed

## Install

### Quick start

Requires the [Atomic VCS](https://atomic.dev) CLI on your PATH. Then:

```bash
atomic agent enable --agent claude-code
```

The enable command syncs the package from Atomic storage and installs it.

Then copy the agent prompt into each project:

```bash
cp CLAUDE.md /path/to/your/project/
```

### Development install

From a local checkout:

```bash
git clone https://github.com/atomicdotdev/atomic-claude
cd atomic-claude
atomic agent enable --agent claude-code --from .

# or the legacy script path:
./install.sh
```

### What install does

1. **Hooks** — runs `atomic agent enable --hooks hooks/claude-code.atomic-hooks.json` to merge the hook entries (and the `permissions.deny` rule) into `~/.claude/settings.json`. The hook definitions live in this repo's manifest, so updating Claude Code's hook wiring never requires rebuilding `atomic`.
2. **Skills & agents** — symlinks the five packaged skills into `~/.claude/skills/` and the `@intent` agent into `~/.claude/agents/`
3. **CLAUDE.md** — must be copied to each project root manually (Claude Code auto-discovers it)

## Prerequisites

- [Atomic VCS](https://atomic.dev) installed and on your PATH (`atomic --version`). Memory research requires `atomic vault context`; older CLIs receive an upgrade warning and continue with the intent-only workflow
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

### Memory research flow

Before an intent is drafted, the agent runs `atomic vault context` and treats the results as candidates:

- A sufficient memory is selected and recorded on the intent with its path and revision.
- A partial memory produces an evidence-based expansion proposal.
- An empty result produces a first-memory proposal only when durable knowledge exists; otherwise the task continues without one.
- Creating or updating memory requires the agent to show the exact proposal and receive explicit user confirmation. The task request and Intent approval do not count as memory-write approval.

The agent first probes `atomic vault context --help`. If the installed CLI does not support the command, it recommends upgrading and continues with the previous intent-only workflow instead of treating the command failure as an empty Vault.

The selected wiki-links become generic KG `REFERENCES` relationships after sync. Before implementation, the agent checks that the selected paths and revisions still match what the user accepted. This package does not yet automate post-task learning distillation; that is a separate write-back stage of the flywheel.

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
| `CLAUDE.md` | Agent prompt — copy to project roots for the memory-to-intent workflow |
| `skills/atomic-vault/SKILL.md` | Memory research plus intent and goal lifecycle (`/atomic-vault` skill) |
| `skills/atomic-vcs/SKILL.md` | Inspect state & history: `status`, `log`, `change -p`/`-a`, `diff` (`/atomic-vcs` skill) |
| `skills/code-intelligence/SKILL.md` | Knowledge graph query patterns (`/code-intelligence` skill) |
| `install.js` | Installs hooks + symlinks skills and the `@intent` agent into `~/.claude/` |
| `install.sh` | Development install |
| `specs/intent-agent.md` | Historical design draft for the original Intent Agent architecture |
| `specs/test-plan-task1.md` | Historical manual test plan for the original Intent Agent prototype |

## How hooks work

Claude Code has a native hook system in `.claude/settings.json`. This package ships the hook definitions in `hooks/claude-code.atomic-hooks.json`; `atomic agent enable --hooks` merges them in (idempotently, preserving non-Atomic hooks). They call back to `atomic agent hooks claude-code <verb>`:

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
atomic agent disable --agent claude-code
```

Or manually:

```bash
atomic agent disable --hooks /path/to/atomic-claude/hooks/claude-code.atomic-hooks.json
rm ~/.claude/skills/atomic-vault/SKILL.md
rm ~/.claude/skills/atomic-vcs/SKILL.md
rm ~/.claude/skills/code-intelligence/SKILL.md
rm ~/.claude/skills/intent-builder/SKILL.md
rm ~/.claude/skills/codebase-context/SKILL.md
rm ~/.claude/agents/intent.md
```

CLAUDE.md files in project roots must be removed manually.

## License

Apache-2.0 — same as [Atomic VCS](https://github.com/atomicdotdev/atomic).
