# Intent Agent Specification

**Status:** Draft
**Created:** 2025-07-22
**Scope:** Atomic Agent Harness — Intent Agent for Claude Code

> **Historical draft:** This document describes the original 2025 Intent Agent prototype and is not the current runtime contract. See [`../README.md`](../README.md), [`../CLAUDE.md`](../CLAUDE.md), and [`../agents/intent.md`](../agents/intent.md) for the installed memory-first workflow.

---

## 1. Overview

The Intent Agent is the conversational front door to the Atomic Agent Harness. It is the only agent that talks to the human. Every other agent in the SDLC pipeline (Task, Build, Validate, Deliver) runs autonomously, orchestrated by Circuit Breaker.

The Intent Agent's job is narrow and well-defined:

1. Listen to what the user wants
2. Search the vault and codebase for context
3. Ask clarifying questions
4. Build a structured intent record in the vault
5. Present it for user approval
6. On confirmation, hand off to Circuit Breaker

The Intent Agent does **not** write code, design solutions, decompose tasks, or run tests. It defines problems.

### Architecture: Agent + Skills

The Intent Agent is a **Claude Code subagent** — a `.claude/agents/intent.md` file with YAML frontmatter and a focused system prompt. It is NOT a monolithic `CLAUDE.md`. The `CLAUDE.md` stays tiny (just "you use Atomic VCS, not git"). The Intent Agent loads on demand when invoked via `/agents` or `@intent`.

**Skills** are the reference material preloaded into the agent's context. Each skill teaches the agent how to use a specific set of `atomic` CLI commands via `Bash`. Skills are the manual; `Bash` is the tool.

| Layer | What it is | Token cost |
|-------|-----------|------------|
| `CLAUDE.md` | Base context: "you use Atomic VCS" | Tiny, always loaded |
| `agents/intent.md` | Agent prompt: process, rules, personality | Small, loaded when invoked |
| `skills/intent-builder/` | Skill: how to create/edit/confirm intents via CLI | Loaded into agent context |
| `skills/codebase-context/` | Skill: how to search the knowledge graph via CLI | Loaded into agent context |

### What changes

