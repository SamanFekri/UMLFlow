# UMLFlow

**Language-agnostic code understanding and incremental UML synchronization — for the CLI and for Claude Code.**

UMLFlow analyses a repository once, builds a compact *System Model* of its structure and behaviour, generates
Mermaid diagrams (Use Case, Sequence, ERD) from that model, and then keeps them in sync incrementally as the
code evolves — re-reading only what changed, regenerating only the diagrams that are affected, and asking an
LLM only when a question genuinely needs semantic interpretation.

> UMLFlow does not treat generated diagrams as the source of truth. **The source code is the source of truth.**
> The System Model is a cache of what the code says; diagrams are views of that model.

```
SOURCE CODE ─► change detection (git + hashes) ─► affected scope ─► parsers (tree-sitter)
           ─► System Model (components, calls, entities, flows, provenance)
           ─► Use Case / Sequence / ERD ─► Mermaid ─► .umlflow/diagrams/*.md
```

## Why

* **Token-efficient by design.** Claude never has to re-read a repository to draw or update a diagram:
  `umlflow context` summarises what is already known in a few hundred tokens, and only open *semantic
  questions* ("which actor calls `OrderController`?") need interpretation.
* **Incremental.** Content hashes + git detect what changed; a dependency-aware pipeline finds affected
  symbols and diagrams; unrelated diagrams are never touched.
* **Honest.** Every fact carries provenance: deterministic (from code), inferred (heuristics) or declared
  (by you). Uncertain facts are marked, never presented as truth. User declarations are never overwritten.
* **Language-agnostic.** Parsers sit at the edge (TypeScript/JavaScript, Python, Java, Go, SQL DDL, Prisma
  today); the model, generators and renderer never see a language-specific AST.
* **Safe.** Generated blocks are replaced in place; manual sections and everything else you write survive.
  Git hooks are installed as clearly marked managed sections next to your existing hook logic.

## Quick start

```bash
npm install -g umlflow            # or: npx umlflow …
cd my-project
umlflow init                      # choose Use Case / Sequence / ERD; builds the index and first diagrams
umlflow generate --type sequence --name checkout --about "checkout"   # scope inferred from the code
umlflow semantic questions        # what UMLFlow could not determine from code
umlflow declare actor Customer --for OrderController
umlflow update                    # regenerate only affected diagrams
umlflow install-hooks             # pre-commit: fail when diagrams are stale (or --mode update)
umlflow install-skill             # teach Claude Code to use UMLFlow
```

Diagrams land in `.umlflow/diagrams/<name>.md` (Markdown with a Mermaid block, so GitHub renders them).

## Claude Code

```bash
umlflow install-skill            # → .claude/skills/umlflow/SKILL.md
```

Then just ask: *"Create a sequence diagram for the login flow"*, *"What diagrams does this change
affect?"*, *"Update the authentication use case diagram"*. The skill instructs Claude to read UMLFlow's
state first, delegate analysis to the CLI, answer only the open semantic questions with targeted context,
respect your overrides, and report inferred vs. deterministic facts honestly.

## Documentation

* [Architecture](docs/architecture.md) · [Installation](docs/installation.md) · [Quick start](docs/quick-start.md)
* [CLI](docs/cli.md) · [Configuration](docs/configuration.md) · [Diagrams, definitions & overrides](docs/diagrams.md)
* [Incremental analysis, System Model & cache](docs/incremental-analysis.md)
* [Claude Code integration](docs/claude-code.md) · [Git hooks & CI](docs/git-hooks-and-ci.md)
* [Supported analysis](docs/supported-analysis.md) · [Extending (adapters, generators, renderers)](docs/extending.md)
* [Troubleshooting](docs/troubleshooting.md) · [Examples](docs/examples.md) · [Implementation plan](docs/plan.md)

## Development

```bash
npm install
npm test          # builds, then runs unit + integration tests (fixture repos, golden snapshots)
npm run build
```

MIT licensed.
