#!/bin/sh
# Install UMLFlow from this checkout: the `umlflow` CLI (global) and the /umlflow Claude Code skill.
set -e
cd "$(dirname "$0")"
echo "▸ Building UMLFlow…"
npm install --no-audit --no-fund >/dev/null
npm run build >/dev/null
echo "▸ Installing the umlflow CLI globally (npm install -g .)…"
npm install -g . --no-audit --no-fund >/dev/null
echo "▸ Installing the /umlflow skill into ~/.claude/skills/umlflow…"
umlflow install-skill --quiet
echo
echo "Done. In any project, open Claude Code and type:"
echo "  /umlflow                       # initialize and build all diagrams"
echo "  /umlflow sequence \"checkout\"   # a scoped sequence diagram"
echo "  /umlflow --help                # all commands"
