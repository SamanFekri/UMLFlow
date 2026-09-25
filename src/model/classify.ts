import type { CodeFile, CodeSymbol } from '../codemodel/types.js';
import { codeFact, inferredFact, unknownFact, type Provenance } from '../core/provenance.js';
import type { ComponentRole, EntryPoint } from './types.js';

/** Framework annotations that deterministically establish a role. */
const ROLE_ANNOTATIONS: Record<string, ComponentRole> = {
  Controller: 'controller',
  RestController: 'controller',
  ApiController: 'controller',
  Resource: 'controller',
  Path: 'controller',
  Resolver: 'controller',
  WebSocketGateway: 'controller',
  Service: 'service',
  Repository: 'repository',
  Entity: 'entity',
  Table: 'entity',
  Document: 'entity',
  Model: 'entity',
  'dataclass_json': 'model',
};

/** Annotations that establish "this is a managed component" without saying which kind. */
const GENERIC_COMPONENT_ANNOTATIONS = new Set(['Injectable', 'Component', 'Singleton', 'Provider', 'Bean', 'Configuration']);

const NAME_RULES: [RegExp, ComponentRole][] = [
  [/(Controller|Handler|Resource|Router|Endpoint|Api|Resolver|Listener|Consumer|Subscriber|Command|Job|Task|Worker|Cli)$/, 'controller'],
  [/(Service|Manager|UseCase|Interactor|Processor|Orchestrator|Coordinator|Facade|Engine|Workflow)$/, 'service'],
  [/(Repository|Repo|Dao|Store|Mapper|Storage|Persistence)$/, 'repository'],
  [/(Gateway|Client|Adapter|Provider|Connector|Bridge|Proxy|Api[A-Z]\w*Client|Publisher|Producer|Sdk)$/, 'gateway'],
  [/(Entity|Model|Record|Row|Table|Schema)$/, 'entity'],
  [/(Dto|Request|Response|Input|Output|Payload|Params|Options|Config|Props|Event|Message|Command|Query|Result|Error|Exception|Type|Interface|Enum)$/, 'model'],
];

const ORM_BASES = new Set(['Model', 'Base', 'DeclarativeBase', 'BaseModel', 'Document', 'ActiveRecord', 'gorm.Model']);

/** Suffixes stripped when handler functions are grouped into module components. */
export function componentRoleFromSymbol(sym: CodeSymbol, file: CodeFile, hasMethods = true): { role: ComponentRole; provenance: Provenance } {
  const ref = { file: file.path, line: sym.line, symbol: sym.id };
  for (const ann of sym.annotations) {
    const short = ann.name.split('.').pop() ?? ann.name;
    const role = ROLE_ANNOTATIONS[short];
    if (role) return { role, provenance: codeFact([ref], `@${ann.name}`) };
  }
  // ORM base classes: Django models.Model, SQLAlchemy Base, Mongoose-like Document.
  for (const base of sym.extends) {
    if (ORM_BASES.has(base) && (sym.fields.length > 0 || file.language === 'python')) {
      return { role: 'entity', provenance: codeFact([ref], `extends ${base}`) };
    }
  }
  if (sym.kind === 'struct' && sym.fields.some((f) => f.annotations.some((a) => a.name === 'tag' && /\bgorm:/.test(a.args[0] ?? '')))) {
    return { role: 'entity', provenance: codeFact([ref], 'gorm struct tags') };
  }
  if (sym.kind === 'struct' && sym.extends.includes('Model')) {
    return { role: 'entity', provenance: codeFact([ref], 'embeds gorm.Model') };
  }
  for (const [re, role] of NAME_RULES) {
    if (re.test(sym.name)) {
      const generic = sym.annotations.some((a) => GENERIC_COMPONENT_ANNOTATIONS.has(a.name.split('.').pop() ?? ''));
      return { role, provenance: inferredFact([ref], `name suffix${generic ? ' + managed component annotation' : ''}`) };
    }
  }
  if (sym.kind === 'interface' || sym.kind === 'type' || sym.kind === 'enum') {
    return { role: 'model', provenance: inferredFact([ref], `${sym.kind} declaration`) };
  }
  if (sym.annotations.some((a) => GENERIC_COMPONENT_ANNOTATIONS.has(a.name.split('.').pop() ?? ''))) {
    return { role: 'service', provenance: inferredFact([ref], 'managed component annotation without specific role') };
  }
  if (sym.kind === 'class' || sym.kind === 'struct') {
    if (!hasMethods) return { role: 'model', provenance: inferredFact([ref], 'data structure without behaviour') };
    return { role: 'unknown', provenance: unknownFact([ref], 'no annotation or naming convention matched') };
  }
  return { role: 'utility', provenance: inferredFact([ref], 'free function or value') };
}

