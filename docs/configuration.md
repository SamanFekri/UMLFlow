# Configuration — `.umlflow/config.yaml`

The file is user-owned. UMLFlow writes to it only when you run `generate` (adds/updates a diagram
definition) and only ever *replaces* the `inferredScope` field it owns. Comments and formatting are preserved.

```yaml
version: 1

analysis:
  include: []                 # path globs; empty = whole repository
  exclude:                    # in addition to node_modules, dist, build, vendor, .git, …
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/__tests__/**"
    - "**/test/**"
    - "**/tests/**"
    - "**/*.d.ts"
  languages: []               # restrict to language ids (typescript, javascript, python, java, go, sql, prisma)
  maxFileSize: 1000000        # bytes
  maxCallDepth: 6             # default depth when walking flows

output:
  dir: .umlflow/diagrams
  format: md                  # md = Markdown with a ```mermaid block; mmd = bare Mermaid file
  mermaidDir: umlflow         # extra plain-Mermaid mirror, grouped by type; null disables it

renderer: mermaid

git:
  hooks:
    pre-commit: check         # check | update | off  (also: pre-push, post-merge, post-checkout)

diagrams:
  system-usecases:
    type: usecase
    description: Actors and the capabilities the system exposes to them

  login-flow:
    type: sequence
    description: User login and authentication flow
    scope:                    # user scope — always wins over inferredScope
      include: [src/auth, src/users]
      exclude: [src/admin]
      entryPoints: ["POST /auth/login"]     # or AuthController.login
      components: []          # explicit component names
      entities: []            # ERD only
      depth: 4
    inferredScope:            # owned by UMLFlow (written by `generate --about`)
      query: login
      entryPoints: [AuthController.login]
      files: [src/auth/auth.controller.ts, …]   # informational
      components: [AuthController, AuthService, …]
      entities: [User]
      inferredAt: 2026-09-19T10:00:00.000Z
    overrides:
      labels: { AuthService: Authentication, __system__: Shop }   # __system__ renames the use case boundary
      aliases: { OrderRepo: OrderRepository }    # merge ids into one participant/entity
      exclude: [Logger, MetricsService]
      actors: { "OrderController.create": Customer }   # operation | use case id | component → actor
      relationships:                              # facts analysis cannot see
        - { from: order-controller-create, to: auth-controller-login, kind: include }   # usecase
        - { from: User, to: audit_log, kind: one-to-many, label: writes }              # erd
        - { from: PaymentService, to: stripe, label: "charge card" }                   # sequence
      groups: { Auth: [AuthController, AuthService] }    # sequence boxes / use case sub-boundaries
      raw: ["%% extra mermaid lines appended inside the diagram"]
      style: ["classDef ext fill:#eee"]
      instructions: "Treat Stripe as an external actor when interpreting this diagram."   # read by Claude
```

## Scope resolution

For each field, UMLFlow uses the user's `scope` value when present, otherwise the value from `inferredScope`,
otherwise "everything". Inferred `files`/`components` are informational: when entry points were inferred, the
diagram follows those flows wherever the code takes them (bounded by `depth`), so newly added services appear
automatically. `overrides.exclude` and `declare ignore` hide ids in any case.

## `.umlflow/semantics.yaml`

```yaml
version: 1
actors:
  Customer: { description: A shopper, source: user }
components:
  OrderController: { actor: Customer, source: user }
  Logger: { role: utility, ignore: true, source: user }
  AuthController: { actor: Visitor, source: semantic-inference }
operations:
  OrderController.create: { useCase: Place order, flow: Checkout, source: user }
  JobRunner.run: { useCase: Nightly settlement, source: semantic-inference }
entities:
  audit_log: { label: AuditLog, ignore: false, source: user }
```

`source: user` entries are declared by people (via `umlflow declare …` or by editing the file) and are never
overwritten by inference. `semantic-inference` entries were established once (typically by Claude answering
`umlflow semantic questions`) and are reused instead of being rediscovered. Precedence when facts disagree:
**user > code > semantic-inference > unknown** — an inferred role can never override a `@Controller` decorator,
but a user declaration can.

## `output.mermaidDir` — the plain-Mermaid mirror

Alongside the canonical diagram under `output.dir`, UMLFlow writes a bare Mermaid copy of every diagram,
grouped by diagram type:

```
umlflow/
├── usecase/system-usecases.mmd
├── sequence/main-flows.mmd
└── erd/database-erd.mmd
```

These files hold nothing but a short provenance comment and the diagram itself — no Markdown, no generated
or manual markers — so they can be fed straight to `mmdc`, embedded in another site, or read by a tool that
expects raw Mermaid.

The mirror is **derived output**: it is rewritten whenever the diagram it mirrors is written, restored if you
delete it, and removed when you run `umlflow remove <name>`. Edit the file under `output.dir` (or the
`overrides` in this config) — never the mirror, whose changes are overwritten on the next update.

Set `mermaidDir: null` to turn the mirror off. The path must be relative and inside the repository; a diagram
whose `type` changes leaves its old mirror behind, so delete that file yourself after a type change.
