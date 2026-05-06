---
name: intent-builder
description: How to create, build, and confirm intents using the Atomic vault CLI.
---

# Building Intents

Intents are structured work records in the Atomic vault. You build them through CLI commands and by editing the intent markdown file.

## Commands

### Check for duplicates first

```
atomic vault intent list
atomic vault intent list -s backlog
atomic vault intent list --json
```

Always run this before creating. If an existing intent covers the same problem, tell the user.

### Create a draft

```
atomic vault intent create --title "Short title under 80 chars"
```

Returns an intent ID (e.g., `ATOM-42`) and a file path under `.vault/intents/`. The file is a markdown template with placeholder sections. Your job is to fill them in.

Optional flags:
- `-p high` — priority: `low`, `medium`, `high`, `critical`
- `--assignee name` — who owns this
- `--labels "security,auth"` — comma-separated tags

### Show an intent

```
atomic vault intent show ATOM-42
atomic vault intent show ATOM-42 --json
```

Use this to read back the current state before presenting to the user.

### Confirm the intent

```
atomic vault intent update ATOM-42 --status planned
```

Only run this after the user explicitly approves.

## The intent file

After `create`, edit the file at `.vault/intents/<id>/intent.md`. Replace every section:

### Problem (required)

What is broken or missing, and why it matters. This is NOT a solution description. Minimum two sentences.

Bad: "Add OAuth2 to the API"
Good: "The atomic-storage API has no authentication. All endpoints are publicly accessible, meaning any client can read or modify any tenant's data."

### Acceptance Criteria (required, at least 1)

Checklist items that are testable — a reviewer or test suite could verify each one.

Bad: "- [ ] Auth works"
Good: "- [ ] OAuth2 authorization code flow with PKCE returns a valid JWT"

### Scope — In (required, at least 1)

Specific crates, modules, files, or components included.

```
**In:**
- atomic-storage-auth crate
- Route middleware in atomic-storage-routes
```

### Scope — Out

What you're explicitly NOT doing. Prevents scope creep.

```
**Out:**
- CLI authentication
- UI login flow
```

### Constraints

Technical limits, compatibility requirements, or decisions that must be respected.

```
- Must use existing atomic-identity KeyPair — no new key types
- Must not break existing unauthenticated health check endpoint
```

### Dependencies

Other intent IDs that must complete first. Use the `PREFIX-N` format.

```
- ATOM-41 (token contract definitions)
```

### TODOs (required, at least 1)

TODOs are the independently executable tasks that build agents pick up. Each TODO is a unit of work that can run in parallel — a build agent reads one TODO and has everything it needs to start without reading the others.

#### Structure

Every TODO must have:
- **ID** — `<intent-id>/<n>` (e.g., `ATOM-42/1`)
- **Title** — short description of the task
- **Files** — specific file paths that will be created or modified. Use `atomic vault query search` and `atomic vault query entities` to find real paths. Never guess.
- **Criteria** — how to verify this specific TODO is done. Must be a subset of the intent's acceptance criteria, or a step toward them.
- **Depends** — other TODO IDs from this intent that must complete first. Omit if independent.

#### Format

```
## TODOs

- [ ] `ATOM-42/1` Add `set` subcommand to vault intent CLI
  **Files:** `atomic-cli/src/commands/vault/intent.rs`, `atomic-repository/src/repository/vault_intent.rs`
  **Criteria:** `atomic vault intent set ATOM-42 --problem "..."` writes the problem field to frontmatter and re-renders the intent file.

- [ ] `ATOM-42/2` Add `add` subcommand for list fields
  **Files:** `atomic-cli/src/commands/vault/intent.rs`, `atomic-repository/src/repository/vault_intent.rs`
  **Criteria:** `atomic vault intent add ATOM-42 --criteria "..."` appends to the criteria list in frontmatter and re-renders.

- [ ] `ATOM-42/3` Add `confirm` subcommand with validation gate
  **Files:** `atomic-cli/src/commands/vault/intent.rs`, `atomic-repository/src/repository/vault_intent.rs`
  **Criteria:** `atomic vault intent confirm ATOM-42` rejects if problem is empty or criteria count is 0, succeeds otherwise.
  **Depends:** `ATOM-42/1`, `ATOM-42/2`
```

#### Rules for good TODOs

**Independence.** A build agent reads ONE TODO. It does not read other TODOs. Each TODO must contain enough context to execute — the file paths, the expected behavior, and the success criteria. If a TODO requires understanding another TODO to make sense, it's not independent enough.

**Specific files.** Always search the codebase (`atomic vault query search "X"`, then `atomic vault query entities <file>`) to find the real file paths. Never write `"the relevant file"` or `"update as needed"`. Name the exact paths.

**Scoped criteria.** Each TODO's criteria should be verifiable in isolation. "The full test suite passes" is not a TODO criterion — that's the intent's acceptance criterion. A TODO criterion is: "Running `atomic vault intent set ID --problem '...'` updates the frontmatter and exits 0."

**Ordered by dependency.** List TODOs in execution order. Independent TODOs first, then TODOs that depend on them. This makes the dependency graph obvious at a glance.

**Right-sized.** A TODO should take a build agent 1–15 minutes. If a TODO would take an hour, split it. If it would take 30 seconds, merge it into an adjacent TODO.

#### Bad TODOs

```
- [ ] `ATOM-42/1` Implement the feature
  **Files:** various
  **Criteria:** It works

- [ ] `ATOM-42/2` Write tests
  **Files:** tests/
  **Criteria:** Tests pass
```

This is useless — no specificity, no real file paths, no verifiable criteria, and "write tests" is not independent of the implementation.

#### Good TODOs

```
- [ ] `ATOM-42/1` Add IntentSetOptions struct and vault_intent_set method
  **Files:** `atomic-repository/src/repository/vault_intent.rs`
  **Criteria:** `IntentSetOptions` has `problem: Option<String>`, `priority: Option<String>`, `title: Option<String>`. `vault_intent_set()` updates frontmatter for non-None fields. Unit test: set problem on an existing intent, read it back, verify it persists.

- [ ] `ATOM-42/2` Wire set subcommand into CLI
  **Files:** `atomic-cli/src/commands/vault/intent.rs`
  **Criteria:** `atomic vault intent set ATOM-42 --problem "test"` calls `vault_intent_set()` and prints confirmation. `--problem`, `--priority`, `--title` flags are defined.
  **Depends:** `ATOM-42/1`
```

Each TODO names exact files, describes verifiable behavior, and can be handed to a build agent cold.

## Multiple intents

When the conversation reveals multiple distinct problems:

1. Create all of them with `intent create`
2. Note dependencies in each file's Dependencies section
3. Fill in each one in sequence, including TODOs for each
4. Show all of them to the user for review
5. Confirm all on approval

## What NOT to put in an intent

- Solution architecture — you define the what, the TODOs define the where, the build agent decides the how
- Test code or implementation snippets — build agents write code, not you
- Vague scope like "update relevant files" — use `search` and `entities` to find the real paths