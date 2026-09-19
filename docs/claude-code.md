# Claude Code integration

UMLFlow ships a Claude Code skill (`skill/SKILL.md`). Install it per project or globally:

```bash
umlflow install-skill            # .claude/skills/umlflow/SKILL.md
umlflow install-skill --global   # ~/.claude/skills/umlflow/SKILL.md
```

Claude loads it when UML, diagrams, architecture, or a `.umlflow/` directory come up.

## What the skill teaches Claude

1. **What UMLFlow is** and that the code, not the diagrams, is the source of truth.
2. **State first**: run `umlflow context` before reading any source file. The summary contains the indexed
   files, model size, diagram list with freshness, entry points, and open semantic questions — a few hundred
   tokens for a whole repository.
3. **Delegate**: a request → command table (create/update/check/diff/hooks). Claude never scans the
   repository to "understand the architecture" itself.
4. **Task boundaries**: after architecture-relevant code changes, run `umlflow update` once at the end of
   the task and report what changed — not after every edit.
5. **Semantic questions**: the only place Claude interprets meaning. `umlflow semantic questions --json`
   lists what code cannot determine with compact context and `file:line` refs; Claude answers with
   `umlflow semantic answer --set id=value`. Answers are persisted as `semantic-inference` and never asked
   again. If unsure, ask the user or leave it open — never invent.
6. **Ownership**: never edit generated blocks; customise through `overrides`; never remove user
   declarations (`source: user`) or user `scope`; don't add diagram types the user did not choose.
7. **Honesty**: keep "from code" and "inferred" apart when summarising; `?`/`??` markers; unsupported
   languages are reported, not described from imagination.

## Example session

> **User:** Add OAuth login to the application.

Claude edits `AuthService`, adds `OAuthController` and `OAuthClient`, then at the end of the task:

```
$ umlflow update
Since last sync: 2 added, 1 modified; re-parsed 3 files of 18.
2 diagrams affected, 2 written.
Updated:
  ✓ system-usecases usecase (src/auth/oauth.controller.ts added)
  ✓ login-flow sequence (src/auth/auth.service.ts changed)
Not affected:
  - database-erd erd

Architecture changes since last sync:
  + controller OAuthController added
  + gateway OAuthClient added
  + AuthService now depends on OAuthClient
  + entry point OAuthController.callback [http GET /auth/oauth/callback] added

1 semantic question open: umlflow semantic questions
$ umlflow semantic questions --json
[{ "id": "actor:OAuthController", "question": "Which actor initiates the operations of OAuthController?",
   "context": ["GET /auth/oauth/callback → callback"], "options": ["Visitor", "Customer", "External system", …] }]
$ umlflow semantic answer --set actor:OAuthController=Visitor
$ umlflow update
```

and reports:

```
UMLFlow: 3 files changed, 2 diagrams affected.
Updated: system-usecases, login-flow
Unchanged: database-erd
Architecture changes: + OAuthController, + OAuthClient, + AuthService → OAuthClient
```

## Token budget

| Action | What Claude reads |
|---|---|
| Any diagram request | `umlflow context` (~300–800 tokens) |
| Create a diagram | the `generate` output (scope match summary + notes) |
| Answer a question | the question's `context` lines; at most the referenced `file:line` region |
| After a task | the `update` output |

Nothing in this flow requires reading unchanged files, and nothing is sent anywhere by UMLFlow itself.
