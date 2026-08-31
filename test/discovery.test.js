import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openApi, a2aAgentCard, serverJson } from '../src/discovery.js';

const origin = 'https://relaymarket.example';

test('A2A discovery is explicit about the protocol version actually implemented', () => {
  const card = a2aAgentCard(origin);
  assert.equal(card.protocolVersion, '0.3.0');
  assert.equal(card.url, `${origin}/a2a`);
});

test('MCP registry metadata points at one public Streamable HTTP endpoint', () => {
  const server = serverJson(origin);
  assert.equal(server.name, 'io.github.Kosta1985/relaymarket');
  assert.ok(Array.isArray(server.remotes));
  assert.equal(server.remotes.length, 1);
  assert.equal(server.remotes[0].type, 'streamable-http');
  assert.equal(server.remotes[0].url, `${origin}/mcp`);
});

test('crawler and machine discovery files use absolute canonical URLs', async () => {
  const robots = await readFile(new URL('../public/robots.txt', import.meta.url), 'utf8');
  const sitemap = await readFile(new URL('../public/sitemap.xml', import.meta.url), 'utf8');
  assert.match(robots, /https:\/\/relaymarket\.notary-labs\.workers\.dev\/sitemap\.xml/);
  assert.match(sitemap, /https:\/\/relaymarket\.notary-labs\.workers\.dev\//);
});

test('OpenAPI describes the complete authenticated marketplace lifecycle', () => {
  const spec = openApi(origin);
  for (const path of [
    '/api/v1/agents',
    '/api/v1/agents/{id}',
    '/api/v1/agents/{id}/verification-challenges',
    '/api/v1/agents/{id}/verification-challenges/{challengeId}/verify',
    '/api/v1/trust/summary',
    '/api/v1/agents/{id}/trust',
    '/api/v1/agents/{id}/trust/operator',
    '/api/v1/agents/{id}/trust/business-verification',
    '/api/v1/trust/reports',
    '/api/v1/tasks',
    '/api/v1/tasks/{id}/matches',
    '/api/v1/tasks/{id}/accept',
    '/api/v1/tasks/{id}/start',
    '/api/v1/tasks/{id}/deliver',
    '/api/v1/tasks/{id}/complete',
    '/api/v1/tasks/{id}/dispute',
    '/api/v1/tasks/{id}/cancel',
    '/api/v1/tasks/{id}/messages',
    '/api/v1/tasks/{id}/protection',
    '/api/v1/payments/config',
    '/api/v1/payments/quote',
    '/api/v1/payments/stats',
    '/api/v1/tasks/{id}/payment',
    '/api/v1/payments/{paymentId}/release',
    '/api/v1/payments/{paymentId}/refund',
    '/api/v1/metrics',
    '/api/v1/events'
  ]) assert.ok(spec.paths[path], `missing OpenAPI path ${path}`);
  assert.deepEqual(spec.paths['/api/v1/tasks/{id}/accept'].post.security, [{ agentBearer: [] }]);
  assert.ok(spec.paths['/api/v1/tasks/{id}/accept'].post.parameters.some(x => x.name === 'Idempotency-Key'));
});

test('portal contains canonical SEO, structured data, favicon and indexable TaskBay explanatory content', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="canonical" href="__PUBLIC_ORIGIN__\//);
  assert.match(html, /rel="icon" href="\/favicon\.png" type="image\/png" sizes="96x96"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type"\s*:\s*"WebApplication"/);
  assert.match(html, /TaskBay/i);
  assert.match(html, /Execution layer/i);
  assert.match(html, /Business model/i);
  assert.match(html, /platform fee is 1%|platform fee.*1%/i);
  assert.match(html, /not live yet/i);
  assert.match(html, /MCP/i);
  assert.match(html, /A2A/i);
  assert.doesNotMatch(html, /aggregateRating|reviewCount/);
  assert.doesNotMatch(html, /\"price\"\s*:\s*\"0\"/);
});

test('trust surfaces are machine-discoverable without collapsing evidence layers', () => {
  const api = openApi(origin);
  assert.ok(api.paths['/api/v1/trust/summary']);
  assert.ok(api.paths['/api/v1/agents/{id}/trust']);
  assert.ok(api.paths['/api/v1/agents/{id}/trust/business-verification']);
  assert.ok(api.paths['/api/v1/trust/reports']);
});
