import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  A2A_VERSION,
  MCP_LEGACY_VERSION,
  MCP_REGISTRY_NAME,
  agentCard,
  mcpServerJson,
  mcpTools,
  robotsTxt,
  sitemapXml,
  llmsTxt,
  securityTxt,
  openApi,
  webManifest
} from '../src/discovery.js';

const origin = 'https://relaymarket.example';

test('A2A discovery is explicit about the protocol version actually implemented', () => {
  const card = agentCard(origin);
  assert.equal(A2A_VERSION, '0.3.0');
  assert.equal(card.protocolVersion, '0.3.0');
  assert.equal(card.name, 'TaskBay');
  assert.match(card.description, /TaskBay/);
  assert.equal(card.url, `${origin}/a2a`);
  assert.equal(card.supportedInterfaces[0].protocolVersion, '0.3');
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.equal(card.supportedInterfaces[0].url, `${origin}/a2a`);
  assert.ok(card.skills.some(x => x.id === 'discover_agents'));
});

test('MCP registry metadata preserves compatibility identity while presenting TaskBay', () => {
  const server = mcpServerJson(origin);
  assert.equal(MCP_REGISTRY_NAME, 'io.github.Kosta1985/relaymarket');
  assert.equal(server.name, MCP_REGISTRY_NAME);
  assert.equal(server.title, 'TaskBay');
  assert.match(server.description, /TaskBay/);
  assert.deepEqual(server.remotes, [{ type: 'streamable-http', url: `${origin}/mcp` }]);
  assert.match(server.$schema, /modelcontextprotocol/);
  assert.equal(MCP_LEGACY_VERSION, '2025-11-25');
});

test('crawler and machine discovery files use absolute canonical URLs and TaskBay brand', () => {
  const robots = robotsTxt(origin);
  assert.match(robots, new RegExp(`Sitemap: ${origin.replaceAll('.', '\\.')}/sitemap\\.xml`));
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Disallow: \/mcp/);
  const sitemap = sitemapXml(origin);
  assert.match(sitemap, new RegExp(`<loc>${origin.replaceAll('.', '\\.')}\\/</loc>`));
  assert.equal((sitemap.match(/<url>/g) || []).length, 1);
  const llms = llmsTxt(origin);
  assert.match(llms, /^# TaskBay/m);
  for (const path of [
    '/.well-known/agent-card.json',
    '/mcp',
    '/.well-known/mcp.json',
    '/server.json',
    '/openapi.json',
    '/api/v1/stats',
    '/ecosystems.json',
    '/integrations.html',
    '/api/v1/payments/quote',
    '/api/v1/payments/stats'
  ]) {
    assert.ok(llms.includes(`${origin}${path}`), `llms.txt missing ${path}`);
  }
  const security = securityTxt(origin);
  assert.match(security, new RegExp(`Canonical: ${origin.replaceAll('.', '\\.')}\/.well-known\/security\.txt`));
  assert.match(security, /Contact: https:\/\/github\.com\/Kosta1985\/relaymarket\/security\/advisories\/new/);
  const manifest = webManifest(origin);
  assert.equal(manifest.name, 'TaskBay');
  assert.equal(manifest.short_name, 'TaskBay');
  assert.equal(manifest.icons[0].src, `${origin}/favicon.png`);
  assert.equal(manifest.icons[0].sizes, '96x96');
});

test('OpenAPI describes the complete authenticated TaskBay marketplace lifecycle', () => {
  const spec = openApi(origin);
  assert.equal(spec.info.title, 'TaskBay API');
  assert.match(spec.info.description, /TaskBay/);
  assert.equal(spec.components.securitySchemes.agentBearer.bearerFormat, 'TaskBay Agent API Key');
  for (const path of [
    '/api/v1/tasks/{id}/accept',
    '/api/v1/tasks/{id}/start',
    '/api/v1/tasks/{id}/deliver',
    '/api/v1/tasks/{id}/complete',
    '/api/v1/tasks/{id}/dispute',
    '/api/v1/tasks/{id}/cancel',
    '/api/v1/agents/{id}/credentials/{credentialId}/rotate',
    '/api/v1/agents/{id}/credentials/{credentialId}/revoke',
    '/api/v1/agents/{id}/verification-challenges/{challengeId}/verify',
    '/api/v1/tasks/{id}/payment',
    '/api/v1/tasks/{id}/protection',
    '/api/v1/payments/config',
    '/api/v1/payments/quote',
    '/api/v1/payments/stats',
    '/api/v1/agents/{id}/payout/stripe',
    '/api/v1/agents/{id}/payout/stripe/onboard',
    '/api/v1/payments/{paymentId}/release',
    '/api/v1/payments/{paymentId}/refund',
    '/api/v1/metrics',
    '/api/v1/events'
  ]) assert.ok(spec.paths[path], `missing OpenAPI path ${path}`);
  assert.deepEqual(spec.paths['/api/v1/tasks/{id}/accept'].post.security, [{ agentBearer: [] }]);
  assert.ok(spec.paths['/api/v1/tasks/{id}/accept'].post.parameters.some(x => x.name === 'Idempotency-Key'));
  assert.equal(spec.paths['/api/v1/tasks'].get.parameters[0].name, 'X-RelayMarket-Source');
});

test('portal contains canonical SEO, structured data, favicon and indexable TaskBay explanatory content', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /rel="canonical" href="__PUBLIC_ORIGIN__\//);
  assert.match(html, /rel="icon" href="\/favicon\.svg" type="image\/svg\+xml"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /"@type"\s*:\s*"WebApplication"/);
  assert.match(html, /TaskBay/i);
  assert.match(html, /Execution layer/i);
  assert.match(html, /Business model/i);
  assert.match(html, /platform fee.*1%/i);
  assert.match(html, /not live yet/i);
  assert.match(html, /MCP/i);
  assert.match(html, /A2A/i);
  assert.doesNotMatch(html, /aggregateRating|reviewCount/);
  assert.doesNotMatch(html, /\"price\"\s*:\s*\"0\"/);
});

test('trust surfaces are machine-discoverable without collapsing evidence layers', () => {
  const origin='https://relaymarket.example';
  const api=openApi(origin);
  assert.ok(api.paths['/api/v1/trust/summary']);
  assert.ok(api.paths['/api/v1/agents/{id}/trust']);
  assert.ok(api.paths['/api/v1/agents/{id}/trust/business-verification']);
  assert.ok(mcpTools().some(x=>x.name==='relaymarket_trust_summary'));
  assert.ok(mcpTools().some(x=>x.name==='relaymarket_get_protection_case'));
  assert.ok(mcpTools().some(x=>x.name==='relaymarket_add_protection_evidence'));
  const card=agentCard(origin);
  assert.ok(card.skills.some(x=>x.id==='trust_summary'));
});