| Today | Tomorrow |
|-------|----------|
| One monolithic `CLAUDE.md` doing everything | Tiny `CLAUDE.md` + Intent Agent subagent + focused skills |
| Agent prompt burns tokens on every turn | Agent loads on demand; skills preloaded only into that agent |
| Agent does intent + task + build + validate in one turn | Agent only builds intents; CB drives everything else |
| User drives every step with a new prompt | User approves intents; pipeline delivers autonomously |
| Skills (`/atomic-vault`, `/code-intelligence`) are generic | Skills scoped per agent role — intent-builder, codebase-context |

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Claude Code                                                         │
│                                                                      │
│  CLAUDE.md (tiny: "you use Atomic VCS")                              │
│       │                                                              │
│       ▼                                                              │
│  /agents → Intent Agent subagent                                     │
│       │                                                              │
│       ├── skills/intent-builder   (how to build intents via CLI)     │
│       ├── skills/codebase-context (how to search the KG via CLI)     │
│       │                                                              │
│       ├── Bash → atomic vault intent create/show/update              │
│       ├── Bash → atomic vault query search/neighbors                 │
│       ├── Read/Grep/Glob → read intent files, explore .vault/        │
│       │                                                              │
│  Human ◄──► Conversation ◄──► Vault CLI + Knowledge Graph           │
│                                                                      │
│  Output: confirmed intent recorded in vault                          │
└─────────────────────────┬────────────────────────────────────────────┘
                          │
                    atomic record
                    (via hooks, with provenance)
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Circuit Breaker (Petri Net)                                         │
│                                                                      │
│  Token lands in "problem-defined" place                              │
│  Task transition enables → autonomous pipeline begins                │
│                                                                      │
│  Task → Build → Validate → Deliver (no human in loop)                │
└──────────────────────────────────────────────────────────────────────┘
```

### Components involved

| Component | Role |
|-----------|------|
| **Claude Code** | Runtime — hosts the subagent, provides Bash/Read/Grep/Glob tools |
| **`agents/intent.md`** | Subagent definition — focused prompt, tool ACL, skill list |
| **`skills/intent-builder/`** | Skill — teaches the agent how to use vault intent CLI commands |
| **`skills/codebase-context/`** | Skill — teaches the agent how to search the knowledge graph |
| **Atomic CLI** | Tool surface — vault commands the agent runs through Bash |
| **Atomic hooks** | Session lifecycle — draft view creation, provenance recording |
| **Circuit Breaker** | Picks up confirmed intents and drives the autonomous pipeline |

### File layout

```
atomic-claude/
├── CLAUDE.md                          # Tiny: "you use Atomic VCS, not git"
├── agents/
│   └── intent.md                      # Intent Agent subagent definition
├── skills/
│   ├── intent-builder/
│   │   └── SKILL.md                   # How to build intents via CLI
│   ├── codebase-context/
│   │   └── SKILL.md                   # How to search the knowledge graph
│   ├── atomic-vault/
│   │   └── SKILL.md                   # (existing) full vault reference
│   └── code-intelligence/
│       └── SKILL.md                   # (existing) full KG reference
├── specs/
│   └── intent-agent.md                # This spec
└── install.sh                         # Installs hooks + symlinks agents/skills
```

### How it loads

1. Claude Code starts → reads `CLAUDE.md` (tiny, always in context)
2. User types `/agents` or `@intent` → Claude Code loads `agents/intent.md`
3. Agent frontmatter says `skills: [intent-builder, codebase-context]`
4. Both skill files are injected into the agent's context at startup
5. Agent has `tools: Bash, Read, Grep, Glob` — no Write, no Edit
6. Agent runs `atomic vault ...` commands through Bash
7. Agent reads/presents intent files through Read

Only the active agent's prompt + skills burn tokens. The main conversation stays lean.

---

## 3. Vault CLI: How the Agent Builds Intents

### Available commands (what exists today)

The agent calls these through `Bash`. The `intent-builder` skill documents them.

```
atomic vault intent create --title "..."       # Creates intent, returns ID + file path
atomic vault intent list                       # List intents (check duplicates)
atomic vault intent list -s backlog            # Filter by status
atomic vault intent show <id>                  # Show intent content
atomic vault intent show <id> --json           # Structured output
atomic vault intent update <id> --status ...   # Update status
atomic vault intent link <id> --goal ...       # Link to goal
```

### How the agent uses them

1. `intent create --title "..."` → gets an ID and a markdown file path
2. Agent reads the file with `Read` tool, sees the template with REPLACE placeholders
3. Agent edits the file through `Bash` (e.g., writing sections with heredoc or sed) to fill in Problem, Criteria, Scope, Constraints, Dependencies
4. Agent uses `Read` to show the user the current state
5. On approval, `intent update <id> --status planned`

### New commands needed (Task 2)

These commands replace the "edit markdown through Bash" workaround with structured CLI operations:

#### `set` — Set a scalar field

```
atomic vault intent set ATOM-42 --problem "API has no authentication mechanism..."
atomic vault intent set ATOM-42 --priority high
```

Validates the value (e.g., `--problem` minimum 20 chars). Idempotent.

#### `add` — Append to a list field

```
atomic vault intent add ATOM-42 --criteria "OAuth2 authorization code flow with PKCE"
atomic vault intent add ATOM-42 --scope-in "atomic-storage-auth crate"
atomic vault intent add ATOM-42 --scope-out "CLI auth"
atomic vault intent add ATOM-42 --constraint "Must use existing atomic-identity KeyPair"
atomic vault intent add ATOM-42 --depends-on ATOM-41
```

One item per call. Returns the current count.

#### `remove` — Remove from a list field

```
atomic vault intent remove ATOM-42 --criteria 2
atomic vault intent remove ATOM-42 --depends-on ATOM-41
```

By 1-based index or by ID.

#### `confirm` — Validate, record, and hand off

```
atomic vault intent confirm ATOM-42
```

Validates completeness (problem set, ≥1 criterion, ≥1 scope-in), records via `atomic add` + `atomic record`, produces structured token for CB.

On validation failure, returns the exact command to fix each missing field. The agent reads the error and knows what to ask.

### Task 1 workaround (tomorrow)

The `set`, `add`, `remove`, and `confirm` commands don't exist yet. For tomorrow's test, the agent edits the intent markdown file directly through `Bash` (heredoc writes) and `Read` (to present back). This tests the **conversation pattern** — does the agent ask good questions, search for context, build incrementally, and present for approval? The tool enforcement comes in Task 2.

### Multi-intent support

When a conversation reveals multiple problems, the agent creates multiple intents and notes dependencies in each file:

```
atomic vault intent create --title "Token contracts"
# → ATOM-42

