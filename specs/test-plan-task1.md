# Task 1 Test Plan: Intent Agent Subagent in Claude Code

**Date:** 2025-07-23
**Goal:** Validate that the Intent Agent subagent, invoked via `@intent`, drives a focused problem-definition conversation without drifting into implementation.

> **Historical test plan:** These scenarios target the original 2025 prototype. The current memory-first workflow and automated contract tests are documented in [`../README.md`](../README.md) and `test/`.

---

## Prerequisites

1. Atomic VCS installed and on PATH (`atomic --version`)
2. A project with an `.atomic/` repository and vault initialized (`atomic init --vault`)
3. Claude Code installed
4. Hooks active: `atomic agent enable --agent claude-code --global`
5. Intent Agent installed (agent + skills)

### Setup checklist

```bash
# In your test project directory
cd /path/to/test-project

# Ensure atomic repo and vault exist
atomic init --vault

# Install the Intent Agent and skills
cd /path/to/atomic-claude
./install.sh

# Verify the agent is registered
claude agents  # should show "intent" in the list

# Verify skills are available
ls ~/.claude/skills/intent-builder/SKILL.md
ls ~/.claude/skills/codebase-context/SKILL.md

# Verify vault is working
atomic vault intent list

# Verify the agent loads
# Start Claude Code, type /agents, switch to Library tab
# "intent" should appear with blue color
```

### Install details

The `install.sh` script should:
1. Symlink `agents/intent.md` → `~/.claude/agents/intent.md`
2. Symlink `skills/intent-builder/` → `~/.claude/skills/intent-builder/`
3. Symlink `skills/codebase-context/` → `~/.claude/skills/codebase-context/`
4. Keep existing `skills/atomic-vault/` and `skills/code-intelligence/` symlinks
5. Run `atomic agent enable --agent claude-code --global` (existing behavior)

---

## Test Scenarios

### Invoking the agent

Three ways to test — try each at least once:

1. **`@intent` mention** — type `@` in the prompt, pick "intent (agent)" from the typeahead, then your request
2. **`/agents` menu** — type `/agents`, switch to Library, select "intent"
3. **Natural language** — just describe work; Claude should auto-delegate based on the agent's `description`

For most scenarios below, use `@intent` to guarantee the subagent runs.

### Scenario 1: Single intent, well-defined request

**Prompt:** `@intent Expand the vault intent create command to support a builder pattern with set, add, remove, and confirm subcommands`

**What we're observing:**

| Step | Expected behavior | Pass? |
|------|-------------------|-------|
| 0. Subagent launches | Blue-colored subagent appears in the Running tab of `/agents` | ☐ |
| 1. Agent's first action | Runs `atomic vault intent list` via Bash to check for duplicates | ☐ |
| 2. Agent creates draft | Runs `atomic vault intent create --title "..."` via Bash with a concise title | ☐ |
| 3. Agent searches context | Runs `atomic vault query search` via Bash for relevant code (e.g., "intent", "vault") | ☐ |
| 4. Agent asks questions | Asks 1–3 clarifying questions about scope, constraints, or success criteria instead of jumping to implementation | ☐ |
| 5. Agent does NOT write code | No file edits outside `.vault/`, no implementation suggestions, no solution design | ☐ |
| 6. Agent records answers | After user answers, writes findings into the intent file sections via Bash | ☐ |
| 7. Agent may search again | Runs `atomic vault query neighbors` via Bash between rounds to inform follow-up questions | ☐ |
| 8. Agent presents intent | Reads back the intent file (Read tool), shows it with all sections filled in, no REPLACE placeholders | ☐ |
| 9. Agent asks for approval | Explicitly asks "Does this look right?" or equivalent before finalizing | ☐ |
| 10. Agent handles feedback | If user says "change X," modifies the intent file and presents again | ☐ |
| 11. Agent confirms | On user approval, runs `atomic vault intent update <ID> --status planned` via Bash | ☐ |
| 12. Agent stops | Does not continue to implementation after confirming. Subagent returns result to main conversation. | ☐ |

**Quality checks on the intent file:**

| Field | Quality criterion | Pass? |
|-------|-------------------|-------|
| Problem | States what is broken/missing and why it matters. Not a solution description. ≥ 20 chars. | ☐ |
| Criteria | Each criterion is testable — you could write a test or verification step for it | ☐ |
| Criteria | At least 3 criteria (for a prompt this specific, fewer would indicate under-exploration) | ☐ |
| Scope In | Names specific crates, files, or modules | ☐ |
| Scope Out | Explicitly excludes at least one thing to prove the agent thought about boundaries | ☐ |
| Constraints | At least one constraint identified (compatibility, naming, etc.) | ☐ |
| No REPLACE | Zero REPLACE placeholders remain in the file | ☐ |

**Subagent behavior checks:**

