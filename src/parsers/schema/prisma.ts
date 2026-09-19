import type { AttributeDecl, CodeFile, EntityDecl } from '../../codemodel/types.js';
import { emptyCodeFile } from '../../codemodel/types.js';
import type { LanguageAdapter, ParseContext } from '../adapter.js';

const SCALARS = new Set(['String', 'Int', 'BigInt', 'Float', 'Decimal', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Unsupported']);

/** Prisma schema extractor: models, fields, @id, @unique, @relation, @@map, enums. */
export class PrismaAdapter implements LanguageAdapter {
  readonly id = 'prisma';
  readonly displayName = 'Prisma schema';
  readonly version = 1;
  readonly extensions = ['.prisma'];

  async parse(ctx: ParseContext): Promise<CodeFile> {
    const file = emptyCodeFile(ctx.path, this.id, ctx.hash, 'ok');
    try {
      file.entities = extractPrismaEntities(ctx.text);
    } catch (err) {
      file.status = 'failed';
      file.message = (err as Error).message;
    }
    return file;
  }
}

export function extractPrismaEntities(text: string): EntityDecl[] {
  const lines = text.split('\n');
  const entities: EntityDecl[] = [];
  const enums = new Set<string>();
  const enumRe = /^\s*enum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
  for (const l of lines) {
    const m = l.match(enumRe);
    if (m) enums.add(m[1]!);
  }
  const modelRe = /^\s*model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/;
  let i = 0;
  while (i < lines.length) {
    const m = lines[i]!.match(modelRe);
    if (!m) {
      i++;
      continue;
    }
    const entity: EntityDecl = { name: m[1]!, attributes: [], relations: [], line: i + 1, origin: 'prisma' };
    i++;
    const pendingRelations: { field: string; target: string; isList: boolean; optional: boolean; fkFields: string[] }[] = [];
    for (; i < lines.length && !/^\s*\}/.test(lines[i]!); i++) {
      const raw = lines[i]!.replace(/\/\/.*$/, '').trim();
      if (!raw) continue;
      if (raw.startsWith('@@')) {
        const map = raw.match(/@@map\(\s*"([^"]+)"\s*\)/);
        if (map) entity.table = map[1]!;
        const id = raw.match(/@@id\(\s*\[([^\]]+)\]/);
        if (id) for (const c of id[1]!.split(',')) markPk(entity, c.trim());
        const uniq = raw.match(/@@unique\(\s*\[([^\]]+)\]/);
        if (uniq && uniq[1]!.split(',').length === 1) markUnique(entity, uniq[1]!.trim());
        continue;
      }
      const fm = raw.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*)(\[\])?(\?)?\s*(.*)$/);
      if (!fm) continue;
      const [, name, type, list, optional, rest] = fm;
      const baseType = type!;
      const isRelation = !SCALARS.has(baseType) && !enums.has(baseType);
      if (isRelation) {
        const fields = rest!.match(/@relation\([^)]*fields:\s*\[([^\]]+)\]/);
        pendingRelations.push({ field: name!, target: baseType, isList: !!list, optional: !!optional, fkFields: fields ? fields[1]!.split(',').map((s) => s.trim()) : [] });
        continue;
      }
      const attr: AttributeDecl = { name: name!, type: baseType + (list ? '[]' : ''), nullable: !!optional };
      if (/@id\b/.test(rest!)) attr.primaryKey = true;
      if (/@unique\b/.test(rest!)) attr.unique = true;
      entity.attributes.push(attr);
    }
    for (const rel of pendingRelations) {
      if (rel.fkFields.length > 0) {
        for (const fk of rel.fkFields) {
          const attr = entity.attributes.find((a) => a.name === fk);
          if (attr) attr.foreignKey = { entity: rel.target };
        }
        entity.relations.push({ target: rel.target, kind: 'many-to-one', field: rel.field });
      } else if (rel.isList) {
        entity.relations.push({ target: rel.target, kind: 'one-to-many', field: rel.field });
      } else {
        entity.relations.push({ target: rel.target, kind: 'one-to-one', field: rel.field });
      }
    }
    entities.push(entity);
    i++;
  }
  // Resolve many-to-many: both sides list without fk fields.
  const byName = new Map(entities.map((e) => [e.name, e]));
  for (const e of entities) {
    for (const r of e.relations) {
      if (r.kind !== 'one-to-many') continue;
      const other = byName.get(r.target);
      const back = other?.relations.find((br) => br.target === e.name && br.kind === 'one-to-many');
      if (back) {
        r.kind = 'many-to-many';
        back.kind = 'many-to-many';
      }
    }
  }
  return entities;
}

function markPk(entity: EntityDecl, name: string): void {
  const attr = entity.attributes.find((a) => a.name === name);
  if (attr) attr.primaryKey = true;
}

function markUnique(entity: EntityDecl, name: string): void {
  const attr = entity.attributes.find((a) => a.name === name);
  if (attr) attr.unique = true;
}
