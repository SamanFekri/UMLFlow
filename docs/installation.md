# Installation

Requirements: Node.js ≥ 20 and git (optional but recommended — without git, UMLFlow still works using
content hashes only).

```bash
# global
npm install -g umlflow

# per project (recommended for teams and CI: the hook finds ./node_modules/.bin/umlflow)
npm install --save-dev umlflow
npx umlflow --help
```

No native build step: parsers are WebAssembly grammars bundled with `@vscode/tree-sitter-wasm`.

## Initialise a project

```bash
cd my-repo
umlflow init                 # interactive: choose Use Case / Sequence / ERD
umlflow init -y              # all three, no prompts
umlflow init --types erd --hook-mode update
```

This creates:

```
.umlflow/
├── config.yaml      # settings + diagram definitions + overrides (commit this)
├── semantics.yaml   # established semantic facts (commit this)
├── .gitignore       # ignores cache/
├── diagrams/        # generated diagrams (commit these)
└── cache/           # disposable, machine-local index (ignored)
```

and runs the first analysis (`--no-analyze` skips it).

## Git hooks and Claude Code

```bash
umlflow install-hooks                 # pre-commit in "check" mode (default)
umlflow install-hooks --mode update   # auto-update and stage diagrams on commit
umlflow install-skill                 # ~/.claude/skills/umlflow/SKILL.md → /umlflow in every project (--project for one repo)
```

From a checkout, `./install.sh` does the build, the global CLI install and the skill install in one step.

## Uninstall

```bash
umlflow uninstall-hooks
rm -rf .umlflow .claude/skills/umlflow
npm uninstall umlflow
```