| Check | Expected | Pass? |
|-------|----------|-------|
| Agent uses Bash tool for CLI commands | `atomic vault intent create`, `atomic vault query search`, etc. — all via Bash, not hardcoded output | ☐ |
| Agent uses Read tool for file presentation | Reads `.vault/intents/<id>/intent.md` through Read, not Bash cat | ☐ |
| Agent does NOT use Write or Edit tools | Disallowed by `tools: Bash, Read, Grep, Glob` in frontmatter | ☐ |
| Skills loaded | Agent references intent-builder concepts (section names, good/bad examples) without being told | ☐ |
| Context stays clean | Main conversation context is not flooded with the agent's search results and file contents | ☐ |

---

### Scenario 2: Vague request that needs decomposition

**Prompt:** `@intent We need to make the agent system work better`

**What we're observing:**

| Step | Expected behavior | Pass? |
|------|-------------------|-------|
| 1. Agent does NOT immediately create an intent | Recognizes the request is too vague to act on | ☐ |
| 2. Agent asks clarifying questions | Asks what "agent system" means, what "better" means, what the current pain point is | ☐ |
| 3. Agent reframes as problem | Translates the user's vague solution-request into a concrete problem statement | ☐ |
| 4. Agent searches for context | Runs `atomic vault query search` via Bash to understand what exists before asking follow-ups | ☐ |
| 5. Agent identifies multiple problems (if applicable) | If the conversation reveals multiple issues, agent proposes creating multiple intents | ☐ |
| 6. Agent does NOT guess | Does not fill in criteria or scope based on assumptions — asks the user | ☐ |

---

### Scenario 3: Request that tempts implementation

**Prompt:** `@intent Add a --problem flag to the vault intent create command in Rust`

**What we're observing:**

| Step | Expected behavior | Pass? |
|------|-------------------|-------|
| 1. Agent does NOT open Rust files | Does not use Read/Grep on any `.rs` files for implementation purposes | ☐ |
| 2. Agent does NOT write code | Does not produce Rust code snippets, even in the intent file | ☐ |
| 3. Agent reframes as problem | Converts "add a --problem flag" into a problem statement about why the flag is needed | ☐ |
| 4. Agent asks about the bigger picture | Asks whether this is part of a larger change (builder pattern), or a standalone fix | ☐ |
| 5. Criteria are about outcomes, not implementation | "Problem statement is captured as structured data" not "Add a --problem flag to IntentCreate struct" | ☐ |

**Note:** The agent may use `atomic vault query search "intent"` to understand the existing code — that's fine and expected (codebase-context skill in action). The check is whether it uses what it finds to inform *questions*, not to start *implementing*.

---

### Scenario 4: User says "no" to the presented intent

**Prompt:** Start with Scenario 1, but when the agent presents the intent, respond with: "Drop the last criterion and add a constraint about backward compatibility"

**What we're observing:**

| Step | Expected behavior | Pass? |
|------|-------------------|-------|
| 1. Agent modifies the intent file | Edits via Bash to remove the specified criterion and add the constraint | ☐ |
| 2. Agent reads back the file | Uses Read tool to get the updated content | ☐ |
| 3. Agent presents again | Shows the updated intent to the user, not just a description of what changed | ☐ |
| 4. Agent asks for approval again | Does not skip confirmation after making changes | ☐ |
| 5. Changes are correct | The right criterion was removed, the constraint was added in the right section | ☐ |

---

### Scenario 5: Auto-delegation (no @intent mention)

**Prompt:** (just type normally, no @-mention) "I need to add rate limiting to the storage API"

**What we're observing:**

| Step | Expected behavior | Pass? |
|------|-------------------|-------|
| 1. Claude delegates to Intent Agent | Based on the agent's `description` field, Claude recognizes this as "starting new work" and spawns the intent subagent | ☐ |
| 2. Same behavior as Scenario 1 | The intent subagent follows its process: list, create, search, ask, build, show, confirm | ☐ |

**Note:** Auto-delegation may not work reliably in early testing — Claude needs to learn when to use the agent. If it doesn't auto-delegate, that's a prompt tuning issue with the `description` field, not a failure of the architecture. The `@intent` invocation is the reliable path.

---

## Anti-patterns to watch for

These are failures even if the final intent looks OK:

| Anti-pattern | Why it's a failure |
|--------------|--------------------|
| Agent writes code in any file | Intent Agent has no code-writing responsibility |
| Agent uses Write or Edit tools | Frontmatter restricts to `Bash, Read, Grep, Glob` only |
| Agent suggests implementation approach in the intent | "Approach" and "Files to Modify" are Task Agent's job |
| Agent skips `intent list` check | Could create duplicate intents |
| Agent creates intent before asking any questions | Jumping to action without understanding the problem |
| Agent fills in all sections at once without asking | Not driving a conversation, just generating output |
| Agent says "let me implement this" after confirming | Should stop after confirmation — subagent returns to main conversation |
| Agent runs `atomic add` or `atomic record` | Hooks handle this; agent should not |
| Agent creates or switches views | Hooks handle this; agent should not |
| Agent asks more than 3 rounds of questions | Spec says max 3 rounds — should converge |
| Agent outputs raw JSON as the intent | Intent should be human-readable markdown in the vault file |
| Skills not loaded | Agent doesn't know command syntax, asks user for help with CLI — skill preloading failed |
| Main context polluted | Search results, file contents, and tool output from the subagent leak into the main conversation | 