atomic vault intent create --title "Multi-agent decomposition"
# → ATOM-43

# Agent writes "Depends on: ATOM-42" in ATOM-43's intent file
```

---

## 4. Intent Data Model

### Storage (vault entry frontmatter — current)

Today's frontmatter:

```json
{
  "id": "ATOM-42",
  "title": "API authentication module",
  "status": "backlog",
  "priority": "high",
  "assignee": null,
  "created_by": "lee@atomic.dev",
  "created_at": "2025-07-23T10:00:00Z",
  "labels": ["security"],
  "goals": []
}
```

### Storage (vault entry frontmatter — after Task 2)

Extended with structured fields the `set`/`add`/`remove`/`confirm` commands manage:

```json
{
  "id": "ATOM-42",
  "title": "API authentication module",
  "status": "draft",
  "problem": "API has no authentication mechanism...",
  "criteria": [
    "OAuth2 authorization code flow with PKCE",
    "Password auth with argon2 hashing"
  ],
  "scope_in": ["atomic-storage-auth crate"],
  "scope_out": ["CLI auth"],
  "constraints": ["Must use existing atomic-identity KeyPair"],
  "depends_on": [],
  "priority": "high",
  "labels": ["security"],
  "created_by": "lee@atomic.dev",
  "created_at": "2025-07-23T10:00:00Z",
  "confirmed_by": null,
  "confirmed_at": null,
  "goals": []
}
```

### Status lifecycle

```
backlog → planned → in-progress → review → done
  ↑
  │ (today: intent create sets backlog)
  │
  │ (after Task 2: "draft" added before backlog)
  │
draft → confirmed → planned → in-progress → review → done
  │                    ↑
  │                    │ (Task agent sets this)
  └──── (user can      │
        abandon)       └── (CB pipeline manages from here)
```

For tomorrow (Task 1): `backlog` → `planned` (on user approval)
After Task 2: `draft` → `confirmed` → `planned` (with validation gate)

---

## 5. Agent + Skills Definitions

The Intent Agent is three files, not one monolithic prompt.

### `agents/intent.md` — The agent

```yaml
---
name: intent
description: Defines problems through conversation. Builds structured intents
  in the Atomic vault by asking clarifying questions, searching the codebase
  for context, and driving to a problem statement the user confirms before
  autonomous agents take over.
tools: Bash, Read, Grep, Glob
model: inherit
effort: high
color: blue
skills:
  - intent-builder
  - codebase-context
---

You define problems. You do not solve them.

The user describes what they want. Your job is to turn that into a structured
intent record in the Atomic vault — a clear problem statement with testable
criteria that downstream agents can act on without asking the user anything.

## Process

1. Check for duplicates: `atomic vault intent list`
2. Create a draft: `atomic vault intent create --title "..."`
3. Search the codebase for context using your skills
4. Ask clarifying questions — max 3 rounds, 1–3 questions each
5. Record answers into the intent file as you learn them
6. Show the intent and ask "Does this look right?"
7. On approval, mark confirmed: `atomic vault intent update <ID> --status planned`

If the conversation reveals multiple distinct problems, create multiple
intents with dependencies noted in each file.

## Rules

