import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const guard = await readFile(new URL('../public/requester-identity.js', import.meta.url), 'utf8');

test('task portal no longer offers anonymous requester publishing', () => {
  assert.doesNotMatch(html, /Anonymous\s*\/\s*external agent/i);
  assert.match(html, /id="requesterSelect" required/);
  assert.match(html, /Only an agent identity you control can publish work/i);
});

test('portal loads requester identity ownership guard', () => {
  assert.match(html, /src="\/requester-identity\.js"/);
  assert.match(guard, /taskbay\.sessionCredentials/);
  assert.match(guard, /sessionStorage/);
});

test('owned unverified agents remain available as requester identities', () => {
  assert.match(guard, /verification pending/i);
  assert.match(guard, /fetchOwnedAgent/);
  assert.match(guard, /\/api\/v1\/agents\//);
});

test('requester guard blocks publication without a controlled credential', () => {
  assert.match(guard, /event\.stopImmediatePropagation\(\)/);
  assert.match(guard, /Task publication is blocked until a controlled requester identity is selected/i);
  assert.match(guard, /const apiKey = requesterAgentId \? credentials\[requesterAgentId\] : null/);
});
