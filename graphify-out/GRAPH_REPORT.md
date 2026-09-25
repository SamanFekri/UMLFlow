# Graph Report - UMLFlow  (2026-09-25)

## Corpus Check
- 144 files · ~69,944 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1168 nodes · 2858 edges · 66 communities (60 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d3166921`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- python.ts
- mermaid/index.ts
- OrderController
- generator.ts
- build.ts
- Order
- ModelBuilder
- ir.ts
- compilerOptions
- diagrams/index.ts
- classify.ts
- services.py
- src/index.ts
- OverrideHelper
- provenance.ts
- cli/index.ts
- typescript.ts
- 1.2.0
- fs.ts
- extract.ts
- sequence.ts
- auth.service.ts
- Supported Languages and Extracted Facts
- Order
- UMLFlow
- package.json
- CodeFile
- wiring.ts
- schema.ts
- .umlflow/config.yaml
- Git
- /umlflow Claude Code Skill
- update Semantics (six-step pipeline)
- keywords
- config/store.ts
- order.service.ts
- semantics.ts
- dependencies
- Technology Decisions
- OrderService
- scripts
- InventoryService
- PaymentGateway
- index/store.ts
- Semantic Question/Answer Protocol
- OrderHandler
- OrderController
- helpers.ts
- devDependencies
- Troubleshooting Guide
- files
- User
- umlflow.js
- exports
- repository
- ts-shop/package.json
- main-flows Diagram Definition
- install.sh
- acme/shop
- hooks.ts
- Affected-Diagram Computation
- scope.ts
- index-config.test.ts
- event-app/package.json

## God Nodes (most connected - your core abstractions)
1. `CodeFile` - 46 edges
2. `Umlflow` - 41 edges
3. `ModelBuilder` - 35 edges
4. `field()` - 28 edges
5. `namedChildren()` - 25 edges
6. `LanguageAdapter` - 22 edges
7. `DiagramDefinition` - 21 edges
8. `SystemModel` - 21 edges
9. `Git` - 21 edges
10. `Order` - 21 edges

## Surprising Connections (you probably didn't know these)
- `System Model (src/model)` --semantically_similar_to--> `System Model (cache of what the code says)`  [INFERRED] [semantically similar]
  docs/architecture.md → README.md
- `Progressive Context Expansion` --semantically_similar_to--> `Token-Efficient by Design`  [INFERRED] [semantically similar]
  docs/incremental-analysis.md → README.md
- `Managed UMLFLOW Hook Section` --semantically_similar_to--> `Safe In-Place Regeneration of Generated Blocks`  [INFERRED] [semantically similar]
  docs/git-hooks-and-ci.md → README.md
- `Run update Once at Task End` --semantically_similar_to--> `Task Boundaries for Regeneration`  [INFERRED] [semantically similar]
  skill/SKILL.md → docs/claude-code.md
- `registerSemantic()` --references--> `umlflow`  [EXTRACTED]
  src/cli/commands/semantic.ts → package.json

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Provenance and Uncertainty System** — docs_architecture_provenance, docs_configuration_precedence, docs_supported_analysis_deterministic_vs_inferred, docs_diagrams_uncertainty_markers, docs_incremental_analysis_component_roles, readme_honest_provenance [INFERRED 0.85]
- **UMLFlow Extension Points** — docs_extending_language_adapter, docs_extending_entity_extractor, docs_extending_diagram_generator, docs_extending_renderer [EXTRACTED 1.00]
- **Semantic Question/Answer Flow** — skill_skill_semantic_questions, docs_plan_question_answer_protocol, docs_architecture_no_llm_in_cli, docs_configuration_semantics_yaml, docs_claude_code_integration, skill_skill_declare [EXTRACTED 1.00]
- **Login flow participants** — examples_ts_shop_login_flow_visitor, examples_ts_shop_login_flow_authcontroller, examples_ts_shop_login_flow_authservice, examples_ts_shop_login_flow_userrepository, examples_ts_shop_login_flow_sessionmanager, examples_ts_shop_login_flow_db_user [EXTRACTED 1.00]
- **Place order flow participants** — examples_ts_shop_checkout_flow_customer, examples_ts_shop_checkout_flow_ordercontroller, examples_ts_shop_checkout_flow_orderservice, examples_ts_shop_checkout_flow_inventoryservice, examples_ts_shop_checkout_flow_inventoryrepository, examples_ts_shop_checkout_flow_paymentservice, examples_ts_shop_checkout_flow_paymentgateway, examples_ts_shop_checkout_flow_orderrepository, examples_ts_shop_checkout_flow_db_order [EXTRACTED 1.00]
- **User-rooted relational data model** — examples_ts_shop_database_erd_user, examples_ts_shop_database_erd_order, examples_ts_shop_database_erd_orderitem, examples_ts_shop_database_erd_audit_log [EXTRACTED 1.00]

## Communities (66 total, 6 thin omitted)

### Community 0 - "python.ts"
Cohesion: 0.07
Nodes (80): node, CodeImport, CodeSymbol, emptyCodeFile(), Field, Param, ParseStatus, RelationDecl (+72 more)

### Community 1 - "mermaid/index.ts"
Cohesion: 0.20
Nodes (16): Diagram, CARDINALITY, componentShape(), confidenceMark(), erdName(), erdType(), esc(), firstParticipant() (+8 more)

### Community 2 - "OrderController"
Cohesion: 0.05
Nodes (45): Customer, Order Datastore (checkout flow), Checkout Flow Sequence Diagram, InventoryRepository, InventoryService, OrderController, OrderRepository, OrderService (+37 more)

### Community 3 - "generator.ts"
Cohesion: 0.20
Nodes (7): DiagramGenerator, GenerateContext, GenerateResult, ErdGenerator, UseCaseGenerator, ResolvedScope, SemanticsData

### Community 4 - "build.ts"
Cohesion: 0.12
Nodes (21): RelationKind, SourceRef, sortBy(), CRUD_VERBS, HTTP_VERB_NAMES, Resolution, singularize(), useCaseNameFor() (+13 more)

### Community 5 - "Order"
Cohesion: 0.08
Nodes (17): GetMapping, JpaRepository, PostMapping, RequestMapping, RestController, Service, CreateOrderRequest, Customer (+9 more)

### Community 6 - "ModelBuilder"
Cohesion: 0.11
Nodes (13): CallSite, canonicalKey(), DATA_CLIENT_TYPES, EXTERNAL_STOPLIST, mergeMode(), ModelBuilder, packageName(), SELF_NAMES (+5 more)

### Community 7 - "ir.ts"
Cohesion: 0.15
Nodes (17): Cardinality, ComponentDiagram, DiagramBase, DiagramNote, ErdAttribute, ErdEntity, ErDiagram, ErdRelation (+9 more)

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (24): ES2022, node, src/**/*.ts, compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, lib (+16 more)

### Community 9 - "diagrams/index.ts"
Cohesion: 0.17
Nodes (10): ComponentGenerator, createDefaultGenerators(), createDefaultRenderers(), resolveEntryPoint(), resolveScope(), ModelIndex, push(), generators (+2 more)

### Community 10 - "classify.ts"
Cohesion: 0.24
Nodes (12): CLI_ANNOTATIONS, componentRoleFromSymbol(), entryPointFromAnnotations(), EVENT_ANNOTATIONS, GENERIC_COMPONENT_ANNOTATIONS, HTTP_DECORATORS, joinPath(), NAME_RULES (+4 more)

### Community 11 - "services.py"
Cohesion: 0.13
Nodes (13): Base, create_order(), get_order(), get, OrderService, post, Customer, Order (+5 more)

### Community 12 - "src/index.ts"
Cohesion: 0.05
Nodes (47): Out, DiagramDefinition, OutputFormat, plural(), GeneratorRegistry, SystemModel, UseCase, RendererRegistry (+39 more)

### Community 14 - "provenance.ts"
Cohesion: 0.20
Nodes (11): codeFact(), Confidence, declaredFact(), inferredFact(), PRECEDENCE, Provenance, strongerOf(), unknownFact() (+3 more)

### Community 15 - "cli/index.ts"
Cohesion: 0.12
Nodes (31): evidence(), registerCoverage(), GenerateOptions, registerGenerate(), registerScenarios(), applyAnswer(), printQuestion(), registerSemantic() (+23 more)

### Community 16 - "typescript.ts"
Cohesion: 0.10
Nodes (39): Annotation, MountRegistration, RouteRegistration, callsOutside(), camelFromTopic(), collectCalls(), collectRegistrations(), collectTypeRefs() (+31 more)

### Community 17 - "1.2.0"
Cohesion: 0.20
Nodes (9): 1.0.0, 1.2.0, 1.3.0, Added, Added, Changed, Changelog, Fixed (+1 more)

### Community 18 - "fs.ts"
Cohesion: 0.12
Nodes (24): changedPaths(), ChangeSet, detectChanges(), DetectOptions, diffHashSnapshots(), FileEntry, hashFile(), isEmptyChangeSet() (+16 more)

### Community 19 - "extract.ts"
Cohesion: 0.13
Nodes (20): AttributeDecl, EntityDecl, ann(), columnName(), decoratorOrmExtractor, DEFAULT_ENTITY_EXTRACTORS, djangoExtractor, EntityExtractor (+12 more)

### Community 20 - "sequence.ts"
Cohesion: 0.23
Nodes (8): humanize(), mermaidId(), slugify(), PARTICIPANT_ROLES, SequenceGenerator, SequenceElement, SequenceParticipant, accessMode()

### Community 21 - "auth.service.ts"
Cohesion: 0.14
Nodes (10): AuthController, Body, Controller, Post, AuthService, Injectable, SessionManager, Injectable (+2 more)

### Community 22 - "Supported Languages and Extracted Facts"
Cohesion: 0.12
Nodes (19): Code Model (src/codemodel), Language Adapters (src/parsers), System Model (src/model), Cross-Source Entity Merging, Entity Relationship Diagram, go-shop Fixture (Go net/http), java-shop Fixture (Spring Boot + JPA), py-shop Fixture (FastAPI + SQLAlchemy) (+11 more)

### Community 23 - "Order"
Cohesion: 0.16
Nodes (12): JoinColumn, Order, Column, ManyToOne, OneToMany, PrimaryGeneratedColumn, OrderItem, Column (+4 more)

### Community 24 - "UMLFlow"
Cohesion: 0.18
Nodes (15): Change Detector (src/change), umlflow CLI Layer, Diagram Manager (src/diagrams, src/sync), Index / Cache (src/index), UMLFlow Layered Architecture, Sync Baseline Separate from Parse Cache, Umlflow Engine (src/sync/pipeline.ts), Programmatic Umlflow API (+7 more)

### Community 25 - "package.json"
Cohesion: 0.12
Nodes (16): author, bin, umlflow, bugs, url, description, engines, homepage (+8 more)

### Community 26 - "CodeFile"
Cohesion: 0.29
Nodes (4): CodeFile, BuildInput, moduleName(), routePrefixFromAnnotations()

### Community 27 - "wiring.ts"
Cohesion: 0.12
Nodes (8): EmailClient, NotificationService, OrderRepository, OrderService, PaymentGateway, notifications, orders, wire()

### Community 28 - "schema.ts"
Cohesion: 0.14
Nodes (22): registerInit(), defaultDiagramFor(), InitOptions, initProject(), InitResult, DiagramScope, DiagramType, ExplicitRelationship (+14 more)

### Community 29 - ".umlflow/config.yaml"
Cohesion: 0.21
Nodes (13): Comment-Preserving Config Store, .umlflow/config.yaml, inferredScope (UMLFlow-owned field), Diagram Overrides (labels, aliases, actors, relationships), Fact Precedence: user > code > inference > unknown, Scope Resolution (user scope beats inferredScope), .umlflow/semantics.yaml, Entry Point (+5 more)

### Community 30 - "Git"
Cohesion: 0.17
Nodes (6): execFileAsync, Git, GitFileChange, parseNameStatus(), normalizeRel(), toPosix()

### Community 31 - "/umlflow Claude Code Skill"
Cohesion: 0.18
Nodes (14): Provenance and Confidence Primitives, umlflow context (compact state summary), Claude Code Integration, Task Boundaries for Regeneration, --json Structured Output, CLI Command Reference, Uncertainty Markers (? and ??), Idempotent Skill Installation (+6 more)

### Community 32 - "update Semantics (six-step pipeline)"
Cohesion: 0.18
Nodes (12): Generated Content Owned by UMLFlow, Mermaid Renderer (src/render/mermaid), OAuth Login Example Session, update Semantics (six-step pipeline), Protected UMLFLOW MANUAL Sections, A Day in the Life Workflow, Renderer Extension Point, Hook CLI Binary Discovery Chain (+4 more)

### Community 33 - "keywords"
Cohesion: 0.15
Nodes (13): keywords, architecture, claude-code, claude-code-skill, cli, diagrams, erd, incremental (+5 more)

### Community 34 - "config/store.ts"
Cohesion: 0.20
Nodes (7): projectPaths, UmlflowConfig, ConfigStore, stripUndefined(), exists(), readText(), writeText()

### Community 35 - "order.service.ts"
Cohesion: 0.26
Nodes (5): CreateOrderDto, OrderService, Injectable, Logger, Injectable

### Community 36 - "semantics.ts"
Cohesion: 0.14
Nodes (14): FactSource, ActorSemantics, ComponentSemantics, emptySemantics(), EntitySemantics, hasSemanticsHeader(), isRecord(), isSemanticsHeader() (+6 more)

### Community 37 - "dependencies"
Cohesion: 0.18
Nodes (11): commander, @inquirer/prompts, dependencies, commander, @inquirer/prompts, picocolors, @vscode/tree-sitter-wasm, yaml (+3 more)

### Community 38 - "Technology Decisions"
Cohesion: 0.33
Nodes (6): Golden Snapshot Outputs, prisma-shop Fixture, Fourteen Build Phases, Dedicated SQL DDL and Prisma Extractors, Technology Decisions, Vitest Fixture Repos and Golden Tests

### Community 39 - "OrderService"
Cohesion: 0.36
Nodes (5): Order, OrderRepository, OrderService, Client, NewOrderService()

### Community 40 - "scripts"
Cohesion: 0.20
Nodes (10): scripts, build, clean, lint, pack:check, prepublishOnly, pretest, test (+2 more)

### Community 41 - "InventoryService"
Cohesion: 0.27
Nodes (4): InventoryRepository, Injectable, InventoryService, Injectable

### Community 42 - "PaymentGateway"
Cohesion: 0.24
Nodes (4): PaymentGateway, Injectable, PaymentService, Injectable

### Community 43 - "index/store.ts"
Cohesion: 0.14
Nodes (8): readJson(), removeFile(), writeJson(), CacheHealth, DiagramState, DiagramStateFile, FileIndex, IndexStore

### Community 44 - "Semantic Question/Answer Protocol"
Cohesion: 0.20
Nodes (10): No LLM Inside the CLI, Exit Codes and Stale-Diagram Signal, Adapter Version as Cache Key, CI Staleness Check, Component Role Classification, SystemModel Schema, Semantic Question/Answer Protocol, check Fails in CI but Passes Locally (+2 more)

### Community 45 - "OrderHandler"
Cohesion: 0.29
Nodes (6): OrderHandler, Request, ResponseWriter, ServeMux, OrderService, RegisterRoutes()

### Community 46 - "OrderController"
Cohesion: 0.25
Nodes (5): OrderController, Body, Controller, Get, Post

### Community 47 - "helpers.ts"
Cohesion: 0.21
Nodes (12): parseFiles(), ParseRequest, buildSystemModel(), createDefaultRegistry(), analyzeFixture(), cleanup(), FIXTURES, git() (+4 more)

### Community 48 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, typescript, vitest, @types/node, typescript, vitest

### Community 49 - "Troubleshooting Guide"
Cohesion: 0.18
Nodes (12): Cache Is Disposable (rebuild-index), Deterministic Interaction Resolution, Sequence Diagram, ts-shop Fixture (NestJS + TypeORM + SQL), Cache Corruption Recovery, Only Components Are Sequence Participants, Known Analysis Limitations, Troubleshooting Guide (+4 more)

### Community 50 - "files"
Cohesion: 0.29
Nodes (7): files, bin/, CHANGELOG.md, dist/, !dist/**/*.map, !dist/**/*.tsbuildinfo, skill/SKILL.md

### Community 51 - "User"
Cohesion: 0.40
Nodes (4): Column, OneToMany, PrimaryGeneratedColumn, User

### Community 52 - "umlflow.js"
Cohesion: 0.83
Nodes (3): describe(), fail(), main()

### Community 53 - "exports"
Cohesion: 0.67
Nodes (3): exports, ./package.json, ./skill/SKILL.md

### Community 54 - "repository"
Cohesion: 0.67
Nodes (3): repository, type, url

### Community 61 - "hooks.ts"
Cohesion: 0.30
Nodes (14): currentBinary(), registerHooks(), setHookModes(), SUPPORTED_HOOKS, readTextOrNull(), findSection(), HookInstallResult, HookInstallStatus (+6 more)

### Community 62 - "Affected-Diagram Computation"
Cohesion: 0.25
Nodes (8): Claude Token Budget per Action, generate Options and Scope Flags, DiagramGenerator Extension Point, Affected-Diagram Computation, Progressive Context Expansion, Scope Inference from an --about Topic, generate --about Matched Nothing, Token-Efficient by Design

### Community 63 - "scope.ts"
Cohesion: 0.25
Nodes (12): InferredScope, ComponentEdge, ComponentNode, componentInScope(), entityInScope(), fileInScope(), inferScope(), keywordsFor() (+4 more)

### Community 64 - "index-config.test.ts"
Cohesion: 0.57
Nodes (5): fingerprint(), sha256(), shortHash(), sortKeys(), stableStringify()

## Ambiguous Edges - Review These
- `Logger Ignore Rule` → `audit_log Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: conceptually_related_to
- `InventoryRepository` → `OrderItem Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: shares_data_with

## Knowledge Gaps
- **173 isolated node(s):** `Added`, `Fixed`, `Changed`, `Added`, `Fixed` (+168 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Logger Ignore Rule` and `audit_log Entity`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `InventoryRepository` and `OrderItem Entity`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `CodeFile` connect `CodeFile` to `python.ts`, `generator.ts`, `build.ts`, `ModelBuilder`, `ir.ts`, `classify.ts`, `index/store.ts`, `src/index.ts`, `helpers.ts`, `typescript.ts`, `extract.ts`, `sequence.ts`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `Entity` connect `ModelBuilder` to `build.ts`, `src/index.ts`, `extract.ts`, `User`, `Order`, `scope.ts`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `Order` connect `Order` to `order.service.ts`, `PaymentGateway`, `User`, `ModelBuilder`?**
  _High betweenness centrality (0.056) - this node is a cross-community bridge._
- **What connects `Added`, `Fixed`, `Changed` to the rest of the system?**
  _173 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `python.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07188200149365198 - nodes in this community are weakly interconnected._