- Reframe solutions as problems. The user says "build X" — you ask "what's broken without X?"
- Ask, don't guess. Ambiguity gets a question, not an assumption.
- Search between rounds. What you find informs what you ask next.
- Never confirm without showing. The user reviews before you finalize.
- Never write code. No implementation, no file edits outside `.vault/`.
- Never run `atomic add` or `atomic record`. Hooks handle this.
```

Key design decisions:
- **`tools: Bash, Read, Grep, Glob`** — no Write, no Edit. The agent can run CLI commands and read files, but cannot directly edit source code. It edits intent files through Bash (heredoc/sed), which is constrained to `.vault/`.
- **`skills: [intent-builder, codebase-context]`** — preloaded at startup. The agent knows how to use the vault CLI and knowledge graph without burning tokens in the main conversation.
- **`model: inherit`** — uses whatever model the main session is running.
- **No `disallowedTools: Write, Edit`** — we use an allowlist (`tools`), not a denylist. Cleaner.

### `skills/intent-builder/SKILL.md` — How to build intents

Teaches the agent:
- Which `atomic vault intent` commands exist and their flags
- What the intent file sections are (Problem, Criteria, Scope, Constraints, Dependencies)
- What good vs bad problem statements and criteria look like
- What NOT to put in an intent (implementation plans, file lists, test code)

### `skills/codebase-context/SKILL.md` — How to search the knowledge graph

Teaches the agent:
- `atomic vault query search "term"` — short, specific terms
- `atomic vault query neighbors <node-id>` — copy IDs from search results, never construct them
- `atomic vault memory list/show` — persistent project context
- When to search: before first question, between rounds, when defining scope

---

## 6. Conversation Flow

### Example: single intent

```
User: @intent "Build me a user auth module"

Agent: (checks existing intents via Bash)
  $ atomic vault intent list
  → No duplicates found

Agent: (creates draft via Bash)
  $ atomic vault intent create --title "API authentication module"
  → Created intent ATOM-42
  → file: .vault/intents/atom-42/intent.md

Agent: (searches for context via Bash — codebase-context skill)
  $ atomic vault query search "authentication"
  → entity:atomic-storage-auth/src/lib.rs (empty scaffold)
  → entity:atomic-identity/src/keypair.rs:KeyPair

Agent: (explores neighbors via Bash)
  $ atomic vault query neighbors entity:atomic-identity/src/keypair.rs:KeyPair
  → Signer trait, Identity struct, delegation system

Agent: "I found an empty auth scaffold in atomic-storage-auth and
        existing Ed25519 keys in atomic-identity. Three questions:

        1. What auth methods — OAuth2, password-based, API keys, or a combination?
        2. Session strategy — JWT, server-side sessions, or cookies?
        3. Should this integrate with atomic-identity's existing keys?"

User: "OAuth + password, JWT, yes integrate with identity"

Agent: (writes answers into intent file via Bash)
  $ cat << 'EOF' > .vault/intents/atom-42/intent.md
  [fills in Problem, Criteria, Scope sections]
  EOF

Agent: (searches more context)
  $ atomic vault query neighbors entity:atomic-identity/src/delegation.rs:Delegation
  → DelegationScope, delegated signing

Agent: "Since atomic-identity has a delegation system, should delegated
        identities (like CI agents) be able to authenticate, or just
        primary identities?"

User: "Both — delegated identities should work too"

Agent: (updates intent file — adds criterion, updates scope)

Agent: (reads file back to present to user via Read tool)
  [reads .vault/intents/atom-42/intent.md]

  "Here's what I've got. Does this look right?

  ATOM-42: API authentication module

  Problem:
    atomic-storage API has no authentication. All endpoints are
    publicly accessible...

  Criteria:
    1. [ ] OAuth2 authorization code flow with PKCE
    2. [ ] Password auth with argon2 hashing
    3. [ ] JWT tokens signed with Ed25519 keys from atomic-identity
    4. [ ] Delegated identities can authenticate with same flow

  Scope:
    In: atomic-storage-auth crate, route middleware
    Out: CLI authentication, UI login flow

  Constraints:
    - Must use existing atomic-identity KeyPair and Signer trait"

User: "Add token refresh without re-auth as a criterion, otherwise good"

Agent: (updates intent file, reads back)
  "Updated — added criterion 5. Confirm?"

User: "Yes"

Agent: (confirms via Bash)
  $ atomic vault intent update ATOM-42 --status planned
  → Updated intent: ATOM-42, status: planned
