import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { cleanup, git, read, tempRepo, write } from '../helpers.js';
import { initProject } from '../../src/config/init.js';
import { Umlflow } from '../../src/sync/pipeline.js';
import { DIAGRAM_MANUAL_BEGIN, MD_MANUAL_BEGIN } from '../../src/sync/output.js';

let root: string;

beforeEach(async () => {
  root = await tempRepo('ts-shop', { git: true });
  await initProject({ root, diagramTypes: ['usecase', 'sequence', 'erd'] });
});

afterEach(async () => {
  await cleanup(root);
});

function statuses(result: { diagrams: { name: string; status: string }[] }): Record<string, string> {
  return Object.fromEntries(result.diagrams.map((d) => [d.name, d.status]));
}

describe('incremental pipeline', () => {
  it('initial update parses everything once and creates all diagrams', async () => {
    const engine = await Umlflow.open(root);
    const result = await engine.update();
    expect(result.index.rebuilt).toBe(true);
    expect(result.index.parsed).toBe(result.index.total);
    expect(statuses(result)).toEqual({ 'system-usecases': 'created', 'main-flows': 'created', 'database-erd': 'created' });
    const md = await read(root, '.umlflow/diagrams/main-flows.md');
    expect(md).toContain('```mermaid');
    expect(md).toContain('sequenceDiagram');
    expect(md).toContain(MD_MANUAL_BEGIN);
    expect(result.questions).toBe(2); // required only; flow-name refinements are optional
    // cache exists, project files exist
    expect(JSON.parse(await read(root, '.umlflow/cache/index.json')).files['src/orders/order.service.ts'].symbols.length).toBeGreaterThan(0);
    // no source text in the cache
    expect(await read(root, '.umlflow/cache/index.json')).not.toContain("this.logger.info('creating order')");
  });

  it('second update with no changes parses nothing and touches nothing', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    const before = await read(root, '.umlflow/diagrams/main-flows.md');
    const engine2 = await Umlflow.open(root);
    const result = await engine2.update();
    expect(result.index.rebuilt).toBe(false);
    expect(result.index.parsed).toBe(0);
    expect(statuses(result)).toEqual({ 'system-usecases': 'skipped', 'main-flows': 'skipped', 'database-erd': 'skipped' });
    expect(await read(root, '.umlflow/diagrams/main-flows.md')).toBe(before);
  });

  it('a payment change re-parses one file and updates only the sequence diagram', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    const erdBefore = await read(root, '.umlflow/diagrams/database-erd.md');
    // Add a fraud check call into PaymentService
    await write(
      root,
      'src/payments/fraud.service.ts',
      `import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class FraudService {\n  async screen(amount: number): Promise<boolean> { return amount < 10000; }\n}\n`,
    );
    const payment = await read(root, 'src/payments/payment.service.ts');
    await write(
      root,
      'src/payments/payment.service.ts',
      payment
        .replace("import { PaymentGateway } from './payment.gateway';", "import { PaymentGateway } from './payment.gateway';\nimport { FraudService } from './fraud.service';")
        .replace('constructor(private readonly gateway: PaymentGateway) {}', 'constructor(private readonly gateway: PaymentGateway, private readonly fraud: FraudService) {}')
        .replace('const ok = await this.gateway.authorize(order.total);', 'await this.fraud.screen(order.total);\n    const ok = await this.gateway.authorize(order.total);'),
    );
    const engine2 = await Umlflow.open(root);
    const result = await engine2.update();
    expect(result.index.changes.added).toEqual(['src/payments/fraud.service.ts']);
    expect(result.index.changes.modified).toEqual(['src/payments/payment.service.ts']);
    expect(result.index.parsed).toBe(2);
    expect(statuses(result)).toEqual({ 'system-usecases': 'skipped', 'main-flows': 'updated', 'database-erd': 'skipped' });
    // Awaited calls render as async arrows ("-)"), not plain ones.
    expect(await read(root, '.umlflow/diagrams/main-flows.md')).toContain('payment_service-)fraud_service: screen');
    expect(await read(root, '.umlflow/diagrams/database-erd.md')).toBe(erdBefore);
    expect(result.modelDiff?.added).toContain('PaymentService now depends on FraudService');
    expect(result.modelDiff?.added).toContain('call PaymentService.charge → FraudService.screen added');
  });

  it('a new controller affects the use case diagram (broad scope) but not scoped diagrams', async () => {
    const engine = await Umlflow.open(root);
    await engine.defineDiagram('login-flow', { type: 'sequence' }, 'login');
    await engine.update();
    await write(
      root,
      'src/reports/report.controller.ts',
      `import { Controller, Get } from '@nestjs/common';\n@Controller('/reports')\nexport class ReportController {\n  @Get('/')\n  async list() { return []; }\n}\n`,
    );
    const engine2 = await Umlflow.open(root);
    const result = await engine2.update();
    expect(statuses(result)).toEqual({ 'system-usecases': 'updated', 'main-flows': 'updated', 'database-erd': 'skipped', 'login-flow': 'skipped' });
  });

  it('check reports fresh, then stale after a change, and never writes diagrams', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    const fresh = await (await Umlflow.open(root)).check();
    expect(fresh.stale).toBe(false);
    expect(Object.values(statuses(fresh)).every((s) => s === 'fresh')).toBe(true);
    const auth = await read(root, 'src/auth/auth.service.ts');
    await write(root, 'src/auth/auth.service.ts', auth.replace('return this.sessions.create(user.id);', 'await this.users.findByEmail(email);\n    return this.sessions.create(user.id);'));
    const before = await read(root, '.umlflow/diagrams/main-flows.md');
    const stale = await (await Umlflow.open(root)).check();
    expect(stale.stale).toBe(true);
    expect(statuses(stale)).toEqual({ 'system-usecases': 'fresh', 'main-flows': 'stale', 'database-erd': 'fresh' });
    expect(await read(root, '.umlflow/diagrams/main-flows.md')).toBe(before);
  });

  it('preserves manual sections and user content outside the generated block', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    const file = path.join(root, '.umlflow/diagrams/main-flows.md');
    let text = await fs.readFile(file, 'utf8');
    text = text.replace(`  %% ${DIAGRAM_MANUAL_BEGIN}\n`, `  %% ${DIAGRAM_MANUAL_BEGIN}\n  Note over order_controller: manual note\n`);
    text = text.replace(`${MD_MANUAL_BEGIN}\n`, `${MD_MANUAL_BEGIN}\nMy prose about this flow.\n`);
    text += '\n## Extra user section\n\nkept\n';
    await fs.writeFile(file, text);
    // Trigger a regeneration of the sequence diagram
    const auth = await read(root, 'src/auth/auth.service.ts');
    await write(root, 'src/auth/auth.service.ts', auth.replace('return this.sessions.create(user.id);', 'await this.users.findByEmail(email);\n    return this.sessions.create(user.id);'));
    const result = await (await Umlflow.open(root)).update();
    expect(statuses(result)['main-flows']).toBe('updated');
    const after = await fs.readFile(file, 'utf8');
    expect(after).toContain('Note over order_controller: manual note');
    expect(after).toContain('My prose about this flow.');
    expect(after).toContain('## Extra user section\n\nkept');
    // manual edits alone do not make a diagram stale
    const check = await (await Umlflow.open(root)).check();
    expect(check.stale).toBe(false);
  });

  it('rebuilds from a deleted or corrupt cache', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    await fs.writeFile(path.join(root, '.umlflow/cache/index.json'), '{ not json');
    const result = await (await Umlflow.open(root)).update();
    expect(result.index.rebuilt).toBe(true);
    expect(result.index.reason).toContain('unreadable');
    // parse cache was rebuilt, but the sync baseline is intact so nothing needs regenerating
    expect(result.diagrams.every((d) => d.status === 'skipped' || d.status === 'unchanged')).toBe(true);
    await fs.rm(path.join(root, '.umlflow/cache'), { recursive: true });
    const again = await (await Umlflow.open(root)).check();
    expect(again.index.rebuilt).toBe(true);
    expect(again.stale).toBe(false);
  });

  it('handles renames and deletions incrementally', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'diagrams');
    git(root, 'mv', 'src/shared/logger.ts', 'src/shared/log.ts');
    await fs.rm(path.join(root, 'src/inventory/inventory.repository.ts'));
    const result = await (await Umlflow.open(root)).update();
    expect(result.index.changes.renamed).toEqual([{ from: 'src/shared/logger.ts', to: 'src/shared/log.ts' }]);
    expect(result.index.changes.deleted).toEqual(['src/inventory/inventory.repository.ts']);
    expect(result.modelDiff?.removed).toContain('repository InventoryRepository removed');
    expect(statuses(result)['main-flows']).toBe('updated');
    expect(statuses(result)['database-erd']).toBe('skipped');
  });

  it('semantic declarations affect diagrams that reference them and stop questions', async () => {
    const engine = await Umlflow.open(root);
    await engine.update();
    await engine.semanticsStore.set('actors', 'Customer', {}, 'user');
    await engine.semanticsStore.set('components', 'OrderController', { actor: 'Customer' }, 'user');
    await engine.semanticsStore.set('components', 'AuthController', { actor: 'Visitor' }, 'semantic-inference');
    engine.invalidateModel();
    const result = await engine.update();
    expect(result.questions).toBe(0); // every required hole is filled
    const uc = await read(root, '.umlflow/diagrams/system-usecases.md');
    expect(uc).toContain('👤 Customer');
    expect(uc).toContain('👤 Visitor');
    expect(uc).not.toContain('Visitor ?'); // names never carry uncertainty markers
    expect(uc).not.toContain('Unknown actor');
    // user facts are never overwritten by inference
    expect(await engine.semanticsStore.set('components', 'OrderController', { actor: 'Bot' }, 'semantic-inference')).toBe(false);
  });

  it('scope inference persists in config and user scope wins over it', async () => {
    const engine = await Umlflow.open(root);
    const { inference } = await engine.defineDiagram('login-flow', { type: 'sequence' }, 'login');
    expect(inference?.scope.entryPoints).toEqual(['AuthController.login']);
    expect(inference?.scope.files).toEqual(['src/auth/auth.controller.ts', 'src/auth/auth.service.ts', 'src/auth/session.manager.ts', 'src/users/user.repository.ts']);
    const cfg = await read(root, '.umlflow/config.yaml');
    expect(cfg).toContain('inferredScope:');
    expect(cfg).toContain('# UMLFlow project configuration.');
    await engine.update({ names: ['login-flow'] });
    const md = await read(root, '.umlflow/diagrams/login-flow.md');
    expect(md).toContain('POST /auth/login');
    expect(md).not.toContain('POST /orders');
    // user overrides inferred scope
    await engine.defineDiagram('login-flow', { type: 'sequence', scope: { entryPoints: ['OrderController.get'] }, inferredScope: inference?.scope });
    await engine.update({ names: ['login-flow'] });
    const md2 = await read(root, '.umlflow/diagrams/login-flow.md');
    expect(md2).toContain('GET /orders/:id');
    expect(md2).not.toContain('POST /auth/login');
  });
});

