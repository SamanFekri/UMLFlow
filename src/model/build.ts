import path from 'node:path';
import type { CallSite, CodeFile, CodeSymbol, EntityDecl, Field, RelationKind, RouteRegistration } from '../codemodel/types.js';
import { codeFact, inferredFact, strongerOf, unknownFact, type Provenance, type SourceRef } from '../core/provenance.js';
import { humanize, slugify, sortBy } from '../core/text.js';
import { componentRoleFromSymbol, entryPointFromAnnotations, isNonDescriptiveName, routePrefixFromAnnotations, joinPath } from './classify.js';
import { extractEntity } from './entities/extract.js';
import { provenanceFor, type SemanticsData } from './semantics.js';
import { buildFlows } from './flows.js';
import {
  MODEL_VERSION,
  type AccessMode,
  type Actor,
  type Component,
  type ComponentRole,
  type DataAccess,
  type Dependency,
  type Entity,
  type EntityRelation,
  type Interaction,
  type Operation,
  type SemanticQuestion,
  type SystemModel,
  type UseCase,
} from './types.js';

export interface BuildInput {
  files: Record<string, CodeFile>;
  semantics: SemanticsData;
  maxCallDepth: number;
}

const SELF_NAMES = new Set(['this', 'self', 'cls', 'me']);
const READ_VERBS = /^(find|get|list|query|select|count|exists|fetch|load|search|all|filter|first|one|read|scan|retrieve|lookup|has|is|paginate|aggregate|group|where|order|include|stream)/i;
const WRITE_VERBS = /^(save|create|insert|update|delete|remove|upsert|persist|add|commit|flush|merge|write|set|destroy|bulk|put|patch|increment|decrement|truncate|drop|execute|exec|store|append|push|enqueue|publish|clear)/i;
const DATA_CLIENT_TYPES = new Set(['Repository', 'EntityRepository', 'MongoRepository', 'TreeRepository', 'Model', 'PrismaClient', 'DataSource', 'EntityManager', 'Session', 'AsyncSession', 'Knex', 'Db', 'Database', 'Connection', 'Pool', 'Collection', 'DynamoDB', 'DocumentClient', 'Mapper', 'QueryBuilder', 'SQLAlchemy', 'DB', 'Client']);
const DATA_CLIENT_NAMES = /^(prisma|db|database|session|knex|connection|conn|em|entityManager|manager|dataSource|orm|sql|mongo|collection|pool|client|store)$/i;
const EXTERNAL_STOPLIST = new Set([
  'fs', 'path', 'os', 'util', 'crypto', 'events', 'stream', 'http', 'https', 'url', 'querystring', 'zlib', 'buffer', 'child_process', 'assert', 'net', 'tls',
  'lodash', 'underscore', 'ramda', 'moment', 'dayjs', 'date-fns', 'uuid', 'zod', 'yup', 'joi', 'class-validator', 'class-transformer', 'rxjs', 'reflect-metadata', 'dotenv', 'chalk', 'debug', 'winston', 'pino', 'bunyan', 'log4js',
  'json', 'logging', 'typing', 'datetime', 're', 'math', 'time', 'sys', 'uuid', 'collections', 'itertools', 'functools', 'dataclasses', 'enum', 'abc', 'pathlib', 'random', 'copy', 'string', 'decimal', 'pydantic', 'asyncio', 'contextlib', 'traceback', 'warnings', 'inspect', 'io', 'struct', 'hashlib', 'base64', 'secrets', 'textwrap', 'pprint', 'shutil', 'tempfile', 'glob', 'operator', 'numbers', 'types', 'weakref',
  'fmt', 'errors', 'strings', 'strconv', 'context', 'log', 'sync', 'bytes', 'io', 'sort', 'unicode', 'reflect', 'regexp', 'encoding', 'encoding/json', 'time', 'os', 'net/http',
  'java', 'javax', 'jakarta', 'lombok', 'slf4j', 'guava',
  'console', 'process', 'Math', 'JSON', 'Object', 'Array', 'Promise', 'Date', 'Number', 'String', 'Boolean', 'Error', 'Map', 'Set', 'Symbol', 'Reflect', 'Intl', 'globalThis', 'window', 'document',
]);
const FRAMEWORK_MODULES = /^(@nestjs\/|@angular\/|express|fastify|koa|hono|flask|fastapi|django|starlette|spring|org\.springframework|gin|echo|chi|gorilla|typeorm|sequelize|mongoose|sqlalchemy|prisma|@prisma\/|react|vue|svelte|next|nuxt|@types\/|vitest|jest|mocha|chai|pytest|unittest|testing)/;

interface ComponentDraft {
  component: Component;
  symbol?: CodeSymbol;
  file: CodeFile;
  /** Method / function symbols that become operations. */
  memberSymbols: CodeSymbol[];
  fields: Field[];
  routePrefix?: string;
}

interface Resolution {
  componentId: string;
  provenance: Provenance;
}

/**
 * Builds the System Model from cached Code Files and stored semantics. Pure
 * and deterministic: the same inputs always produce the same model.
 */
export function buildSystemModel(input: BuildInput): SystemModel {
  const files = sortBy(Object.values(input.files), (f) => f.path);
  const builder = new ModelBuilder(files, input.semantics, input.maxCallDepth);
  return builder.build();
}

class ModelBuilder {
  private readonly drafts: ComponentDraft[] = [];
  private readonly draftById = new Map<string, ComponentDraft>();
  private readonly byFileAndName = new Map<string, Map<string, string>>();
  private readonly globalByName = new Map<string, string[]>();
  private readonly operations: Operation[] = [];
  private readonly opById = new Map<string, Operation>();
  /** file path → module-scope variable bindings (name → type held). */
  private readonly bindingsByFile = new Map<string, Map<string, string>>();
  /** file path → mounted router name → prefix. */
  private readonly mountsByFile = new Map<string, Map<string, string>>();
  /** Mounted router name → prefix, across every analysed file. */
  private allMounts: Map<string, string> | null = null;
  private readonly interactions: Interaction[] = [];
  private readonly dependencies = new Map<string, Dependency>();
  private readonly dataAccess = new Map<string, DataAccess>();
  private readonly externals = new Map<string, Component>();
  private readonly entities: Entity[] = [];
  private readonly entityByKey = new Map<string, Entity>();
  private readonly relations = new Map<string, EntityRelation>();
  private readonly questions: SemanticQuestion[] = [];

  constructor(
    private readonly files: CodeFile[],
    private readonly semantics: SemanticsData,
    private readonly maxCallDepth: number,
  ) {}

