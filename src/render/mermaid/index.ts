import type { ComponentDiagram, Diagram, ErDiagram, SequenceDiagram, SequenceElement, UseCaseDiagram } from '../../diagrams/ir.js';
import { mermaidId } from '../../core/text.js';
import type { Renderer } from '../renderer.js';

/**
 * Mermaid renderer. Mermaid has no native use case diagram, so use cases are
 * rendered as a flowchart with actors outside a "system" boundary subgraph.
 */
export class MermaidRenderer implements Renderer {
  readonly id = 'mermaid';
  readonly extension = 'mmd';
  readonly fenceLanguage = 'mermaid';
  readonly commentPrefix = '%%';

  supports(type: string): boolean {
    return type === 'usecase' || type === 'sequence' || type === 'erd' || type === 'component';
  }

  render(diagram: Diagram): string {
    switch (diagram.type) {
      case 'usecase':
        return renderUseCase(diagram as UseCaseDiagram);
      case 'sequence':
        return renderSequence(diagram as SequenceDiagram);
      case 'erd':
        return renderErd(diagram as ErDiagram);
      case 'component':
        return renderComponent(diagram as ComponentDiagram);
      default:
        throw new Error(`Mermaid renderer does not support diagram type "${diagram.type}"`);
    }
  }
}

