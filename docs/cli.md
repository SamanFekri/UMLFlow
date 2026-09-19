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
| `umlflow install-skill [--global]` | Install the Claude Code skill. |

## `generate` options

```
-t, --type <usecase|sequence|erd>   diagram type
-n, --name <name>                   output name (.umlflow/diagrams/<name>.md)
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
