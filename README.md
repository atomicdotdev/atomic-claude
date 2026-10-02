# atomic-claude

[Atomic VCS](https://atomic.dev) integration for [Claude Code](https://code.claude.com): an installable plugin with a mod, skills, and an intent agent.

**Atomic is a graph-and-patch version control system, not Git.** The mod uses Atomic for repository discovery, views, changes, dependency-aware review, provenance, and signing. Views are filtered perspectives on Atomic's graph; separate concurrent working directories use Atomic sandboxes.

The authoritative source is `https://atomic.atomic.storage/workspaces/oss/projects/atomic-claude/code`. GitHub is a mirror.

## Requirements

- **Claude Code 2.1.287 or later** for mods (`claude --version`).
- **Atomic 0.18.3 or later** on PATH (`atomic --version`).
- **Node.js 18 or later** on PATH for installation and standalone session finalization.
- An Atomic repository or Atomic sandbox. The mod remains inactive in other directories.

## Install

### From npm or a local checkout

```bash
npx atomic-claude
# Or, from this checkout:
node install.js
# The shell entry point delegates to the same installer:
./install.sh
```

The installer checks `claude --version` before enabling the mod. Too-old, missing, failed, or unrecognized version output produces an actionable warning, **including during silent npm postinstall**. Unsupported versions receive legacy hooks, skills, and the intent agent instead of the mod. Upgrade Claude Code and rerun installation to enable the UI.

For a compatibility check without installation:

```bash
node install.js --check
```

This exits nonzero when mod compatibility cannot be established.

On supported versions the installer links the self-contained `plugin/` directory into `~/.claude/skills/atomic/`, which Claude Code loads as `atomic@skills-dir`. It also maintains legacy skill/agent links and installs Rust hooks through Atomic. An ownership receipt at `~/.claude/atomic-claude/installer.json` allows installer-created links to migrate between package locations, including npx caches. Arbitrary user-owned files, directories, and symlinks are preserved. Keep the active package in place while using its links. Failed hook enable/disable operations report their diagnostics even in silent mode and exit nonzero; missing/incompatible Atomic produces an explicit partial-install warning.

Restart Claude Code or run `/reload-plugins`, then try `/atomic-status`. The mod injects Atomic workflow context in Atomic repositories; copying `CLAUDE.md` is needed only for the legacy integration.

### From Atomic storage

The Atomic CLI's declarative installer stages an inert activation bundle, preserves the shared `atomic-skills` source for global skills, and installs legacy Rust callbacks. It does not write a plugin manifest/module into an occupied Claude discovery slot:

```bash
atomic agent enable --agent claude-code
# Local development package:
atomic agent enable --agent claude-code --from .

# Explicitly activate the staged plugin through version and ownership checks:
node "$HOME/.atomic/claude-code/activation/install.js"
```

The declarative stage does not execute package code. The activation command performs the install-time Claude check and protects the plugin directory as a unit. You can also check the staged bundle without activating it:

```bash
node "$HOME/.atomic/claude-code/activation/install.js" --check
```

Storage installations also install a lightweight `SessionStart` version check against the inert bundle. Older Claude versions see an upgrade warning and retain legacy callbacks. The `[requires]` gate checks Atomic, not Claude Code. An existing user-owned `~/.claude/skills/atomic` directory is never converted to a plugin by staging or activation. To migrate an older declarative installation that already copied an owned plugin there, uninstall that receipt-managed distribution first, then stage and activate the new bundle; modified/unowned files require manual attention.

### Try the mod without installing it

```bash
claude --plugin-dir ./plugin
```

The plugin is self-contained: its manifest, module, skills, and agent all live under `plugin/`. Mods require 2.1.287 even when loaded this way.

## Commands and interface

| Command | Behavior |
| --- | --- |
| `/atomic-status` | Shows the current view and parent, working-copy status, explicit session-local intent selection, repository intent inventory, and recording dispatch state. |
| `/atomic-review` | Shows recent recorded changes, working-copy token diff, and repository intent inventory. |
| `/atomic-review HASH` | Shows a recorded change's dependencies, provenance decision graph, and AI attestation. |
| `/atomic-intent` | Inspects the explicit selection and lists repository intents without selecting one. |
| `/atomic-intent ID` | Explicitly selects an existing intent for this Claude session. |
| `/atomic-intent --clear` | Clears this session's selection. |

Commands run directly, without a model turn. The terminal and Desktop app show a review pane and an Atomic band above the prompt. Headless sessions and surfaces without mod drawing receive textual review output instead. The band refreshes at session/turn boundaries and after completed potentially mutating main-conversation tool calls; `/atomic-status` explicitly refreshes current state.

Live refresh observes tool completion (including Bash commands and file edits), coalesces bursts with a 100 ms debounce, and reads Atomic's working-copy state and intent inventory in the background. It updates the status of the exact explicitly selected intent. Commands that update a different intent never select that intent. The observer does not parse shell text to guess status or write lifecycle state, and it also reads after failed actions that may have partial effects. Known read-only tools and denied calls do not schedule a refresh. Only one live read runs at a time; actions during a read request another pass. Older results cannot override a newer foreground refresh or repaint a reset session, and refresh failures show cached data with an error indicator.

Review commands are read-only. Promotion into shared views remains part of Atomic's existing independent-review and dependency-aware insertion workflow. The mod never implements graph operations or silently promotes a change.

Skills are available through the plugin namespace, such as `/atomic:atomic-vault`, `/atomic:atomic-vcs`, and `/atomic:code-intelligence`. The bundled agent is `atomic:intent`; compatibility installs also provide the original global skills and `intent` agent.

### Explicit active-intent handoff

The band **never infers an intent from list order, status, or the current view**. It starts without an intent and displays one only after an explicit announcement or user selection.

The mod registers `mcp__atomic__set_active_intent` for Claude:

```json
{"intent_id": "HELL::bradley::1"}
```

To clear it, Claude calls the same tool with `{"intent_id": null}`. The tool description and injected workflow tell the main conversation to announce the intent it actually chooses to plan, implement, or review, announce switches, and clear the selection when leaving that work. Subagents cannot change the parent conversation's selection; they report intent IDs to the parent.

Both the tool and `/atomic-intent ID` reject malformed IDs and IDs not found by `atomic intent list --json`. Use the exact full ID returned by `atomic intent new/list`; numeric aliases are not resolved. A failed lookup or persistence operation returns an error rather than claiming a new selection. Selection does not approve an intent, change its status, create it, or mutate Atomic's session ledger.

Until Atomic provides a native session binding, this is explicitly a **display hint** stored through Claude's plugin store, keyed by canonical Atomic repository and Claude session ID. Sandboxes resolve their graph root from `.atomic-sandbox`. Lifecycle generations fence delayed selections: a pre-reset write cannot reactivate a cleared selection or publish into a new session. Reload and same-ID resume restore the current generation; fresh IDs start unselected. `/clear` and `/branch` (source `fork`) start unselected. A resume receiving a different ID also starts unselected even if Atomic reuses a view.

Titles and statuses are refreshed from Atomic. A missing selected intent is shown as `not found`, and unavailable lookup as `lookup unavailable`; neither condition chooses a replacement. If an older supported Atomic CLI cannot supply the intent inventory, view/status display continues but a new selection cannot be verified. No new Atomic binding command or Rust upgrade is required.

## Lifecycle and provenance

The Rust backend owns the durable session ledger, graph, view selection, recording, and signing:

1. `classic.SessionStart` starts/resumes Atomic tracking. Sandbox sessions adopt their pointer's view.
2. `classic.UserPromptSubmit` starts the Atomic interaction.
3. Tool events feed the existing Rust provenance handlers.
4. `turn.step` collects main-loop API-reported model and token/cache counts. `classic.Stop` forwards those counts with the original transcript and session fields.
5. Interrupted, terminal API-error, and refusal completions receive a Rust checkpoint if normal Stop did not run. Unconfirmed failure checkpoints preserve their original prompt and usage for recovery before a later prompt can replace attribution.
6. Session end delegates pending flush and attestation to Rust. The session view stays available for review.

**Exactly one owner dispatches each callback.** The mod checks effective settings for matching Atomic hook commands. Existing legacy callbacks receive enriched payloads; the mod invokes the same CLI handler itself only when no matching owner exists. Old guards in nested directories and partially installed hook sets are handled individually. Non-Atomic settings hooks continue normally.

Ownership includes lifecycle source matchers. Native PreToolUse envelopes are adapted to Rust stdin while the host receives its original envelope and permission result. Stop usage is consumed only after a structured recorded-change acknowledgement or causally chained ledger advancement from `atomic session show ID --json`, including read-only checkpoints. A continuing native turn restarts Rust with the captured original prompt and only outstanding request usage; blocked/failed callbacks are not assumed successful merely because their shell exits zero.

Compaction preserves the captured interaction prompt. An uncertain checkpoint retains its original ledger baseline and exact forwarded usage snapshot: recovery can recognize a publication whose after-read failed without replaying recording. Pending uncertainty is resolved before a continuation or later prompt; if recovery cannot be confirmed, the mod uses the host's abort/block controls rather than throwing a hook that Claude could skip. Selection restoration is also revision-fenced so an old inspection cannot replace a newer announcement.

Mod reload only re-registers commands and refreshes UI; it does not create another Rust session or view. Classic events handle `/clear`, resume, and compaction. Reactive presentation/usage state survives mod reload, while authoritative state remains in Atomic.

Subagent requests are not added to main-loop token totals. Tool/transcript provenance continues through Rust. The mod does not invent dollar costs or claim one final model describes every request. Full cross-agent/model cost accounting is a backend extension, not a UI calculation.

Claude limits session-end handlers to 1.5 seconds. Standalone-plugin finalization uses a bounded Node launcher and a detached worker so the Rust flush/attestation can finish afterward. Diagnostics are written to `atomic-claude-finalize-*.log` in the OS temporary directory. Existing legacy settings hooks retain their own finalization behavior. Check `atomic agent status --json` for session state; an unsuccessful Rust flush leaves work recoverable rather than finalizing it as successful. UI dispatch state is not an independent attestation of recording success.

## Memory and intent workflow

The injected context and bundled skills guide memory research before drafting an intent. Memory retrieval returns candidates; memories are historical project data. Creating or expanding memory requires separate explicit approval of the exact proposal.

Current Atomic commands are `atomic intent new/list/show/update/validate/attest/verify` and `atomic memory ...`. The removed `atomic vault intent` and `atomic vault memory` namespaces are not used by the bundled workflow. Intents must contain directives, satisfy their criteria with verification evidence, and be signed before handoff at `needs-review`.

Useful repository-data commands:

```bash
atomic vault query enrich                  # Build code/content and graph indexes
atomic vault query code "PostToolUse"      # Search source
atomic vault query search "install"        # Search structure/history
atomic vault context "Claude mod hooks" --format json
atomic vault sync                          # Persist edited Vault documents
```

## Development and verification

```bash
npm test                                  # Installer/workflow + real Rust hook test
npm run test:mod                           # Event, ownership, interruption and UI tests
npm run validate:plugin                    # Strict Claude plugin validation
claude -p "/atomic-status" --plugin-dir ./plugin
```

The Rust integration test uses a temporary repository, verifies recorded token provenance and duplicate-Stop behavior, and exercises the finalization worker. It skips when Atomic is not installed. Claude's generated local type declarations and `plugin/tsconfig.json` are ignored; shipped declarations are in `plugin/types/`.

## Uninstall

For npm/local symlink installations:

```bash
node install.js --uninstall
```

For Atomic storage installations:

```bash
atomic agent disable --agent claude-code
```

If you explicitly activated a staged storage bundle, remove its installer-owned links before removing the staged files:

```bash
node "$HOME/.atomic/claude-code/activation/install.js" --uninstall
atomic agent disable --agent claude-code
```

Installer-owned links/copies and hook entries are removed; user-owned or modified files are retained. Remove manually copied project `CLAUDE.md` instructions yourself when no longer needed. Disabling only the mod leaves separately installed legacy callbacks active; uninstall those callbacks to stop recording.

## License

Apache-2.0, same as Atomic VCS.
