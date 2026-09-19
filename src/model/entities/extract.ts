import type { AttributeDecl, CodeFile, CodeSymbol, EntityDecl, Field, RelationKind } from '../../codemodel/types.js';

/**
 * ORM entity extractors. Each takes a class-like symbol and, when it
 * recognises the framework, returns a normalised EntityDecl. All extractors
 * work purely on the Code Model (annotations, fields, base classes).
 */

export interface EntityExtractor {
  id: string;
  extract(sym: CodeSymbol, file: CodeFile): EntityDecl | null;
}

function ann(field: Field | CodeSymbol, ...names: string[]) {
  return field.annotations.find((a) => names.includes(a.name.split('.').pop() ?? a.name));
}

function relationKindFromAnnotation(name: string): RelationKind | null {
  switch (name) {
    case 'ManyToOne':
      return 'many-to-one';
    case 'OneToMany':
      return 'one-to-many';
    case 'OneToOne':
      return 'one-to-one';
    case 'ManyToMany':
      return 'many-to-many';
    default:
      return null;
  }
}

/** TypeORM (TypeScript) and JPA/Hibernate (Java) share the same annotation vocabulary. */
export const decoratorOrmExtractor: EntityExtractor = {
  id: 'decorator-orm',
  extract(sym, file) {
    const entityAnn = ann(sym, 'Entity');
    if (!entityAnn || (sym.kind !== 'class')) return null;
    const table = ann(sym, 'Table')?.named?.name ?? ann(sym, 'Table')?.args[0] ?? entityAnn.named?.name ?? (entityAnn.args[0] && !entityAnn.args[0].startsWith('{') ? entityAnn.args[0] : undefined) ?? tableFromObjectArg(entityAnn.args[0]);
    const decl: EntityDecl = { name: sym.name, table, attributes: [], relations: [], line: sym.line, origin: file.language === 'java' ? 'jpa' : 'typeorm' };
    for (const f of sym.fields) {
      const rel = f.annotations.map((a) => relationKindFromAnnotation(a.name.split('.').pop() ?? a.name)).find((k): k is RelationKind => k !== null);
      if (rel) {
        const target = f.type ?? f.typeArgs?.[0] ?? targetFromArrow(f);
        if (target) {
          decl.relations.push({ target, kind: rel, field: f.name });
          const join = ann(f, 'JoinColumn');
          if (rel === 'many-to-one' || (rel === 'one-to-one' && join)) {
            const explicit = join?.named?.name ?? (join?.args[0] && !join.args[0].startsWith('{') ? join.args[0] : tableFromObjectArg(join?.args[0]));
            const col = explicit ?? `${f.name}_id`;
            decl.attributes.push({ name: col, type: 'fk', foreignKey: { entity: target }, nullable: true });
          }
        }
        continue;
      }
      const isColumn = ann(f, 'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn', 'Id', 'GeneratedValue', 'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn', 'VersionColumn', 'ObjectIdColumn', 'EmbeddedId');
      if (!isColumn && file.language !== 'java') continue;
      if (!isColumn && (f.visibility === 'public' || (f.type && /^[A-Z]/.test(f.type) && !isJavaScalar(f.type)))) continue;
      if (!isColumn && !f.type) continue;
      const attr: AttributeDecl = { name: columnName(f), type: f.type };
      if (ann(f, 'PrimaryColumn', 'PrimaryGeneratedColumn', 'Id', 'ObjectIdColumn', 'EmbeddedId')) attr.primaryKey = true;
      const col = ann(f, 'Column');
      if (col?.named?.unique === 'true' || /unique:\s*true/.test(col?.args[0] ?? '')) attr.unique = true;
      if (col?.named?.nullable === 'false' || /nullable:\s*false/.test(col?.args[0] ?? '')) attr.nullable = false;
      else if (col?.named?.nullable === 'true' || /nullable:\s*true/.test(col?.args[0] ?? '')) attr.nullable = true;
      decl.attributes.push(attr);
    }
    return decl;
  },
};

