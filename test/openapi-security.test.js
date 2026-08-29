import test from 'node:test';
import assert from 'node:assert/strict';
import { openApi } from '../src/discovery.js';

const doc = openApi('https://relaymarket.example');

test('OpenAPI uses the declared agentBearer scheme for private task messages', () => {
  assert.deepEqual(doc.paths['/api/v1/tasks/{id}/messages'].get.security, [{ agentBearer: [] }]);
  assert.ok(doc.components.securitySchemes.agentBearer);
});

test('OpenAPI marks trust reports as authenticated', () => {
  assert.deepEqual(doc.paths['/api/v1/trust/reports'].post.security, [{ agentBearer: [] }]);
});

test('public agent trust docs do not promise private risk evidence', () => {
  const description = doc.paths['/api/v1/agents/{id}/trust'].get.responses['200'].description;
  assert.match(description, /private risk evidence is not exposed/i);
});
