---
name: intent-builder
description: Define, verify, and confirm directive-based Atomic intents before implementation.
---

# Building Intents

## Research and check for duplicates

Follow the atomic-vault skill's memory-first workflow. Retrieved memory is historical data; any memory mutation needs separate explicit confirmation of the complete proposal. Then run `atomic intent list`. Continue an existing intent covering this problem rather than creating a duplicate.

## Create and fill the intent

```bash
atomic intent new "Short agent authored title"
```

Use the exact returned file path; do not construct one from the display ID. Preserve frontmatter and fill every directive stub. Copy the UID from the scaffold:

When the mod's `mcp__atomic__set_active_intent` tool is available to the main conversation, announce the exact intent ID being drafted or continued. Clear or switch that display selection when the work changes. This does not approve an intent or update Atomic lifecycle state. A subagent returns the ID to its parent rather than changing the parent selection. With no mod tool, continue the CLI workflow.

```markdown
:::why
What is broken or missing, and why it matters.
:::
:::acceptance-criterion{#<uid>-ac-1 status=unmet}
A single outcome that a reviewer can verify.
:::
:::task{#<uid>-1 status=open criteria=<uid>-ac-1}
A concrete work item naming files, dependencies, and verification.
::file-ref{path=src/example.rs}
:::
:::scope-in
Specific components included.
:::
:::scope-out
Explicit boundaries and their consequences.
:::
:::constraint
Atomic is a graph-and-patch VCS; the integration owns recording and views.
:::
```

The mandatory `:::why` describes the problem, rather than repeating a requested solution. Tasks must be independently understandable, name verified file paths, and specify meaningful checks. Order tasks by dependencies. Do not invent CLI commands for changing individual criteria: edit the directive file directly.

## Simplification guard

For every simpler or divergent approach:
1. Name the reference implementation or specification.
2. Enumerate behavior it drops: interruptions, failures, boundaries, round-trip fidelity, cleanup, and concurrency.
3. Preserve each behavior with an acceptance criterion, explicitly exclude it with consequences, or ask the user.

A decision about API shape is not a decision about behavior. Never silently lose a guarantee.

## Persist and obtain acceptance

```bash
atomic vault sync
atomic intent show <id>
```

The CLI reads from the database. Unsynced `intent update` can overwrite your file with stale data. Present the problem, criteria, tasks and constraints and wait for explicit acceptance before implementation. Selected source memories require path/revision revalidation using `atomic vault context --intent <id> --format json`; changed sources require renewed acceptance. With no selected sources, skip that retrieval.

```bash
atomic vault sync
atomic intent update <id> --status planned
```

## Execute and verify

Mark `in_progress` when implementation begins. After each task passes its checks, use the native editing tool to change task `status=open` to `status=done`. Mark a satisfied criterion with all three attributes:

```markdown
:::acceptance-criterion{#<uid>-ac-1 status=met verifiedBy="test suite" evidence="actual passing command"}
```

Sync after every edit. When complete:

```bash
atomic vault sync
atomic intent validate <id>
atomic intent attest <id>
atomic intent verify <id>
atomic intent update <id> --status needs-review
```

An unsigned intent may fail validation only for missing attribution/proof, which `attest` fills; fix every content violation before signing. Independent review completes the handoff. Never manually add/record changes or create/switch views; the integration owns those operations.
