---
name: umlflow
description: "Use when the user types /umlflow, or asks for UML/architecture diagrams (use case, sequence, ERD), asks which diagrams a code change affects, wants diagrams updated after changes, or asks about the architecture of a project that has a .umlflow/ directory. Delegates all code analysis to the `umlflow` CLI and its cached System Model — never re-reads the whole repository."
---

# /umlflow

Language-agnostic code understanding and incremental UML sync. UMLFlow parses the repository once
(tree-sitter), keeps a compact cached *System Model*, generates Mermaid diagrams from it, and updates only
the diagrams a change affects. **The source code is the source of truth**; diagrams are generated views.

## Usage

```
/umlflow                                   # first run: init + build all diagrams; later: status of diagrams and open questions
/umlflow init [usecase,sequence,erd]       # initialize .umlflow/ in this repo (default: all three types)
/umlflow sequence "<topic>"                # sequence diagram scoped to a topic, e.g. "checkout", "login"
/umlflow usecase ["<topic>"]               # use case diagram (whole system, or scoped)
/umlflow erd ["<topic>"]                   # entity-relationship diagram from SQL/Prisma/ORM models
/umlflow scenarios                         # one sequence diagram per use case (each pinned to a single entry point)
/umlflow coverage                          # what was analysed and what could not be understood
/umlflow validate                          # check diagrams against the model (clean names, evidence-backed participants)
/umlflow update [name]                     # bring affected diagrams up to date (only changed files are re-parsed)
/umlflow check                             # are diagrams stale? (no writes; same check CI uses)
/umlflow diff                              # architecture changes since last sync + affected diagrams
/umlflow status                            # index, diagrams, freshness, open semantic questions
/umlflow questions                         # list what UMLFlow could not determine from code, then answer them
/umlflow hooks [check|update|off]          # install the git pre-commit hook in that mode (default check)
/umlflow remove <name>                     # delete a diagram definition and file
/umlflow "<anything in plain language>"    # e.g. "show me the payment architecture", "what does this change affect?"
/umlflow --help                            # print this usage block
```

If the user invoked `/umlflow --help` or `/umlflow -h`, print the Usage block above verbatim and stop.

## Step 1 — Ensure the CLI is installed

```bash
if ! command -v umlflow >/dev/null 2>&1; then
  npm install -g umlflow -q 2>&1 | tail -2 || true
fi
command -v umlflow >/dev/null 2>&1 && umlflow --version
```

If `umlflow` is still not found, stop and tell the user: *"Install UMLFlow first: `npm install -g umlflow`,
or from a checkout: `./install.sh` in the UMLFlow repository."* Do not try to reimplement the analysis.

## Step 2 — Ensure the project is initialized

```bash
[ -f .umlflow/config.yaml ] && echo initialized || echo "not initialized"
```

Not initialized → `umlflow init -y` (or `umlflow init --types <list>` when the user named types). This builds
the index and the first diagrams. If the user did not ask for `init` explicitly, tell them it happened.

## Step 3 — Read the state, never the repository

```bash
umlflow context
```

This returns, in a few hundred tokens: indexed files, model size, every diagram with its freshness, the entry
points, and the open semantic questions with `file:line` refs. Everything you need to answer or act is here.
Do **not** grep or read source files to "understand the architecture" — that is what the System Model is for.
Only open a file when a question's `refs` point at it and its `context` lines are not enough.

## Step 4 — Dispatch

| Invocation | Run |
|---|---|
| `/umlflow` (initialized) | `umlflow update` then `umlflow context`; report diagrams + questions |
| `/umlflow sequence "<topic>"` | `umlflow generate --type sequence --name <slug>-flow --about "<topic>"` |
| "a diagram per use case / per scenario / for each flow" | `umlflow scenarios` — never hand-build these |
| `/umlflow usecase ["<topic>"]` | `umlflow generate --type usecase --name <slug>-usecases [--about "<topic>"]` |
| `/umlflow erd ["<topic>"]` | `umlflow generate --type erd --name <slug>-erd [--about "<topic>"]` |
| `/umlflow scenarios` | `umlflow scenarios` — defines and builds one diagram per use case |
| `/umlflow coverage` | `umlflow coverage` |
| `/umlflow validate` | `umlflow validate` (exit 1 = a name or participant is wrong) |
| `/umlflow update [name]` | `umlflow update [name]` |
| `/umlflow check` | `umlflow check` (exit 1 = stale) |
| `/umlflow diff` | `umlflow diff` |
| `/umlflow status` | `umlflow status` |
| `/umlflow questions` | `umlflow semantic questions --json`, then Step 5 |
| `/umlflow hooks [mode]` | `umlflow install-hooks --mode <mode>` |
| `/umlflow remove <name>` | `umlflow remove <name>` |
| plain language | map to the closest command; "show me the X architecture" → `umlflow generate --type sequence --name x --about "X" --no-write` and show it; "what does this change affect" → `umlflow diff` |