const HTTP_DECORATORS = new Set(['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all', 'route', 'api_route']);
const SPRING_MAPPINGS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
  RequestMapping: 'ANY',
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH',
  HttpGet: 'GET',
  HttpPost: 'POST',
  HttpPut: 'PUT',
  HttpDelete: 'DELETE',
  HttpPatch: 'PATCH',
  Query: 'GRAPHQL',
  Mutation: 'GRAPHQL',
  Subscription: 'GRAPHQL',
};
const EVENT_ANNOTATIONS = new Set(['OnEvent', 'EventPattern', 'MessagePattern', 'KafkaListener', 'RabbitListener', 'SqsListener', 'EventListener', 'Subscribe', 'SubscribeMessage', 'receiver', 'on']);
const SCHEDULED_ANNOTATIONS = new Set(['Cron', 'Scheduled', 'Interval', 'Timeout', 'periodic_task', 'scheduled_job']);
const CLI_ANNOTATIONS = new Set(['command', 'Command', 'click.command', 'app.command', 'cli.command', 'Option']);

/** Detect an entry point from a method's annotations. `classPrefix` is the controller-level route prefix. */
export function entryPointFromAnnotations(sym: CodeSymbol, file: CodeFile, classPrefix?: string): EntryPoint | undefined {
  const ref = { file: file.path, line: sym.line, symbol: sym.id };
  for (const ann of sym.annotations) {
    const parts = ann.name.split('.');
    const last = parts[parts.length - 1] ?? ann.name;
    const spring = SPRING_MAPPINGS[last];
    if (spring) {
      let p = ann.args[0] ?? ann.named?.path ?? ann.named?.value ?? '';
      let method = spring;
      if (last === 'RequestMapping' && ann.named?.method) method = ann.named.method.replace(/.*\./, '').toUpperCase();
      return { kind: 'http', method, path: joinPath(classPrefix, p), provenance: codeFact([ref], `@${ann.name}`) };
    }
    if (HTTP_DECORATORS.has(last.toLowerCase()) && (parts.length > 1 || /^[A-Z]/.test(last))) {
      // NestJS @Get('/x') (capitalised) or Python @router.get('/x') / @app.route('/x', methods=[...])
      let method = last.toUpperCase();
      if (last.toLowerCase() === 'route' || last.toLowerCase() === 'api_route') {
        const methods = ann.named?.methods;
        method = methods ? methods.replace(/[[\]'"\s]/g, '').split(',')[0]!.toUpperCase() || 'GET' : 'GET';
      }
      return { kind: 'http', method, path: joinPath(classPrefix, ann.args[0] ?? ann.named?.path ?? ''), provenance: codeFact([ref], `@${ann.name}`) };
    }
    if (EVENT_ANNOTATIONS.has(last)) {
      return { kind: 'event', path: ann.args[0], provenance: codeFact([ref], `@${ann.name}`) };
    }
    if (SCHEDULED_ANNOTATIONS.has(last)) {
      return { kind: 'scheduled', path: ann.args[0], provenance: codeFact([ref], `@${ann.name}`) };
    }
    if (CLI_ANNOTATIONS.has(ann.name) || CLI_ANNOTATIONS.has(last)) {
      return { kind: 'cli', path: ann.args[0] ?? sym.name, provenance: codeFact([ref], `@${ann.name}`) };
    }
  }
  return undefined;
}

/** Route prefix from a class-level annotation (@Controller('/x'), @RequestMapping("/x"), @Path("/x")). */
export function routePrefixFromAnnotations(sym: CodeSymbol): string | undefined {
  for (const ann of sym.annotations) {
    const last = ann.name.split('.').pop() ?? ann.name;
    if (['Controller', 'RequestMapping', 'Path', 'Route', 'RoutePrefix', 'ApiController'].includes(last)) {
      const p = ann.args[0] ?? ann.named?.path ?? ann.named?.value ?? ann.named?.prefix;
      if (p && p.startsWith('/')) return p;
      if (p && last === 'Controller') return '/' + p;
    }
  }
  return undefined;
}

export function joinPath(prefix: string | undefined, p: string): string {
  const a = (prefix ?? '').replace(/\/+$/, '');
  let b = p.replace(/^\/+/, '');
  if (!a && !b) return '/';
  if (!b) return a || '/';
  return `${a}/${b}`;
}

const NON_DESCRIPTIVE = new Set(['handle', 'index', 'run', 'execute', 'main', 'post', 'get', 'put', 'delete', 'patch', 'invoke', 'process', 'do', 'call', 'handler', 'exec']);

/** Names generated for inline handlers; they carry no meaning of their own. */
const SYNTHETIC_HANDLER = /^(route|handler|fn|job)_\d+$/i;

export function isNonDescriptiveName(name: string): boolean {
  return NON_DESCRIPTIVE.has(name.toLowerCase()) || SYNTHETIC_HANDLER.test(name);
}
