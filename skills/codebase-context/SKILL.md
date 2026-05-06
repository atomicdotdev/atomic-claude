---
name: codebase-context
description: How to understand the codebase using the Atomic knowledge graph before asking questions or writing code.
---

# Codebase Context

Use these commands to understand the codebase before asking the user questions. What you find here informs what you ask.

You ARE the reasoning agent. Use the KG tools directly — don't delegate to `atomic vault query ask` (that's for humans without an LLM in the loop).

This applies in **Plan Mode** too: gather context with `atomic vault query ...` commands before using Claude Code `Grep`, `Glob`, shell `grep`, `find`, `rg`, or similar filesystem search tools. Atomic is the primary code-discovery surface; grep/find are fallback tools only when Atomic lacks an index, returns sparse results after `atomic vault query enrich`, or you need untracked files.

## Understand a File's Structure

```
atomic vault query entities src/auth.rs
```

Returns every function, class, struct, trait, type, and constant with line ranges and signatures. This is a table of contents — use it instead of reading the whole file.

## Find Where Something Is

```
atomic vault query search "authentication"
atomic vault query search "ViewScope"
```

Short, specific terms. Returns node IDs with descriptions. Use the node IDs with `neighbors` to explore connections.

## Follow Relationships

```
atomic vault query neighbors entity:src/auth.rs:authenticate:10
atomic vault query neighbors file:src/pristine/traits.rs
atomic vault query neighbors change:R4YQUAS2UZV5
```

Shows direct connections — what entities a file defines, what files a change modified, who authored it, what depends on what.

**Never construct node IDs.** Copy them from search results or entities output.

## Check Project Memory

```
atomic vault memory list
atomic vault memory show <key>
```

Memory entries are persistent knowledge the vault retains across sessions — architectural decisions, conventions, known constraints. Check these before proposing changes that might violate existing decisions.

## How to Use This in the Intent Workflow

1. **Before your first question**: `search` for terms related to the user's request. Run `entities` on files that look relevant. What exists? What crates are involved?
2. **Between question rounds**: follow up on what the user said. They mention a type — `search` for it. They mention a file — run `entities` on it.
3. **When defining scope**: use `entities` and `neighbors` to name specific functions and types, not vague areas.
4. **When identifying constraints**: `neighbors` reveals what depends on what. If changing X would break Y, that's a constraint worth noting.
5. **When writing TODOs**: run `entities` on the files you plan to list. Confirm they exist and contain what you think they contain.

## The Pattern

```
search "concept"           → find relevant nodes
neighbors <node_id>        → follow connections
entities <file>            → see file structure with line ranges
read_file (your tool)      → read specific lines you now know about
```

Each step narrows your focus. By the time you read source code, you know exactly which lines matter.

## Enriching the Knowledge Graph

If searches return sparse results:

```
atomic vault query enrich
```

This extracts file nodes, change history, and tree-sitter entities into the KG. Run it once after importing a repo or when results seem thin.