`<slug>` is the topic in kebab-case (`"checkout orders"` → `checkout-orders`). If `generate` reports that
nothing matched the topic, ask the user for a path or entry point and rerun with `--include <dir>`,
`--entry "POST /orders"` or `--components <Name>`. Never guess a scope.

## Step 5 — Answer semantic questions (the only interpretation you do)

Structure is extracted deterministically. What code cannot say — which actor triggers a controller, a
business name for `handle()`, the role of an unannotated class — UMLFlow lists as questions:

```bash
umlflow semantic questions --json          # required: holes in the model (unknown actor, role, name)
umlflow semantic questions --all --json    # + optional refinements you are uniquely good at
```

Required questions block a complete diagram. **Optional** ones are where your judgement adds the most:
`flow-name` carries the whole call chain (`OrderController → OrderService.createOrder → PaymentService.charge …`)
so you can name the *business scenario* — "Checkout and payment capture", not "Create Order". `entity-relation`
asks you to confirm an inferred foreign key. Answer them from the `context` alone; that is why it is there.

For each: use its `context` lines and `options`; open only the listed `refs` if needed; then

```bash
umlflow semantic answer --set actor:OrderController=Customer --set usecase-name:JobRunner.run="Nightly settlement"
umlflow update
```

Answers are stored as `semantic-inference` and reused forever. If you genuinely cannot tell, leave the question
open and ask the user — **never invent** an actor, flow or relationship. When the *user* states a fact, record it
with `umlflow declare actor|role|usecase|flow|ignore …` (source `user`, never overwritten).

## After you changed code in a task

Do not regenerate after every edit. When the task is done (or before committing) run `umlflow update` once
and report verbatim:

```
UMLFlow: 3 files changed, 2 diagrams affected.
Updated: authentication-usecase, login-sequence
Unchanged: database-erd
Architecture changes: + AuthService now depends on OAuthClient …
```

## Rules

- **One scenario per use case.** Never merge unrelated use cases into one sequence diagram, and never
  hand-write a diagram: run `umlflow scenarios`, which pins each diagram to a single entry point.
- **Names are never marked.** A name must never end in `?` or `??` — `UserService?` is not a name.
  Uncertainty belongs in the analysis notes, which UMLFlow writes for you. Run `umlflow validate` after
  generating; it exits 1 if a name or participant is wrong.
- **Report coverage honestly.** `umlflow coverage` lists files that produced no structure and use cases
  with no diagram. Say what was not understood instead of describing architecture you have not seen.
- Never edit the generated block of a diagram file. Customise via `diagrams.<name>.overrides` in
  `.umlflow/config.yaml` (labels, aliases, exclude, actors, groups, relationships, raw, style) or the
  `UMLFLOW MANUAL` sections, which survive updates.
- User `scope` beats UMLFlow's `inferredScope`; `source: user` facts in `semantics.yaml` beat everything.
  Do not remove or rewrite them. Do not add diagram types the user did not ask for.
- Labels ending in `?` are inferred, `??` unknown. Keep "from code" and "inferred" apart when you summarise.
  Unsupported languages are indexed but yield no structure — say so instead of describing architecture you
  have not seen.
- Output lives in `.umlflow/diagrams/<name>.md` (Markdown + Mermaid), mirrored as bare Mermaid in
  `umlflow/<type>/<name>.mmd` (`type` = usecase|sequence|erd). The mirror is derived and overwritten on every
  update — never edit it, and never write a diagram there yourself; change the canonical file or `overrides`.
  Point the user at the file; do not paste the whole diagram unless asked or when using `--no-write`.

## Command reference

`umlflow init|generate|update|check|status|context|diff|diagrams|remove|rebuild-index` ·
`umlflow semantic questions|answer|show` · `umlflow declare actor|role|usecase|flow|ignore` ·
`umlflow install-hooks|uninstall-hooks|install-skill`. All accept `--json`; `umlflow <cmd> --help` lists options.
