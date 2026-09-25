import { describe, expect, it } from 'vitest';
import { analyzeFixture } from '../helpers.js';
import { emptySemantics } from '../../src/model/semantics.js';
import { ModelIndex } from '../../src/model/types.js';
import { strongerOf, PRECEDENCE, codeFact, inferredFact, declaredFact, unknownFact } from '../../src/core/provenance.js';

describe('System Model: structural facts', () => {
  it('classifies components with provenance', async () => {
    const model = await analyzeFixture('ts-shop');
    const idx = new ModelIndex(model);
    expect(idx.components.get('OrderController')).toMatchObject({ role: 'controller', roleProvenance: { confidence: 'deterministic', source: 'code' } });
    expect(idx.components.get('OrderService')).toMatchObject({ role: 'service', roleProvenance: { confidence: 'inferred' } });
    expect(idx.components.get('Order')).toMatchObject({ role: 'entity', roleProvenance: { confidence: 'deterministic' } });
    expect(idx.components.get('CreateOrderDto')?.role).toBe('model');
  });

  it('records dependencies (injection, calls) and entry points', async () => {
    const model = await analyzeFixture('ts-shop');
    const injects = model.dependencies.filter((d) => d.from === 'OrderService' && d.kind === 'injects').map((d) => d.to);
    expect(injects).toEqual(['InventoryService', 'Logger', 'OrderRepository', 'PaymentService']);
    const ep = model.operations.find((o) => o.id === 'OrderController.create')!.entryPoint!;
    expect(ep).toMatchObject({ kind: 'http', method: 'POST', path: '/orders', provenance: { confidence: 'deterministic' } });
  });

  it('resolves interactions deterministically through typed injection', async () => {
    const model = await analyzeFixture('ts-shop');
    const calls = model.interactions.filter((i) => i.from === 'OrderService.createOrder').map((i) => `${i.toComponent}.${i.label}:${i.provenance.confidence}`);
    expect(calls).toEqual([
      'Logger.info:deterministic',
      'OrderService.validate:deterministic',
      'InventoryService.reserve:deterministic',
      'PaymentService.charge:deterministic',
      'OrderRepository.save:deterministic',
    ]);
  });

  it('derives data access from Repository<Entity> fields', async () => {
    const model = await analyzeFixture('ts-shop');
    expect(model.dataAccess).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ componentId: 'OrderRepository', entityId: 'Order', mode: 'read-write' }),
        expect.objectContaining({ componentId: 'UserRepository', entityId: 'User', mode: 'read' }),
      ]),
    );
  });

  it('merges SQL tables with ORM entities into one entity and normalises relations', async () => {
    const model = await analyzeFixture('ts-shop');
    const order = model.entities.find((e) => e.id === 'Order')!;
    expect(order.table).toBe('orders');
    expect(order.provenance.refs.map((r) => r.file).sort()).toEqual(['db/001_init.sql', 'src/orders/order.entity.ts']);
    expect(order.attributes.map((a) => a.name)).toEqual(['id', 'customer_id', 'total', 'status']);
    expect(model.relations.map((r) => `${r.from} ${r.kind} ${r.to}`)).toEqual(['OrderItem many-to-one Order', 'Order many-to-one User', 'audit_log many-to-one User']);
  });

  it('understands Python, Java and Go repositories', async () => {
    const py = await analyzeFixture('py-shop');
    expect(py.operations.find((o) => o.id === 'api.create_order')?.entryPoint).toMatchObject({ kind: 'http', method: 'POST', path: '/orders' });
    expect(py.interactions.map((i) => `${i.from}->${i.toComponent}.${i.label}`)).toContain('PaymentClient.charge->ext:requests.post');
    expect(py.relations).toEqual([expect.objectContaining({ from: 'Order', to: 'Customer', kind: 'many-to-one' })]);

    const java = await analyzeFixture('java-shop');
    expect(java.components.find((c) => c.id === 'OrderService')?.roleProvenance.confidence).toBe('deterministic');
    expect(java.dataAccess).toEqual([expect.objectContaining({ componentId: 'OrderRepository', entityId: 'Order' })]);
    // chained call `.findById(id).orElse(null)` must not be attributed to the repository
    expect(java.interactions.map((i) => i.label)).not.toContain('orElse');

    const go = await analyzeFixture('go-shop');
    expect(go.operations.find((o) => o.id === 'OrderHandler.Create')?.entryPoint).toMatchObject({ kind: 'http', path: '/orders' });
    expect(go.operations.find((o) => o.id === 'handler.RegisterRoutes')?.entryPoint).toBeUndefined();
  });
});

