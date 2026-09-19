# UMLFlow — Implementation Plan

This document turns the UMLFlow specification into concrete architectural
decisions and an ordered build plan. It is kept in the repository so the
reasoning behind the structure is not lost.

## 1. Technology decisions

| Concern | Decision | Why |
|---|---|---|
| Runtime / language | Node.js ≥ 20, TypeScript (ESM, strict) | Same runtime as Claude Code tooling, strong typing, easy CLI distribution via `npm`/`npx`. |
| Parsing | `@vscode/tree-sitter-wasm` (web-tree-sitter runtime + prebuilt grammars) | Mature, language-agnostic AST with no native build step. One dependency covers TS/TSX/JS, Python, Java, Go, Rust, Ruby, PHP, C#, C++. Adding a language = one adapter file + the grammar. |
| Schema formats | Small dedicated extractors for SQL DDL and Prisma schema | No mature tree-sitter grammar ships for these; the DDL subset needed for an ERD is small and stable. |
| CLI | `commander` | Standard, good help output. |
| Config | YAML via `yaml` (Document API preserves comments) | Human-editable project files. |
| Interactive prompts | `@inquirer/prompts` | Only used by `init`/`generate` when no flags given and stdin is a TTY. |
| Tests | `vitest` with fixture repositories + snapshot ("golden") outputs | Fast, TypeScript-native. |
| LLM access | **None inside the CLI.** Semantic interpretation is exposed as a *question/answer protocol* (`umlflow semantic questions` / `umlflow semantic answer`). | Claude Code *is* the LLM. The skill instructs Claude to answer only the open questions with targeted context. No API keys, no hidden token use, fully testable. |

## 2. Repository layout

```
umlflow/
├── package.json, tsconfig.json, vitest.config.ts
├── src/
│   ├── cli/                 # commander program + one file per command
│   ├── core/                # shared primitives: SourceRef, Provenance, errors, hashing, fs helpers
│   ├── config/              # config schema, defaults, load/save (comment-preserving), init
│   ├── change/              # git queries + content hashing + ChangeSet computation
│   ├── index/               # local cache store (file hashes, per-file code model, model, diagram state)
│   ├── codemodel/           # language-independent Code Model (files, symbols, imports, calls, annotations)
│   ├── parsers/             # LanguageAdapter interface, registry, tree-sitter runtime, per-language adapters,
│   │                        # schema extractors (SQL, Prisma), fallback adapter
│   ├── model/               # UMLFlow System Model: types, builder (code model → model), semantics store,
│   │                        # precedence/merge, entity extractors (ORM/SQL → entities), flows, diff
│   ├── diagrams/            # diagram definitions, scope resolution/inference, diagram IR,
│   │                        # generators (usecase, sequence, erd) behind a registry
│   ├── render/              # Renderer interface + Mermaid renderer
│   ├── sync/                # incremental pipeline: affected-diagram computation, update/check/status, output files
│   ├── hooks/               # git hook install/uninstall/run with managed sections
│   └── skill/               # Claude Code skill content + installer
├── skill/SKILL.md           # the Claude Code skill (also installable via `umlflow install-skill`)
├── docs/                    # user + contributor documentation
└── tests/
    ├── fixtures/repos/      # small multi-language fixture repositories
    ├── unit/                # per-subsystem tests
    ├── integration/         # end-to-end CLI flows on temp git repos
    └── __snapshots__/       # golden Mermaid outputs
```

## 3. Data flow

```
source files ──► parsers (tree-sitter adapters) ──► CodeFile (per-file, cached by hash)
                                                        │
                        semantics.yaml (user/inferred) ─┤
                                                        ▼
                                              SystemModel builder
                        (classification, dependencies, interactions, entities, flows)
                                                        │
                       diagram definitions (config) ────┤
                                                        ▼
                                   generators ──► Diagram IR ──► Mermaid renderer
                                                        │
                                                        ▼
                                  .umlflow/diagrams/<name>.md (generated + manual sections)
```

## 4. State layout

Committed (project-facing):

