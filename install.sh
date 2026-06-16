#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MANIFEST="$SCRIPT_DIR/hooks/claude-code.atomic-hooks.json"

HOOKS_STATUS="not installed"

# 1. Register hooks by delegating the merge to the atomic binary. The manifest
#    in this repo is the source of truth for the hook wiring (and the
#    permissions.deny rule) — when Claude Code changes its hook schema, edit the
#    manifest and re-publish; no `atomic` rebuild needed.
if command -v atomic &>/dev/null; then
  echo "Installing hooks..."
  if atomic agent enable --hooks "$MANIFEST"; then
    HOOKS_STATUS="registered via atomic agent enable"
  else
    HOOKS_STATUS="enable failed — see output above"
  fi
else
  HOOKS_STATUS="SKIPPED — 'atomic' not on PATH"
  echo "Warning: 'atomic' not found on PATH. Install Atomic VCS first."
  echo "  Hooks will not be active until you run:"
  echo "    atomic agent enable --hooks \"$MANIFEST\""
fi

# 2. Symlink agents into ~/.claude/agents/
AGENTS_TARGET="$HOME/.claude/agents"
mkdir -p "$AGENTS_TARGET"

agents_linked=0
for agent in "$SCRIPT_DIR"/agents/*.md; do
  [ -f "$agent" ] || continue
  name="$(basename "$agent")"
  ln -sf "$agent" "$AGENTS_TARGET/$name"
  agents_linked=$((agents_linked + 1))
done

# 3. Symlink skills into ~/.claude/skills/
SKILLS_TARGET="$HOME/.claude/skills"
mkdir -p "$SKILLS_TARGET"

skills_linked=0
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$skill_dir" ] || continue
  name="$(basename "$skill_dir")"
  mkdir -p "$SKILLS_TARGET/$name"
  if [ -f "$skill_dir/SKILL.md" ]; then
    ln -sf "$skill_dir/SKILL.md" "$SKILLS_TARGET/$name/SKILL.md"
    skills_linked=$((skills_linked + 1))
  fi
done

cat <<EOF

────────────────────────────────────────────────────────────
✓ Installed atomic-claude
────────────────────────────────────────────────────────────

What was installed:
  • Hooks      ${HOOKS_STATUS}
               → ~/.claude/settings.json (merged from this repo's manifest by
                 'atomic agent enable --hooks'; also adds the permissions.deny
                 rule for .atomic/metadata. Definitions live in
                 ${MANIFEST})
  • Agents     ${agents_linked} symlinked (always re-linked)
               → ~/.claude/agents/  (e.g. @intent)
  • Skills     ${skills_linked} symlinked (always re-linked)
               → ~/.claude/skills/  (/atomic-vault, /atomic-vcs, /code-intelligence, ...)

Symlinks point back into this checkout:
  ${SCRIPT_DIR}
Keep this directory in place; moving or deleting it breaks the links.

Manual steps to finish:
  1. Per project, copy the base agent prompt to the repo root:
       cp "${SCRIPT_DIR}/CLAUDE.md" /path/to/your/project/
  2. Ensure the project is an Atomic repo (one-time):
       cd /path/to/your/project && atomic init
  3. Start Claude Code in that project — hooks activate automatically.

Verify:
  • Hooks:  grep -q claude-code ~/.claude/settings.json && echo OK
  • Skills: ls ~/.claude/skills/
  • Agents: invoke '@intent <request>' inside Claude Code

Uninstall:
  ./install.sh is install-only; to remove run:
    node install.js --uninstall
  (or: atomic agent disable --hooks "${MANIFEST}")
────────────────────────────────────────────────────────────
EOF