function isJavaScalar(t: string): boolean {
  return ['String', 'Long', 'Integer', 'Boolean', 'Double', 'Float', 'BigDecimal', 'LocalDate', 'LocalDateTime', 'Instant', 'UUID', 'Date', 'Short', 'Byte', 'Character', 'Timestamp', 'OffsetDateTime', 'ZonedDateTime'].includes(t);
}

function columnName(f: Field): string {
  const col = ann(f, 'Column');
  const explicit = col?.named?.name ?? (col?.args[0]?.startsWith('{') ? tableFromObjectArg(col.args[0]) : undefined);
  return explicit ?? f.name;
}

function tableFromObjectArg(arg: string | undefined): string | undefined {
  if (!arg) return undefined;
  const m = arg.match(/name:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : undefined;
}

function targetFromArrow(f: Field): string | undefined {
  for (const a of f.annotations) {
    const m = a.args[0]?.match(/=>\s*([A-Z][A-Za-z0-9_]*)/);
    if (m) return m[1];
  }
  return undefined;
}

/** SQLAlchemy declarative models: `x = Column(Integer, ForeignKey("t.id"), primary_key=True)` + relationship(). */
export const sqlalchemyExtractor: EntityExtractor = {
  id: 'sqlalchemy',
  extract(sym, file) {
    if (file.language !== 'python') return null;
    const columns = sym.fields.filter((f) => f.annotations.some((a) => /^(sa\.|sqlalchemy\.|db\.)?(Column|mapped_column)$/.test(a.name)));
    if (columns.length === 0) return null;
    const tableField = sym.fields.find((f) => f.name === '__tablename__');
    const decl: EntityDecl = { name: sym.name, attributes: [], relations: [], line: sym.line, origin: 'sqlalchemy' };
    const literal = tableField?.annotations.find((a) => a.name === 'literal')?.args[0];
    if (literal) decl.table = literal;
    for (const f of columns) {
      const col = f.annotations.find((a) => /(Column|mapped_column)$/.test(a.name))!;
      const attr: AttributeDecl = { name: f.name, type: col.args.find((a) => !/ForeignKey/.test(a)) ?? f.type };
      if (col.named?.primary_key === 'True') attr.primaryKey = true;
      if (col.named?.unique === 'True') attr.unique = true;
      if (col.named?.nullable === 'False' || attr.primaryKey) attr.nullable = false;
      else if (col.named?.nullable === 'True') attr.nullable = true;
      const fk = col.args.map((a) => a.match(/ForeignKey\(["']([^"']+)["']/)).find(Boolean);
      if (fk) {
        const [table, column] = fk[1]!.split('.');
        attr.foreignKey = { entity: table!, attribute: column };
        decl.relations.push({ target: table!, kind: 'many-to-one', field: f.name });
      }
      decl.attributes.push(attr);
    }
    for (const f of sym.fields) {
      const rel = f.annotations.find((a) => /(^|\.)relationship$/.test(a.name));
      if (!rel) continue;
      const target = rel.args[0];
      if (!target) continue;
      const hasFk = decl.relations.some((r) => r.field !== f.name && r.target.toLowerCase().replace(/s$/, '') === target.toLowerCase());
      if (hasFk) continue; // already represented by the FK column relation
      const kind: RelationKind = rel.named?.uselist === 'False' ? 'one-to-one' : rel.named?.secondary ? 'many-to-many' : 'one-to-many';
      decl.relations.push({ target, kind, field: f.name, via: rel.named?.secondary });
    }
    return decl;
  },
};

/** Django models: class X(models.Model) with models.*Field assignments. */
export const djangoExtractor: EntityExtractor = {
  id: 'django',
  extract(sym, file) {
    if (file.language !== 'python') return null;
    if (!sym.extends.some((b) => b === 'Model' || b.endsWith('.Model'))) return null;
    const fields = sym.fields.filter((f) => f.annotations.some((a) => /Field$/.test(a.name)));
    if (fields.length === 0) return null;
    const decl: EntityDecl = { name: sym.name, attributes: [], relations: [], line: sym.line, origin: 'django' };
    const meta = sym.annotations.find((a) => a.name === 'Meta.db_table');
    if (meta?.args[0]) decl.table = meta.args[0];
    let hasPk = false;
    for (const f of fields) {
      const a = f.annotations.find((x) => /Field$/.test(x.name))!;
      const kind = a.name.split('.').pop()!;
      if (kind === 'ForeignKey' || kind === 'OneToOneField' || kind === 'ManyToManyField') {
        const target = (a.args[0] ?? a.named?.to ?? '').replace(/^['"]|['"]$/, '').split('.').pop() ?? '';
        if (!target) continue;
        const relKind: RelationKind = kind === 'ForeignKey' ? 'many-to-one' : kind === 'OneToOneField' ? 'one-to-one' : 'many-to-many';
        decl.relations.push({ target: target === 'self' ? sym.name : target, kind: relKind, field: f.name });
        if (relKind !== 'many-to-many') decl.attributes.push({ name: `${f.name}_id`, type: 'fk', foreignKey: { entity: target }, nullable: a.named?.null === 'True' });
        continue;
      }
      const attr: AttributeDecl = { name: f.name, type: kind.replace(/Field$/, '') };
      if (a.named?.primary_key === 'True') {
        attr.primaryKey = true;
        hasPk = true;
      }
      if (a.named?.unique === 'True') attr.unique = true;
      attr.nullable = a.named?.null === 'True';
      decl.attributes.push(attr);
    }
    if (!hasPk) decl.attributes.unshift({ name: 'id', type: 'AutoField', primaryKey: true, nullable: false });
    return decl;
  },
};

/** GORM structs (Go): tagged fields, embedded gorm.Model. */
export const gormExtractor: EntityExtractor = {
  id: 'gorm',
  extract(sym, file) {
    if (file.language !== 'go' || sym.kind !== 'struct') return null;
    const hasGorm = sym.extends.includes('Model') || sym.fields.some((f) => f.annotations.some((a) => a.name === 'tag' && /\bgorm:/.test(a.args[0] ?? '')));
    if (!hasGorm) return null;
    const decl: EntityDecl = { name: sym.name, attributes: [], relations: [], line: sym.line, origin: 'gorm' };
    if (sym.extends.includes('Model')) decl.attributes.push({ name: 'ID', type: 'uint', primaryKey: true, nullable: false });
    for (const f of sym.fields) {
      const tag = f.annotations.find((a) => a.name === 'tag')?.args[0] ?? '';
      if (f.type && /^[A-Z]/.test(f.type) && !['Time', 'DeletedAt', 'NullString', 'NullInt64'].includes(f.type)) {
        const isSlice = /\[\]/.test(f.type) || sym.fields.some(() => false);
        decl.relations.push({ target: f.type, kind: isSlice ? 'one-to-many' : 'many-to-one', field: f.name });
        continue;
      }
      const attr: AttributeDecl = { name: f.name, type: f.type };
      if (/primaryKey|primary_key/.test(tag)) attr.primaryKey = true;
      if (/unique/.test(tag)) attr.unique = true;
      if (/not null/.test(tag)) attr.nullable = false;
      decl.attributes.push(attr);
    }
    return decl;
  },
};

export const DEFAULT_ENTITY_EXTRACTORS: EntityExtractor[] = [decoratorOrmExtractor, sqlalchemyExtractor, djangoExtractor, gormExtractor];

export function extractEntity(sym: CodeSymbol, file: CodeFile, extractors = DEFAULT_ENTITY_EXTRACTORS): EntityDecl | null {
  for (const ex of extractors) {
    const decl = ex.extract(sym, file);
    if (decl) return decl;
  }
  return null;
}
