import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanup, tempRepo, analyzeFixture } from '../helpers.js';
import { initProject } from '../../src/config/init.js';
import { Umlflow } from '../../src/sync/pipeline.js';
import { matchEntryVerb } from '../../src/parsers/entrypatterns.js';

let root: string | null = null;
afterEach(async () => {
  if (root) await cleanup(root);
  root = null;
});

describe('entry-point patterns are framework-independent', () => {
  it('classifies registration verbs by concept, not by framework name', () => {
    expect(matchEntryVerb('get')).toMatchObject({ pattern: { kind: 'http' }, method: 'GET' });
    expect(matchEntryVerb('POST')).toMatchObject({ method: 'POST' });
    expect(matchEntryVerb('on')!.pattern.kind).toBe('event');
    expect(matchEntryVerb('subscribe')!.pattern.kind).toBe('event');
    expect(matchEntryVerb('process')!.pattern.kind).toBe('message');
    expect(matchEntryVerb('schedule')!.pattern.kind).toBe('scheduled');
    expect(matchEntryVerb('command')!.pattern.kind).toBe('cli');
    expect(matchEntryVerb('totallyUnknownVerb')).toBeUndefined();
    // HTTP registration is direct evidence; shape-matched ones are not.
    expect(matchEntryVerb('get')!.pattern.confidence).toBe('deterministic');
    expect(matchEntryVerb('on')!.pattern.confidence).toBe('inferred');
  });

  it('discovers every category of entry point in one mixed application', async () => {
    const model = await analyzeFixture('event-app');
    const kinds = model.operations.filter((o) => o.entryPoint).map((o) => o.entryPoint!.kind).sort();
    expect(kinds).toEqual(['cli', 'event', 'http', 'message', 'scheduled']);

    // Every entry point becomes exactly one use case, with a readable name.
    expect(model.useCases).toHaveLength(5);
    const names = model.useCases.map((u) => u.name).sort();
    expect(names).toContain('Create Order');
    expect(names).toContain('Order Placed');
    expect(names).toContain('Settle Orders');
    expect(names).toContain('Status');
    expect(names).toContain('Scheduled job');
    // A cron expression is never mangled into a name.
    for (const n of names) expect(n).not.toMatch(/^\d/);
  });

  it('attributes an inline handler\'s calls to that handler, not the setup function', async () => {
    const model = await analyzeFixture('event-app');
    // `wire()` only registers; it must not own the handlers' work.
    const flows = new Map(model.flows.map((f) => [f.name, f]));
    const placed = flows.get('Order Placed')!;
    const settle = flows.get('Settle Orders')!;
    expect(placed.components).toContain('NotificationService');
    expect(placed.components).not.toContain('OrderRepository');
    expect(settle.components).toContain('OrderRepository');
    expect(settle.components).not.toContain('NotificationService');
  });

  it('resolves dependencies wired in a composition root (const x = new Service())', async () => {
    const model = await analyzeFixture('event-app');
    const http = model.flows.find((f) => f.name === 'Create Order')!;
    // wiring → OrderService → { PaymentGateway, OrderRepository } across four files.
    expect(http.components).toContain('OrderService');
    expect(http.components).toContain('PaymentGateway');
    expect(http.components).toContain('OrderRepository');
  });

  it('marks shape-matched entry points as inferred and HTTP ones as deterministic', async () => {
    const model = await analyzeFixture('event-app');
    const byKind = (k: string) => model.operations.find((o) => o.entryPoint?.kind === k)!.entryPoint!;
    expect(byKind('http').provenance.confidence).toBe('deterministic');
    for (const k of ['event', 'message', 'scheduled', 'cli']) {
      expect(byKind(k).provenance.confidence, k).toBe('inferred');
    }
  });

  it('asks before asserting a shape-matched entry point, and answering "no" removes it', async () => {
    root = await tempRepo('event-app', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    let model = await engine.getModel();

    // Only the inferred ones are questioned; the HTTP route is not.
    const asked = model.questions.filter((q) => q.kind === 'entry-point');
    expect(asked).toHaveLength(4);
    for (const q of asked) expect(q.priority).toBe('optional');
    expect(asked.some((q) => q.subject.includes('route_'))).toBe(false);

    // Answering "no" retracts it rather than leaving a fabricated flow behind.
    const target = asked.find((q) => q.subject.endsWith('job_4'))!;
    await engine.semanticsStore.set('operations', target.subject, { ignore: true }, 'semantic-inference');
    engine.invalidateModel();
    model = await engine.getModel();
    expect(model.flows.map((f) => f.name)).not.toContain('Scheduled job');
    expect(model.useCases.length).toBe(4);
  });

  it('gives each entry point its own scenario diagram with only its participants', async () => {
    root = await tempRepo('event-app', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.defineScenarios();
    await engine.update({ all: true });

    const read = async (n: string) => fs.readFile(path.join(root!, '.umlflow/diagrams', `${n}.md`), 'utf8');
    const order = await read('order-placed-sequence');
    expect(order).toContain('NotificationService');
    expect(order).toContain('EmailClient');
    expect(order).not.toContain('PaymentGateway');

    const create = await read('create-order-sequence');
    expect(create).toContain('PaymentGateway');
    expect(create).not.toContain('EmailClient');

    // Names stay clean across all of them.
    for (const n of ['order-placed-sequence', 'create-order-sequence', 'settle-orders-sequence']) {
      expect(await read(n)).not.toMatch(/\s\?{1,2}"/);
    }
  });
});

describe('route mounting and prefixes', () => {
  it('composes a prefix onto routes registered inside a mounted router, across files', async () => {
    const adapter = (await import('../../src/parsers/registry.js')).createDefaultRegistry().adapterFor('server.ts')!;
    const server = await adapter.parse({
      path: 'server.ts',
      text: `import { orderRoutes } from './routes.js';\nexport function build(app) { app.use('/api/v1', orderRoutes); }`,
      hash: 'x',
      fileExists: () => false,
    });
    const mounts = [...(server.mounts ?? []), ...server.symbols.flatMap((s) => s.mounts ?? [])];
    expect(mounts).toMatchObject([{ prefix: '/api/v1', target: 'orderRoutes' }]);
  });

  it('reads a prefix from an options object as well as a positional path', async () => {
    const adapter = (await import('../../src/parsers/registry.js')).createDefaultRegistry().adapterFor('a.ts')!;
    const file = await adapter.parse({
      path: 'a.ts',
      text: `export function build(f) { f.register(orderRoutes, { prefix: '/api' }); }`,
      hash: 'x',
      fileExists: () => false,
    });
    const mounts = file.symbols.flatMap((s) => s.mounts ?? []);
    expect(mounts).toMatchObject([{ prefix: '/api', target: 'orderRoutes' }]);
  });
});

describe('asynchronous interactions', () => {
  it('marks awaited calls as async and leaves unawaited ones synchronous', async () => {
    const model = await analyzeFixture('event-app');
    const flow = model.flows.find((f) => f.name === 'Create Order')!;
    const charge = flow.steps.find((s) => s.label === 'charge')!;
    const save = flow.steps.find((s) => s.label === 'save')!;
    expect(charge.async).toBe(true); // `await this.payments.charge(...)`
    expect(save.async).toBeUndefined(); // `return this.repo.save(...)`
  });
});

describe('architecture diagram from the shared System Model', () => {
  it('draws layers that the codebase actually has, and no empty ones', async () => {
    root = await tempRepo('event-app', { git: true });
    await initProject({ root, diagramTypes: ['component'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const md = await fs.readFile(path.join(root, '.umlflow/diagrams/architecture.md'), 'utf8');

    expect(md).toContain('flowchart TB');
    expect(md).toContain('OrderService');
    expect(md).toContain('OrderRepository');
    expect(md).toContain('PaymentGateway');
    // This fixture has no use-case-diagram actors and no ERD entities, so those
    // bands must not be invented.
    expect(md).not.toContain('Domain & Data"]\n    direction TB\n  end');
    // Names stay clean here too.
    expect(md).not.toMatch(/\s\?{1,2}"/);
  });

  it('never contradicts the sequence view about a relationship', async () => {
    root = await tempRepo('event-app', { git: true });
    await initProject({ root, diagramTypes: ['component', 'sequence'] });
    const engine = await Umlflow.open(root);
    await engine.defineScenarios();
    await engine.update({ all: true });

    const arch = await fs.readFile(path.join(root, '.umlflow/diagrams/architecture.md'), 'utf8');
    const seq = await fs.readFile(path.join(root, '.umlflow/diagrams/create-order-sequence.md'), 'utf8');
    // The call OrderService → PaymentGateway appears in both views.
    expect(seq).toMatch(/order_service-[)>]+payment_gateway/);
    expect(arch).toMatch(/order_service -->\|calls\| payment_gateway/);
  });

  it('collapses a component pair to one edge instead of one per dependency kind', async () => {
    root = await tempRepo('event-app', { git: true });
    await initProject({ root, diagramTypes: ['component'] });
    const engine = await Umlflow.open(root);
    const g = await engine.generateDiagram('architecture', engine.getConfig().diagrams.architecture!);
    const pairs = (g.block.match(/(\w+) -->\|\w+\| (\w+)/g) ?? []).map((l) => l.replace(/\|\w+\|/, '|'));
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
