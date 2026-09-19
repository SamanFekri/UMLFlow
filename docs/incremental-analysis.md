# Incremental analysis, the System Model and the cache

## The pipeline

```
files on disk
   │  walk (respecting analysis.include/exclude + built-in ignores) and hash every analysable file
   ▼
ChangeSet vs parse cache  ─ added / modified / deleted / renamed (git attributes renames)
   │  parse only changed files (+ unchanged files that import added/removed files)
   ▼
Code Files (cache/index.json)  ─ facts per file, keyed by content hash; never source text
   │  build in memory (cheap, deterministic)
   ▼
System Model  ─ components, operations, entry points, dependencies, interactions,
   │            data access, entities, relations, actors, use cases, flows, questions
   ▼
ChangeSet vs sync baseline (cache/sync.json)  ─ what changed since the last update
   │  ∩ each diagram's recorded input files / model ids, definition hash, relevant-semantics hash
   ▼
Affected diagrams  ─ regenerated; written only when the generated block differs
```

Progressive context expansion in practice: changed files → their importers → the model built from cached
facts → the diagrams whose inputs intersect. No diagram or source file outside that set is touched.

## Change detection

* **Hashes are authoritative.** A file is "modified" only if its content hash differs from the index — editor
  saves, external tools, branch switches and commits are all caught; touching a file without changing it is not.
* **Git adds attribution.** Staged/unstaged renames are attributed (`renamed`, reusing the old Code Model when
  content is unchanged); without git, a deleted+added pair with identical content is still recognised as a move.
* Committed vs. uncommitted makes no difference to detection: everything is relative to what the index knows.

## Two snapshots, on purpose

| File | Meaning | Written by |
|---|---|---|
| `cache/index.json` | parse cache (Code Model per file + hash) | every command (read-only ones may refresh it) |
| `cache/sync.json` | file hashes at the last synchronisation | `update`, `generate`, `init` |
| `cache/diagrams.json` | per-diagram inputs and fingerprints | `update`, `generate` |
| `cache/model.json` | last synchronised System Model (baseline for `diff`) | `update`, `generate`, `rebuild-index` |

Because `check`/`status`/`diff` refresh the parse cache but never the baseline, running them before `update`
cannot hide changes from it.

## System Model

```ts
SystemModel {
  components[]   { id, name, kind, role, roleProvenance, file, ref, operations[], dependsOn[] }
  operations[]   { id: "OrderController.create", componentId, name, ref, entryPoint?: { kind, method, path, provenance } }
  interactions[] { from: operationId, fromComponent, toComponent, toOperation?, label, order, ref, provenance }
  dependencies[] { from, to, kind: injects|imports|calls|extends|implements|uses, provenance }
  entities[]     { id, name, table?, attributes[], origin, ref, provenance }
  relations[]    { from, to, kind: one-to-one|many-to-one|many-to-many, fromField?, provenance }
  dataAccess[]   { componentId, entityId, mode: read|write|read-write|unknown, operations[], provenance }
  actors[]       { id, name, description?, provenance }
  useCases[]     { id, name, nameProvenance, actorIds[], actorProvenance, operationIds[], componentId }
  flows[]        { id, name, entryOperation, entryComponent, actorId?, steps[{depth, from, to, label, …}], components[], entities[] }
  questions[]    { id, kind: actor|usecase-name|component-role|flow-name, subject, question, refs[], options?, context? }
  unparsed[]     { file, status: partial|failed|unsupported, message }
}
```

Roles: `controller`, `service`, `repository`, `gateway`, `handler`, `entity`, `model`, `module`, `utility`,
`unknown`. Deterministic when established by framework annotations (`@Controller`, `@Service`, `@Entity`,
`@RestController`, Django `models.Model`, …) or route registrations; inferred from naming conventions
(`*Service`, `*Repository`, `*Client`, …); otherwise unknown (and a question is raised if the component
participates in interactions).

## Confidence and provenance

Every fact carries `{ source, confidence, refs, reason }`:

| source | confidence | example |
|---|---|---|
| `code` | `deterministic` | `OrderService` calls `PaymentService.charge` via an injected `PaymentService` field |
| `semantic-inference` | `inferred` | `OrderController.create` is the "Create Order" use case; actor Visitor (answered by Claude) |
| `user` | `declared` | actor Customer for `OrderController` (`umlflow declare`) |
| `code` | `unknown` | which actor initiates `POST /orders` |

Precedence when merging: **user > code > inference > unknown**.

## Cache facts

* Disposable: delete `.umlflow/cache` or run `umlflow rebuild-index` any time. `rebuild-index` keeps the sync
  baseline and diagram state so the next `update` stays targeted.
* Corrupt or version-mismatched cache files are detected and rebuilt automatically, with a note in `status`.
* Never contains source text — only identifiers, annotation arguments, route strings and line numbers.
