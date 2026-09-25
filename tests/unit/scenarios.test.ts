import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanup, tempRepo } from '../helpers.js';
import { initProject } from '../../src/config/init.js';
import { Umlflow } from '../../src/sync/pipeline.js';
import { planScenarios, uncoveredUseCases } from '../../src/sync/scenarios.js';
import { buildCoverage, validateDiagrams } from '../../src/sync/coverage.js';

let root: string | null = null;
afterEach(async () => {
  if (root) await cleanup(root);
  root = null;
});

/** Every name a diagram draws: participants, use case nodes, actors, entities. */
function names(mermaid: string): string[] {
  const out: string[] = [];
  for (const line of mermaid.split('\n')) {
    const as = line.match(/^\s*(?:participant|actor)\s+\S+\s+as\s+(.+)$/);
    if (as) out.push(as[1]!.trim());
    const node = line.match(/\(\["(.+?)"\]\)/);
    if (node) out.push(node[1]!.trim());
    const alias = line.match(/\["(.+?)"\]\s*\{/);
    if (alias) out.push(alias[1]!.trim());
  }
  return out;
}

describe('diagram names are clean', () => {
  it('never appends "?" or "??" to any name in any diagram type or language', async () => {
    for (const fixture of ['ts-shop', 'py-shop', 'java-shop', 'go-shop'] as const) {
      root = await tempRepo(fixture, { git: true });
      await initProject({ root, diagramTypes: ['usecase', 'sequence', 'erd'] });
      const engine = await Umlflow.open(root);
      await engine.update();
      for (const [name, def] of Object.entries(engine.getConfig().diagrams)) {
        const g = await engine.generateDiagram(name, def);
        for (const n of names(g.block)) {
          expect(n, `${fixture}/${name} drew the name "${n}"`).not.toMatch(/\s\?{1,2}$/);
        }
        // The uncertainty itself is not discarded — it moves into the notes.
        expect(g.block).not.toMatch(/Unknown actor \?\?/);
      }
      await cleanup(root);
      root = null;
    }
  });

  it('keeps the uncertainty visible in notes instead of in the name', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const md = await fs.readFile(path.join(root, '.umlflow/diagrams/main-flows.md'), 'utf8');
    expect(md).toContain('Create Order');
    expect(md).not.toContain('Create Order ?');
    expect(md).toMatch(/Uncertain name: Create Order — named by heuristic/);
  });

  it('restores the markers when output.uncertaintyMarkers is opted back in', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['usecase'] });
    const cfg = path.join(root, '.umlflow/config.yaml');
    await fs.writeFile(cfg, (await fs.readFile(cfg, 'utf8')).replace(/^  uncertaintyMarkers: false$/m, '  uncertaintyMarkers: true'));
    const engine = await Umlflow.open(root);
    await engine.update({ force: true });
    const md = await fs.readFile(path.join(root, '.umlflow/diagrams/system-usecases.md'), 'utf8');
    expect(md).toContain('Create Order ?');
  });
});

