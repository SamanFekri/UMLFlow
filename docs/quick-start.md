# Quick start

```bash
umlflow init -y
```

```
Initialized UMLFlow.
  + .umlflow/config.yaml
  + .umlflow/semantics.yaml
  + .umlflow/.gitignore

First synchronisation (missing): parsed 17 files.
Created:
  + system-usecases usecase (forced)
      ? 3 use case(s) have no known actor. Declare one with `umlflow declare actor <Name> --for <Component>` …
  + main-flows sequence (forced)
  + database-erd erd (forced)

2 semantic question(s) need an answer: umlflow semantic questions
```

## Add a focused diagram

```bash
umlflow generate --type sequence --name login-flow --about "login"
```

UMLFlow matches "login" against entry points, components, paths and files, follows the flows from the
matched entry points, and stores the result as `inferredScope` in `config.yaml`. Later changes to
`AuthService` update `login-flow`; changes to `ReportingService` do not.

## Answer what code cannot tell

```bash
umlflow semantic questions
```

```
actor:OrderController  actor
  Which actor initiates the operations of OrderController?
  context: POST /orders → create; GET /orders/:id → get
  options: User, Administrator, External system, Internal service
  source: src/orders/order.controller.ts:6
```

```bash
umlflow declare actor Customer --for OrderController          # you know → source: user
umlflow semantic answer --set actor:AuthController=Visitor     # Claude's interpretation → source: semantic-inference
umlflow update
```

## Keep in sync

```bash
umlflow diff       # what changed architecturally, which diagrams are affected
umlflow update     # regenerate affected diagrams only
umlflow check      # CI: exit 1 when stale
umlflow install-hooks
```

## Customise without touching Mermaid

```yaml
diagrams:
  login-flow:
    type: sequence
    description: User login
    scope:
      entryPoints: ["POST /auth/login"]
      depth: 4
    overrides:
      labels: { SessionManager: Sessions }
      exclude: [Logger]
      groups: { Auth: [AuthController, AuthService] }
```

See [diagrams.md](diagrams.md) for every override.
