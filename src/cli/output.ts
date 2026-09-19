import pc from 'picocolors';
import type { DiagramOutcome, IndexRefreshResult } from '../sync/pipeline.js';
import type { ModelDiff } from '../sync/diff.js';
import { plural } from '../core/text.js';

/** Shared, deterministic console output helpers. */
export class Out {
  constructor(readonly json: boolean, readonly quiet = false) {}

  line(text = ''): void {
    if (!this.json && !this.quiet) console.log(text);
  }

  error(text: string): void {
    console.error(text);
  }

  emitJson(value: unknown): void {
    if (this.json) console.log(JSON.stringify(value, null, 2));
  }

  heading(text: string): void {
    this.line(pc.bold(text));
  }

  indexSummary(index: IndexRefreshResult): void {
    const c = index.sinceSync;
    const parts: string[] = [];
    if (c.added.length) parts.push(`${c.added.length} added`);
    if (c.modified.length) parts.push(`${c.modified.length} modified`);
    if (c.deleted.length) parts.push(`${c.deleted.length} deleted`);
    if (c.renamed.length) parts.push(`${c.renamed.length} renamed`);
    const parsed = index.rebuilt ? `parsed ${plural(index.total, 'file')}` : `re-parsed ${plural(index.parsed, 'file')} of ${index.total}`;
    if (index.noBaseline) this.line(pc.dim(`First synchronisation${index.reason ? ` (${index.reason})` : ''}: ${parsed}.`));
    else if (parts.length) this.line(pc.dim(`Since last sync: ${parts.join(', ')}; ${parsed}.`));
    else this.line(pc.dim(`No source changes since last sync; ${plural(index.total, 'file')} indexed.`));
  }

  outcomes(outcomes: DiagramOutcome[]): void {
    const icon: Record<string, string> = {
      updated: pc.green('✓'),
      created: pc.green('+'),
      unchanged: pc.dim('='),
      skipped: pc.dim('-'),
      stale: pc.yellow('!'),
      missing: pc.yellow('?'),
      fresh: pc.green('✓'),
      error: pc.red('✗'),
    };
    const groups: [string, string][] = [
      ['updated', 'Updated'],
      ['created', 'Created'],
      ['stale', 'Stale'],
      ['missing', 'Missing'],
      ['error', 'Errors'],
      ['unchanged', 'Unchanged (regenerated, no difference)'],
      ['fresh', 'Fresh'],
      ['skipped', 'Not affected'],
    ];
    for (const [status, title] of groups) {
      const items = outcomes.filter((o) => o.status === status);
      if (!items.length) continue;
      this.line(`${title}:`);
      for (const o of items) {
        const reason = o.reason && status !== 'skipped' ? pc.dim(` (${o.reason})`) : '';
        this.line(`  ${icon[status]} ${o.name} ${pc.dim(o.type)}${reason}`);
        for (const n of o.notes ?? []) {
          if (n.level === 'info') continue;
          this.line(`      ${n.level === 'unknown' ? pc.yellow('?') : pc.cyan('≈')} ${n.text}`);
        }
      }
    }
  }

  modelDiff(diff: ModelDiff): void {
    if (diff.isEmpty) {
      this.line(pc.dim('No architecture changes.'));
      return;
    }
    for (const a of diff.added) this.line(`  ${pc.green('+')} ${a}`);
    for (const c of diff.changed) this.line(`  ${pc.yellow('~')} ${c}`);
    for (const r of diff.removed) this.line(`  ${pc.red('-')} ${r}`);
  }
}
