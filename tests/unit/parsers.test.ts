import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createDefaultRegistry } from '../../src/parsers/registry.js';
import { extractSqlEntities } from '../../src/parsers/schema/sql.js';
import { extractPrismaEntities } from '../../src/parsers/schema/prisma.js';
import { walkFiles, DEFAULT_IGNORE_DIRS } from '../../src/core/fs.js';
import { shortHash } from '../../src/core/hash.js';

const FIXTURES = path.resolve(__dirname, '../fixtures/repos');
const registry = createDefaultRegistry();

async function parseFixture(repo: string, rel: string) {
  const root = path.join(FIXTURES, repo);
  const files = new Set(await walkFiles(root, { ignoreDirs: DEFAULT_IGNORE_DIRS, ignorePatterns: [], maxFileSize: 1e6 }));
  const text = await fs.readFile(path.join(root, rel), 'utf8');
  const adapter = registry.adapterFor(rel)!;
  return adapter.parse({ path: rel, text, hash: shortHash(text), fileExists: (p) => files.has(p) });
}

describe('TypeScript adapter', () => {
  it('extracts classes, decorators, injected fields, methods and calls', async () => {
    const file = await parseFixture('ts-shop', 'src/orders/order.service.ts');
    expect(file.status).toBe('ok');
    const cls = file.symbols.find((s) => s.id === 'OrderService')!;
    expect(cls.kind).toBe('class');
    expect(cls.exported).toBe(true);
    expect(cls.annotations.map((a) => a.name)).toContain('Injectable');
    expect(cls.fields.map((f) => `${f.name}:${f.type}`)).toEqual([
      'repo:OrderRepository',
      'payments:PaymentService',
      'inventory:InventoryService',
      'logger:Logger',
    ]);
    const create = file.symbols.find((s) => s.id === 'OrderService.createOrder')!;
    expect(create.kind).toBe('method');
    expect(create.returnType).toBe('Order');
    expect(create.calls.map((c) => `${c.receiver ?? ''}.${c.name}`)).toEqual([
      'this.logger.info',
      'this.validate',
      'this.inventory.reserve',
      'this.payments.charge',
      'this.repo.save',
    ]);
    expect(create.typeRefs).toContain('Order');
    const validate = file.symbols.find((s) => s.id === 'OrderService.validate')!;
    expect(validate.flags?.visibility).toBe('private');
  });

  it('resolves relative imports and captures route decorators', async () => {
    const file = await parseFixture('ts-shop', 'src/orders/order.controller.ts');
    const imp = file.imports.find((i) => i.source === './order.service')!;
    expect(imp.resolvedFile).toBe('src/orders/order.service.ts');
    expect(imp.names).toEqual(['OrderService']);
    const ctrl = file.symbols.find((s) => s.id === 'OrderController')!;
    expect(ctrl.annotations).toEqual([{ name: 'Controller', args: ['/orders'], line: 5 }]);
    const create = file.symbols.find((s) => s.id === 'OrderController.create')!;
    expect(create.annotations[0]).toMatchObject({ name: 'Post', args: ['/'] });
    expect(create.params[0]).toMatchObject({ name: 'dto', type: 'CreateOrderDto' });
    expect(create.params[0]!.annotations[0]!.name).toBe('Body');
  });

  it('captures TypeORM field decorators', async () => {
    const file = await parseFixture('ts-shop', 'src/orders/order.entity.ts');
    const entity = file.symbols.find((s) => s.id === 'Order')!;
    expect(entity.annotations[0]).toMatchObject({ name: 'Entity' });
    const customer = entity.fields.find((f) => f.name === 'customer')!;
    expect(customer.type).toBe('User');
    expect(customer.annotations.map((a) => a.name)).toEqual(['ManyToOne', 'JoinColumn']);
    const items = entity.fields.find((f) => f.name === 'items')!;
    expect(items.type).toBe('OrderItem');
  });

  it('extracts Express-style routes and arrow function handlers', async () => {
    const text = `import express from 'express';
const app = express();
export const listOrders = async (req, res) => { res.json(await orders.list()); };
app.get('/orders', listOrders);
app.post('/orders', (req, res) => { orders.create(req.body); });
export function setup(router) { router.delete('/orders/:id', removeOrder); }`;
    const adapter = registry.adapterFor('server.js')!;
    const file = await adapter.parse({ path: 'server.js', text, hash: 'x', fileExists: () => false });
    // The inline handler is lifted into its own symbol so it owns its calls.
    expect(file.routes.map((r) => `${r.method} ${r.path} ${r.handler ?? '-'}`)).toEqual(['GET /orders listOrders', 'POST /orders route_1']);
    const setup = file.symbols.find((s) => s.id === 'setup')!;
    expect(setup.routes).toMatchObject([{ method: 'DELETE', path: '/orders/:id', handler: 'removeOrder', line: 6 }]);
    const handler = file.symbols.find((s) => s.id === 'listOrders')!;
    expect(handler.kind).toBe('function');
    expect(handler.calls.map((c) => c.name)).toEqual(['json', 'list']);

    const inline = file.symbols.find((s) => s.id === 'route_1')!;
    expect(inline.flags?.inlineHandler).toBe(true);
    expect(inline.calls.map((c) => c.name)).toEqual(['create']);
  });

  it('recognises non-HTTP registrations by call shape and marks them inferred', async () => {
    const text = `bus.on('user.created', async (user) => { await mailer.send(user); });
queue.process('resize', (job) => { images.resize(job.data); });
bot.command('start', (ctx) => { greeter.welcome(ctx); });
scheduler.schedule('0 * * * *', () => { reports.build(); });
stream.on('data', (chunk) => { sink.write(chunk); });`;
    const adapter = registry.adapterFor('wiring.ts')!;
    const file = await adapter.parse({ path: 'wiring.ts', text, hash: 'x', fileExists: () => false });
    const byKind = file.routes.map((r) => `${r.kind}:${r.path}`);
    expect(byKind).toContain('event:user.created');
    expect(byKind).toContain('message:resize');
    expect(byKind).toContain('cli:start');
    expect(byKind).toContain('scheduled:0 * * * *');
    // Shape-based matches are never presented as direct evidence.
    for (const r of file.routes) expect(r.confidence).toBe('inferred');
    // Each handler body is attributed to its own registration, not to the module.
    const handlers = file.symbols.filter((s) => s.flags?.inlineHandler);
    expect(handlers.length).toBeGreaterThanOrEqual(4);
    expect(handlers.flatMap((h) => h.calls.map((c) => c.name))).toContain('send');
  });
});