  build(): SystemModel {
    for (const file of this.files) this.collectComponents(file);
    this.applyComponentSemantics();
    for (const draft of this.drafts) this.collectOperations(draft);
    for (const draft of this.drafts) this.applyRouteRegistrations(draft);
    for (const draft of this.drafts) this.applyPublicEntryPoints(draft);
    for (const draft of this.drafts) this.collectStructuralDependencies(draft);
    for (const draft of this.drafts) this.collectInteractions(draft);
    for (const file of this.files) this.collectEntities(file);
    this.linkRepositoriesToEntities();
    const components = [...this.drafts.map((d) => d.component), ...sortBy([...this.externals.values()], (c) => c.id)];
    const { actors, useCases } = this.collectUseCases();
    const model: SystemModel = {
      version: MODEL_VERSION,
      builtAt: new Date().toISOString(),
      files: this.files.map((f) => f.path),
      components,
      operations: this.operations,
      interactions: this.interactions,
      dependencies: sortBy([...this.dependencies.values()], (d) => `${d.from}|${d.kind}|${d.to}`),
      entities: this.entities,
      relations: sortBy([...this.relations.values()], (r) => `${r.from}|${r.to}|${r.kind}`),
      dataAccess: sortBy([...this.dataAccess.values()], (d) => `${d.componentId}|${d.entityId}`),
      actors,
      useCases,
      flows: [],
      questions: this.questions,
      unparsed: this.files.filter((f) => f.status !== 'ok').map((f) => ({ file: f.path, status: f.status, message: f.message })),
    };
    model.flows = buildFlows(model, this.semantics, this.maxCallDepth);
    this.collectQuestions(model);
    model.questions = sortBy(this.questions, (q) => q.id);
    return model;
  }

  /* ------------------------------------------------------------------ components */

  private collectComponents(file: CodeFile): void {
    const topLevel = file.symbols.filter((s) => !s.parent);
    const members = file.symbols.filter((s) => s.parent);
    const moduleFunctions: CodeSymbol[] = [];
    for (const sym of topLevel) {
      if (sym.kind === 'function' || sym.kind === 'variable') {
        if (sym.kind === 'function' || (sym.routes && sym.routes.length > 0)) moduleFunctions.push(sym);
        continue;
      }
      if (sym.kind === 'module') continue;
      const memberSymbols = members.filter((m) => m.parent === sym.id);
      const { role, provenance } = componentRoleFromSymbol(sym, file, memberSymbols.length > 0);
      const id = this.allocateId(sym.name, file);
      const component: Component = {
        id,
        name: sym.name,
        kind: sym.kind,
        role,
        roleProvenance: provenance,
        file: file.path,
        ref: { file: file.path, line: sym.line, endLine: sym.endLine, symbol: sym.id },
        operations: [],
        dependsOn: [],
      };
      const draft: ComponentDraft = {
        component,
        symbol: sym,
        file,
        memberSymbols,
        fields: sym.fields,
        routePrefix: routePrefixFromAnnotations(sym),
      };
      this.registerDraft(draft, file, sym.name);
    }
    // Go methods whose receiver struct lives in another file of the same package.
    for (const m of members) {
      if (!topLevel.some((t) => t.id === m.parent)) {
        const existing = this.globalByName.get(m.parent!)?.[0];
        const draft = existing ? this.draftById.get(existing) : undefined;
        if (draft && draft.file.module === file.module) draft.memberSymbols.push(m);
        else moduleFunctions.push(m);
      }
    }
    if (moduleFunctions.length > 0 || file.routes.length > 0) {
      const name = moduleName(file.path);
      const hasEntry = moduleFunctions.some((f) => entryPointFromAnnotations(f, file) || (f.routes && f.routes.length > 0)) || file.routes.length > 0;
      const id = this.allocateId(name, file);
      const ref: SourceRef = { file: file.path, line: 1 };
      const component: Component = {
        id,
        name,
        kind: 'module',
        role: hasEntry ? 'controller' : 'module',
        roleProvenance: hasEntry ? codeFact([ref], 'module registers routes / route handlers') : inferredFact([ref], 'module of free functions'),
        file: file.path,
        ref,
        operations: [],
        dependsOn: [],
      };
      const draft: ComponentDraft = { component, file, memberSymbols: moduleFunctions, fields: [] };
      this.registerDraft(draft, file, name);
      for (const fn of moduleFunctions) this.registerLocalName(file, fn.name, id);
    }
  }

  private allocateId(name: string, file: CodeFile): string {
    if (!this.draftById.has(name)) return name;
    const dir = path.posix.dirname(file.path);
    let candidate = `${name}@${dir === '.' ? path.posix.basename(file.path) : dir}`;
    let n = 2;
    while (this.draftById.has(candidate)) candidate = `${name}@${dir}#${n++}`;
    return candidate;
  }

  private registerDraft(draft: ComponentDraft, file: CodeFile, localName: string): void {
    this.drafts.push(draft);
    this.draftById.set(draft.component.id, draft);
    this.registerLocalName(file, localName, draft.component.id);
    const list = this.globalByName.get(localName) ?? [];
    list.push(draft.component.id);
    this.globalByName.set(localName, list);
  }

  private registerLocalName(file: CodeFile, name: string, id: string): void {
    let map = this.byFileAndName.get(file.path);
    if (!map) {
      map = new Map();
      this.byFileAndName.set(file.path, map);
    }
    if (!map.has(name)) map.set(name, id);
  }

  private applyComponentSemantics(): void {
    for (const draft of this.drafts) {
      const sem = this.semantics.components[draft.component.id] ?? this.semantics.components[draft.component.name];
      if (!sem?.role) continue;
      const prov = provenanceFor(sem.source, 'semantics.yaml');
      const winner = strongerOf(draft.component.roleProvenance, prov);
      if (winner === prov) {
        draft.component.role = sem.role;
        draft.component.roleProvenance = prov;
      }
    }
  }

  /* ------------------------------------------------------------------ resolution */

