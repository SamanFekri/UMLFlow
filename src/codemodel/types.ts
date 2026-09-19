/**
 * Language-independent Code Model.
 *
 * Language adapters translate ASTs into this representation. Everything
 * downstream (System Model builder, generators) only sees these types, never
 * a language-specific AST. Only facts are stored — never source text beyond
 * identifiers, decorator arguments and string literals needed for routes.
 */

export type SymbolKind =
  | 'class'
  | 'interface'
  | 'struct'
  | 'enum'
  | 'function'
  | 'method'
  | 'variable'
  | 'type'
  | 'module';

export interface Annotation {
  /** Decorator / annotation / attribute name without sigils, e.g. "Controller", "GetMapping", "app.route". */
  name: string;
  /** Literal arguments as strings (string literals unquoted, others as source text), in order. */
  args: string[];
  /** Named arguments where the language supports them (e.g. `path="/x"`). */
  named?: Record<string, string>;
  line: number;
}

export interface Field {
  name: string;
  /** Declared or inferred type name (simple identifier, generics stripped) if known. */
  type?: string;
  /** Simplified generic type arguments, e.g. Repository<Order> → ["Order"]. */
  typeArgs?: string[];
  annotations: Annotation[];
  line: number;
  /** Visibility if the language has it. */
  visibility?: 'public' | 'private' | 'protected' | 'package';
}

export interface Param {
  name: string;
  type?: string;
  typeArgs?: string[];
  annotations: Annotation[];
}

export interface CallSite {
  /**
   * Receiver expression in normalised form, e.g. "this.orders", "orders",
   * "PaymentService", "self.repo", "db.session". Undefined for bare calls.
   */
  receiver?: string;
  /** Called member / function name. */
  name: string;
  line: number;
  argCount: number;
  /** Whether the call is awaited / async where detectable. */
  awaited?: boolean;
  /** True when the receiver is the result of another call (`a.b().c()`); the receiver type is unknown. */
  chained?: boolean;
}

/** A framework-style route registration observed in code, e.g. `router.post('/orders', handler)`. */
export interface RouteRegistration {
  method: string;
  path: string;
  /** Handler symbol name if literally referenced, e.g. "createOrder" or "OrderController.create". */
  handler?: string;
  line: number;
}

export interface CodeSymbol {
  /** Unique id inside a file: "<Name>" for top-level, "<Owner>.<name>" for members. */
  id: string;
  name: string;
  kind: SymbolKind;
  /** Owner id for members. */
  parent?: string;
  line: number;
  endLine: number;
  exported: boolean;
  annotations: Annotation[];
  /** Fields for classes/structs/interfaces; also used by ORM entity extraction. */
  fields: Field[];
  /** Parameters for functions/methods; constructor injection is recorded on the class as fields. */
  params: Param[];
  returnType?: string;
  extends: string[];
  implements: string[];
  /** Calls made from within this symbol's body (methods/functions). */
  calls: CallSite[];
  /** Routes registered inside this symbol (e.g. Express router setup functions). */
  routes?: RouteRegistration[];
  /** Type names referenced in the body (instantiations, static access), used for dependency edges. */
  typeRefs?: string[];
  /** Language-specific flags, e.g. { static: true, async: true, visibility: "public" }. */
  flags?: Record<string, boolean | string>;
}

export interface CodeImport {
  /** Import specifier as written: "./payment", "com.acme.orders.PaymentService", "app.models". */
  source: string;
  /** Imported names (empty for namespace/side-effect imports). */
  names: string[];
  /** Local alias → original mapping when renamed. */
  aliases?: Record<string, string>;
  line: number;
  /** Repo-relative path if resolvable by the adapter (relative imports). */
  resolvedFile?: string;
}

/** Declarative data schema information extracted from SQL, Prisma, ORM models, etc. */
export interface EntityDecl {
  name: string;
  /** Physical table name when known. */
  table?: string;
  attributes: AttributeDecl[];
  relations: RelationDecl[];
  line: number;
  /** "sql" | "prisma" | "typeorm" | "sqlalchemy" | "django" | "jpa" | ... */
  origin: string;
}

export interface AttributeDecl {
  name: string;
  type?: string;
  primaryKey?: boolean;
  nullable?: boolean;
  unique?: boolean;
  foreignKey?: { entity: string; attribute?: string };
}

export type RelationKind = 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many' | 'unknown';

export interface RelationDecl {
  target: string;
  kind: RelationKind;
  /** Attribute/field on which the relation is declared. */
  field?: string;
  /** Join table for many-to-many if known. */
  via?: string;
}

export type ParseStatus = 'ok' | 'partial' | 'failed' | 'unsupported';

export interface CodeFile {
  path: string;
  language: string;
  hash: string;
  status: ParseStatus;
  /** Message when status is partial/failed/unsupported. */
  message?: string;
  symbols: CodeSymbol[];
  imports: CodeImport[];
  /** Module-level routes (e.g. Express `app.get(...)` at top level). */
  routes: RouteRegistration[];
  entities: EntityDecl[];
  /** Module/package name if the language declares one (Java package, Go package). */
  module?: string;
}

export function emptyCodeFile(path: string, language: string, hash: string, status: ParseStatus, message?: string): CodeFile {
  return { path, language, hash, status, message, symbols: [], imports: [], routes: [], entities: [] };
}

export function symbolRefId(file: string, symbolId: string): string {
  return `${file}#${symbolId}`;
}
