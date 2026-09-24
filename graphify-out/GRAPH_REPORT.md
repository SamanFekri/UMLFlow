# Graph Report - .  (2026-09-24)

## Corpus Check
- 129 files · ~57,137 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1066 nodes · 2827 edges · 61 communities (57 shown, 4 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 47 edges (avg confidence: 0.78)
- Token cost: 159,287 input · 0 output

## Community Hubs (Navigation)
- Tree-sitter Language Adapters
- Parser & Generator Registries
- ts-shop Example Diagrams
- Diagram Generators & Scope
- Code Model & Provenance Types
- ts-shop Order Domain
- Model Builder & Call Resolution
- Sync Pipeline & Rendering
- TypeScript Compiler Config
- Public API & Diagram IR
- Component Role Classification
- Python Shop Fixture
- Umlflow Engine Facade
- Config Schema & Init
- Semantics & Flow Inference
- CLI Command Wiring
- Git Wrapper
- CLI Output & Model Diff
- Filesystem & Change Detection
- Entity Extraction & Merging
- Config Store & Paths
- Auth Flow Fixture
- Language Support Documentation
- Order Entities Fixture
- Architecture Documentation
- Package Metadata
- Git Hook Installation
- Test Helpers & Fixtures
- Index Cache Store
- Diagram Config & Overrides Docs
- Hashing & Fingerprints
- Claude Code Skill Docs
- CLI & Hooks Reference Docs
- Package Keywords
- Errors & Skill Installer
- Order Service Fixture
- Semantics Store
- Runtime Dependencies
- Design Decisions & Protocol
- Go Shop Fixture
- npm Scripts
- Inventory Fixture
- Payment Fixture
- SQL DDL Parser
- Cache & Troubleshooting Docs
- Go HTTP Handler Fixture
- Order Controller Fixture
- Renderer Extension & CI Docs
- Dev Dependencies
- Semantic Q&A Examples Docs
- npm Files Allowlist
- User Entity Fixture
- CLI Entry Point (bin)
- Package Exports Map
- Repository Metadata
- Fixture Package Manifest
- Main Flows Definition
- Install Script
- Java Package Root

## God Nodes (most connected - your core abstractions)
1. `CodeFile` - 49 edges
2. `field()` - 41 edges
3. `Umlflow` - 40 edges
4. `namedChildren()` - 35 edges
5. `ModelBuilder` - 33 edges
6. `line()` - 28 edges
7. `simplifyType()` - 24 edges
8. `LanguageAdapter` - 23 edges
9. `Git` - 21 edges
10. `ConfigStore` - 21 edges

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

## Communities (61 total, 4 thin omitted)

### Community 0 - "Tree-sitter Language Adapters"
Cohesion: 0.08
Nodes (95): node, Annotation, CodeImport, emptyCodeFile(), Field, Param, RouteRegistration, LanguageAdapter (+87 more)

### Community 1 - "Parser & Generator Registries"
Cohesion: 0.07
Nodes (26): mermaidId(), GeneratorRegistry, createDefaultGenerators(), createDefaultRenderers(), resolveEntryPoint(), resolveScope(), parseFiles(), ParseRequest (+18 more)

### Community 2 - "ts-shop Example Diagrams"
Cohesion: 0.05
Nodes (45): Customer, Order Datastore (checkout flow), Checkout Flow Sequence Diagram, InventoryRepository, InventoryService, OrderController, OrderRepository, OrderService (+37 more)

### Community 3 - "Diagram Generators & Scope"
Cohesion: 0.12
Nodes (23): DiagramOverrides, humanize(), slugify(), DiagramGenerator, GenerateContext, GenerateResult, ErdGenerator, PARTICIPANT_ROLES (+15 more)

### Community 4 - "Code Model & Provenance Types"
Cohesion: 0.11
Nodes (31): AttributeDecl, CodeSymbol, ParseStatus, RelationDecl, RelationKind, SymbolKind, InferredScope, Provenance (+23 more)

### Community 5 - "ts-shop Order Domain"
Cohesion: 0.08
Nodes (17): GetMapping, JpaRepository, PostMapping, RequestMapping, RestController, Service, CreateOrderRequest, Customer (+9 more)

### Community 6 - "Model Builder & Call Resolution"
Cohesion: 0.13
Nodes (13): CallSite, sortBy(), accessMode(), buildSystemModel(), DATA_CLIENT_TYPES, EXTERNAL_STOPLIST, mergeMode(), ModelBuilder (+5 more)

### Community 7 - "Sync Pipeline & Rendering"
Cohesion: 0.12
Nodes (20): OutputFormat, Diagram, DiagramState, Renderer, RendererRegistry, composeGeneratedBlock(), ComposeInput, composeMermaidMirror() (+12 more)

### Community 8 - "TypeScript Compiler Config"
Cohesion: 0.08
Nodes (24): ES2022, node, src/**/*.ts, compilerOptions, declaration, esModuleInterop, exactOptionalPropertyTypes, lib (+16 more)

### Community 9 - "Public API & Diagram IR"
Cohesion: 0.13
Nodes (22): buildContext(), ContextSummary, summarizeModel(), Confidence, Cardinality, DiagramBase, ErdAttribute, ErdEntity (+14 more)

### Community 10 - "Component Role Classification"
Cohesion: 0.14
Nodes (18): CodeFile, BuildInput, moduleName(), CLI_ANNOTATIONS, componentRoleFromSymbol(), entryPointFromAnnotations(), EVENT_ANNOTATIONS, GENERIC_COMPONENT_ANNOTATIONS (+10 more)

### Community 11 - "Python Shop Fixture"
Cohesion: 0.13
Nodes (13): Base, create_order(), get_order(), get, OrderService, post, Customer, Order (+5 more)

### Community 12 - "Umlflow Engine Facade"
Cohesion: 0.22
Nodes (3): diffHashSnapshots(), DiagramDefinition, Umlflow

### Community 13 - "Config Schema & Init"
Cohesion: 0.18
Nodes (20): registerInit(), defaultDiagramFor(), InitOptions, initProject(), InitResult, DiagramScope, DiagramType, ExplicitRelationship (+12 more)

### Community 14 - "Semantics & Flow Inference"
Cohesion: 0.17
Nodes (14): codeFact(), declaredFact(), FactSource, inferredFact(), PRECEDENCE, strongerOf(), unknownFact(), buildFlows() (+6 more)

### Community 15 - "CLI Command Wiring"
Cohesion: 0.22
Nodes (17): GenerateOptions, registerGenerate(), applyAnswer(), printQuestion(), registerSemantic(), ROLES, registerSkill(), registerSync() (+9 more)

### Community 16 - "Git Wrapper"
Cohesion: 0.18
Nodes (4): execFileAsync, Git, GitFileChange, parseNameStatus()

### Community 17 - "CLI Output & Model Diff"
Cohesion: 0.16
Nodes (10): ChangeSet, Out, describeDep(), diffModels(), ModelDiff, roleLabel(), setDiff(), DiagramOutcome (+2 more)

### Community 18 - "Filesystem & Change Detection"
Cohesion: 0.17
Nodes (15): detectChanges(), makeFileFilter(), DEFAULT_IGNORE_DIRS, globToRegExp(), matchesAny(), normalizeRel(), removeFile(), toPosix() (+7 more)

### Community 19 - "Entity Extraction & Merging"
Cohesion: 0.13
Nodes (12): EntityDecl, canonicalKey(), ann(), columnName(), decoratorOrmExtractor, DEFAULT_ENTITY_EXTRACTORS, djangoExtractor, EntityExtractor (+4 more)

### Community 20 - "Config Store & Paths"
Cohesion: 0.24
Nodes (7): projectPaths, DEFAULT_CONFIG, UmlflowConfig, ConfigStore, stripUndefined(), readText(), writeText()

### Community 21 - "Auth Flow Fixture"
Cohesion: 0.14
Nodes (10): AuthController, Body, Controller, Post, AuthService, Injectable, SessionManager, Injectable (+2 more)

### Community 22 - "Language Support Documentation"
Cohesion: 0.12
Nodes (19): Code Model (src/codemodel), Language Adapters (src/parsers), System Model (src/model), Cross-Source Entity Merging, Entity Relationship Diagram, go-shop Fixture (Go net/http), java-shop Fixture (Spring Boot + JPA), py-shop Fixture (FastAPI + SQLAlchemy) (+11 more)

### Community 23 - "Order Entities Fixture"
Cohesion: 0.16
Nodes (12): JoinColumn, Order, Column, ManyToOne, OneToMany, PrimaryGeneratedColumn, OrderItem, Column (+4 more)

### Community 24 - "Architecture Documentation"
Cohesion: 0.15
Nodes (17): Change Detector (src/change), umlflow CLI Layer, Diagram Manager (src/diagrams, src/sync), UMLFlow Layered Architecture, Umlflow Engine (src/sync/pipeline.ts), Claude Token Budget per Action, DiagramGenerator Extension Point, Programmatic Umlflow API (+9 more)

### Community 25 - "Package Metadata"
Cohesion: 0.12
Nodes (16): author, bin, umlflow, bugs, url, description, engines, homepage (+8 more)

### Community 26 - "Git Hook Installation"
Cohesion: 0.30
Nodes (14): currentBinary(), registerHooks(), setHookModes(), SUPPORTED_HOOKS, readTextOrNull(), findSection(), HookInstallResult, HookInstallStatus (+6 more)

### Community 27 - "Test Helpers & Fixtures"
Cohesion: 0.22
Nodes (11): claudeConfigDir(), skillTargetPath(), cleanup(), FIXTURES, git(), read(), tempRepo(), write() (+3 more)

### Community 28 - "Index Cache Store"
Cohesion: 0.15
Nodes (6): readJson(), writeJson(), CacheHealth, DiagramStateFile, FileIndex, IndexStore

### Community 29 - "Diagram Config & Overrides Docs"
Cohesion: 0.16
Nodes (16): Comment-Preserving Config Store, .umlflow/config.yaml, inferredScope (UMLFlow-owned field), Diagram Overrides (labels, aliases, actors, relationships), Scope Resolution (user scope beats inferredScope), Entry Point, Deterministic Interaction Resolution, Sequence Diagram (+8 more)

### Community 30 - "Hashing & Fingerprints"
Cohesion: 0.19
Nodes (12): changedPaths(), DetectOptions, FileEntry, hashFile(), isEmptyChangeSet(), AnalysisConfig, fingerprint(), sha256() (+4 more)

### Community 31 - "Claude Code Skill Docs"
Cohesion: 0.19
Nodes (13): Provenance and Confidence Primitives, umlflow context (compact state summary), Claude Code Integration, Task Boundaries for Regeneration, Fact Precedence: user > code > inference > unknown, .umlflow/semantics.yaml, Uncertainty Markers (? and ??), Idempotent Skill Installation (+5 more)

### Community 32 - "CLI & Hooks Reference Docs"
Cohesion: 0.15
Nodes (13): OAuth Login Example Session, generate Options and Scope Flags, --json Structured Output, CLI Command Reference, update Semantics (six-step pipeline), A Day in the Life Workflow, Hook CLI Binary Discovery Chain, Hook Modes: check, update, off (+5 more)

### Community 33 - "Package Keywords"
Cohesion: 0.15
Nodes (13): keywords, architecture, claude-code, claude-code-skill, cli, diagrams, erd, incremental (+5 more)

### Community 34 - "Errors & Skill Installer"
Cohesion: 0.23
Nodes (8): bundledSkillPath(), installSkill(), require, SkillInstallStatus, CacheCorruptError, errorMessage(), NotInitializedError, UmlflowError

### Community 35 - "Order Service Fixture"
Cohesion: 0.26
Nodes (5): CreateOrderDto, OrderService, Injectable, Logger, Injectable

### Community 36 - "Semantics Store"
Cohesion: 0.24
Nodes (6): emptySemantics(), isRecord(), normalizeSection(), normalizeSemantics(), SemanticsStore, SOURCES

### Community 37 - "Runtime Dependencies"
Cohesion: 0.18
Nodes (11): commander, @inquirer/prompts, dependencies, commander, @inquirer/prompts, picocolors, @vscode/tree-sitter-wasm, yaml (+3 more)

### Community 38 - "Design Decisions & Protocol"
Cohesion: 0.20
Nodes (10): No LLM Inside the CLI, Golden Snapshot Outputs, prisma-shop Fixture, Component Role Classification, SystemModel Schema, Fourteen Build Phases, Semantic Question/Answer Protocol, Dedicated SQL DDL and Prisma Extractors (+2 more)

### Community 39 - "Go Shop Fixture"
Cohesion: 0.36
Nodes (5): Order, OrderRepository, OrderService, Client, NewOrderService()

### Community 40 - "npm Scripts"
Cohesion: 0.20
Nodes (10): scripts, build, clean, lint, pack:check, prepublishOnly, pretest, test (+2 more)

### Community 41 - "Inventory Fixture"
Cohesion: 0.27
Nodes (4): InventoryRepository, Injectable, InventoryService, Injectable

### Community 42 - "Payment Fixture"
Cohesion: 0.24
Nodes (4): PaymentGateway, Injectable, PaymentService, Injectable

### Community 43 - "SQL DDL Parser"
Cohesion: 0.53
Nodes (8): addForeignKey(), cleanIdent(), extractSqlEntities(), findOrCreate(), lineOf(), parseTableElement(), splitTopLevel(), stripComments()

### Community 44 - "Cache & Troubleshooting Docs"
Cohesion: 0.25
Nodes (8): Cache Is Disposable (rebuild-index), Index / Cache (src/index), Sync Baseline Separate from Parse Cache, Adapter Version as Cache Key, Cache Corruption Recovery, Two Snapshots: parse cache vs sync baseline, check Fails in CI but Passes Locally, Troubleshooting Guide

### Community 45 - "Go HTTP Handler Fixture"
Cohesion: 0.29
Nodes (6): OrderHandler, Request, ResponseWriter, ServeMux, OrderService, RegisterRoutes()

### Community 46 - "Order Controller Fixture"
Cohesion: 0.25
Nodes (5): OrderController, Body, Controller, Get, Post

### Community 47 - "Renderer Extension & CI Docs"
Cohesion: 0.33
Nodes (7): Generated Content Owned by UMLFlow, Mermaid Renderer (src/render/mermaid), Exit Codes and Stale-Diagram Signal, Protected UMLFLOW MANUAL Sections, Renderer Extension Point, CI Staleness Check, Pluggable Renderer over Diagram IR

### Community 48 - "Dev Dependencies"
Cohesion: 0.29
Nodes (7): devDependencies, @types/node, typescript, vitest, @types/node, typescript, vitest

### Community 49 - "Semantic Q&A Examples Docs"
Cohesion: 0.33
Nodes (6): ts-shop Fixture (NestJS + TypeORM + SQL), Actors Show as Unknown Actor, ts-shop Showcase Diagrams, umlflow declare (user-sourced facts), Never Invent an Actor, Flow or Relationship, Answering Semantic Questions

### Community 50 - "npm Files Allowlist"
Cohesion: 0.33
Nodes (6): files, bin/, dist/, !dist/**/*.map, !dist/**/*.tsbuildinfo, skill/SKILL.md

### Community 51 - "User Entity Fixture"
Cohesion: 0.40
Nodes (4): Column, OneToMany, PrimaryGeneratedColumn, User

### Community 52 - "CLI Entry Point (bin)"
Cohesion: 0.83
Nodes (3): describe(), fail(), main()

### Community 53 - "Package Exports Map"
Cohesion: 0.67
Nodes (3): exports, ./package.json, ./skill/SKILL.md

### Community 54 - "Repository Metadata"
Cohesion: 0.67
Nodes (3): repository, type, url

## Ambiguous Edges - Review These
- `Logger Ignore Rule` → `audit_log Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: conceptually_related_to
- `InventoryRepository` → `OrderItem Entity`  [AMBIGUOUS]
  examples/ts-shop/database-erd.md · relation: shares_data_with

## Knowledge Gaps
- **151 isolated node(s):** `install.sh script`, `name`, `version`, `description`, `uml` (+146 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Logger Ignore Rule` and `audit_log Entity`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `InventoryRepository` and `OrderItem Entity`?**
  _Edge tagged AMBIGUOUS (relation: shares_data_with) - confidence is low._
- **Why does `CodeFile` connect `Component Role Classification` to `Tree-sitter Language Adapters`, `Parser & Generator Registries`, `Diagram Generators & Scope`, `Code Model & Provenance Types`, `Model Builder & Call Resolution`, `Sync Pipeline & Rendering`, `Public API & Diagram IR`, `SQL DDL Parser`, `Umlflow Engine Facade`, `Entity Extraction & Merging`, `Index Cache Store`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `Entity` connect `Code Model & Provenance Types` to `Diagram Generators & Scope`, `Model Builder & Call Resolution`, `Public API & Diagram IR`, `Entity Extraction & Merging`, `User Entity Fixture`, `Order Entities Fixture`?**
  _High betweenness centrality (0.106) - this node is a cross-community bridge._
- **Why does `node` connect `Tree-sitter Language Adapters` to `Package Metadata`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `install.sh script`, `name`, `version` to the rest of the system?**
  _151 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Tree-sitter Language Adapters` be split into smaller, more focused modules?**
  _Cohesion score 0.07616191904047977 - nodes in this community are weakly interconnected._