  /** Resolve a type/identifier name as seen from `file` to a component id. */
  private resolveName(name: string | undefined, file: CodeFile): Resolution | null {
    if (!name) return null;
    const local = this.byFileAndName.get(file.path)?.get(name);
    if (local) return { componentId: local, provenance: codeFact([{ file: file.path }], 'same file') };
    for (const imp of file.imports) {
      const original = imp.aliases?.[name] ?? name;
      if (!imp.names.includes(name) && !imp.names.includes('*') && !(imp.names.length === 1 && imp.source.endsWith('.' + name))) continue;
      if (imp.resolvedFile) {
        const target = this.byFileAndName.get(imp.resolvedFile)?.get(original);
        if (target) return { componentId: target, provenance: codeFact([{ file: file.path, line: imp.line }], `import from ${imp.source}`) };
        if (imp.names.includes('*')) continue;
      }
      // Python "from app import services" then services.OrderService → treat module import.
      if (imp.names.includes(name) && !imp.resolvedFile) return null; // external
    }
    const candidates = this.globalByName.get(name);
    if (candidates && candidates.length === 1) {
      const target = this.draftById.get(candidates[0]!);
      const samePackage = target && target.file.module !== undefined && target.file.module === file.module && target.file.language === file.language;
      return {
        componentId: candidates[0]!,
        provenance: samePackage ? codeFact([{ file: file.path }], 'same package') : inferredFact([{ file: file.path }], 'unique name match across repository'),
      };
    }
    if (candidates && candidates.length > 1) {
      // Prefer a candidate in the same directory.
      const dir = path.posix.dirname(file.path);
      const near = candidates.find((c) => path.posix.dirname(this.draftById.get(c)!.file.path) === dir);
      if (near) return { componentId: near, provenance: inferredFact([{ file: file.path }], 'nearest of several name matches') };
    }
    return null;
  }

  private externalComponentFor(name: string, file: CodeFile): Component | null {
    const imp = file.imports.find((i) => (i.names.includes(name) || i.aliases?.[name]) && !i.resolvedFile);
    if (!imp) return null;
    const pkg = packageName(imp.source);
    if (!pkg || EXTERNAL_STOPLIST.has(pkg) || EXTERNAL_STOPLIST.has(imp.source) || FRAMEWORK_MODULES.test(imp.source)) return null;
    const id = `ext:${pkg}`;
    let comp = this.externals.get(id);
    if (!comp) {
      comp = {
        id,
        name: pkg,
        kind: 'module',
        role: 'gateway',
        roleProvenance: codeFact([{ file: file.path, line: imp.line }], `external dependency ${imp.source}`),
        file: '',
        ref: { file: file.path, line: imp.line },
        operations: [],
        dependsOn: [],
      };
      this.externals.set(id, comp);
    }
    return comp;
  }

  /* ------------------------------------------------------------------ operations */

  private collectOperations(draft: ComponentDraft): void {
    const { component, file } = draft;
    for (const sym of sortBy(draft.memberSymbols, (s) => String(s.line).padStart(8, '0'))) {
      if (sym.kind !== 'method' && sym.kind !== 'function') continue;
      if (sym.name === 'constructor' || sym.name === '__init__' || sym.name === '__new__') continue;
      const id = `${component.id}.${sym.name}`;
      if (this.opById.has(id)) continue;
      const op: Operation = {
        id,
        componentId: component.id,
        name: sym.name,
        ref: { file: file.path, line: sym.line, endLine: sym.endLine, symbol: sym.id },
        visibility: visibilityOf(sym, file),
      };
      const entry = entryPointFromAnnotations(sym, file, draft.routePrefix);
      if (entry) op.entryPoint = entry;
      this.operations.push(op);
      this.opById.set(id, op);
      component.operations.push(id);
    }
  }

  /**
   * Prefix under which a router/route-group function is mounted.
   * `app.use('/api', routes)` means every route registered inside `routes` is
   * actually served under `/api`, so the prefix has to travel to those routes or
   * the model records the wrong paths (and therefore the wrong use case names).
   */
  private mountPrefixFor(file: CodeFile, symbolName: string): string | undefined {
    let mounts = this.mountsByFile.get(file.path);
    if (!mounts) {
      mounts = new Map<string, string>();
      const all = [...(file.mounts ?? []), ...file.symbols.flatMap((s) => s.mounts ?? [])];
      for (const m of all) {
        // `routes.default` / `mod.routes` are mounted by their last segment.
        const target = m.target.split('.').pop() ?? m.target;
        mounts.set(target, m.prefix);
      }
      this.mountsByFile.set(file.path, mounts);
    }
    return mounts.get(symbolName);
  }

  /** Route registrations (Express/Go style) map handlers to entry points. */
  private applyRouteRegistrations(draft: ComponentDraft): void {
    const { file } = draft;
    const routes: { route: RouteRegistration; prefix?: string }[] = [];
    if (draft.component.kind === 'module') {
      for (const r of file.routes) routes.push({ route: r });
    }
    for (const s of draft.memberSymbols) {
      // A prefix may be declared in any analysed file, not only this one.
      const prefix = this.mountPrefixFor(file, s.name) ?? this.mountPrefixAnywhere(s.name);
      for (const r of s.routes ?? []) routes.push({ route: r, ...(prefix ? { prefix } : {}) });
    }
    for (const { route, prefix } of routes) {
      if (!route.handler) continue;
      const target = this.resolveHandler(route.handler, draft);
      if (!target) continue;
      if (target.entryPoint && target.entryPoint.kind !== 'public') continue;
      const ref = { file: file.path, line: route.line };
      const reason = route.reason ?? 'route registration';
      // Only HTTP registrations are direct evidence; event/queue/cron/command
      // registrations are recognised by call shape, so they stay inferred.
      const provenance = route.confidence === 'inferred' ? inferredFact([ref], reason) : codeFact([ref], reason);
      const isHttp = (route.kind ?? 'http') === 'http';
      target.entryPoint = {
        kind: route.kind ?? 'http',
        ...(route.method ? { method: route.method } : {}),
        path: isHttp && prefix ? joinPath(prefix, route.path) : route.path,
        provenance,
      };
      const owner = this.draftById.get(target.componentId);
      if (owner && owner.component.role !== 'controller' && owner.component.roleProvenance.confidence !== 'declared') {
        owner.component.role = 'controller';
        owner.component.roleProvenance = codeFact([{ file: file.path, line: route.line }], 'handles registered route');
      }
    }
  }

  /** Public methods of controllers without explicit routes are still capabilities. */
  private applyPublicEntryPoints(draft: ComponentDraft): void {
    const { component } = draft;
    if (component.role === 'controller') {
      const wiring = new Set(draft.memberSymbols.filter((s) => s.routes && s.routes.length > 0).map((s) => `${component.id}.${s.name}`));
      for (const opId of component.operations) {
        const op = this.opById.get(opId)!;
        if (wiring.has(opId)) continue; // registers routes; not a capability itself
        if (!op.entryPoint && op.visibility !== 'private' && op.visibility !== 'protected') {
          op.entryPoint = { kind: 'public', provenance: inferredFact([op.ref], 'public method of a controller-like component') };
        }
      }
    }
  }

