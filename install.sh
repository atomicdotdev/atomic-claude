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

# 2. Symlink skills into ~/.claude/skills/
TARGET="$HOME/.claude/skills"
mkdir -p "$TARGET"

for name in atomic-vault code-intelligence; do
  mkdir -p "$TARGET/$name"
  ln -sf "$SCRIPT_DIR/skills/$name/SKILL.md" "$TARGET/$name/SKILL.md"
done

echo "✓ Installed atomic-claude"
echo "  Hooks: ~/.claude/settings.json"
echo "  Skills: ~/.claude/skills/"
echo ""
echo "  Copy CLAUDE.md into your project root to enable the agent prompt:"
echo "    cp $SCRIPT_DIR/CLAUDE.md /path/to/your/project/"
