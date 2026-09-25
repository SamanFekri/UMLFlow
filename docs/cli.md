# CLI reference

Global options: `--json` (machine-readable output), `--cwd <dir>`, `-q/--quiet`, `-h`, `-V`.
Exit codes: `0` success · `1` stale diagrams (`check`) or diagram errors · `2` usage/config error.

| Command | Purpose |
|---|---|
| `umlflow init [-t types] [--hook-mode m] [-y] [--force] [--no-analyze]` | Create `.umlflow/`, choose diagram types, run the first analysis. |
| `umlflow generate` / `gen` | Define and generate a diagram. Interactive when no options. |
| `umlflow update [names…] [--all] [--force]` | Re-parse changed files, regenerate affected diagrams. |
| `umlflow check` | Report stale/missing diagrams without writing. Exit 1 when stale (CI). |
| `umlflow status` | Index health, pending changes, diagram freshness, questions. |
| `umlflow context` | Compact state summary (for Claude — read before source). |
| `umlflow diff` | Semantic architecture changes since the last sync + affected diagrams. |
| `umlflow diagrams` | List diagram definitions. |
| `umlflow remove <name>` | Delete a definition and its file. |
| `umlflow rebuild-index` | Discard the parse cache and rebuild from source. |
| `umlflow semantic questions [--diagram n] [--kind k]` | Open questions with compact context. |
| `umlflow semantic answer --set id=value… [--file f] [--as user\|inference]` | Record answers. |
| `umlflow semantic show` | Stored facts. |
| `umlflow declare actor <Name> [--for ids…]` | Declare an actor (source `user`). |
| `umlflow declare role <Component> <role>` | Declare a component role. |
| `umlflow declare usecase <Op> "<name>"` · `declare flow <Op> "<name>"` | Name a use case / flow. |
| `umlflow declare ignore <id> [--undo]` | Hide a component / operation / entity everywhere. |
| `umlflow install-hooks [--hooks list] [--mode m]` · `uninstall-hooks` | Manage git hooks. |
| `umlflow install-skill [--project]` | Install the `/umlflow` Claude Code skill (global by default). |

## `generate` options

```
-t, --type <usecase|sequence|erd>   diagram type
-n, --name <name>                   output name (.umlflow/diagrams/<name>.md + umlflow/<type>/<name>.mmd)
-a, --about <query>                 infer scope from a topic ("login", "checkout", "orders database")
-d, --description <text>
--include <globs…> --exclude <globs…>
--entry <ids…>                      AuthController.login | "POST /login" | login
--components <names…> --entities <names…> --depth <n>
--no-write                          print instead of writing
```

Re-running `generate` with an existing `--name` updates that definition (new flags are merged into it).

## `update` semantics

1. Detect changed files against the parse cache (content hashes; git attributes renames).
2. Parse only those files (plus unchanged files that import added/removed files).
3. Rebuild the System Model in memory from cached Code Files + `semantics.yaml`.
4. Compare the changes against the **sync baseline** (file hashes at the last `update`/`generate`) and each
   diagram's recorded inputs to find affected diagrams. Diagrams whose definition or relevant semantics changed
   are affected too.
5. Regenerate affected diagrams; write a file only when its generated block differs.
6. Report `Updated` / `Created` / `Unchanged` / `Not affected`, the architecture diff, and open questions.

`update <name>` forces one diagram; `--all` regenerates all (writing only changed files); `--force` rewrites all files.

## Output conventions

* Names ending in ` ?` are inferred; ` ??` are unknown. Solid arrows are deterministic, dotted are inferred.
* `--json` on every command returns the full structured result (outcomes, change sets, diff, questions).


## `umlflow scenarios`

One sequence diagram per use case. Each scenario is **pinned to a single entry point**
(`scope.entryPoints: [<operation>]`), so unrelated use cases can never be merged into one diagram and a
scenario cannot drift as the code grows.

```bash
umlflow scenarios              # define one diagram per use case, then build them
umlflow scenarios --dry-run    # show what would be created
umlflow scenarios --no-build   # define only; generate later with `umlflow update`
umlflow scenarios --depth 8    # deeper call chains for the generated scenarios
```

Idempotent: an existing scenario is recognised by the entry point it is scoped to, not by its name, so you
can rename a diagram and re-run this safely. New endpoints get a new scenario; nothing is duplicated.

For `ts-shop` this produces `login-sequence`, `create-order-sequence` and `get-order-sequence` — the login
diagram contains no payment components, and the get-order diagram contains four participants rather than
the whole system.

## `umlflow coverage`

What UMLFlow analysed, and what it could not.

```bash
umlflow coverage
umlflow coverage --json
```

Reports indexed files split into analysed / no-structure / unparsed, entry points by kind, use cases with
and without their own sequence diagram, components with an unknown role or in no diagram, and calls whose
target operation could not be resolved (their downstream path is invisible, so it is stated rather than
silently dropped).

## `umlflow validate`

Checks generated diagrams against the System Model.

```bash
umlflow validate            # exit 1 on errors
umlflow validate --strict   # exit 1 on warnings too
```

| Check | Level |
|---|---|
| `name-uncertainty-marker` — a name ends in `?`/`??` | error |
| `unbacked-id` — a drawn id is not in the model | warning |
| `usecase-without-scenario` — a use case has no sequence diagram | warning |
| `duplicate-entity` — two entities share a name | warning |
| `unresolved-calls` — calls whose target could not be resolved | warning |