  private resolveHandler(handler: string, draft: ComponentDraft): Operation | null {
    const segs = handler.split('.');
    if (segs.length === 1) {
      const local = this.opById.get(`${draft.component.id}.${handler}`);
      if (local) return local;
      const res = this.resolveName(handler, draft.file);
      if (res) {
        const target = this.draftById.get(res.componentId);
        const op = target ? this.opById.get(`${target.component.id}.${handler}`) : undefined;
        return op ?? null;
      }
      return null;
    }
    // h.Create / OrderController.create / controller.create
    const [root, ...rest] = segs;
    const method = rest[rest.length - 1]!;
    let compId: string | undefined;
    const res = this.resolveName(root, draft.file);
    if (res) compId = res.componentId;
    else {
      // parameter typed to a component (Go: func Routes(h *Handler))
      for (const fn of draft.memberSymbols) {
        const p = fn.params.find((pp) => pp.name === root);
        const pr = this.resolveName(p?.type, draft.file);
        if (pr) {
          compId = pr.componentId;
          break;
        }
      }
    }
    if (!compId) return null;
    return this.opById.get(`${compId}.${method}`) ?? null;
  }

  /* ------------------------------------------------------------------ structure */

  private collectStructuralDependencies(draft: ComponentDraft): void {
    const { component, file, symbol } = draft;
    const addDep = (to: string, kind: Dependency['kind'], provenance: Provenance): void => {
      if (to === component.id) return;
      const key = `${component.id}|${kind}|${to}`;
      if (!this.dependencies.has(key)) this.dependencies.set(key, { from: component.id, to, kind, provenance });
      if (!component.dependsOn.includes(to)) component.dependsOn.push(to);
    };
    for (const f of draft.fields) {
      const res = this.resolveName(f.type, file);
      if (res) addDep(res.componentId, 'injects', { ...res.provenance, refs: [{ file: file.path, line: f.line }], reason: `field ${f.name}: ${f.type}` });
      for (const arg of f.typeArgs ?? []) {
        const r = this.resolveName(arg, file);
        if (r) addDep(r.componentId, 'uses', { ...r.provenance, refs: [{ file: file.path, line: f.line }], reason: `field ${f.name}<${arg}>` });
      }
    }
    if (symbol) {
      for (const base of symbol.extends) {
        const res = this.resolveName(base, file);
        if (res) addDep(res.componentId, 'extends', { ...res.provenance, refs: [component.ref] });
      }
      for (const iface of symbol.implements) {
        const res = this.resolveName(iface, file);
        if (res) addDep(res.componentId, 'implements', { ...res.provenance, refs: [component.ref] });
      }
    }
    const typeRefs = new Set<string>([...(symbol?.typeRefs ?? []), ...draft.memberSymbols.flatMap((m) => m.typeRefs ?? [])]);
    for (const t of typeRefs) {
      const res = this.resolveName(t, file);
      if (res) addDep(res.componentId, 'uses', { ...res.provenance, refs: [component.ref], reason: `instantiates ${t}` });
    }
  }

  /* ------------------------------------------------------------------ interactions */

  private collectInteractions(draft: ComponentDraft): void {
    const { component, file } = draft;
    for (const sym of draft.memberSymbols) {
      const opId = `${component.id}.${sym.name}`;
      const op = this.opById.get(opId);
      if (!op) continue;
      let order = 0;
      for (const call of sym.calls) {
        if (call.chained) continue; // method on the result of another call: type unknown, never guess
        const target = this.resolveCall(call, sym, draft);
        if (!target) continue;
        order++;
        if (target.kind === 'data') {
          this.recordDataAccess(component.id, target.entityName, call, file, target.provenance, opId);
          continue;
        }
        const id = `${opId}->${target.componentId}.${call.name}@${call.line}`;
        this.interactions.push({
          id,
          from: opId,
          fromComponent: component.id,
          toComponent: target.componentId,
          toOperation: target.operationId,
          label: target.label ?? call.name,
          order,
          ref: { file: file.path, line: call.line },
          provenance: target.provenance,
          ...(call.awaited ? { async: true } : {}),
        });
        if (target.componentId !== component.id) {
          const key = `${component.id}|calls|${target.componentId}`;
          if (!this.dependencies.has(key)) this.dependencies.set(key, { from: component.id, to: target.componentId, kind: 'calls', provenance: target.provenance });
          if (!component.dependsOn.includes(target.componentId)) component.dependsOn.push(target.componentId);
        }
      }
    }
  }

