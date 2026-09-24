# Architecture

```
                         ┌───────────────────┐
                         │ Claude Code skill │  skill/SKILL.md — reads state first, delegates to the CLI
                         └─────────┬─────────┘
                                   ▼
                         ┌───────────────────┐
                         │    umlflow CLI    │  src/cli — every command is a thin wrapper over the engine
                         └─────────┬─────────┘
                                   ▼
                         ┌───────────────────┐
                         │  Umlflow engine   │  src/sync/pipeline.ts — one instance per project
                         └─────────┬─────────┘
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 Change detector             Index / cache              Diagram manager
 src/change                  src/index                  src/diagrams, src/sync
 git + content hashes        per-file Code Model,       definitions, scope, generators,
                             model, diagram state,      affected-diagram detection,
                             sync baseline              output files
        └──────────────────────────┼──────────────────────────┘
                                   ▼
                         ┌───────────────────┐
                         │ Language adapters │  src/parsers — tree-sitter (TS/JS, Python, Java, Go),
                         │  → Code Model     │  SQL DDL, Prisma, fallback (records, never fabricates)
                         └─────────┬─────────┘
                                   ▼
                         ┌───────────────────┐
                         │   System Model    │  src/model — classification, resolution, entities,
                         │  + semantics.yaml │  interactions, data access, use cases, flows, questions
                         └─────────┬─────────┘
                      ┌────────────┼────────────┐
                      ▼            ▼            ▼
                  Use Case      Sequence       ERD          src/diagrams/generators → Diagram IR
                      └────────────┼────────────┘
                                   ▼
                          Mermaid renderer                  src/render/mermaid (pluggable)
                                   ▼
                        .umlflow/diagrams/*.md              generated block + protected manual sections
                        umlflow/<type>/*.mmd                plain-Mermaid mirror (derived, no markers)
```

## Layers

| Layer | Directory | Responsibility |
|---|---|---|
| Core | `src/core` | Provenance/confidence primitives, hashing, fs helpers, errors, text utils. |
| Config | `src/config` | `.umlflow/config.yaml` schema, comment-preserving store, `init`. |
| Change detection | `src/change` | Git queries (changed/staged/renamed files, hooks dir) and content hashing. Hashes are authoritative; git attributes renames and is optional. |
| Index | `src/index` | Disposable cache: per-file Code Model keyed by hash, last built model, per-diagram state, sync baseline. |
| Code Model | `src/codemodel` | Language-independent facts per file: symbols, fields, params, annotations, calls, imports, routes, schema entities. Never source text. |
| Parsers | `src/parsers` | `LanguageAdapter` implementations. The only language-specific code in UMLFlow. |
| System Model | `src/model` | Builder turning Code Files + semantics into components, operations, entry points, dependencies, interactions, data access, entities, relations, actors, use cases, flows and open questions. |
| Diagrams | `src/diagrams` | Definitions, scope resolution/inference, Diagram IR, generators, overrides. |
| Render | `src/render` | `Renderer` interface and the Mermaid renderer. |
| Sync | `src/sync` | Engine orchestration: incremental index refresh, affected diagrams, output merging, update/check/diff. |
| Hooks | `src/hooks` | Managed git hook sections. |
| CLI | `src/cli` | Commands, output formatting, `context` summary. |

## Key invariants

1. **Source code wins.** The cache can be deleted at any time (`umlflow rebuild-index`); everything is
   reconstructed from the repository plus the committed project files.
2. **Facts have provenance.** `{ source: code | semantic-inference | user, confidence: deterministic |
   inferred | declared | unknown, refs }`. Precedence when facts disagree: user > code > inference > unknown.
3. **Parsing is incremental; model building is cheap.** Only changed files (and files importing
   added/removed files) are re-parsed; the System Model is rebuilt in memory from cached Code Files.
4. **Diagrams are regenerated only when affected.** Each diagram records its input files and model ids, a
   definition fingerprint and a fingerprint of the *relevant* semantic facts. The sync baseline (file hashes
   at the last `update`) is separate from the parse cache, so read-only commands never hide changes.
5. **No LLM inside the CLI.** Semantic interpretation is a question/answer protocol
   (`umlflow semantic questions` → `umlflow semantic answer`). Claude Code is the LLM; answers are persisted.
6. **Generated content is owned by UMLFlow; everything else is yours.** Regeneration replaces only the
   generated block and re-inserts the manual sections.

See [incremental-analysis.md](incremental-analysis.md) for the data flow in detail and
[plan.md](plan.md) for the decisions behind the structure.
