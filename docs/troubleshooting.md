# Troubleshooting

**"UMLFlow is not initialized"** — run `umlflow init` in the repository root (UMLFlow searches upwards for
`.umlflow/config.yaml`).

**Diagrams are empty / "No entry points found in scope"** — check `umlflow status`: are the files indexed
(`analysis.include/exclude`, unsupported language)? Are routes declared in a way UMLFlow understands
(see [supported-analysis.md](supported-analysis.md))? Widen the scope or add `scope.entryPoints`.

**`generate --about` matched nothing** — the keywords did not match any entry point, component, file path or
entity. Use `--include src/feature`, `--entry "POST /orders"` or `--components OrderService`.

**A call is missing from a sequence diagram** — it may be untyped (declare the field's type or add
`overrides.relationships`), chained (`a.b().c()`), dynamic, or the callee is out of scope / excluded /
`model`/`utility` role. `umlflow status --json` exposes the model; `Analysis notes` in the diagram list
unresolved calls.

**Actors show as "Unknown actor"** — expected until declared: `umlflow declare actor Customer --for
OrderController` or answer `umlflow semantic questions`.

**`check` fails in CI but passes locally** — commit `.umlflow/diagrams/*.md` and `config.yaml`/`semantics.yaml`;
make sure CI installs the same `umlflow` version (adapter versions are part of the cache key and generation
is deterministic per version).

**Cache problems** — `umlflow rebuild-index`. Corrupt or incompatible cache files are detected and rebuilt
automatically; the cache never holds anything that cannot be recomputed.

**Hook not running** — `umlflow install-hooks` prints the file; check `git config core.hooksPath` and that
the file is executable. The hook is silent when the CLI cannot be found (it prints a warning) and when the
mode is `off`.

**Hook blocks a commit** — `umlflow update && git add .umlflow/diagrams`, or switch to `--mode update`.

**Parser failed / partial** — `status --json` lists `unparsed` files with the reason. Syntax the grammar
cannot handle yields `partial` (facts before the error are kept). Nothing is fabricated for failed files.

**Large repositories** — first indexing parses every supported file once (WASM tree-sitter, ~ms per file);
afterwards only changed files are parsed. Narrow `analysis.include` or raise `maxFileSize` if needed.