function esc(text: string): string {
  return text.replace(/"/g, '#quot;');
}

function tail(diagram: Diagram): string[] {
  const lines: string[] = [];
  if (diagram.styleLines.length) lines.push(...diagram.styleLines.map((l) => `  ${l}`));
  if (diagram.rawLines.length) lines.push(...diagram.rawLines.map((l) => `  ${l}`));
  return lines;
}

/**
 * Uncertainty suffix for a label. Empty unless the diagram opted in via
 * `output.uncertaintyMarkers`: a name like "UserService?" is not a name, and
 * downstream tools treat it as a different entity. Uncertainty is reported in
 * the diagram notes and by `umlflow validate` instead.
 */
function confidenceMark(confidence: string, enabled: boolean | undefined): string {
  if (!enabled) return '';
  return confidence === 'inferred' ? ' ?' : confidence === 'unknown' ? ' ??' : '';
}

function renderUseCase(d: UseCaseDiagram): string {
  const lines: string[] = ['flowchart LR'];
  for (const a of d.actors) {
    lines.push(`  ${mermaidId('actor_' + a.id)}(["👤 ${esc(a.label)}${confidenceMark(a.confidence, d.uncertaintyMarkers)}"])`);
  }
  const grouped = new Set(Object.values(d.groups).flat());
  lines.push(`  subgraph ${mermaidId('system')} ["${esc(d.systemName)}"]`);
  lines.push('    direction TB');
  for (const [group, members] of Object.entries(d.groups)) {
    lines.push(`    subgraph ${mermaidId('group_' + group)} ["${esc(group)}"]`);
    for (const id of members) {
      const uc = d.useCases.find((u) => u.id === id);
      if (uc) lines.push(`      ${mermaidId('uc_' + uc.id)}(["${esc(uc.label)}${confidenceMark(uc.confidence, d.uncertaintyMarkers)}"])`);
    }
    lines.push('    end');
  }
  for (const uc of d.useCases) {
    if (grouped.has(uc.id)) continue;
    lines.push(`    ${mermaidId('uc_' + uc.id)}(["${esc(uc.label)}${confidenceMark(uc.confidence, d.uncertaintyMarkers)}"])`);
  }
  lines.push('  end');
  for (const assoc of d.associations) {
    const arrow = assoc.confidence === 'deterministic' || assoc.confidence === 'declared' ? '-->' : '-.->';
    lines.push(`  ${mermaidId('actor_' + assoc.actor)} ${arrow} ${mermaidId('uc_' + assoc.useCase)}`);
  }
  for (const rel of d.relations) {
    const label = rel.label ?? (rel.kind === 'include' ? '«include»' : rel.kind === 'extend' ? '«extend»' : '');
    lines.push(`  ${mermaidId('uc_' + rel.from)} -.->|${esc(label)}| ${mermaidId('uc_' + rel.to)}`);
  }
  lines.push(...tail(d));
  return lines.join('\n') + '\n';
}

function renderSequence(d: SequenceDiagram): string {
  const lines: string[] = ['sequenceDiagram'];
  if (d.title) lines.push(`  title ${d.title}`);
  lines.push('  autonumber');
  const groups = new Map<string, typeof d.participants>();
  for (const p of d.participants) {
    if (!p.group) continue;
    const list = groups.get(p.group) ?? [];
    list.push(p);
    groups.set(p.group, list);
  }
  const declare = (p: (typeof d.participants)[number], indent: string): void => {
    const keyword = p.kind === 'actor' ? 'actor' : 'participant';
    const label = p.kind === 'database' ? `🗄 ${p.label}` : p.kind === 'external' ? `☁ ${p.label}` : p.label;
    lines.push(`${indent}${keyword} ${mermaidId(p.id)} as ${esc(label)}`);
  };
  // Keep declaration order: actors and participants in first-appearance order, groups where their first member appears.
  const emitted = new Set<string>();
  for (const p of d.participants) {
    if (emitted.has(p.id)) continue;
    if (p.group) {
      lines.push(`  box ${esc(p.group)}`);
      for (const member of groups.get(p.group) ?? []) {
        declare(member, '    ');
        emitted.add(member.id);
      }
      lines.push('  end');
    } else {
      declare(p, '  ');
      emitted.add(p.id);
    }
  }
  renderSequenceElements(d.elements, lines, '  ', d.uncertaintyMarkers);
  lines.push(...tail(d));
  return lines.join('\n') + '\n';
}

function renderSequenceElements(elements: SequenceElement[], lines: string[], indent: string, markers?: boolean): void {
  for (const el of elements) {
    if (el.kind === 'message') {
      const arrow = el.reply ? '-->>' : el.async ? '-)' : '->>';
      lines.push(`${indent}${mermaidId(el.from)}${arrow}${mermaidId(el.to)}: ${esc(el.label)}${confidenceMark(el.confidence, markers)}`);
    } else if (el.kind === 'note') {
      const over = el.over.map(mermaidId).join(',');
      lines.push(`${indent}Note over ${over}: ${esc(el.text)}`);
    } else {
      lines.push(`${indent}${el.op === 'group' ? 'rect rgb(245, 245, 245)' : `${el.op} ${esc(el.label)}`}`);
      if (el.op === 'group') lines.push(`${indent}  Note over ${el.body.length ? firstParticipant(el.body) : ''}: ${esc(el.label)}`);
      renderSequenceElements(el.body, lines, indent + '  ', markers);
      for (const branch of el.branches ?? []) {
        lines.push(`${indent}else ${esc(branch.label)}`);
        renderSequenceElements(branch.body, lines, indent + '  ', markers);
      }
      lines.push(`${indent}end`);
    }
  }
}

function firstParticipant(body: SequenceElement[]): string {
  for (const el of body) {
    if (el.kind === 'message') return mermaidId(el.from);
    if (el.kind === 'note') return el.over.map(mermaidId).join(',');
    const inner = firstParticipant(el.body);
    if (inner) return inner;
  }
  return '';
}

/** Node shape carries the kind: [] component, [()] datastore, {{}} external. */
function componentShape(node: ComponentDiagram['nodes'][number], label: string): string {
  if (node.kind === 'datastore') return `[("${label}")]`;
  if (node.kind === 'external') return `{{"${label}"}}`;
  return `["${label}"]`;
}

function renderComponent(d: ComponentDiagram): string {
  const lines: string[] = ['flowchart TB'];
  const grouped = new Set(Object.values(d.groups).flat());
  const byId = new Map(d.nodes.map((n) => [n.id, n]));
  const declare = (id: string, indent: string): void => {
    const node = byId.get(id);
    if (!node) return;
    const label = `${esc(node.label)}${confidenceMark(node.confidence, d.uncertaintyMarkers)}`;
    lines.push(`${indent}${mermaidId(node.id)}${componentShape(node, label)}`);
  };
  for (const [group, members] of Object.entries(d.groups)) {
    lines.push(`  subgraph ${mermaidId('layer_' + group)} ["${esc(group)}"]`);
    lines.push('    direction TB');
    for (const id of members) declare(id, '    ');
    lines.push('  end');
  }
  for (const node of d.nodes) {
    if (grouped.has(node.id)) continue;
    declare(node.id, '  ');
  }
  for (const e of d.edges) {
    // Inferred relationships are dotted; direct evidence is solid.
    const arrow = e.confidence === 'deterministic' || e.confidence === 'declared' ? '-->' : '-.->';
    const label = e.label ?? e.kind;
    lines.push(`  ${mermaidId(e.from)} ${arrow}|${esc(label)}| ${mermaidId(e.to)}`);
  }
  lines.push(...tail(d));
  return lines.join('\n') + '\n';
}

const CARDINALITY: Record<string, string> = {
  'one-to-one': '||--||',
  'one-to-many': '||--o{',
  'many-to-one': '}o--||',
  'many-to-many': '}o--o{',
  unknown: '..',
};

function renderErd(d: ErDiagram): string {
  const lines: string[] = ['erDiagram'];
  for (const e of d.entities) {
    const id = mermaidId(e.id);
    const mark = confidenceMark(e.confidence, d.uncertaintyMarkers);
    const alias = e.label !== e.id ? `["${esc(e.label)}${mark}"]` : mark ? `["${esc(e.label)}${mark}"]` : '';
    if (e.attributes.length === 0) {
      lines.push(`  ${id}${alias} {`);
      lines.push('  }');
      continue;
    }
    lines.push(`  ${id}${alias} {`);
    for (const a of e.attributes) {
      const type = erdType(a.type);
      const keys = a.keys.length ? ' ' + a.keys.join(', ') : '';
      const comment = a.comment ? ` "${esc(a.comment)}"` : '';
      lines.push(`    ${type} ${erdName(a.name)}${keys}${comment}`);
    }
    lines.push('  }');
  }
  for (const r of d.relations) {
    const conn = CARDINALITY[r.cardinality] ?? CARDINALITY.unknown;
    lines.push(`  ${mermaidId(r.from)} ${conn} ${mermaidId(r.to)} : "${esc(r.label)}${confidenceMark(r.confidence, d.uncertaintyMarkers)}"`);
  }
  lines.push(...tail(d));
  return lines.join('\n') + '\n';
}

function erdType(type: string | undefined): string {
  if (!type) return 'unknown';
  // Mermaid attribute types allow letters, digits, underscore, brackets and parentheses without spaces.
  const t = type.replace(/\s*,\s*/g, ',').replace(/\s+/g, '_').replace(/[^A-Za-z0-9_()[\],.]/g, '');
  return t || 'unknown';
}

function erdName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, '_');
}
