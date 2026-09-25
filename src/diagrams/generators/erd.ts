import { humanize } from '../../core/text.js';
import type { DiagramGenerator, GenerateContext, GenerateResult } from '../generator.js';
import type { Cardinality, DiagramNote, ErDiagram, ErdAttribute } from '../ir.js';
import { OverrideHelper } from '../overrides.js';
import { entityInScope } from '../scope.js';
import { extractEntity } from '../../model/entities/extract.js';
import type { CodeFile } from '../../codemodel/types.js';

/** Entity–relationship diagram from every recognised schema source. */
export class ErdGenerator implements DiagramGenerator {
  readonly type = 'erd';
  readonly displayName = 'Entity Relationship';

  isFileRelevant(file: CodeFile): boolean {
    return file.entities.length > 0 || file.symbols.some((s) => !s.parent && extractEntity(s, file) !== null);
  }

  generate(ctx: GenerateContext): GenerateResult {
    const { model, scope, definition, name } = ctx;
    const ov = new OverrideHelper(definition);
    const notes: DiagramNote[] = [];
    const files = new Set<string>();
    const modelIds = new Set<string>();
    const diagram: ErDiagram = {
      name,
      type: 'erd',
      title: humanize(name),
      description: definition.description,
      notes,
      rawLines: ov.rawLines,
      styleLines: ov.styleLines,
      uncertaintyMarkers: ctx.uncertaintyMarkers,
      entities: [],
      relations: [],
    };
    const included = new Map<string, string>(); // entity id → canonical (alias) id
    let stubs = 0;
    for (const e of model.entities) {
      if (!entityInScope(e, scope) || ov.isExcluded(e.id, e.name)) continue;
      const canonical = ov.canonical(e.id);
      included.set(e.id, canonical);
      if (diagram.entities.some((d) => d.id === canonical)) continue;
      modelIds.add(e.id);
      for (const r of e.provenance.refs) files.add(r.file);
      if (e.provenance.confidence === 'unknown') stubs++;
      const attributes: ErdAttribute[] = e.attributes.map((a) => {
        const keys: ErdAttribute['keys'] = [];
        if (a.primaryKey) keys.push('PK');
        if (a.foreignKey) keys.push('FK');
        if (a.unique && !a.primaryKey) keys.push('UK');
        const comment = a.foreignKey ? `→ ${a.foreignKey.entity}${a.foreignKey.attribute ? '.' + a.foreignKey.attribute : ''}` : a.nullable === false && !a.primaryKey ? 'not null' : undefined;
        return { name: a.name, type: a.type ?? (a.foreignKey ? 'ref' : undefined), keys, comment };
      });
      diagram.entities.push({ id: canonical, label: ov.label(e.id, e.name === canonical ? e.name : ov.label(canonical, e.name)), attributes, confidence: e.provenance.confidence });
    }
    const seen = new Set<string>();
    for (const r of model.relations) {
      const from = included.get(r.from);
      const to = included.get(r.to);
      if (!from || !to) continue;
      const key = `${from}|${to}|${r.kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = r.fromField ? ov.label(`${r.from}.${r.fromField}`, r.fromField) : r.kind === 'many-to-one' ? 'belongs to' : r.kind === 'many-to-many' ? 'linked to' : 'has';
      diagram.relations.push({ from, to, cardinality: r.kind as Cardinality, label, confidence: r.provenance.confidence });
    }
    for (const rel of ov.relationships) {
      const from = diagram.entities.find((e) => e.id === rel.from || e.label === rel.from)?.id;
      const to = diagram.entities.find((e) => e.id === rel.to || e.label === rel.to)?.id;
      if (!from || !to) continue;
      diagram.relations.push({ from, to, cardinality: (rel.kind as Cardinality) ?? 'unknown', label: rel.label ?? 'relates to', confidence: 'declared' });
    }
    diagram.entities.sort((a, b) => a.id.localeCompare(b.id));
    diagram.relations.sort((a, b) => `${a.from}|${a.to}`.localeCompare(`${b.from}|${b.to}`));
    if (stubs > 0) notes.push({ level: 'unknown', text: `${stubs} entity(ies) are referenced by relations but never defined in analysed sources (marked "??").` });
    if (diagram.entities.length === 0) notes.push({ level: 'info', text: 'No entities found. UMLFlow understands SQL DDL, Prisma, TypeORM, JPA, SQLAlchemy, Django and GORM models.' });
    return { diagram, files: [...files].sort(), modelIds: [...modelIds].sort() };
  }
}