  private resolveCall(
    call: CallSite,
    sym: CodeSymbol,
    draft: ComponentDraft,
  ): { kind: 'component'; componentId: string; operationId?: string; label?: string; provenance: Provenance } | { kind: 'data'; entityName: string; provenance: Provenance } | null {
    const { component, file } = draft;
    const ref: SourceRef = { file: file.path, line: call.line };
    if (!call.receiver) {
      // Bare call: self operation, module function, or imported function.
      const selfOp = this.opById.get(`${component.id}.${call.name}`);
      if (selfOp) return { kind: 'component', componentId: component.id, operationId: selfOp.id, provenance: codeFact([ref], 'call to own method') };
      const res = this.resolveName(call.name, file);
      if (res) {
        const target = this.draftById.get(res.componentId);
        const op = target ? this.opById.get(`${target.component.id}.${call.name}`) : undefined;
        if (op) return { kind: 'component', componentId: res.componentId, operationId: op.id, provenance: { ...res.provenance, refs: [ref] } };
        if (target && target.component.kind !== 'module') return null; // instantiation, not a call
      }
      return null;
    }
    const segs = call.receiver.split('.').filter(Boolean);
    if (segs.length === 0) return null;
    let selfCall = false;
    if (SELF_NAMES.has(segs[0]!)) {
      segs.shift();
      selfCall = true;
    } else if (segs.length >= 2 && draft.fields.some((f) => f.name === segs[1]) && segs[0]!.length <= 2) {
      // Go receiver variable (s.repo.Save)
      segs.shift();
      selfCall = true;
    }
    if (segs.length === 0) {
      // this.method()
      const selfOp = this.opById.get(`${component.id}.${call.name}`);
      return selfOp ? { kind: 'component', componentId: component.id, operationId: selfOp.id, provenance: codeFact([ref], 'call to own method') } : null;
    }
    const root = segs[0]!;
    // 1. Field of this component (injected dependency / data client).
    const fieldMatch = selfCall || draft.fields.some((f) => f.name === root) ? draft.fields.find((f) => f.name === root) : undefined;
    if (fieldMatch) return this.resolveViaType(fieldMatch.type, fieldMatch.typeArgs, root, segs.slice(1), call, file, ref, `field ${root}`);
    if (selfCall) return null;
    // 2. Parameter of the operation (FastAPI Depends, Go handler params).
    const param = sym.params.find((p) => p.name === root);
    if (param) return this.resolveViaType(param.type, param.typeArgs, root, segs.slice(1), call, file, ref, `parameter ${root}`);
    // 3. Module-scope binding: `const service = new UserService()`. This is how
    //    composition roots and hand-wired dependencies are expressed when there is
    //    no DI container, so the variable carries the type of what it holds.
    const bound = this.moduleBinding(file, root);
    if (bound) return this.resolveViaType(bound, undefined, root, segs.slice(1), call, file, ref, `module binding ${root}`);
    // 4. Imported / local name (static call, module import, Django `User.objects`).
    const res = this.resolveName(root, file);
    if (res) {
      const target = this.draftById.get(res.componentId);
      if (target?.component.role === 'entity') return { kind: 'data', entityName: target.component.name, provenance: { ...res.provenance, refs: [ref] } };
      if (target) {
        const op = this.opById.get(`${target.component.id}.${call.name}`) ?? this.opById.get(`${target.component.id}.${segs[1] ?? ''}`);
        return { kind: 'component', componentId: res.componentId, operationId: op?.id, provenance: { ...res.provenance, refs: [ref] } };
      }
    }
    // 5. Data client by conventional name (prisma.user.findMany, db.orders.insert).
    if (DATA_CLIENT_NAMES.test(root) && segs[1]) {
      const entity = this.findEntityNameHint(segs[1]);
      if (entity) return { kind: 'data', entityName: entity, provenance: inferredFact([ref], `data client "${root}"`) };
    }
    // 6. External package.
    const ext = this.externalComponentFor(root, file);
    if (ext) {
      const label = segs.length > 1 ? `${segs.slice(1).join('.')}.${call.name}` : call.name;
      return { kind: 'component', componentId: ext.id, label, provenance: codeFact([ref], `external package ${ext.name}`) };
    }
    return null;
  }

  /**
   * Type held by a module-scope variable, e.g. `const service = new UserService()`.
   * Only unambiguous bindings count: a variable initialised from several
   * constructors tells us nothing definite, so it is skipped rather than guessed.
   */
  private moduleBinding(file: CodeFile, name: string): string | undefined {
    let bindings = this.bindingsByFile.get(file.path);
    if (!bindings) {
      bindings = new Map<string, string>();
      for (const sym of file.symbols) {
        if (sym.kind !== 'variable' || sym.parent) continue;
        const refs = sym.typeRefs ?? [];
        const type = sym.returnType ?? (refs.length === 1 ? refs[0] : undefined);
        if (type) bindings.set(sym.name, type);
      }
      this.bindingsByFile.set(file.path, bindings);
    }
    return bindings.get(name);
  }

  /** A router is often defined in one file and mounted in another. */
  private mountPrefixAnywhere(symbolName: string): string | undefined {
    if (!this.allMounts) {
      this.allMounts = new Map<string, string>();
      for (const f of this.files) {
        for (const m of [...(f.mounts ?? []), ...f.symbols.flatMap((s) => s.mounts ?? [])]) {
          const target = m.target.split('.').pop() ?? m.target;
          if (!this.allMounts.has(target)) this.allMounts.set(target, m.prefix);
        }
      }
    }
    return this.allMounts.get(symbolName);
  }

  private resolveViaType(
    type: string | undefined,
    typeArgs: string[] | undefined,
    root: string,
    rest: string[],
    call: CallSite,
    file: CodeFile,
    ref: SourceRef,
    reason: string,
  ): ReturnType<ModelBuilder['resolveCall']> {
    if (type) {
      const res = this.resolveName(type, file);
      if (res) {
        const target = this.draftById.get(res.componentId);
        if (target?.component.role === 'entity') return { kind: 'data', entityName: target.component.name, provenance: { ...res.provenance, refs: [ref], reason } };
        if (rest.length > 0 && target) {
          // Follow the member chain (service.repo.session.x) through typed fields; stop when unknown.
          const next = target.fields.find((f) => f.name === rest[0]);
          if (!next) return null;
          return this.resolveViaType(next.type, next.typeArgs, rest[0]!, rest.slice(1), call, target.file, ref, `${reason} → ${rest[0]}`);
        }
        const op = target ? this.opById.get(`${target.component.id}.${call.name}`) : undefined;
        return { kind: 'component', componentId: res.componentId, operationId: op?.id, provenance: { ...res.provenance, refs: [ref], reason } };
      }
      if (DATA_CLIENT_TYPES.has(type)) {
        const arg = typeArgs?.[0];
        const argRes = this.resolveName(arg, file);
        if (arg && argRes && this.draftById.get(argRes.componentId)?.component.role === 'entity') {
          return { kind: 'data', entityName: this.draftById.get(argRes.componentId)!.component.name, provenance: codeFact([ref], `${type}<${arg}> ${reason}`) };
        }
        if (arg) return { kind: 'data', entityName: arg, provenance: codeFact([ref], `${type}<${arg}> ${reason}`) };
        if (rest[0]) {
          const hint = this.findEntityNameHint(rest[0]);
          if (hint) return { kind: 'data', entityName: hint, provenance: inferredFact([ref], `${type} client member "${rest[0]}"`) };
        }
        return null;
      }
      const ext = this.externalComponentFor(type, file);
      if (ext) return { kind: 'component', componentId: ext.id, provenance: codeFact([ref], `external type ${type}`) };
    }
    // Untyped field: match field name to a component name (orderService → OrderService).
    const guess = this.guessComponentByFieldName(root);
    if (guess) {
      const target = this.draftById.get(guess)!;
      const op = this.opById.get(`${target.component.id}.${call.name}`);
      if (target.component.role === 'entity') return { kind: 'data', entityName: target.component.name, provenance: inferredFact([ref], `field name "${root}" matches entity`) };
      return { kind: 'component', componentId: guess, operationId: op?.id, provenance: inferredFact([ref], `field name "${root}" matches component name`) };
    }
    if (DATA_CLIENT_NAMES.test(root) && rest[0]) {
      const hint = this.findEntityNameHint(rest[0]);
      if (hint) return { kind: 'data', entityName: hint, provenance: inferredFact([ref], `data client "${root}"`) };
    }
    return null;
  }