```

### Example: conversation reveals multiple intents

```
User: @intent "We need agent orchestration for the SDLC"

Agent: (searches, asks questions over several rounds)

  "Based on what you've described, I see four distinct problems:

  1. Token contracts — agents can't coordinate without typed schemas
  2. Multi-agent decomposition — monolithic CLAUDE.md can't be sequenced
  3. Circuit Breaker wiring — no mechanism to orchestrate agent invocations
  4. Conversational Intent agent — the front door doesn't exist yet

  These have a dependency chain: 1 → 2 → 3 → 4.
  Should I create four intents with these dependencies?"

User: "Yes"

Agent: (creates all four via Bash, fills in each file, notes dependencies)
  $ atomic vault intent create --title "Define agent-to-agent token contracts"
  → ATOM-42
  $ atomic vault intent create --title "Decompose atomic-claude into multi-agent definitions"
  → ATOM-43
  [fills in ATOM-43's intent file with "Dependencies: ATOM-42"]
  ...

  [reads all four files, presents to user]
  "Here are all four. Review each?"

User: (reviews, adjusts, approves)

Agent:
  $ atomic vault intent update ATOM-42 --status planned
  $ atomic vault intent update ATOM-43 --status planned
  $ atomic vault intent update ATOM-44 --status planned
  $ atomic vault intent update ATOM-45 --status planned
```

---

## 7. Session Lifecycle

### Hook integration

The existing `atomic agent hooks claude-code` system remains unchanged. The hooks handle:

- **SessionStart**: Create a haikunator-named draft view
- **UserPromptSubmit**: Save prompt metadata
- **PreToolUse/PostToolUse**: Track tool executions in provenance graph
- **Stop**: Hook fires `atomic add` + `atomic record` with provenance for any changed files

The Intent Agent doesn't need to manage recording — the hooks do it automatically when the turn ends. The agent just edits intent files and sets status.

### How the agent gets invoked

The user can invoke the Intent Agent in several ways:

1. **`@intent` in the prompt** — guarantees the Intent Agent runs for that task
2. **`/agents` → select intent** — launches the agent from the library
3. **Automatic delegation** — Claude reads the agent's `description` and delegates when the user's request matches (starting new work, describing something to build)
4. **`claude --agent intent`** — runs the whole session as the Intent Agent

### Session end states

| Outcome | What happens |
|---------|-------------|
| User confirms intent(s) | Status set to `planned`, hooks record the change with provenance |
| User abandons mid-conversation | Draft intent files remain in vault with status `backlog`, hooks record whatever state exists |
| User closes Claude Code without confirming | Same as abandon |
| Agent hits an error | Error displayed, user can retry or abandon |

---

## 8. Circuit Breaker Integration (Future)

This spec focuses on the Intent Agent inside Claude Code. The CB integration is documented here for context but is a separate workstream.

### Handoff mechanism (not in scope for Task 1)

How a confirmed intent gets from the vault to Circuit Breaker's Petri net is a separate design. The intent file in `.vault/` is the source of truth. Options for CB pickup:

- CB watches for `planned` status changes in the vault
- A bridge process polls the vault and injects tokens into CB
- The hooks publish a NATS event when status changes to `planned`

This will be designed when the SDLC circuit workflow is built.

---

## 9. Tasks

### Task 1: Intent Agent subagent for Claude Code

**Goal:** Create the Intent Agent as a Claude Code subagent with focused skills. Test the conversational flow using existing vault commands, with the agent editing intent files through Bash as a workaround for commands that don't exist yet.

**What we're testing:** Can the agent + skills architecture drive a focused problem-definition conversation that produces a well-structured intent, without the agent drifting into implementation?

**Deliverables:**

1. **`agents/intent.md`** — The Intent Agent subagent definition
   - YAML frontmatter: name, description, tools (Bash/Read/Grep/Glob), skills, model, color
   - Focused system prompt: process, rules, personality
   - No implementation instructions, no code-writing steps

2. **`skills/intent-builder/SKILL.md`** — How to build intents via CLI
   - Documents `atomic vault intent create/list/show/update` commands and flags
   - Defines intent file sections (Problem, Criteria, Scope, Constraints, Dependencies)
   - Shows good vs bad examples for each section
   - Lists what NOT to put in an intent

3. **`skills/codebase-context/SKILL.md`** — How to search the knowledge graph via CLI
   - Documents `atomic vault query search/neighbors` commands
   - Documents `atomic vault memory list/show` commands
   - Node ID formats and rules (never construct, always copy)
   - When to search in the intent workflow

4. **Updated `CLAUDE.md`** — Stripped to base Atomic context only
   - Remove the monolithic 4-step process
   - Keep: "you use Atomic VCS, not git"
   - Keep: hook behavior (don't run add/record/view commands)
   - Remove: intent workflow, skill references (those are in the agent now)

5. **Updated `install.sh`** — Installs agents + skills
   - Symlink `agents/intent.md` → `~/.claude/agents/intent.md` (or `.claude/agents/` in project)
   - Symlink new skills alongside existing ones
   - Backward compatible — existing skills still install

**What works tomorrow with existing commands:**

| Need | How the agent does it |
|------|-----------------------|
| Check duplicates | `atomic vault intent list` via Bash |
| Create draft | `atomic vault intent create --title "..."` via Bash |
| Search codebase | `atomic vault query search "term"` via Bash |
| Explore connections | `atomic vault query neighbors <id>` via Bash |
| Read intent file | Read tool on `.vault/intents/<id>/intent.md` |
| Edit intent file | Bash heredoc/sed to write sections |
| Present to user | Read tool, then show in conversation |
| Confirm | `atomic vault intent update <id> --status planned` via Bash |

**What we're testing:**
- Does the agent ask questions instead of guessing?
- Does it search the knowledge graph for context between rounds?
- Does it build the intent incrementally as the conversation progresses?
- Does it present the intent for review before confirming?
- Does it stay in its lane — no code, no solution design, no implementation?
- Do the skills provide enough reference for the agent to use the CLI correctly?

**Not in scope for Task 1:**
- Rust changes to atomic CLI (that's Task 2)
- Circuit Breaker integration (that's Task 5)
- Token schema enforcement (that's Task 4)
- Other agent definitions (Task, Build, Validate — those are separate specs)

---

### Task 2: Vault CLI builder commands

**Goal:** Implement `set`, `add`, `remove`, and `confirm` as subcommands of `atomic vault intent` in the Rust CLI. This replaces the "edit markdown through Bash" workaround from Task 1 with structured CLI operations.

**Scope:**

- `IntentSetOptions`, `IntentAddOptions`, `IntentRemoveOptions` structs in `atomic-repository`
- `vault_intent_set()`, `vault_intent_add()`, `vault_intent_remove()`, `vault_intent_confirm()` methods on `Repository`
- Clap argument definitions in `atomic-cli/src/commands/vault/intent.rs`
- Validation logic in each method (see Section 3)
- Enhanced `vault_intent_show()` that renders a clean summary format (not raw markdown)
- `draft` status added to the intent lifecycle
- Update vault frontmatter schema to include new fields (problem, criteria, scope_in, scope_out, constraints, depends_on)
- Unit tests for each new method
- Integration tests for the full builder flow: create → set → add → show → confirm

**Files to modify:**

| File | Changes |
|------|---------|
| `atomic-repository/src/repository/vault_intent.rs` | New methods, types, validation |
| `atomic-cli/src/commands/vault/intent.rs` | New subcommands, clap args |
| `atomic-repository/vault/templates/intent.md` | Template generated from structured data |
| `atomic-core/src/pristine/vault.rs` | Update `IntentSummary` with new fields |

**Depends on:** Task 1 results (what worked, what was painful with the Bash workaround)

---

### Task 3: Update skills for builder commands

**Goal:** Update `skills/intent-builder/SKILL.md` to document the new `set`, `add`, `remove`, `confirm` commands instead of the Bash heredoc workaround.

**Scope:**

- Replace "edit through Bash" instructions with structured `set`/`add`/`remove` command docs
- Add `confirm` command reference with validation rules
- Update the existing `skills/atomic-vault/SKILL.md` to remove monolithic workflow references
- Keep `skills/codebase-context/SKILL.md` unchanged (it's already correct)

**Depends on:** Task 2 (needs the final command signatures)

---

### Task 4: Intent token schema and confirm output

**Goal:** Define the formal token schema that `confirm` outputs, and ensure it matches what Circuit Breaker's `problem-defined` place expects.

**Scope:**

- JSON Schema for the intent token (see Section 8)
- `confirm` command outputs JSON to stdout when `--json` flag is set
- Token includes all structured fields plus `change_hash`, `confirmed_by`, `confirmed_at`
- Schema file added to `circuit-breaker/schemas/` for CB integration
- Validation test: confirm output is valid against the token schema

**Depends on:** Task 2 (confirm command must exist)

---

### Task 5: Circuit Breaker SDLC circuit (Intent → Task handoff)

**Goal:** Define the Petri net workflow that receives confirmed intent tokens and fires the Task agent.

**Scope:**

- SDLC circuit workflow definition (TypeScript, using CB SDK)
- `prompt-received` and `problem-defined` places with token schemas
- Intent transition definition (action type: agent invocation)
- Task transition definition (placeholder — just receives the token)
- Handoff mechanism: how confirmed tokens flow from vault to CB
- End-to-end test: confirm an intent, verify CB receives the token

**Depends on:** Task 4 (token schema must be defined)

---

## 10. Success Criteria for the Spec

The Intent Agent is working when:

1. A user can invoke `@intent` or `/agents → intent` and get a focused problem-definition conversation
2. The main `CLAUDE.md` stays tiny — the agent's prompt and skills are only loaded when the agent is invoked
3. The agent asks clarifying questions instead of guessing
4. The agent uses `atomic vault query search` to inform its questions (codebase-context skill)
5. The agent builds the intent incrementally — creating the file early, filling sections as the conversation progresses
6. The agent presents the intent for review before confirming (intent-builder skill)
7. The confirmed intent contains a clear problem statement, testable criteria, defined scope, and constraints
8. The intent file has zero REPLACE placeholders when the user reviews it
9. The human never touches the keyboard again after saying "yes" (CB takes over — future)

---

## Appendix A: Comparison with current architecture

### Current: monolithic CLAUDE.md

```
CLAUDE.md (always loaded, burns tokens every turn):
  1. Create intent          ← Intent Agent's job
  2. Define the problem     ← Intent Agent's job
  3. Execute the tasks      ← Build Agent's job
  4. Update the intent      ← Validate/Deliver Agent's job

Skills (loaded on /slash-command):
  /atomic-vault             ← generic, covers everything
  /code-intelligence        ← generic, covers everything
```

All four steps in one prompt. One agent. One turn. No gates. No validation. Skills are generic catch-alls.

### New: Agent + Skills architecture

```
CLAUDE.md (tiny, always loaded):
  "You use Atomic VCS, not git."

agents/intent.md (loaded on @intent or /agents):
  1. Listen
  2. Search for context
  3. Ask questions
  4. Build the intent file
  5. Show for review
  6. Confirm on approval

  skills: [intent-builder, codebase-context]
  tools: [Bash, Read, Grep, Glob]

Everything else is Circuit Breaker's problem.
```

Each agent loads its own skills. Skills are scoped per role. Tokens burn only when the agent is active.

### Future agents (separate specs, same pattern)

| Agent | Tools | Skills | One-line job |
|-------|-------|--------|-------------|
| **Task** | Bash, Read, Grep, Glob | task-decomposer, codebase-context | Decompose confirmed intent into ordered tasks with file-level scope |
| **Build** | Bash, Read, Write, Edit, Grep, Glob | build-patterns, codebase-context | Write code for one task, add tests, record the change |
| **Validate** | Bash, Read, Grep, Glob | test-runner, acceptance-checker | Run tests, check each criterion, report pass/fail |
| **Deliver** | Bash, Read | view-management | Insert confirmed changes from draft view into shared view |

Each gets its own `agents/*.md` file, its own skills, its own tool ACL. The harness holds them together.
