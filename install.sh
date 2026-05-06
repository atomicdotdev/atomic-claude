#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 1. Install hooks into ~/.claude/settings.json
if command -v atomic &>/dev/null; then
  echo "Installing hooks..."
  atomic agent enable --agent claude-code --global 2>/dev/null || true
else
  echo "Warning: 'atomic' not found on PATH. Install Atomic VCS first."
  echo "  Hooks will not be active until you run: atomic agent enable --agent claude-code --global"
fi

# 2. Symlink agents into ~/.claude/agents/
AGENTS_TARGET="$HOME/.claude/agents"
mkdir -p "$AGENTS_TARGET"

linked=0
skipped=0

for agent in "$SCRIPT_DIR"/agents/*.md; do
  [ -f "$agent" ] || continue
  name="$(basename "$agent")"
  if [ -L "$AGENTS_TARGET/$name" ] || [ -f "$AGENTS_TARGET/$name" ]; then
    skipped=$((skipped + 1))
  else
    ln -sf "$agent" "$AGENTS_TARGET/$name"
    linked=$((linked + 1))
  fi
done

echo "  agents: $linked linked, $skipped skipped → ~/.claude/agents/"

# 3. Symlink skills into ~/.claude/skills/
SKILLS_TARGET="$HOME/.claude/skills"
mkdir -p "$SKILLS_TARGET"

for skill_dir in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$skill_dir" ] || continue
  name="$(basename "$skill_dir")"
  mkdir -p "$SKILLS_TARGET/$name"
  if [ -f "$skill_dir/SKILL.md" ]; then
    if [ -L "$SKILLS_TARGET/$name/SKILL.md" ] || [ -f "$SKILLS_TARGET/$name/SKILL.md" ]; then
      skipped=$((skipped + 1))
    else
      ln -sf "$skill_dir/SKILL.md" "$SKILLS_TARGET/$name/SKILL.md"
      linked=$((linked + 1))
    fi
  fi
done

echo "  skills: $linked linked, $skipped skipped → ~/.claude/skills/"

echo ""
echo "✓ Installed atomic-claude"
echo "  Hooks:  ~/.claude/settings.json"
echo "  Agents: ~/.claude/agents/"
echo "  Skills: ~/.claude/skills/"
echo ""
echo "  Invoke the Intent Agent in Claude Code:"
echo "    @intent <your request>"
echo ""
echo "  Or copy CLAUDE.md into your project root for base Atomic context:"
echo "    cp $SCRIPT_DIR/CLAUDE.md /path/to/your/project/"