describe('one sequence diagram per use case', () => {
  it('defines a separate, entry-point-pinned scenario for every use case', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    const plans = await engine.defineScenarios();

    expect(plans.map((p) => p.name)).toEqual(['login-sequence', 'create-order-sequence', 'get-order-sequence']);
    for (const p of plans) {
      expect(p.definition.type).toBe('sequence');
      // Pinned to exactly one entry point, so unrelated use cases can never merge in.
      expect(p.definition.scope!.entryPoints).toEqual([p.entryOperation]);
    }
    expect(plans.map((p) => p.entryOperation)).toEqual(['AuthController.login', 'OrderController.create', 'OrderController.get']);
  });

  it('draws only the components that participate in that scenario', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.defineScenarios();
    await engine.update({ all: true });

    const login = await fs.readFile(path.join(root, '.umlflow/diagrams/login-sequence.md'), 'utf8');
    expect(login).toContain('AuthService');
    expect(login).toContain('SessionManager');
    // The checkout half of the system must not leak into the login scenario.
    expect(login).not.toContain('PaymentGateway');
    expect(login).not.toContain('InventoryService');
    expect(login).not.toContain('OrderRepository');

    const checkout = await fs.readFile(path.join(root, '.umlflow/diagrams/create-order-sequence.md'), 'utf8');
    expect(checkout).toContain('PaymentGateway');
    expect(checkout).toContain('InventoryService');
    expect(checkout).not.toContain('SessionManager');
    expect(checkout).not.toContain('AuthService');

    // The smallest scenario stays small: 4 participants, not the whole system.
    const get = await fs.readFile(path.join(root, '.umlflow/diagrams/get-order-sequence.md'), 'utf8');
    expect(get).toContain('OrderRepository');
    expect(get).not.toContain('PaymentService');
    expect(get).not.toContain('AuthController');
  });

  it('is idempotent: re-running recognises scenarios by entry point, not by name', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.defineScenarios();
    const again = await engine.defineScenarios();
    expect(again.every((p) => p.exists)).toBe(true);
    expect(Object.keys(engine.getConfig().diagrams).filter((n) => n.endsWith('-sequence'))).toHaveLength(3);
  });

  it('reports use cases that have no scenario diagram', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    const model = await engine.getModel();
    expect(uncoveredUseCases(model, engine.getConfig().diagrams)).toHaveLength(3);
    const planned = planScenarios(model, { existing: {} });
    expect(planned).toHaveLength(model.useCases.length);
    await engine.defineScenarios();
    expect(uncoveredUseCases(model, engine.getConfig().diagrams)).toHaveLength(0);
  });
});

describe('coverage and validation', () => {
  it('reports what was analysed and what produced no structure', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['usecase', 'sequence', 'erd'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const model = await engine.getModel();
    const c = buildCoverage(model, engine.getConfig().diagrams, new Set(model.components.map((x) => x.id)));

    expect(c.files.total).toBeGreaterThan(0);
    expect(c.entryPoints.total).toBe(3);
    expect(c.entryPoints.byKind.http).toBe(3);
    expect(c.useCases.total).toBe(3);
    // Before `scenarios` runs, no use case has its own diagram.
    expect(c.useCases.withoutScenario).toHaveLength(3);
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThanOrEqual(1);
  });

  it('flags a use case with no scenario, and clears once scenarios exist', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    let model = await engine.getModel();
    let c = buildCoverage(model, engine.getConfig().diagrams, new Set());
    let issues = validateDiagrams(model, [], c);
    expect(issues.filter((i) => i.code === 'usecase-without-scenario')).toHaveLength(3);

    await engine.defineScenarios();
    model = await engine.getModel();
    c = buildCoverage(model, engine.getConfig().diagrams, new Set());
    issues = validateDiagrams(model, [], c);
    expect(issues.filter((i) => i.code === 'usecase-without-scenario')).toHaveLength(0);
  });

  it('raises an error when a name carries an uncertainty marker', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['usecase'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const model = await engine.getModel();
    const c = buildCoverage(model, engine.getConfig().diagrams, new Set());

    const clean = validateDiagrams(model, [{ name: 'd', type: 'usecase', rendered: '  uc_x(["Create Order"])', modelIds: [] }], c);
    expect(clean.filter((i) => i.code === 'name-uncertainty-marker')).toHaveLength(0);

    const dirty = validateDiagrams(model, [{ name: 'd', type: 'usecase', rendered: '  uc_x(["Create Order ?"])\n  participant p as UserService ??', modelIds: [] }], c);
    const errors = dirty.filter((i) => i.code === 'name-uncertainty-marker');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.level).toBe('error');
  });

  it('warns when a diagram draws an id that is not in the model', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const model = await engine.getModel();
    const c = buildCoverage(model, engine.getConfig().diagrams, new Set());
    const issues = validateDiagrams(model, [{ name: 'd', type: 'sequence', rendered: '', modelIds: ['TotallyMadeUpService'] }], c);
    expect(issues.some((i) => i.code === 'unbacked-id' && i.message.includes('TotallyMadeUpService'))).toBe(true);
  });
});