describe('Python adapter', () => {
  it('extracts classes, __init__ injection, methods, calls and route decorators', async () => {
    const file = await parseFixture('py-shop', 'app/services.py');
    const cls = file.symbols.find((s) => s.id === 'OrderService')!;
    expect(cls.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['repo:OrderRepository', 'payments:PaymentClient']);
    const create = file.symbols.find((s) => s.id === 'OrderService.create_order')!;
    expect(create.calls.map((c) => `${c.receiver ?? ''}.${c.name}`)).toEqual(['.Order', 'self.payments.charge', 'self.repo.save']);
    expect(file.imports.find((i) => i.source === '.repositories')?.resolvedFile).toBe('app/repositories.py');

    const api = await parseFixture('py-shop', 'app/api.py');
    const handler = api.symbols.find((s) => s.id === 'create_order')!;
    expect(handler.annotations[0]).toMatchObject({ name: 'router.post', args: ['/orders'] });
    expect(handler.params.find((p) => p.name === 'service')?.type).toBe('OrderService');
    expect(handler.flags?.async).toBe(true);
  });

  it('captures SQLAlchemy column definitions as annotated fields', async () => {
    const file = await parseFixture('py-shop', 'app/models.py');
    const order = file.symbols.find((s) => s.id === 'Order')!;
    expect(order.extends).toEqual(['Base']);
    const fk = order.fields.find((f) => f.name === 'customer_id')!;
    expect(fk.annotations[0]!.name).toBe('Column');
    expect(fk.annotations[0]!.args).toEqual(['Integer', 'ForeignKey("customers.id")']);
    const tablename = order.fields.find((f) => f.name === '__tablename__');
    expect(tablename).toBeDefined();
  });
});

describe('Java adapter', () => {
  it('extracts package, annotations, injected fields and calls', async () => {
    const file = await parseFixture('java-shop', 'src/main/java/com/acme/orders/OrderService.java');
    expect(file.module).toBe('com.acme.orders');
    const cls = file.symbols.find((s) => s.id === 'OrderService')!;
    expect(cls.annotations.map((a) => a.name)).toEqual(['Service']);
    expect(cls.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['repository:OrderRepository', 'payments:PaymentGateway']);
    const create = file.symbols.find((s) => s.id === 'OrderService.create')!;
    expect(create.calls.map((c) => `${c.receiver ?? ''}.${c.name}`)).toEqual(['payments.charge', 'order.getTotal', 'repository.save']);
    expect(create.typeRefs).toEqual(['Order']);
  });

  it('captures JPA annotations and Spring Data repository entity', async () => {
    const entity = await parseFixture('java-shop', 'src/main/java/com/acme/orders/Order.java');
    const order = entity.symbols.find((s) => s.id === 'Order')!;
    expect(order.annotations.find((a) => a.name === 'Table')?.named).toEqual({ name: 'orders' });
    const customer = order.fields.find((f) => f.name === 'customer')!;
    expect(customer.annotations.map((a) => a.name)).toEqual(['ManyToOne', 'JoinColumn']);
    expect(customer.annotations[1]!.named).toEqual({ name: 'customer_id' });
    const items = order.fields.find((f) => f.name === 'items')!;
    expect(items.type).toBe('OrderItem');
    const repo = await parseFixture('java-shop', 'src/main/java/com/acme/orders/OrderRepository.java');
    expect(repo.symbols[0]!.flags?.repositoryEntity).toBe('Order');
    const ctrl = await parseFixture('java-shop', 'src/main/java/com/acme/orders/OrderController.java');
    const get = ctrl.symbols.find((s) => s.id === 'OrderController.get')!;
    expect(get.annotations[0]).toMatchObject({ name: 'GetMapping', args: ['/{id}'] });
  });
});

