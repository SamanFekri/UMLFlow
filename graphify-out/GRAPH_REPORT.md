# Graph Report - UMLFlow  (2026-09-24)

## Corpus Check
- 127 files · ~57,137 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1066 nodes · 2783 edges · 64 communities (58 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.78)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3d628626`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- typescript.ts
- ir.ts
- OrderController
- generator.ts
- src/index.ts
- Order
- CodeFile
- pipeline.ts
- compilerOptions
- scope.ts
- classify.ts
- services.py
- Umlflow
- config/init.ts
- semantics.ts
- cli/index.ts
- Git
- Out
- fs.ts
- codemodel/types.ts
- ConfigStore
- auth.service.ts
- Supported Languages and Extracted Facts
- Order
- UMLFlow
- package.json
- hooks.ts
- helpers.ts
- config/store.ts
- .umlflow/config.yaml
- parsers.test.ts
- /umlflow Claude Code Skill
- update Semantics (six-step pipeline)
- keywords
- errors.ts
- order.service.ts
- SemanticsStore
- dependencies
- Technology Decisions
- OrderService
- scripts
- InventoryService
- PaymentGateway
- sql.ts
- Semantic Question/Answer Protocol
- OrderHandler
- OrderController
- ParserRegistry
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
- schema.ts
- Affected-Diagram Computation
- GeneratorRegistry

## God Nodes (most connected - your core abstractions)
1. `CodeFile` - 47 edges
2. `field()` - 41 edges
3. `namedChildren()` - 35 edges
4. `ModelBuilder` - 33 edges
5. `Umlflow` - 32 edges
6. `line()` - 28 edges
7. `simplifyType()` - 24 edges
8. `LanguageAdapter` - 23 edges
9. `Git` - 21 edges
10. `Provenance` - 21 edges

## Surprising Connections (you probably didn't know these)
- `System Model (src/model)` --semantically_similar_to--> `System Model (cache of what the code says)`  [INFERRED] [semantically similar]
  docs/architecture.md → README.md
- `Progressive Context Expansion` --semantically_similar_to--> `Token-Efficient by Design`  [INFERRED] [semantically similar]
  docs/incremental-analysis.md → README.md
- `Managed UMLFLOW Hook Section` --semantically_similar_to--> `Safe In-Place Regeneration of Generated Blocks`  [INFERRED] [semantically similar]
  docs/git-hooks-and-ci.md → README.md
- `Run update Once at Task End` --semantically_similar_to--> `Task Boundaries for Regeneration`  [INFERRED] [semantically similar]
  skill/SKILL.md → docs/claude-code.md
- `/umlflow Claude Code Skill` --calls--> `umlflow CLI Layer`  [EXTRACTED]
  skill/SKILL.md → docs/architecture.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Provenance and Uncertainty System** — docs_architecture_provenance, docs_configuration_precedence, docs_supported_analysis_deterministic_vs_inferred, docs_diagrams_uncertainty_markers, docs_incremental_analysis_component_roles, readme_honest_provenance [INFERRED 0.85]
- **UMLFlow Extension Points** — docs_extending_language_adapter, docs_extending_entity_extractor, docs_extending_diagram_generator, docs_extending_renderer [EXTRACTED 1.00]
- **Semantic Question/Answer Flow** — skill_skill_semantic_questions, docs_plan_question_answer_protocol, docs_architecture_no_llm_in_cli, docs_configuration_semantics_yaml, docs_claude_code_integration, skill_skill_declare [EXTRACTED 1.00]
- **Login flow participants** — examples_ts_shop_login_flow_visitor, examples_ts_shop_login_flow_authcontroller, examples_ts_shop_login_flow_authservice, examples_ts_shop_login_flow_userrepository, examples_ts_shop_login_flow_sessionmanager, examples_ts_shop_login_flow_db_user [EXTRACTED 1.00]
- **Place order flow participants** — examples_ts_shop_checkout_flow_customer, examples_ts_shop_checkout_flow_ordercontroller, examples_ts_shop_checkout_flow_orderservice, examples_ts_shop_checkout_flow_inventoryservice, examples_ts_shop_checkout_flow_inventoryrepository, examples_ts_shop_checkout_flow_paymentservice, examples_ts_shop_checkout_flow_paymentgateway, examples_ts_shop_checkout_flow_orderrepository, examples_ts_shop_checkout_flow_db_order [EXTRACTED 1.00]
- **User-rooted relational data model** — examples_ts_shop_database_erd_user, examples_ts_shop_database_erd_order, examples_ts_shop_database_erd_orderitem, examples_ts_shop_database_erd_audit_log [EXTRACTED 1.00]

## Communities (64 total, 6 thin omitted)

### Community 0 - "typescript.ts"
Cohesion: 0.08
Nodes (95): node, Annotation, CodeImport, emptyCodeFile(), Field, Param, RouteRegistration, LanguageAdapter (+87 more)

### Community 1 - "ir.ts"
Cohesion: 0.10
Nodes (30): Confidence, mermaidId(), Cardinality, Diagram, ErdAttribute, ErdEntity, ErdRelation, SequenceElement (+22 more)

### Community 2 - "OrderController"
Cohesion: 0.05
Nodes (45): Customer, Order Datastore (checkout flow), Checkout Flow Sequence Diagram, InventoryRepository, InventoryService, OrderController, OrderRepository, OrderService (+37 more)

### Community 3 - "generator.ts"
Cohesion: 0.13
Nodes (20): DiagramOverrides, humanize(), DiagramGenerator, GenerateContext, GenerateResult, ErdGenerator, PARTICIPANT_ROLES, SequenceGenerator (+12 more)

### Community 4 - "src/index.ts"
Cohesion: 0.14
Nodes (31): buildContext(), ContextSummary, summarizeModel(), AttributeDecl, RelationKind, SymbolKind, InferredScope, Provenance (+23 more)

### Community 5 - "Order"
Cohesion: 0.08
Nodes (17): GetMapping, JpaRepository, PostMapping, RequestMapping, RestController, Service, CreateOrderRequest, Customer (+9 more)

### Community 6 - "CodeFile"
Cohesion: 0.13
Nodes (12): CallSite, CodeFile, sortBy(), buildSystemModel(), canonicalKey(), DATA_CLIENT_TYPES, EXTERNAL_STOPLIST, mergeMode() (+4 more)

### Community 7 - "pipeline.ts"
Cohesion: 0.19
Nodes (16): OutputFormat, composeGeneratedBlock(), ComposeInput, composeMermaidMirror(), extractGeneratedBlock(), extractManualDiagramLines(), generatedFingerprint(), MergeInput (+8 more)

### Community 8 - "compilerOptions"
Cohesion: 0.08
Nodes (24): ES2022, node, src/**/*.ts, compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, lib (+16 more)

### Community 9 - "scope.ts"
Cohesion: 0.18
Nodes (13): createDefaultGenerators(), createDefaultRenderers(), inferScope(), keywordsFor(), matches(), resolveEntryPoint(), resolveScope(), STOP_WORDS (+5 more)

### Community 10 - "classify.ts"
Cohesion: 0.15
Nodes (18): singularize(), useCaseNameFor(), CLI_ANNOTATIONS, componentRoleFromSymbol(), entryPointFromAnnotations(), EVENT_ANNOTATIONS, GENERIC_COMPONENT_ANNOTATIONS, HTTP_DECORATORS (+10 more)

### Community 11 - "services.py"
Cohesion: 0.13
Nodes (13): Base, create_order(), get_order(), get, OrderService, post, Customer, Order (+5 more)

### Community 12 - "Umlflow"
Cohesion: 0.19
Nodes (4): DiagramDefinition, couldResolveTo(), GeneratedDiagram, Umlflow

### Community 13 - "config/init.ts"
Cohesion: 0.24
Nodes (12): registerInit(), defaultDiagramFor(), InitOptions, initProject(), InitResult, DiagramType, HOOK_MODES, HookMode (+4 more)

### Community 14 - "semantics.ts"
Cohesion: 0.15
Nodes (16): codeFact(), declaredFact(), FactSource, inferredFact(), PRECEDENCE, strongerOf(), unknownFact(), BuildInput (+8 more)

### Community 15 - "cli/index.ts"
Cohesion: 0.19
Nodes (18): GenerateOptions, registerGenerate(), applyAnswer(), printQuestion(), registerSemantic(), ROLES, registerSkill(), registerSync() (+10 more)

### Community 17 - "Out"
Cohesion: 0.17
Nodes (8): Out, describeDep(), diffModels(), ModelDiff, roleLabel(), setDiff(), DiagramOutcome, IndexRefreshResult

### Community 18 - "fs.ts"
Cohesion: 0.15
Nodes (21): changedPaths(), ChangeSet, detectChanges(), DetectOptions, diffHashSnapshots(), FileEntry, hashFile(), isEmptyChangeSet() (+13 more)

### Community 19 - "codemodel/types.ts"
Cohesion: 0.11
Nodes (15): CodeSymbol, EntityDecl, ParseStatus, RelationDecl, ComponentDraft, ann(), columnName(), decoratorOrmExtractor (+7 more)

### Community 20 - "ConfigStore"
Cohesion: 0.49
Nodes (3): UmlflowConfig, ConfigStore, stripUndefined()

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

### Community 26 - "hooks.ts"
Cohesion: 0.30
Nodes (14): currentBinary(), registerHooks(), setHookModes(), SUPPORTED_HOOKS, readTextOrNull(), findSection(), HookInstallResult, HookInstallStatus (+6 more)

### Community 27 - "helpers.ts"
Cohesion: 0.26
Nodes (9): cleanup(), FIXTURES, git(), read(), tempRepo(), write(), BIN, BIN (+1 more)

### Community 28 - "config/store.ts"
Cohesion: 0.12
Nodes (10): projectPaths, DEFAULT_CONFIG, readJson(), readText(), writeJson(), CacheHealth, DiagramState, DiagramStateFile (+2 more)

### Community 29 - ".umlflow/config.yaml"
Cohesion: 0.21
Nodes (13): Comment-Preserving Config Store, .umlflow/config.yaml, inferredScope (UMLFlow-owned field), Diagram Overrides (labels, aliases, actors, relationships), Fact Precedence: user > code > inference > unknown, Scope Resolution (user scope beats inferredScope), .umlflow/semantics.yaml, Entry Point (+5 more)

### Community 30 - "parsers.test.ts"
Cohesion: 0.29
Nodes (9): DEFAULT_IGNORE_DIRS, fingerprint(), sha256(), shortHash(), sortKeys(), stableStringify(), FIXTURES, parseFixture() (+1 more)

### Community 31 - "/umlflow Claude Code Skill"
Cohesion: 0.18
Nodes (14): Provenance and Confidence Primitives, umlflow context (compact state summary), Claude Code Integration, Task Boundaries for Regeneration, --json Structured Output, CLI Command Reference, Uncertainty Markers (? and ??), Idempotent Skill Installation (+6 more)

### Community 32 - "update Semantics (six-step pipeline)"
Cohesion: 0.18
Nodes (12): Generated Content Owned by UMLFlow, Mermaid Renderer (src/render/mermaid), OAuth Login Example Session, update Semantics (six-step pipeline), Protected UMLFLOW MANUAL Sections, A Day in the Life Workflow, Renderer Extension Point, Hook CLI Binary Discovery Chain (+4 more)

### Community 33 - "keywords"
Cohesion: 0.15
Nodes (13): keywords, architecture, claude-code, claude-code-skill, cli, diagrams, erd, incremental (+5 more)

### Community 34 - "errors.ts"
Cohesion: 0.20
Nodes (10): bundledSkillPath(), claudeConfigDir(), installSkill(), require, SkillInstallStatus, skillTargetPath(), CacheCorruptError, errorMessage() (+2 more)

### Community 35 - "order.service.ts"
Cohesion: 0.26
Nodes (5): CreateOrderDto, OrderService, Injectable, Logger, Injectable

### Community 36 - "SemanticsStore"
Cohesion: 0.20
Nodes (6): emptySemantics(), isRecord(), normalizeSection(), normalizeSemantics(), SemanticsStore, SOURCES

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

### Community 43 - "sql.ts"
Cohesion: 0.53
Nodes (8): addForeignKey(), cleanIdent(), extractSqlEntities(), findOrCreate(), lineOf(), parseTableElement(), splitTopLevel(), stripComments()

### Community 44 - "Semantic Question/Answer Protocol"
Cohesion: 0.20
Nodes (10): No LLM Inside the CLI, Exit Codes and Stale-Diagram Signal, Adapter Version as Cache Key, CI Staleness Check, Component Role Classification, SystemModel Schema, Semantic Question/Answer Protocol, check Fails in CI but Passes Locally (+2 more)

### Community 45 - "OrderHandler"
Cohesion: 0.29
Nodes (6): OrderHandler, Request, ResponseWriter, ServeMux, OrderService, RegisterRoutes()

### Community 46 - "OrderController"
Cohesion: 0.25
Nodes (5): OrderController, Body, Controller, Get, Post

### Community 47 - "ParserRegistry"
Cohesion: 0.21
Nodes (5): parseFiles(), ParseRequest, createDefaultRegistry(), ParserRegistry, analyzeFixture()

### Community 48 - "devDependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, typescript, vitest, @types/node, typescript, vitest

### Community 49 - "Troubleshooting Guide"
Cohesion: 0.18
Nodes (12): Cache Is Disposable (rebuild-index), Deterministic Interaction Resolution, Sequence Diagram, ts-shop Fixture (NestJS + TypeORM + SQL), Cache Corruption Recovery, Only Components Are Sequence Participants, Known Analysis Limitations, Troubleshooting Guide (+4 more)

### Community 50 - "files"
Cohesion: 0.33
Nodes (6): files, bin/, dist/, !dist/**/*.map, !dist/**/*.tsbuildinfo, skill/SKILL.md

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

### Community 61 - "schema.ts"
Cohesion: 0.33
Nodes (9): DiagramScope, ExplicitRelationship, GitConfig, isRecord(), normalizeConfig(), normalizeDiagramDefinition(), OutputConfig, strArray() (+1 more)

### Community 62 - "Affected-Diagram Computation"
Cohesion: 0.25
Nodes (8): Claude Token Budget per Action, generate Options and Scope Flags, DiagramGenerator Extension Point, Affected-Diagram Computation, Progressive Context Expansion, Scope Inference from an --about Topic, generate --about Matched Nothing, Token-Efficient by Design

## Ambiguous Edges - Review These
- `Logger Ignore Rule` → `audit_log Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: conceptually_related_to
- `InventoryRepository` → `OrderItem Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: shares_data_with

## Knowledge Gaps
- **151 isolated node(s):** `name`, `version`, `description`, `uml`, `mermaid` (+146 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Logger Ignore Rule` and `audit_log Entity`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `InventoryRepository` and `OrderItem Entity`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `CodeFile` connect `CodeFile` to `typescript.ts`, `generator.ts`, `src/index.ts`, `pipeline.ts`, `classify.ts`, `sql.ts`, `semantics.ts`, `ParserRegistry`, `codemodel/types.ts`, `config/store.ts`?**
  _High betweenness centrality (0.104) - this node is a cross-community bridge._
- **Why does `Entity` connect `src/index.ts` to `scope.ts`, `User`, `CodeFile`, `Order`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `node` connect `typescript.ts` to `package.json`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _151 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `typescript.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.07616191904047977 - nodes in this community are weakly interconnected._