  private guessComponentByFieldName(fieldName: string): string | undefined {
    const norm = fieldName.toLowerCase().replace(/[_-]/g, '');
    for (const [name, ids] of this.globalByName) {
      if (ids.length !== 1) continue;
      if (name.toLowerCase() === norm) return ids[0];
    }
    return undefined;
  }

  private findEntityNameHint(segment: string): string | undefined {
    const key = canonicalKey(segment);
    for (const draft of this.drafts) {
      if (draft.component.role === 'entity' && canonicalKey(draft.component.name) === key) return draft.component.name;
    }
    for (const file of this.files) {
      for (const e of file.entities) if (canonicalKey(e.table ?? e.name) === key || canonicalKey(e.name) === key) return e.name;
    }
    return undefined;
  }

  private recordDataAccess(componentId: string, entityName: string, call: CallSite, file: CodeFile, provenance: Provenance, opId: string): void {
    const mode = accessMode(call.name);
    const key = `${componentId}|${entityName}`;
    const existing = this.dataAccess.get(key);
    const ref = { file: file.path, line: call.line };
    if (existing) {
      existing.mode = mergeMode(existing.mode, mode);
      if (existing.provenance.refs.length < 5) existing.provenance.refs.push(ref);
      if (existing.operations && !existing.operations.includes(opId)) existing.operations.push(opId);
      return;
    }
    const access: DataAccess = { componentId, entityId: entityName, mode, provenance: { ...provenance, refs: [ref] }, operations: [opId] };
    this.dataAccess.set(key, access);
  }

  /* ------------------------------------------------------------------ entities */

  private collectEntities(file: CodeFile): void {
    const decls: EntityDecl[] = [...file.entities];
    for (const sym of file.symbols) {
      if (sym.parent) continue;
      const decl = extractEntity(sym, file);
      if (decl) decls.push(decl);
    }
    for (const decl of decls) this.mergeEntity(decl, file);
  }

  private mergeEntity(decl: EntityDecl, file: CodeFile): void {
    const keys = [canonicalKey(decl.name)];
    if (decl.table) keys.unshift(canonicalKey(decl.table));
    let entity = keys.map((k) => this.entityByKey.get(k)).find((e): e is Entity => !!e);
    const ref: SourceRef = { file: file.path, line: decl.line, symbol: decl.name };
    if (!entity) {
      entity = {
        id: decl.name,
        name: decl.name,
        table: decl.table,
        attributes: [],
        origin: decl.origin,
        ref,
        provenance: codeFact([ref], decl.origin),
      };
      this.entities.push(entity);
    } else {
      entity.provenance.refs.push(ref);
      if (!entity.table && decl.table) entity.table = decl.table;
      // Prefer domain (ORM) names over raw table names. Safe to rename here: relations and
      // data access are resolved against entities only after every entity is merged.
      if (entity.origin === 'sql' && decl.origin !== 'sql') {
        entity.id = decl.name;
        entity.name = decl.name;
        entity.origin = decl.origin;
      }
    }
    for (const k of keys) this.entityByKey.set(k, entity);
    for (const attr of decl.attributes) {
      const existing = entity.attributes.find((a) => canonicalKey(a.name) === canonicalKey(attr.name));
      if (!existing) entity.attributes.push({ ...attr });
      else {
        existing.primaryKey ||= attr.primaryKey;
        existing.unique ||= attr.unique;
        if (existing.nullable === undefined) existing.nullable = attr.nullable;
        if (!existing.foreignKey && attr.foreignKey) existing.foreignKey = attr.foreignKey;
        if (!existing.type || existing.type === 'fk') existing.type = attr.type ?? existing.type;
      }
    }
    for (const rel of decl.relations) {
      this.addRelation(entity, rel.target, rel.kind, rel.field, ref, decl.origin);
    }
  }

  private pendingRelations: { from: Entity; target: string; kind: RelationKind; field?: string; ref: SourceRef; origin: string }[] = [];

  private addRelation(from: Entity, target: string, kind: RelationKind, field: string | undefined, ref: SourceRef, origin: string): void {
    this.pendingRelations.push({ from, target, kind, field, ref, origin });
  }

  private linkRepositoriesToEntities(): void {
    // Resolve relation targets now that every entity is known.
    for (const rel of this.pendingRelations) {
      let target = this.entityByKey.get(canonicalKey(rel.target));
      if (!target) {
        target = { id: rel.target, name: rel.target, attributes: [], origin: rel.origin, ref: rel.ref, provenance: unknownFact([rel.ref], 'referenced by a relation but never defined') };
        this.entities.push(target);
        this.entityByKey.set(canonicalKey(rel.target), target);
      }
      let from = rel.from.id;
      let to = target.id;
      let kind = rel.kind;
      let fromField = rel.field;
      if (kind === 'one-to-many') {
        [from, to] = [to, from];
        kind = 'many-to-one';
        fromField = undefined;
      }
      if ((kind === 'one-to-one' || kind === 'many-to-many') && from > to) {
        [from, to] = [to, from];
        fromField = undefined;
      }
      if (from === to && kind !== 'many-to-one') continue;
      const key = `${from}|${to}|${kind}`;
      const existing = this.relations.get(key);
      if (existing) {
        existing.provenance.refs.push(rel.ref);
        if (!existing.fromField && fromField) existing.fromField = fromField;
        continue;
      }
      this.relations.set(key, { from, to, kind, fromField, provenance: codeFact([rel.ref], rel.origin) });
    }
    // Map data access entity names to entity ids; keep unknown names (they may be tables only known by name).
    for (const access of this.dataAccess.values()) {
      const e = this.entityByKey.get(canonicalKey(access.entityId));
      if (e) access.entityId = e.id;
    }
    // Repositories declared over an entity (JpaRepository<Order, Long>, Repository<Order>) access that entity.
    for (const draft of this.drafts) {
      const entityName = draft.symbol?.flags?.repositoryEntity;
      if (typeof entityName === 'string') {
        const e = this.entityByKey.get(canonicalKey(entityName));
        const key = `${draft.component.id}|${e?.id ?? entityName}`;
        if (!this.dataAccess.has(key)) {
          this.dataAccess.set(key, { componentId: draft.component.id, entityId: e?.id ?? entityName, mode: 'read-write', provenance: codeFact([draft.component.ref], `repository over ${entityName}`) });
        }
      }
    }
    // Components that call a repository/entity-bound component inherit nothing; access stays on the repository.
  }

  /* ------------------------------------------------------------------ use cases */

