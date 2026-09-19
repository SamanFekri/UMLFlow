---
name: umlflow
description: Use when the user asks for UML or architecture diagrams (use case, sequence, ERD), asks which diagrams a change affects, wants diagrams updated after code changes, or asks about the architecture of a project that has a .umlflow/ directory. Delegates all code analysis to the `umlflow` CLI and its cached System Model — never re-reads the whole repository.
---

# UMLFlow

UMLFlow keeps a compact, cached understanding of a codebase (the *System Model*) and
generates Mermaid diagrams from it. **The source code is the source of truth**; diagrams
in `.umlflow/diagrams/` are generated views. `.umlflow/config.yaml` (diagram definitions
and overrides) and `.umlflow/semantics.yaml` (established facts) are project files;
`.umlflow/cache/` is disposable.

## Always start from UMLFlow state, not from source files

1. Run `umlflow context` (add `--json` when you need to parse it). It tells you what is
   indexed, which diagrams exist, whether they are stale, the entry points, and the open
   semantic questions — in a few hundred tokens.
2. If it reports "not initialized", offer `umlflow init -y` (or `--types usecase,sequence,erd`).
3. Only read a source file when UMLFlow points you at it (`refs: file:line`) or when the
   user asks about code UMLFlow reports as unresolved/unsupported. Never scan the repository
   to "understand the architecture" yourself — that is what the System Model is for.

## Request → command

| The user says… | Do |
|---|---|
| "Create a sequence diagram for the checkout flow" | `umlflow generate --type sequence --name checkout-flow --about "checkout"` |
| "Create an ERD for the database" | `umlflow generate --type erd --name database-erd` |
| "Use case diagram for authentication" | `umlflow generate --type usecase --name auth-usecases --about "auth login"` |
| "Update the login diagram" / "sync diagrams" | `umlflow update [name]` |
| "What diagrams are affected by this change?" | `umlflow diff` |
| "Are the diagrams up to date?" (or in CI) | `umlflow check` (exit 1 = stale) |
| "Show me the architecture of the payment system" | `umlflow context`, then `umlflow generate --type sequence --name payment --about "payment" --no-write` to show it |
| "Keep diagrams in sync on commit" | `umlflow install-hooks --mode check` (or `update`) |

If `--about` matches nothing, UMLFlow says so: ask the user for a path or entry point and
use `--include`, `--entry "POST /orders"` or `--components`. Do not guess.

## After you change architecture-relevant code

Do not regenerate after every edit. When the task is done (or before committing), run
`umlflow update` once and report the result verbatim in this shape:

```
UMLFlow: 3 files changed, 2 diagrams affected.
Updated: authentication-usecase, login-sequence
Unchanged: database-erd
Architecture changes: + AuthService now depends on OAuthClient …
```

Architecture-relevant = new/removed components, endpoints, calls between components,
entities or relations. Pure refactors inside a function usually affect nothing; `update`
will say "not affected".

## Semantic questions (the only place you interpret meaning)

UMLFlow extracts structure deterministically. What it cannot know — which actor triggers a
controller, a business name for `handle()`, the role of an unnamed class — it lists:

```
umlflow semantic questions --json
```

For each question: use the `context` lines first; open only the listed `refs` if needed;
then answer with

```
umlflow semantic answer --set actor:OrderController=Customer --set usecase-name:JobRunner.run="Nightly settlement"
```

Answers are stored as `semantic-inference` and reused forever — UMLFlow will not ask again.
If you genuinely cannot tell, leave the question open or ask the user; **never invent an
actor, flow or relationship**. When the user states a fact ("the actor is Customer"), record
it with `umlflow declare …` (source `user`, highest precedence, never overwritten).

## Respect user ownership

- Never edit the generated block of a diagram file. Customise through
  `diagrams.<name>.overrides` in `.umlflow/config.yaml` (labels, aliases, exclude, actors,
  groups, relationships, raw, style) or the `UMLFLOW MANUAL` sections, which survive updates.
- `scope` in config beats UMLFlow's `inferredScope`; user declarations in `semantics.yaml`
  beat everything. Do not remove or rewrite them.
- If the user chose only some diagram types, do not add others unasked.

## Report facts honestly

Diagram labels ending in `?` are inferred (naming heuristics); `??` means unknown. UMLFlow
lists inferred/unknown counts in "Analysis notes". When you summarise architecture, keep the
distinction: "OrderService calls PaymentService (from code)" vs "probably the checkout use
case (inferred)". Unsupported languages are indexed but yield no structure — say so rather
than describing architecture you have not seen.

## Command reference

`init` · `generate|gen` · `update [names]` · `check` · `status` · `context` · `diff` ·
`diagrams` · `remove <name>` · `rebuild-index` · `semantic questions|answer|show` ·
`declare actor|role|usecase|flow|ignore` · `install-hooks` · `uninstall-hooks` · `install-skill`.
Every command accepts `--json`; `umlflow <cmd> --help` explains options.
