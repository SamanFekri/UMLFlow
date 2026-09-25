# Changelog

All notable changes to UMLFlow. This project follows [Semantic Versioning](https://semver.org).

## 1.2.0

Diagram names are now clean, and every use case gets its own sequence diagram.

`1.1.0` was never published; its changes are included here.

> **Upgrade note:** regenerate before your next CI run. Names lose their `?`/`??` suffixes, which makes every
> existing diagram stale, so `umlflow check` will exit 1 until you run `umlflow update --all` and commit.

### Changed

* **Names no longer carry uncertainty markers.** UMLFlow used to append `?` to an inferred label and `??`
  to an unknown one, producing `UserService?` and `Create Order ?`. A name with a marker is not a name: it
  breaks Mermaid `classDef` selectors, makes diffs noisy whenever confidence flips, and every downstream
  tool reads `UserService?` and `UserService` as two different entities.

  **On upgrade every existing diagram becomes stale**, so `umlflow check` (exit 1) will fail in CI until you
  regenerate. Run `umlflow update --all` and commit the result.

  The information is not lost — it moves to where it can be acted on: the diagram's analysis notes, the new
  `umlflow validate`, and the semantic question protocol. Set `output.uncertaintyMarkers: true` to restore
  the old behaviour.

* **`umlflow semantic questions` lists only required questions by default.** Optional refinements (flow
  naming, relation confirmation) are shown with `--all` or `--kind`, so "No open semantic questions" stays a
  meaningful all-clear.

* **A `umlflow/` directory is created in the repository by default**, mirroring every diagram as plain
  Mermaid. Set `output.mermaidDir: null` to disable it.

### Added

* **`umlflow scenarios`** — one sequence diagram per use case, each pinned to a single entry point via
  `scope.entryPoints`, so unrelated use cases can never be merged into one diagram. Idempotent: existing
  scenarios are matched by entry point, not by name, so diagrams can be renamed and the command re-run.
* **`umlflow coverage`** — what was analysed and what was not: files split into analysed / no-structure /
  unparsed, entry points by kind, use cases with and without a diagram, components in no diagram, and calls
  whose target operation could not be resolved.
* **`umlflow validate`** — checks generated diagrams against the System Model: `name-uncertainty-marker`
  (error), plus `unbacked-id`, `usecase-without-scenario`, `multi-scenario-diagram`, `duplicate-entity` and
  `unresolved-calls` (warnings). `--strict` also fails on warnings.
* **Richer semantic questions.** `flow-name` and `entity-relation` were declared but never asked. They are
  now emitted, and `flow-name` carries the reconstructed call chain as context so the business scenario can
  be named from evidence rather than from a method name.
* **`SemanticQuestion.priority`** (`required` | `optional`) separating holes in the model from refinements.
* **Plain-Mermaid mirror** — every diagram is also written to `umlflow/<type>/<name>.mmd` with no Markdown
  and no generated/manual markers. Derived output: rewritten with its diagram, restored if deleted, removed
  by `umlflow remove`.
* **Config:** `output.uncertaintyMarkers` (default `false`), `output.mermaidDir` (default `umlflow`).
* **Public API:** `planScenarios`, `uncoveredUseCases`, `buildCoverage`, `validateDiagrams`,
  `requiredQuestions`, `optionalQuestions` and their types.

### Fixed

* **`semantics.yaml` grew a duplicate header on every save.** `parseDocument` attaches a leading comment to
  the first map item's key rather than to the document, so the `!doc.commentBefore` guard always read "no
  header" and prepended another copy. Files accumulated one header per write. Existing files are left as
  they are; delete the extra copies by hand if you want them tidy.
* The CLI entry point no longer prints a stack trace when the build is missing, a target is unwritable, or
  stdout is closed early; each failure is one line and a non-zero exit code.
* `umlflow install-skill` honours `CLAUDE_CONFIG_DIR` and reports an unwritable target cleanly (exit 2).

## 1.0.0

First public release: language-agnostic code understanding and incremental UML (Mermaid) synchronization
for the CLI and for Claude Code.