```
.umlflow/
├── config.yaml        # settings, diagram definitions, user overrides
├── semantics.yaml     # established semantic facts (declared by user / inferred by Claude)
└── diagrams/*.md      # generated diagrams (generated section + protected manual section)
```

Local, disposable, git-ignored:

```
.umlflow/cache/
├── index.json         # file hashes + per-file Code Model (facts, never source text)
├── model.json         # last built System Model (used for `diff`)
└── diagrams.json      # per-diagram input set + output fingerprint (for affected-diagram detection)
```

## 5. Key design choices

* **Provenance on every fact**: `{ source: code | semantic-inference | user, confidence: deterministic | inferred | declared | unknown, refs: SourceRef[] }`.
  Precedence when merging: user > code > inference > unknown. Semantic answers are stored in `semantics.yaml`
  and are never overwritten by later inference; user declarations are never overwritten by anything.
* **Incremental pipeline**: ChangeSet (git + hashes) → changed files → re-parse only those → rebuild the System
  Model from cached CodeFiles (cheap, in-memory) → compare affected components/entities → regenerate only
  diagrams whose recorded input set intersects the change (or whose definition/semantics changed).
* **Sequence diagrams from flows**: entry points (HTTP routes, exported handlers, public controller methods)
  are walked through resolved call edges (receiver-type resolution via constructor injection / fields / imports)
  bounded by diagram scope and depth. Only components are participants, never every function.
* **Use cases from entry points**, not classes: operations grouped per controller/handler, named by humanised
  operation or route names (inferred) unless declared; actors default to *unknown* (rendered as such) until
  declared or inferred through the semantic protocol.
* **ERD from any of**: SQL DDL, Prisma, TypeORM decorators, SQLAlchemy / Django models, JPA annotations — all
  normalised to the same `Entity`/`EntityRelation` model.
* **Renderer is pluggable**: generators emit a Diagram IR (`UseCaseDiagram`, `SequenceDiagram`, `ErDiagram`, …);
  `MermaidRenderer` is the first implementation. Mermaid has no native use case diagram, so it is rendered
  as a flowchart with actor/ellipse nodes inside a system boundary subgraph.
* **User-owned content survives**: outputs contain a generated block and a `%% UMLFLOW MANUAL BEGIN/END`
  block that is preserved verbatim on regeneration. Overrides (labels, aliases, exclusions, extra relationships,
  actor names, grouping, raw extra lines) live in the diagram definition.
* **Git hooks**: managed `# UMLFLOW BEGIN/END` section appended to existing hooks; idempotent install; modes
  `check` (default), `update`, `off`; honours `core.hooksPath`.

## 6. Phases

1. Architecture & scaffolding (this document, package, tsconfig, test harness).
2. Config schema, load/save, `init`.
3. Change detection (git + hashes) and cache store with corruption recovery.
4. Code Model + System Model types, provenance, precedence.
5. Parser abstraction: tree-sitter runtime, TypeScript/JavaScript, Python, Java, Go adapters; SQL + Prisma
   extractors; fallback adapter.
6. Semantic engine: deterministic classification heuristics, semantics store, question/answer protocol.
7. Diagram definitions, scope resolution and inference.
8. Diagram IR + Mermaid renderer.
9. Use Case, Sequence, ERD generators.
10. Incremental update pipeline, output files with protected sections, `update`, `check`, `status`.
11. Git hooks.
12. Claude Code skill + `install-skill` + `context` command.
13. `diff`, `rebuild-index`, CLI polish, error handling.
14. Tests + documentation completion.

Each phase ends with `npm test` green.

## 7. Progress checklist

Legend: `[x]` done · `[~]` in progress · `[ ]` pending

**Phase 1 — Architecture & scaffolding**
- [x] Plan and architecture decisions (this document)
- [x] Parser stack verified (`@vscode/tree-sitter-wasm` runtime + grammars)
- [x] package.json, tsconfig, vitest, `bin/umlflow.js`, dependencies installed