describe('Go adapter', () => {
  it('extracts structs, methods with receivers, calls and routes', async () => {
    const file = await parseFixture('go-shop', 'orders/service.go');
    expect(file.module).toBe('orders');
    const svc = file.symbols.find((s) => s.id === 'OrderService')!;
    expect(svc.kind).toBe('struct');
    expect(svc.fields.map((f) => `${f.name}:${f.type}`)).toEqual(['repo:OrderRepository', 'payments:Client']);
    const create = file.symbols.find((s) => s.id === 'OrderService.Create')!;
    expect(create.parent).toBe('OrderService');
    expect(create.calls.map((c) => `${c.receiver ?? ''}.${c.name}`)).toEqual(['s.payments.Charge', 's.repo.Save']);
    const handler = await parseFixture('go-shop', 'orders/handler.go');
    const reg = handler.symbols.find((s) => s.id === 'RegisterRoutes')!;
    expect(reg.routes).toEqual([{ method: 'ANY', path: '/orders', handler: 'h.Create', line: 14 }]);
  });
});

describe('SQL extractor', () => {
  it('extracts tables, columns, keys and relations', async () => {
    const file = await parseFixture('ts-shop', 'db/001_init.sql');
    const names = file.entities.map((e) => e.name);
    expect(names).toEqual(['users', 'orders', 'order_items', 'audit_log']);
    const orders = file.entities[1]!;
    expect(orders.attributes.find((a) => a.name === 'id')?.primaryKey).toBe(true);
    expect(orders.attributes.find((a) => a.name === 'customer_id')?.foreignKey).toEqual({ entity: 'users', attribute: 'id' });
    const items = file.entities[2]!;
    expect(items.attributes.find((a) => a.name === 'id')?.primaryKey).toBe(true);
    expect(items.relations).toEqual([{ target: 'orders', kind: 'many-to-one', field: 'order_id' }]);
    const audit = file.entities[3]!;
    expect(audit.attributes.find((a) => a.name === 'actor_id')?.foreignKey).toEqual({ entity: 'users', attribute: 'id' });
    const users = file.entities[0]!;
    expect(users.attributes.find((a) => a.name === 'email')).toMatchObject({ unique: true, nullable: false, type: 'VARCHAR(255)' });
  });

  it('handles quoted identifiers and schemas', () => {
    const entities = extractSqlEntities('CREATE TABLE "public"."Account" ("Id" INT PRIMARY KEY, `owner` INT REFERENCES [dbo].[People]("Id"));');
    expect(entities[0]!.name).toBe('Account');
    expect(entities[0]!.attributes[1]!.foreignKey).toEqual({ entity: 'People', attribute: 'Id' });
  });
});

describe('Prisma extractor', () => {
  it('extracts models, keys, relations and many-to-many', () => {
    const text = require('node:fs').readFileSync(path.join(FIXTURES, 'prisma-shop/prisma/schema.prisma'), 'utf8');
    const entities = extractPrismaEntities(text);
    expect(entities.map((e) => e.name)).toEqual(['User', 'Order', 'OrderItem', 'Tag']);
    const user = entities[0]!;
    expect(user.table).toBe('users');
    expect(user.attributes.find((a) => a.name === 'id')?.primaryKey).toBe(true);
    expect(user.attributes.find((a) => a.name === 'role')?.type).toBe('Role');
    expect(user.relations).toEqual([
      { target: 'Order', kind: 'one-to-many', field: 'orders' },
      { target: 'Tag', kind: 'many-to-many', field: 'tags' },
    ]);
    const order = entities[1]!;
    expect(order.attributes.find((a) => a.name === 'customerId')?.foreignKey).toEqual({ entity: 'User' });
    expect(order.relations.find((r) => r.target === 'User')?.kind).toBe('many-to-one');
  });
});

describe('registry', () => {
  it('detects languages and falls back without fabricating facts', async () => {
    expect(registry.detectLanguage('a/b.ts')).toBe('typescript');
    expect(registry.detectLanguage('x.rs')).toBe('rust');
    expect(registry.detectLanguage('README.md')).toBeNull();
    const adapter = registry.adapterFor('main.rs')!;
    const file = await adapter.parse({ path: 'main.rs', text: 'fn main() {}', hash: 'h', fileExists: () => false });
    expect(file.status).toBe('unsupported');
    expect(file.symbols).toEqual([]);
    expect(registry.adapterFor('x.ts', ['python'])).toBeNull();
  });
});