  private collectUseCases(): { actors: Actor[]; useCases: UseCase[] } {
    const actors = new Map<string, Actor>();
    for (const [name, sem] of Object.entries(this.semantics.actors)) {
      actors.set(name, { id: name, name, description: sem.description, provenance: provenanceFor(sem.source, 'semantics.yaml') });
    }
    const ensureActor = (name: string, provenance: Provenance): string => {
      if (!actors.has(name)) actors.set(name, { id: name, name, provenance });
      return name;
    };
    const useCases: UseCase[] = [];
    for (const op of this.operations) {
      if (!op.entryPoint) continue;
      const opSem = this.semantics.operations[op.id];
      if (opSem?.ignore) continue;
      const draft = this.draftById.get(op.componentId);
      const compSem = draft ? this.semantics.components[draft.component.id] ?? this.semantics.components[draft.component.name] : undefined;
      let name: string;
      let nameProvenance: Provenance;
      if (opSem?.useCase) {
        name = opSem.useCase;
        nameProvenance = provenanceFor(opSem.source, 'semantics.yaml');
      } else {
        name = useCaseNameFor(op);
        const derivedFromRoute = name !== humanize(op.name);
        nameProvenance =
          isNonDescriptiveName(op.name) && !derivedFromRoute
            ? unknownFact([op.ref], 'operation name is not descriptive')
            : inferredFact([op.ref], derivedFromRoute ? 'derived from route and operation name' : 'derived from operation name');
      }
      const actorIds: string[] = [];
      let actorProvenance: Provenance;
      if (opSem?.actor) {
        actorProvenance = provenanceFor(opSem.source, `semantics.yaml operations.${op.id}`);
        actorIds.push(ensureActor(opSem.actor, actorProvenance));
      } else if (compSem?.actor) {
        actorProvenance = provenanceFor(compSem.source, `semantics.yaml components.${op.componentId}`);
        actorIds.push(ensureActor(compSem.actor, actorProvenance));
      } else if (op.entryPoint.kind === 'scheduled') {
        actorProvenance = codeFact([op.ref], 'scheduled trigger');
        actorIds.push(ensureActor('Scheduler', actorProvenance));
      } else {
        actorProvenance = unknownFact([op.ref], 'actor not declared');
      }
      useCases.push({ id: slugify(`${op.componentId}-${op.name}`), name, nameProvenance, actorIds, actorProvenance, operationIds: [op.id], componentId: op.componentId });
    }
    return { actors: sortBy([...actors.values()], (a) => a.id), useCases };
  }

  /* ------------------------------------------------------------------ questions */

  private collectQuestions(model: SystemModel): void {
    const knownActors = model.actors.map((a) => a.name);
    const byComponent = new Map<string, UseCase[]>();
    for (const uc of model.useCases) {
      if (uc.actorIds.length > 0) continue;
      const list = byComponent.get(uc.componentId) ?? [];
      list.push(uc);
      byComponent.set(uc.componentId, list);
    }
    for (const [componentId, cases] of byComponent) {
      const comp = model.components.find((c) => c.id === componentId)!;
      const context = cases.slice(0, 8).map((uc) => {
        const op = this.opById.get(uc.operationIds[0]!)!;
        const ep = op.entryPoint!;
        return ep.kind === 'http' ? `${ep.method ?? ''} ${ep.path ?? ''} → ${op.name}`.trim() : `${ep.kind}: ${op.name}`;
      });
      this.questions.push({
        id: `actor:${componentId}`,
        kind: 'actor',
        priority: 'required',
        subject: componentId,
        question: `Which actor initiates the operations of ${comp.name}?`,
        refs: [comp.ref],
        options: [...knownActors, 'User', 'Administrator', 'External system', 'Internal service'].filter((v, i, a) => a.indexOf(v) === i),
        context,
      });
    }
    for (const uc of model.useCases) {
      if (uc.nameProvenance.confidence !== 'unknown') continue;
      const op = this.opById.get(uc.operationIds[0]!)!;
      this.questions.push({
        id: `usecase-name:${op.id}`,
        kind: 'usecase-name',
        priority: 'required',
        subject: op.id,
        question: `What business capability does ${op.id} provide? (its name "${op.name}" is not descriptive)`,
        refs: [op.ref],
        context: op.entryPoint?.path ? [`${op.entryPoint.method ?? ''} ${op.entryPoint.path}`.trim()] : undefined,
      });
    }
    // Flow naming: the call chain is the evidence an LLM needs to name a business
    // scenario well, so the question carries the chain instead of just the method name.
    // Only multi-step flows are worth asking about; a one-hop flow is named fine by the route.
    for (const flow of model.flows) {
      if (flow.nameProvenance.confidence === 'declared') continue;
      if (flow.steps.length < 2) continue;
      const op = this.opById.get(flow.entryOperation);
      if (!op) continue;
      const ep = op.entryPoint;
      const entry = ep?.kind === 'http' ? `${ep.method ?? ''} ${ep.path ?? ''}`.trim() : `${ep?.kind ?? 'call'}: ${op.name}`;
      const chain = flow.steps
        .slice(0, 12)
        .map((s) => `${'  '.repeat(Math.max(0, s.depth - 1))}${s.fromComponent} → ${s.toComponent}.${s.label}`);
      const touched = flow.entities.length ? [`data: ${flow.entities.join(', ')}`] : [];
      this.questions.push({
        id: `flow-name:${flow.entryOperation}`,
        kind: 'flow-name',
        priority: 'optional',
        subject: flow.entryOperation,
        question: `What business scenario does the flow starting at ${entry} represent? (currently named "${flow.name}", ${flow.nameProvenance.confidence})`,
        refs: [op.ref],
        context: [entry, ...chain, ...touched],
      });
    }

    // Entry-point confirmation. Registrations matched by call shape (`bus.on(...)`,
    // `queue.process(...)`) are a guess: `stream.on('data', cb)` has the same shape
    // as a real subscription. Rather than assert them, ask — answering "no" sets
    // `ignore` and the flow disappears from every diagram.
    for (const op of model.operations) {
      const ep = op.entryPoint;
      if (!ep || ep.provenance.confidence !== 'inferred') continue;
      if (ep.kind === 'public') continue;
      this.questions.push({
        id: `entry-point:${op.id}`,
        kind: 'entry-point',
        priority: 'optional',
        subject: op.id,
        question: `Is ${op.id} a real ${ep.kind} entry point of this system? (recognised from the shape of the registration call${ep.path ? ` for "${ep.path}"` : ''})`,
        refs: [op.ref],
        options: ['yes', 'no'],
        context: [`${ep.kind}${ep.path ? `: ${ep.path}` : ''}`, ep.provenance.reason ?? 'matched a registration pattern'],
      });
    }

    // Relationship confirmation: an inferred entity relation is a guess about the
    // data model, so it is surfaced rather than drawn as if it were read from code.
    for (const rel of model.relations) {
      if (rel.provenance.confidence !== 'inferred') continue;
      const from = model.entities.find((e) => e.id === rel.from);
      const to = model.entities.find((e) => e.id === rel.to);
      if (!from || !to) continue;
      this.questions.push({
        id: `entity-relation:${rel.from}->${rel.to}`,
        kind: 'entity-relation',
        priority: 'optional',
        subject: rel.from,
        question: `Is the "${rel.kind}" relationship from ${from.name} to ${to.name} correct? (inferred${rel.fromField ? ` from field "${rel.fromField}"` : ''})`,
        refs: [from.ref, to.ref],
        options: ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many', 'none'],
        context: [`${from.name}${from.table ? ` (table ${from.table})` : ''} → ${to.name}${to.table ? ` (table ${to.table})` : ''}`, ...(rel.fromField ? [`via field: ${rel.fromField}`] : [])],
      });
    }

    const interacting = new Set(model.interactions.flatMap((i) => [i.fromComponent, i.toComponent]));
    for (const comp of model.components) {
      if (comp.role !== 'unknown' || !interacting.has(comp.id)) continue;
      this.questions.push({
        id: `component-role:${comp.id}`,
        kind: 'component-role',
        priority: 'required',
        subject: comp.id,
        question: `What architectural role does ${comp.name} play?`,
        refs: [comp.ref],
        options: ['controller', 'service', 'repository', 'gateway', 'entity', 'model', 'utility'],
      });
    }
  }
}

