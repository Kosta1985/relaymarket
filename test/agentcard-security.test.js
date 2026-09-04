import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/src/instrumented.js';

for (const path of ['/.well-known/agent.json', '/.well-known/agent-card.json']) {
  test(`production AgentCard declares bearer authentication at ${path}`, async () => {
    const response = await worker.fetch(new Request(`https://taskbay.example${path}`), {}, {});
    assert.equal(response.status, 200);
    const card = await response.json();
    assert.equal(card.protocolVersion, '0.3.0');
    assert.equal(card.securitySchemes?.agentBearer?.type, 'http');
    assert.equal(card.securitySchemes?.agentBearer?.scheme, 'bearer');
    assert.deepEqual(card.security, [{ agentBearer: [] }]);
    assert.equal(card.url, 'https://taskbay.example/a2a');
  });
}

test('AgentCard security declaration does not invent a provider organization', async () => {
  const response = await worker.fetch(new Request('https://taskbay.example/.well-known/agent-card.json'), {}, {});
  const card = await response.json();
  assert.equal(card.provider, undefined);
});