describe('plain-Mermaid mirror (output.mermaidDir)', () => {
  it('writes <mermaidDir>/<type>/<name>.mmd beside the canonical diagram, without markers', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['usecase', 'sequence', 'erd'] });
    const engine = await Umlflow.open(root);
    await engine.update();

    for (const [type, name] of [['usecase', 'system-usecases'], ['sequence', 'main-flows'], ['erd', 'database-erd']] as const) {
      const mirror = path.join(root, 'umlflow', type, `${name}.mmd`);
      const text = await fs.readFile(mirror, 'utf8');
      expect(text).toMatch(/^%% /);
      expect(text).toContain(`.umlflow/diagrams/${name}.md`);
      // Bare diagram: no generated/manual markers, no Markdown fences.
      expect(text).not.toContain('UMLFLOW GENERATED');
      expect(text).not.toContain('UMLFLOW MANUAL');
      expect(text).not.toContain('```');
      // The canonical file keeps them.
      expect(await fs.readFile(path.join(root, '.umlflow/diagrams', `${name}.md`), 'utf8')).toContain('UMLFLOW GENERATED BEGIN');
    }
  });

  it('refreshes the mirror when the diagram changes, restores it when deleted, and removes it with the diagram', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['sequence'] });
    const engine = await Umlflow.open(root);
    await engine.update();
    const mirror = path.join(root, 'umlflow', 'sequence', 'main-flows.mmd');
    expect(await fs.readFile(mirror, 'utf8')).toContain('authorize');

    // A code change flows through to the mirror.
    const gateway = path.join(root, 'src/payments/payment.gateway.ts');
    await fs.writeFile(gateway, (await fs.readFile(gateway, 'utf8')).replace(/authorize\(/g, 'authorizeCharge('));
    const service = path.join(root, 'src/payments/payment.service.ts');
    await fs.writeFile(service, (await fs.readFile(service, 'utf8')).replace(/authorize\(/g, 'authorizeCharge('));
    const engine2 = await Umlflow.open(root);
    await engine2.update();
    expect(await fs.readFile(mirror, 'utf8')).toContain('authorizeCharge');

    // Deleted mirror is restored even though the diagram itself is unchanged.
    await fs.rm(mirror);
    const engine3 = await Umlflow.open(root);
    await engine3.update({ names: ['main-flows'] });
    expect(await fs.readFile(mirror, 'utf8')).toContain('authorizeCharge');

    // Removing the diagram removes its mirror.
    const engine4 = await Umlflow.open(root);
    await engine4.removeDiagram('main-flows');
    await expect(fs.readFile(mirror, 'utf8')).rejects.toThrow();
  });

  it('writes no mirror when output.mermaidDir is disabled', async () => {
    root = await tempRepo('ts-shop', { git: true });
    await initProject({ root, diagramTypes: ['erd'] });
    const cfg = path.join(root, '.umlflow/config.yaml');
    await fs.writeFile(cfg, (await fs.readFile(cfg, 'utf8')).replace(/^  mermaidDir: .*$/m, '  mermaidDir: null'));
    const engine = await Umlflow.open(root);
    await engine.update();
    await expect(fs.stat(path.join(root, 'umlflow'))).rejects.toThrow();
  });
});