describe('System Model: behavioural facts', () => {
  it('builds flows from entry points, inlining private self-calls', async () => {
    const model = await analyzeFixture('ts-shop');
    const flow = model.flows.find((f) => f.id === 'OrderController.create')!;
    expect(flow.name).toBe('Create Order');
    expect(flow.steps.map((s) => `${s.depth}:${s.fromComponent}->${s.toComponent}.${s.label}`)).toEqual([
      '1:OrderController->OrderService.createOrder',
      '2:OrderService->Logger.info',
      '2:OrderService->InventoryService.reserve',
      '3:InventoryService->InventoryRepository.decrement',
      '2:OrderService->PaymentService.charge',
      '3:PaymentService->PaymentGateway.authorize',
      '3:PaymentService->PaymentGateway.capture',
      '2:OrderService->OrderRepository.save',
    ]);
    expect(flow.entities).toEqual(['Order']);
  });

  it('creates use cases from entry points with unknown actors and asks questions', async () => {
    const model = await analyzeFixture('ts-shop');
    expect(model.useCases.map((u) => u.name)).toEqual(['Login', 'Create Order', 'Get Order']);
    for (const uc of model.useCases) {
      expect(uc.actorIds).toEqual([]);
      expect(uc.actorProvenance.confidence).toBe('unknown');
    }
    const required = model.questions.filter((q) => (q.priority ?? 'required') === 'required');
    expect(required.map((q) => q.id)).toEqual(['actor:AuthController', 'actor:OrderController']);
    expect(required[1]!.context).toEqual(['POST /orders → create', 'GET /orders/:id → get']);

    // Every multi-step flow is offered to the LLM for naming, as an optional refinement.
    const flowQuestions = model.questions.filter((q) => q.kind === 'flow-name');
    expect(flowQuestions.map((q) => q.id)).toEqual([
      'flow-name:AuthController.login',
      'flow-name:OrderController.create',
      'flow-name:OrderController.get',
    ]);
    for (const q of flowQuestions) expect(q.priority).toBe('optional');
    // The question carries the real call chain, not just the method name, so the
    // LLM can reason about the scenario without re-reading the repository.
    const checkout = flowQuestions.find((q) => q.id === 'flow-name:OrderController.create')!;
    expect(checkout.context!.join('\n')).toContain('OrderController → OrderService.createOrder');
    expect(checkout.context!.join('\n')).toContain('PaymentService → PaymentGateway.capture');
    expect(checkout.context!.join('\n')).toContain('data: Order');
  });
});

describe('System Model: semantics and precedence', () => {
  it('applies user declarations and inferred answers', async () => {
    const semantics = emptySemantics();
    semantics.actors.Customer = { source: 'user' };
    semantics.components.OrderController = { actor: 'Customer', source: 'user' };
    semantics.operations['AuthController.login'] = { actor: 'Visitor', useCase: 'Sign in', source: 'semantic-inference' };
    const model = await analyzeFixture('ts-shop', semantics);
    const create = model.useCases.find((u) => u.id === 'order-controller-create')!;
    expect(create.actorIds).toEqual(['Customer']);
    expect(create.actorProvenance).toMatchObject({ source: 'user', confidence: 'declared' });
    const login = model.useCases.find((u) => u.id === 'auth-controller-login')!;
    expect(login.name).toBe('Sign in');
    expect(login.nameProvenance.confidence).toBe('inferred');
    expect(login.actorIds).toEqual(['Visitor']);
    expect(model.actors.map((a) => `${a.id}:${a.provenance.confidence}`)).toEqual(['Customer:declared', 'Visitor:inferred']);
    expect(model.questions.filter((q) => q.kind === 'actor')).toEqual([]);
  });

  it('lets user role declarations override code but not inference override deterministic code facts', async () => {
    const semantics = emptySemantics();
    semantics.components.Logger = { role: 'utility', source: 'user' };
    semantics.components.OrderController = { role: 'service', source: 'semantic-inference' };
    const model = await analyzeFixture('ts-shop', semantics);
    const idx = new ModelIndex(model);
    expect(idx.components.get('Logger')).toMatchObject({ role: 'utility', roleProvenance: { source: 'user', confidence: 'declared' } });
    // @Controller decorator is deterministic; inference cannot override it.
    expect(idx.components.get('OrderController')?.role).toBe('controller');
  });

  it('precedence: user > code > inference > unknown', () => {
    expect(PRECEDENCE.declared).toBeGreaterThan(PRECEDENCE.deterministic);
    expect(PRECEDENCE.deterministic).toBeGreaterThan(PRECEDENCE.inferred);
    expect(PRECEDENCE.inferred).toBeGreaterThan(PRECEDENCE.unknown);
    expect(strongerOf(codeFact([]), inferredFact([])).confidence).toBe('deterministic');
    expect(strongerOf(inferredFact([]), declaredFact()).confidence).toBe('declared');
    expect(strongerOf(unknownFact(), inferredFact([])).confidence).toBe('inferred');
    expect(strongerOf(codeFact([], 'a'), codeFact([], 'b')).reason).toBe('a');
  });

  it('is deterministic: same input produces the same model (except timestamp)', async () => {
    const a = await analyzeFixture('ts-shop');
    const b = await analyzeFixture('ts-shop');
    a.builtAt = b.builtAt = '';
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
