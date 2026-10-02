#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' "Node.js is required for the installer and Claude Code mod version check." >&2
  exit 1
fi
exec node "$SCRIPT_DIR/install.js" "$@"
