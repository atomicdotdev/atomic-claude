# Atomic VCS Agent

You use **Atomic VCS** (not git). A draft view is created for each session automatically.

## Every prompt is a turn. Every turn follows this sequence.

### 1. Create an intent

```bash
atomic vault intent create --title "<short title>"
```

This gives you an intent ID (e.g., HELL-4) and a file path.

### 2. Define the problem

The user's prompt is usually a **solution** ("build me X"). Reframe it as a **problem statement**.

Ask clarifying questions if the problem is ambiguous. Do not guess — ask.

Once the problem is clear, define:

- **Problem statement** — what problem are we solving and why
- **Success criteria** — concrete, testable conditions that mean "done"
- **Tasks** — ordered list of work items

Write all of this into the intent file. Replace every REPLACE placeholder.

Then run `atomic vault sync` to persist the file into the vault database. The intent file lives on disk, but `atomic vault intent show`/`update` read from the database — without `sync` they see the original placeholder template, and `update` will overwrite your file edits with it.

### 3. Execute the tasks

Work through the TODOs in order. After completing each one:

1. **Verify** it meets its criteria — run the commands or checks specified in the TODO.
2. **Edit the intent file** using your file editing tool to mark it done:
   ```
   - [ ] `HELL-1/1` ...   →   - [x] `HELL-1/1` ...
   ```
   Also check off any acceptance criteria that are now satisfied.
3. **Sync** so the database stays current:
   ```bash
   atomic vault sync
   ```

**Use your file editing tool to check off tasks — not bash, not Python, not sed.** Raw file manipulation bypasses the vault.

### 4. Update the intent

```bash
atomic vault sync                          # persist file edits to the database first
atomic vault intent update <ID> --status done
```

Always `atomic vault sync` before `intent update` — `update` re-materializes the database copy over the file, so an unsynced update discards your edits.

**Do NOT run `atomic add` or `atomic record`.** The hook system records your changes automatically with full AI provenance (model, tokens, session, timing) when the turn ends. (`atomic vault sync` is not `record` — it only moves your `.vault/` edits into the vault database, and you must run it.)

## Rules

- **One intent per turn.** Every prompt gets its own intent.
- **Problem first.** Reframe solution-requests as problems. Ask questions if unclear.
- **Write the intent file before coding.** The plan goes in the file, not just in chat.
- **Use Atomic for code discovery in every mode, including Plan Mode.** Before using Claude Code `Grep`, `Glob`, shell `grep`, `find`, `rg`, or similar filesystem search tools, first try the Atomic knowledge graph and content index:
  - Source text: `atomic vault query code "pattern" -t <type>`
  - Structure: `atomic vault query search "term"`
  - Relationships: `atomic vault query neighbors <node_id>`
  - File outline: `atomic vault query entities <path>`
- **Only fall back to `Grep`/`Glob`/`find` if Atomic query commands fail, the repository has no content index/KG yet, or you need to inspect files that are not tracked/indexed by Atomic.** If results are sparse, run `atomic vault query enrich` before falling back.
- **Do not run `atomic add` or `atomic record`.** Hooks handle this with provenance.
- **Do run `atomic vault sync` after editing any `.vault/` file**, and before `atomic vault intent show`/`update`. It deflates your on-disk edits into the vault database; it is not `record` and hooks do not do it for you mid-turn.
- **Do not create or switch views.** The session view is created automatically.
- **Do not run `atomic agent enable`.** The integration is already configured globally.

## Skills

Use these for detailed reference when needed:

- `/atomic-vault` — intent and goal lifecycle, memory operations
- `/atomic-vcs` — inspect repository state and history: `status`, `log`, `change` (`-p` provenance, `-a` AI attestation), `diff`
- `/code-intelligence` — knowledge graph queries for code exploration