**Phase 2 — Config & init**
- [x] Config schema, defaults, validation (`src/config/schema.ts`)
- [x] Comment-preserving YAML load/save (`src/config/store.ts`)
- [x] `umlflow init` (interactive + flags) (`src/config/init.ts`, `src/cli/commands/init.ts`)

**Phase 3 — Change detection & local index**
- [x] Git wrapper: working-tree/staged/branch changes, renames, hooks dir (`src/change/git.ts`)
- [x] Hash-based change detector + file filter (`src/change/detector.ts`)
- [x] Cache store with corruption/version detection + separate sync baseline (`src/index/store.ts`)
- [x] Tests (`tests/unit/change.test.ts`, `tests/unit/index-config.test.ts`)

**Phase 4 — Code Model & System Model**
- [x] Language-independent Code Model (`src/codemodel/types.ts`)
- [x] Provenance model + precedence (`src/core/provenance.ts`)
- [x] System Model schema + index (`src/model/types.ts`)
- [x] Semantics store: user vs inferred, never overwrite user (`src/model/semantics.ts`)

**Phase 5 — Parser abstraction**
- [x] `LanguageAdapter` interface + registry + language detection
- [x] tree-sitter runtime + AST helpers
- [x] TypeScript / JavaScript, Python, Java, Go adapters
- [x] SQL DDL and Prisma extractors; fallback adapter (no fabricated facts)
- [x] Tests (`tests/unit/parsers.test.ts`)

**Phase 6 — Semantic engine**
- [x] Classification (annotations → deterministic, naming → inferred, ORM bases, gorm)
- [x] Receiver/type resolution (injection, params, imports, data clients, external packages, chained calls skipped)
- [x] Entity extractors: TypeORM/JPA, SQLAlchemy, Django, GORM (+ SQL/Prisma), cross-source entity merging
- [x] Model builder: components, operations, entry points, dependencies, interactions, data access, use cases, flows
- [x] Question protocol: `semantic questions` / `semantic answer` / `declare …`
- [x] Tests (`tests/unit/model.test.ts`)

**Phase 7 — Diagram definitions & scope**
- [x] Scope resolution (user > inferred), entry point lookup by id / "METHOD /path"
- [x] Scope inference from a query, persisted as UMLFlow-owned `inferredScope`

**Phase 8 — Rendering**
- [x] Diagram IR (`src/diagrams/ir.ts`)
- [x] `Renderer` interface + Mermaid renderer

**Phase 9 — Generators**
- [x] Use Case, Sequence, ERD generators
- [x] Overrides: labels, aliases, exclude, actors, groups, relationships, raw, style
- [x] Golden snapshots (`tests/unit/golden.test.ts`)

**Phase 10 — Incremental sync**
- [x] Per-diagram input files/ids + fingerprints (definition, relevant semantics, output)
- [x] Affected-diagram computation incl. per-type relevance of added files
- [x] Output files with generated block + protected manual sections
- [x] `generate`, `update`, `check`, `status`
- [x] Tests (`tests/integration/pipeline.test.ts`)

**Phase 11 — Git hooks**
- [x] `install-hooks` / `uninstall-hooks` (managed section, idempotent, `core.hooksPath`)
- [x] `umlflow hook <name>` with update / check / off modes
- [x] Tests (`tests/unit/hooks.test.ts`, `tests/integration/cli.test.ts`)

**Phase 12 — Claude Code skill**
- [x] `skill/SKILL.md`
- [x] `umlflow context`
- [x] `umlflow install-skill`
- [x] Tests (`tests/unit/skill.test.ts`)

**Phase 13 — Diff, recovery, polish**
- [x] `diff` (semantic model diff + affected diagrams)
- [x] `rebuild-index`
- [x] CLI wiring for all commands, `--json`, help text, error handling

**Phase 14 — Tests & docs**
- [x] Fixture repos (TS, Python, Java, Go, SQL, Prisma) + golden snapshots
- [x] Unit tests (change detection, index, config, model, semantics, diagrams, hooks, skill)
- [x] Integration tests on temp git repos (pipeline + CLI)
- [x] Documentation set (README + 13 docs)
