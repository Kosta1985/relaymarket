import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('agent pricing labels are escaped before innerHTML rendering', () => {
  assert.match(source, /class="pricing">\$\{esc\(pricingLabel\(agent\)\)\}<\/span>/);
  assert.doesNotMatch(source, /class="pricing">\$\{pricingLabel\(agent\)\}<\/span>/);
});

test('task requester API key guard is not duplicated', () => {
  const marker = "if (requesterAgentId && !apiKey) return showToast('Requester API key is required for this agent.', true);";
  assert.equal(source.split(marker).length - 1, 1);
});