/* ---------------------------------------------------------------------- helpers */

export function canonicalKey(name: string): string {
  let n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (n.endsWith('ies')) n = n.slice(0, -3) + 'y';
  else if (n.endsWith('ses') || n.endsWith('xes')) n = n.slice(0, -2);
  else if (n.endsWith('s') && !n.endsWith('ss')) n = n.slice(0, -1);
  return n;
}

function moduleName(filePath: string): string {
  const base = path.posix.basename(filePath).replace(/\.[^.]+$/, '');
  if (base === 'index' || base === '__init__' || base === 'main' || base === 'mod') {
    const dir = path.posix.basename(path.posix.dirname(filePath));
    return dir === '.' || dir === '' ? base : dir;
  }
  return base;
}

function packageName(source: string): string | undefined {
  if (!source || source.startsWith('.') || source.startsWith('/')) return undefined;
  if (source.startsWith('@')) return source.split('/').slice(0, 2).join('/');
  const first = source.split(/[/.]/)[0];
  return first || undefined;
}

function visibilityOf(sym: CodeSymbol, file: CodeFile): string | undefined {
  const v = sym.flags?.visibility;
  if (typeof v === 'string') return v;
  if (file.language === 'python' || file.language === 'go') return sym.exported ? 'public' : 'private';
  return undefined;
}

export function accessMode(method: string): AccessMode {
  if (READ_VERBS.test(method)) return 'read';
  if (WRITE_VERBS.test(method)) return 'write';
  return 'unknown';
}

function mergeMode(a: AccessMode, b: AccessMode): AccessMode {
  if (a === b) return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return 'read-write';
}

const CRUD_VERBS: Record<string, { verb: string; plural: boolean }> = {
  create: { verb: 'Create', plural: false },
  store: { verb: 'Create', plural: false },
  add: { verb: 'Add', plural: false },
  get: { verb: 'Get', plural: false },
  show: { verb: 'View', plural: false },
  find: { verb: 'Find', plural: false },
  findone: { verb: 'Get', plural: false },
  findall: { verb: 'List', plural: true },
  list: { verb: 'List', plural: true },
  index: { verb: 'List', plural: true },
  update: { verb: 'Update', plural: false },
  edit: { verb: 'Edit', plural: false },
  patch: { verb: 'Update', plural: false },
  put: { verb: 'Update', plural: false },
  delete: { verb: 'Delete', plural: false },
  remove: { verb: 'Delete', plural: false },
  destroy: { verb: 'Delete', plural: false },
  post: { verb: 'Create', plural: false },
};

const HTTP_VERB_NAMES: Record<string, { verb: string; plural: boolean }> = {
  GET: { verb: 'Get', plural: false },
  POST: { verb: 'Create', plural: false },
  PUT: { verb: 'Update', plural: false },
  PATCH: { verb: 'Update', plural: false },
  DELETE: { verb: 'Delete', plural: false },
};

function singularize(word: string): string {
  if (/ies$/i.test(word)) return word.slice(0, -3) + 'y';
  if (/(ses|xes|shes|ches)$/i.test(word)) return word.slice(0, -2);
  if (/s$/i.test(word) && !/ss$/i.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * Use case name. Descriptive operation names are humanised; CRUD-style and
 * generated handler names borrow the route resource; topic-driven entry points
 * (events, queues, commands, jobs) are named after the topic they listen to.
 */
function useCaseNameFor(op: Operation): string {
  const ep = op.entryPoint;
  if (ep && ep.kind !== 'http' && ep.path && isNonDescriptiveName(op.name)) {
    // "user.created" → "User Created". A cron expression has no words in it, so
    // it is left in the entry point (where the diagram shows it) rather than
    // being mangled into a name like "0 2".
    if (/[A-Za-z]/.test(ep.path)) {
      const words = ep.path.split(/[^A-Za-z0-9]+/).filter(Boolean);
      if (words.length) return humanize(words.join(' '));
    }
    if (ep.kind === 'scheduled') return 'Scheduled job';
  }
  if (ep?.kind === 'http' && ep.path) {
    const crud = CRUD_VERBS[op.name.toLowerCase()] ?? (isNonDescriptiveName(op.name) ? HTTP_VERB_NAMES[ep.method ?? ''] : undefined);
    if (crud) {
      const segments = ep.path.split('/').filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('<'));
      const resource = segments[segments.length - 1];
      if (resource) {
        const hasIdParam = /[:{<]/.test(ep.path.split(resource).pop() ?? '');
        const plural = crud.plural || (crud.verb === 'Get' && !hasIdParam);
        return `${crud.verb} ${humanize(plural ? resource : singularize(resource))}`;
      }
    }
  }
  return humanize(op.name.replace(/_\d+$/, ''));
}

export type { ComponentRole };
