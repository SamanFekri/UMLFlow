import { describe, expect, it } from 'vitest';
import { analyzeFixture } from '../helpers.js';
import { emptySemantics } from '../../src/model/semantics.js';
import { ModelIndex } from '../../src/model/types.js';
import { resolveScope, inferScope } from '../../src/diagrams/scope.js';
import { createDefaultGenerators, createDefaultRenderers } from '../../src/diagrams/index.js';
import type { DiagramDefinition } from '../../src/config/schema.js';

/**
 * Golden outputs: the rendered Mermaid for every fixture and diagram type.
 * Any change to generators, adapters or the renderer shows up here as a
 * reviewable snapshot diff (`npx vitest -u` to accept).
 */
const generators = createDefaultGenerators();
const mermaid = createDefaultRenderers().get('mermaid');

async function render(repo: string, name: string, def: DiagramDefinition, semantics = emptySemantics()): Promise<string> {
  const model = await analyzeFixture(repo, semantics);
  const scope = resolveScope(def, model, semantics, 6);
  const result = generators.get(def.type).generate({ name, definition: def, model, index: new ModelIndex(model), scope, semantics });
  return mermaid.render(result.diagram) + result.diagram.notes.map((n) => `%% note[${n.level}]: ${n.text}\n`).join('');
}

describe('golden diagrams', () => {
  for (const repo of ['ts-shop', 'py-shop', 'java-shop', 'go-shop']) {
    for (const type of ['usecase', 'sequence', 'erd']) {
      it(`${repo} ${type}`, async () => {
        expect(await render(repo, `${type}-diagram`, { type })).toMatchSnapshot();
      });
    }
  }

  it('prisma-shop erd', async () => {
    expect(await render('prisma-shop', 'erd', { type: 'erd' })).toMatchSnapshot();
  });

  it('ts-shop inferred login sequence with declared actor and overrides', async () => {
    const semantics = emptySemantics();
    semantics.actors.Visitor = { source: 'user' };
    semantics.components.AuthController = { actor: 'Visitor', source: 'user' };
    const model = await analyzeFixture('ts-shop', semantics);
    const def: DiagramDefinition = {
      type: 'sequence',
      description: 'User login',
      inferredScope: inferScope('login', 'sequence', model).scope,
      overrides: { labels: { SessionManager: 'Sessions' }, exclude: ['UserRepository'], groups: { Auth: ['AuthController', 'AuthService'] }, raw: ['%% custom line'] },
    };
    expect(await render('ts-shop', 'login-flow', def, semantics)).toMatchSnapshot();
  });

  it('ts-shop erd with aliases, labels and explicit relationships', async () => {
    const def: DiagramDefinition = {
      type: 'erd',
      overrides: { labels: { audit_log: 'AuditLog' }, exclude: ['OrderItem'], relationships: [{ from: 'User', to: 'audit_log', kind: 'one-to-many', label: 'writes' }] },
    };
    expect(await render('ts-shop', 'erd', def)).toMatchSnapshot();
  });

  it('ts-shop use cases with declared actors and groups', async () => {
    const semantics = emptySemantics();
    semantics.actors.Customer = { source: 'user' };
    semantics.components.OrderController = { actor: 'Customer', source: 'user' };
    semantics.operations['AuthController.login'] = { actor: 'Visitor', useCase: 'Sign in', source: 'semantic-inference' };
    const def: DiagramDefinition = { type: 'usecase', overrides: { groups: { Orders: ['OrderController'] }, relationships: [{ from: 'order-controller-create', to: 'auth-controller-login', kind: 'include' }] } };
    expect(await render('ts-shop', 'usecases', def, semantics)).toMatchSnapshot();
  });
});
