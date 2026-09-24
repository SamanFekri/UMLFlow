# UMLFlow

[![npm](https://img.shields.io/npm/v/umlflow.svg)](https://www.npmjs.com/package/umlflow)
[![node](https://img.shields.io/node/v/umlflow.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/umlflow.svg)](LICENSE)

**Language-agnostic code understanding and incremental UML synchronization — for the CLI and for Claude Code.**

UMLFlow analyses a repository once, builds a compact *System Model* of its structure and behaviour, generates
Mermaid diagrams (Use Case, Sequence, ERD) from that model, and then keeps them in sync incrementally as the
code evolves — re-reading only what changed, regenerating only the diagrams that are affected, and asking an
LLM only when a question genuinely needs semantic interpretation.

> UMLFlow does not treat generated diagrams as the source of truth. **The source code is the source of truth.**
> The System Model is a cache of what the code says; diagrams are views of that model.

```
SOURCE CODE ─► change detection (git + hashes) ─► affected scope ─► parsers (tree-sitter)
           ─► System Model (components, calls, entities, flows, provenance)
           ─► Use Case / Sequence / ERD ─► Mermaid ─► .umlflow/diagrams/*.md + umlflow/<type>/*.mmd
```

## Quick start

Requirements: **Node.js ≥ 20**. No native build step — parsers are WebAssembly grammars bundled with
`@vscode/tree-sitter-wasm`, so the same package works on macOS, Linux and Windows.

### 1. Install the `/umlflow` Claude Code skill (one command)

```bash
npx umlflow install-skill
```

This copies the bundled skill to `~/.claude/skills/umlflow/SKILL.md` (`%USERPROFILE%\.claude\skills\umlflow\SKILL.md`
on Windows, or `$CLAUDE_CONFIG_DIR/skills/umlflow/SKILL.md` if you relocate Claude Code's config directory).
It is idempotent — run it again after upgrading to refresh the skill:

```
✓ skill installed: /Users/you/.claude/skills/umlflow/SKILL.md
```

Prefer a per-repository skill instead of a user-wide one?

```bash
npx umlflow install-skill --project     # → ./.claude/skills/umlflow/SKILL.md
```

### 2. Use it in Claude Code

Open Claude Code in any project and type:

```
/umlflow                          # initialize .umlflow/ and build Use Case + Sequence + ERD diagrams
/umlflow sequence "checkout"      # a sequence diagram scoped to a topic
/umlflow erd                      # the database ERD
/umlflow questions                # answer what code cannot tell (actors, business names) — stored forever
/umlflow diff                     # what changed architecturally, which diagrams are affected
/umlflow update                   # regenerate only affected diagrams
/umlflow hooks check              # pre-commit hook: fail when diagrams are stale
/umlflow "show me the payment architecture"
/umlflow --help
```

The skill makes Claude read UMLFlow's cached state first (`umlflow context`), delegate analysis to the CLI,
interpret only the open semantic questions with targeted context, respect your overrides, and report
inferred vs. deterministic facts honestly. Diagrams land in `.umlflow/diagrams/<name>.md` (Markdown +
Mermaid, so GitHub renders them), and a bare-Mermaid copy of each is mirrored to `umlflow/<type>/<name>.mmd`
for tools that want the diagram without the Markdown. The skill installs the CLI on demand the first time it runs.

### 3. Or use it straight from the terminal

Every command works through `npx` with nothing installed globally:

```bash
npx umlflow init -y                                               # create .umlflow/ and build all diagrams
npx umlflow generate --type sequence --name checkout --about "checkout"
npx umlflow semantic questions                                    # what the code alone cannot tell
npx umlflow declare actor Customer --for OrderController
npx umlflow update && npx umlflow check                           # sync, then verify nothing is stale
npx umlflow install-hooks --mode update                           # pre-commit: auto-update diagrams
npx umlflow --help
```

## Installation options

| Goal | Command |
|---|---|
| Try it / one-off | `npx umlflow <command>` |
| Global CLI (`umlflow` on your PATH) | `npm install -g umlflow` |
| Per project (teams & CI — hooks find `./node_modules/.bin/umlflow`) | `npm install --save-dev umlflow` |
| Claude Code skill, user-wide | `npx umlflow install-skill` |
| Claude Code skill, this repo only | `npx umlflow install-skill --project` |
| From a git checkout | `./install.sh` (builds, installs the CLI globally and the skill) |

### Uninstall

```bash
umlflow uninstall-hooks                     # remove the managed git-hook sections
rm -rf .umlflow ~/.claude/skills/umlflow    # project state and the skill
npm uninstall -g umlflow                    # the CLI, if installed globally
```

## Why

* **Token-efficient by design.** Claude never has to re-read a repository to draw or update a diagram:
  `umlflow context` summarises what is already known in a few hundred tokens, and only open *semantic
  questions* ("which actor calls `OrderController`?") need interpretation.
* **Incremental.** Content hashes + git detect what changed; a dependency-aware pipeline finds affected
  symbols and diagrams; unrelated diagrams are never touched.
* **Honest.** Every fact carries provenance: deterministic (from code), inferred (heuristics) or declared
  (by you). Uncertain facts are marked, never presented as truth. User declarations are never overwritten.
* **Language-agnostic.** Parsers sit at the edge (TypeScript/JavaScript, Python, Java, Go, SQL DDL, Prisma
  today); the model, generators and renderer never see a language-specific AST.
* **Safe.** Generated blocks are replaced in place; manual sections and everything else you write survive.
  Git hooks are installed as clearly marked managed sections next to your existing hook logic.

## What it produces

Every diagram below was generated by UMLFlow from the sample NestJS/TypeORM project in
[`tests/fixtures/repos/ts-shop`](https://github.com/SamanFekri/UMLFlow/blob/main/tests/fixtures/repos/ts-shop) — the complete output (including the
`config.yaml` and `semantics.yaml` that drove it) is in [`examples/ts-shop/`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/).
Labels ending in `?` are inferred from naming; everything else is read from the code or declared.

### Use case — `/umlflow usecase`

[`examples/ts-shop/system-usecases.md`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/system-usecases.md)

```mermaid
flowchart LR
  actor_customer(["👤 Customer"])
  actor_visitor(["👤 Visitor"])
  subgraph system ["System"]
    direction TB
    uc_auth_controller_login(["Login ?"])
    uc_order_controller_create(["Place order"])
    uc_order_controller_get(["Get Order ?"])
  end
  actor_visitor --> uc_auth_controller_login
  actor_customer --> uc_order_controller_create
  actor_customer --> uc_order_controller_get
```

### Sequence, scoped by topic — `/umlflow sequence "orders"`

[`examples/ts-shop/checkout-flow.md`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/checkout-flow.md) — scope was inferred from the word
"orders"; `Logger` is hidden via `umlflow declare ignore Logger`.

```mermaid
sequenceDiagram
  title Checkout Flow
  autonumber
  actor actor_customer as Customer
  participant order_controller as OrderController
  participant order_service as OrderService
  participant inventory_service as InventoryService
  participant inventory_repository as InventoryRepository
  participant payment_service as PaymentService
  participant payment_gateway as PaymentGateway
  participant order_repository as OrderRepository
  participant db_order as 🗄 Order
  rect rgb(245, 245, 245)
    Note over actor_customer: Flow: Place order
    actor_customer->>order_controller: POST /orders
    order_controller->>order_service: createOrder
    order_service->>inventory_service: reserve
    inventory_service->>inventory_repository: decrement
    order_service->>payment_service: charge
    payment_service->>payment_gateway: authorize
    payment_service->>payment_gateway: capture
    order_service->>order_repository: save
    order_repository->>db_order: write Order
    order_service-->>order_controller: result
    order_controller-->>actor_customer: response
  end
  rect rgb(245, 245, 245)
    Note over actor_customer: Flow: Get Order ?
    actor_customer->>order_controller: GET /orders/:id
    order_controller->>order_service: findOrder
    order_service->>order_repository: findById
    order_repository->>db_order: read Order
    order_service-->>order_controller: result
    order_controller-->>actor_customer: response
  end
```

### Sequence, scoped by topic — `/umlflow sequence "login"`

[`examples/ts-shop/login-flow.md`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/login-flow.md)

```mermaid
sequenceDiagram
  title Login Flow
  autonumber
  actor actor_visitor as Visitor
  participant auth_controller as AuthController
  participant auth_service as AuthService
  participant user_repository as UserRepository
  participant db_user as 🗄 User
  participant session_manager as SessionManager
  rect rgb(245, 245, 245)
    Note over actor_visitor: Login ?
    actor_visitor->>auth_controller: POST /auth/login
    auth_controller->>auth_service: login
    auth_service->>user_repository: findByEmail
    user_repository->>db_user: read User
    auth_service->>session_manager: create
    auth_service-->>auth_controller: result
    auth_controller-->>actor_visitor: response
  end
```

### ERD — `/umlflow erd`

[`examples/ts-shop/database-erd.md`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/database-erd.md) — SQL migration tables and
`@Entity` classes describing the same tables are merged into one entity each.

```mermaid
erDiagram
  audit_log {
    BIGSERIAL id PK
    UUID actor_id FK "→ users.id"
    TEXT message
  }
  Order {
    UUID id PK
    UUID customer_id FK "→ users.id"
    NUMERIC(10,2) total "not null"
    VARCHAR(32) status
  }
  OrderItem {
    SERIAL id PK
    UUID order_id FK "→ orders.id"
    VARCHAR(64) sku "not null"
    INT quantity "not null"
  }
  User {
    UUID id PK
    VARCHAR(255) email UK "not null"
    TIMESTAMP_WITH_TIME_ZONE created_at
  }
  audit_log }o--|| User : "actor_id"
  Order }o--|| User : "customer_id"
  OrderItem }o--|| Order : "order_id"
```

The whole-system sequence diagram (every entry point) is in
[`examples/ts-shop/main-flows.md`](https://github.com/SamanFekri/UMLFlow/blob/main/examples/ts-shop/main-flows.md).

## Documentation

* [Architecture](https://github.com/SamanFekri/UMLFlow/blob/main/docs/architecture.md) · [Installation](https://github.com/SamanFekri/UMLFlow/blob/main/docs/installation.md) · [Quick start](https://github.com/SamanFekri/UMLFlow/blob/main/docs/quick-start.md)
* [CLI](https://github.com/SamanFekri/UMLFlow/blob/main/docs/cli.md) · [Configuration](https://github.com/SamanFekri/UMLFlow/blob/main/docs/configuration.md) · [Diagrams, definitions & overrides](https://github.com/SamanFekri/UMLFlow/blob/main/docs/diagrams.md)
* [Incremental analysis, System Model & cache](https://github.com/SamanFekri/UMLFlow/blob/main/docs/incremental-analysis.md)
* [Claude Code integration](https://github.com/SamanFekri/UMLFlow/blob/main/docs/claude-code.md) · [Git hooks & CI](https://github.com/SamanFekri/UMLFlow/blob/main/docs/git-hooks-and-ci.md)
* [Supported analysis](https://github.com/SamanFekri/UMLFlow/blob/main/docs/supported-analysis.md) · [Extending (adapters, generators, renderers)](https://github.com/SamanFekri/UMLFlow/blob/main/docs/extending.md)
* [Troubleshooting](https://github.com/SamanFekri/UMLFlow/blob/main/docs/troubleshooting.md) · [Examples](https://github.com/SamanFekri/UMLFlow/blob/main/docs/examples.md) · [Implementation plan](https://github.com/SamanFekri/UMLFlow/blob/main/docs/plan.md)

## Development

```bash
git clone https://github.com/SamanFekri/UMLFlow.git && cd UMLFlow
npm install
npm test            # builds, then runs unit + integration tests (fixture repos, golden snapshots)
npm run build
npm run pack:check  # inspect exactly what a release tarball would contain
```

Releases: bump `version` in `package.json`, then `npm publish` — `prepublishOnly` cleans, rebuilds, runs the
full test suite and prints the tarball contents before anything is uploaded.

MIT licensed.