---

## Recording results

After each scenario, capture:

1. **The intent file** — copy the final `.vault/intents/<id>/intent.md`
2. **The conversation** — note which questions the agent asked and in what order
3. **Tool calls** — list every `atomic` command the agent ran (and which Claude Code tool it used: Bash, Read, Grep, Glob)
4. **Subagent behavior** — did it launch properly? Did results return cleanly to the main conversation?
5. **Failures** — any anti-pattern observed, any step that didn't pass
6. **Prompt/skill adjustments** — if the agent misbehaved, note what you'd change in the agent prompt vs the skill docs

### Results template

```
## Scenario N Results

**Date/time:**
**Invocation method:** @intent / /agents menu / auto-delegation
**Intent ID:**
**Prompt used:**

### Subagent lifecycle
- Launched: [yes/no]
- Color shown: [blue/other/none]
- Returned to main conversation: [yes/no/still running]

### Tool calls (in order)
1. [Bash] atomic vault intent list
2. [Bash] atomic vault intent create --title "..."
3. [Bash] atomic vault query search "..."
4. [Read] .vault/intents/<id>/intent.md
...

### Questions asked by agent
Round 1:
Round 2:
Round 3:

### Intent quality
- Problem statement: [good/weak/missing]
- Criteria count: N
- Criteria testable: [yes/some/no]
- Scope defined: [yes/partial/no]
- Constraints identified: [yes/no]
- REPLACE placeholders remaining: N

### Skills effectiveness
- intent-builder: Did the agent know command syntax? [yes/no]
- intent-builder: Did the agent follow section structure? [yes/no]
- codebase-context: Did the agent search the KG? [yes/no]
- codebase-context: Did search results inform questions? [yes/no]

### Anti-patterns observed
- (none, or list)

### Adjustments needed
- Agent prompt: (none, or what to change)
- intent-builder skill: (none, or what to change)
- codebase-context skill: (none, or what to change)
- Agent frontmatter: (none, or what to change — tools, model, etc.)
```

---

## What we're NOT testing tomorrow

- **Builder CLI commands** (`set`, `add`, `remove`, `confirm`) — these don't exist yet. The agent edits the intent markdown file through Bash heredocs. That's the workaround for Task 1.
- **Token schema validation** — no `confirm` gate exists. The agent uses `intent update --status planned` as an approximation.
- **Circuit Breaker handoff** — no pipeline picks up the confirmed intent. We're only testing the conversation and intent quality.
- **Other agents** (Task, Build, Validate, Deliver) — those are separate specs.
- **Multi-agent orchestration** — no Petri net involved. Just one human and one Intent Agent subagent.
- **Agent-to-agent communication** — the Intent Agent runs in isolation. No chaining or handoff.

Tomorrow is about three questions:

1. **Does the subagent architecture work?** — Does the agent load, do skills preload, does it use the right tools, does it return cleanly?
2. **Does the conversation pattern work?** — Does the agent ask good questions, search for context, build incrementally, present for review?
3. **Does the intent quality hold?** — Is the output a well-structured problem definition that a Task agent could act on?

Everything else we build on top of those answers.

---

## Iteration plan

After running the scenarios:

### Subagent mechanics

| Outcome | Next step |
|---------|-----------|
| Agent doesn't load or skills missing | Fix `install.sh` symlinks, check `~/.claude/agents/` and `~/.claude/skills/` |
| Agent uses Write/Edit despite tool restriction | Check frontmatter `tools` field — should be allowlist not denylist |
| Agent doesn't know CLI syntax | Skill content not preloading — check `skills:` field in frontmatter, verify skill file names match |
| Main conversation flooded with subagent output | Expected behavior for foreground subagents — consider if background mode is better |
| Auto-delegation doesn't trigger | Tune the `description` field in agent frontmatter — make it more specific about when to delegate |

### Conversation quality

| Outcome | Next step |
|---------|-----------|
| Agent follows the process and produces quality intents | Move to Task 2 (build the CLI commands) |
| Agent drifts into implementation | Strengthen "do not write code" in the agent prompt — it's the agent body, not the skill |
| Agent doesn't ask enough questions | Add examples of good questions to the `intent-builder` skill |
| Agent asks too many questions | Tighten "max 3 rounds" in agent prompt, add guidance on convergence criteria |
| Agent doesn't use vault search | Strengthen codebase-context skill — add "you MUST search before your first question" |
| Agent fills everything in at once | Add to agent prompt: "you MUST ask at least one round of questions before filling in criteria" |
| Intent quality is low | Add more good/bad examples to `intent-builder` skill — that's where the reference material lives |
| Agent doesn't understand intent file structure | Improve the "Intent file sections" documentation in `intent-builder` skill |
