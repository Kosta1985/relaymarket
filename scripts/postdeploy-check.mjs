import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const input = process.env.TARGET_ORIGIN || process.env.PUBLIC_ORIGIN;
if (!input) throw new Error('Set TARGET_ORIGIN to the deployed RelayMarket HTTPS origin.');
const target = new URL(input);
if (target.pathname !== '/' || target.search || target.hash) throw new Error('TARGET_ORIGIN must be an origin only, without a path, query, or fragment.');
if (target.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(target.hostname)) throw new Error('TARGET_ORIGIN must use HTTPS.');
const origin = target.origin;
const requireCurrentRelease = process.env.REQUIRE_CURRENT_RELEASE === '1';

async function request(path, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${origin}${path}`, {
      redirect: 'manual',
      ...init,
      headers: { 'user-agent': `RelayMarket-PostDeploy/${pkg.version}`, ...(init.headers || {}) },
      signal: controller.signal
    });
  } finally { clearTimeout(timer); }
}

async function json(path, init) {
  const r = await request(path, init);
  const raw = await r.text();
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error(`${path} did not return JSON (status ${r.status})`); }
  return { r, body };
}

function ok(condition, message) { if (!condition) throw new Error(message); }
function includes(text, value, label) { ok(text.includes(value), `${label} missing ${value}`); }

const health = await json('/health');
ok(health.r.status === 200, `/health status ${health.r.status}`);
ok(health.body.service === 'relaymarket', '/health returned the wrong service');
ok(health.body.version === pkg.version, `/health version ${health.body.version} != ${pkg.version}`);

const homeResponse = await request('/');
ok(homeResponse.status === 200, `/ status ${homeResponse.status}`);
const home = await homeResponse.text();
includes(home, `<link rel="canonical" href="${origin}/">`, 'home canonical');
includes(home, 'application/ld+json', 'home structured data');
ok(!home.includes('__PUBLIC_ORIGIN__'), 'home still contains the PUBLIC_ORIGIN build placeholder');
if (requireCurrentRelease) {
  includes(home, 'Founding 100 open · live agent marketplace', 'home Founding 100 status');
  includes(home, 'not live yet', 'home payment status');
  includes(home, 'When production paid tasks are enabled, the RelayMarket platform fee is planned at 1%', 'home pricing truthfulness');
  includes(home, 'Payment Protection is not live payment capture today', 'home payment protection truthfulness');
}

const faviconResponse = await request('/favicon.png');
ok(faviconResponse.status === 200, `/favicon.png status ${faviconResponse.status}`);
ok((faviconResponse.headers.get('content-type') || '').includes('image/png'), '/favicon.png content-type is not image/png');

const robotsResponse = await request('/robots.txt');
ok(robotsResponse.status === 200, `/robots.txt status ${robotsResponse.status}`);
const robots = await robotsResponse.text();
includes(robots, `Sitemap: ${origin}/sitemap.xml`, 'robots.txt');

const sitemapResponse = await request('/sitemap.xml');
ok(sitemapResponse.status === 200, `/sitemap.xml status ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
includes(sitemap, `<loc>${origin}/</loc>`, 'sitemap');

for (const cardPath of ['/.well-known/agent-card.json', '/.well-known/agent.json']) {
  const card = await json(cardPath);
  ok(card.r.status === 200, `${cardPath} status ${card.r.status}`);
  ok(card.body.name === 'RelayMarket', `${cardPath} returned the wrong agent`);
  ok(card.body.protocolVersion === '0.3.0', `${cardPath} advertises unexpected A2A version`);
  ok(card.body.url === `${origin}/a2a`, `${cardPath} A2A URL mismatch`);
}

if (requireCurrentRelease) {
  const mcpDiscovery = await json('/.well-known/mcp.json');
  ok(mcpDiscovery.r.status === 200, `/.well-known/mcp.json status ${mcpDiscovery.r.status}`);
  ok(mcpDiscovery.body.name === 'RelayMarket', '/.well-known/mcp.json returned the wrong service');
  ok(mcpDiscovery.body.transport === 'streamable-http', '/.well-known/mcp.json transport mismatch');
  ok(mcpDiscovery.body.endpoint === `${origin}/mcp`, '/.well-known/mcp.json MCP endpoint mismatch');
  ok(mcpDiscovery.body.officialRegistryName === 'io.github.Kosta1985/relaymarket', '/.well-known/mcp.json registry identity mismatch');
}

const openapi = await json('/openapi.json');
ok(openapi.r.status === 200, `/openapi.json status ${openapi.r.status}`);
ok(openapi.body.info?.version === pkg.version, 'OpenAPI version mismatch');
for (const path of ['/api/v1/tasks/{id}/accept','/api/v1/tasks/{id}/deliver','/api/v1/tasks/{id}/complete','/api/v1/agents/{id}/credentials/{credentialId}/rotate','/api/v1/tasks/{id}/payment','/api/v1/tasks/{id}/protection','/api/v1/payments/config','/api/v1/payments/quote','/api/v1/payments/stats','/api/v1/agents/{id}/payout/stripe/onboard','/api/v1/payments/{paymentId}/release','/api/v1/payments/{paymentId}/refund','/api/v1/trust/summary','/api/v1/agents/{id}/trust','/api/v1/agents/{id}/trust/business-verification']) {
  ok(openapi.body.paths?.[path], `OpenAPI missing ${path}`);
}

const paymentConfig = await json('/api/v1/payments/config');
ok(paymentConfig.r.status === 200, `/api/v1/payments/config status ${paymentConfig.r.status}`);
ok(paymentConfig.body.platformFeeBps === 100, `platform fee must be 100 bps, got ${paymentConfig.body.platformFeeBps}`);
ok(paymentConfig.body.platformFeePercent === 1, `platform fee must be 1%, got ${paymentConfig.body.platformFeePercent}`);
if (requireCurrentRelease) {
  ok(paymentConfig.body.provider === 'disabled', `production payment provider must remain disabled for this release, got ${paymentConfig.body.provider}`);
} else {
  ok(paymentConfig.body.provider !== 'mock', 'public deployment must never expose the mock payment provider');
}
const quotedPayment = await json('/api/v1/payments/quote?amountMinor=100000&currency=AUD');
ok(quotedPayment.r.status === 200, `/api/v1/payments/quote status ${quotedPayment.r.status}`);
ok(quotedPayment.body.quote?.platformFeeMinor === 1000, 'AUD 1000 quote did not produce a 1% platform fee');
ok(quotedPayment.body.quote?.payerTotalMinor === 101000, 'AUD 1000 quote payer subtotal mismatch');

const trustSummary = await json('/api/v1/trust/summary');
ok(trustSummary.r.status === 200, `/api/v1/trust/summary status ${trustSummary.r.status}`);
ok(trustSummary.body.trust?.policyVersion === 'au-v1', 'Trust policy version mismatch');
ok(Number.isInteger(trustSummary.body.trust?.verifiedOperators), 'Trust summary missing verifiedOperators');

const server = await json('/server.json');
ok(server.r.status === 200, `/server.json status ${server.r.status}`);
ok(server.body.name === 'io.github.Kosta1985/relaymarket', 'MCP Registry name mismatch');
ok(server.body.version === pkg.version, 'server.json version mismatch');
ok(server.body.remotes?.[0]?.url === `${origin}/mcp`, 'server.json MCP URL mismatch');

const mcpGet = await request('/mcp');
ok(mcpGet.status === 405, `GET /mcp expected 405, got ${mcpGet.status}`);
const initialize = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relaymarket-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
ok(initialize.r.status === 200, `MCP initialize status ${initialize.r.status}`);
ok(initialize.body.result?.serverInfo?.name === 'relaymarket', 'MCP initialize server name mismatch');
ok(initialize.body.result?.serverInfo?.version === pkg.version, 'MCP initialize version mismatch');
const tools = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relaymarket-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
for (const tool of ['relaymarket_discover_agents','relaymarket_publish_task','relaymarket_accept_task','relaymarket_deliver_task','relaymarket_complete_task','relaymarket_payment_quote','relaymarket_create_payment','relaymarket_trust_summary','relaymarket_get_protection_case','relaymarket_add_protection_evidence']) {
  ok(tools.body.result?.tools?.some(x => x.name === tool), `MCP tools/list missing ${tool}`);
}

const a2a = await json('/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'x-relaymarket-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'message/send', params: { message: { messageId: 'postdeploy-discovery', role: 'user', parts: [{ kind: 'data', data: { action: 'discover_agents', filters: {} } }] } } }) });
ok(a2a.r.status === 200, `A2A status ${a2a.r.status}`);
ok(a2a.body.result?.kind === 'task', 'A2A did not return a Task');
ok(a2a.body.result?.status?.state === 'completed', 'A2A discovery Task not completed');

const llmsResponse = await request('/llms.txt');
ok(llmsResponse.status === 200, `/llms.txt status ${llmsResponse.status}`);
const llms = await llmsResponse.text();
for (const path of ['/mcp','/a2a','/openapi.json','/api/v1/stats','/api/v1/payments/quote','/api/v1/payments/stats']) includes(llms, `${origin}${path}`, 'llms.txt');

console.log(`RelayMarket ${pkg.version} public discovery black-box checks passed for ${origin}${requireCurrentRelease ? ' (current release required)' : ''}`);
