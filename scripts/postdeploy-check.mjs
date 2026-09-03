import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const input = process.env.TARGET_ORIGIN || process.env.PUBLIC_ORIGIN;
if (!input) throw new Error('Set TARGET_ORIGIN to the deployed TaskBay HTTPS origin.');
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
      headers: { 'user-agent': `TaskBay-PostDeploy/${pkg.version}`, ...(init.headers || {}) },
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
function taskBayOrLegacy(value, current, legacy, label) {
  if (requireCurrentRelease) ok(value === current, `${label} must be ${current}, got ${value}`);
  else ok([current, legacy].includes(value), `${label} must be ${current} or migration-compatible ${legacy}, got ${value}`);
}

const health = await json('/health');
ok(health.r.status === 200, `/health status ${health.r.status}`);
taskBayOrLegacy(health.body.service, 'taskbay', 'relaymarket', '/health service');
ok(health.body.version === pkg.version, `/health version ${health.body.version} != ${pkg.version}`);

const homeResponse = await request('/');
ok(homeResponse.status === 200, `/ status ${homeResponse.status}`);
const home = await homeResponse.text();
includes(home, `<link rel="canonical" href="${origin}/">`, 'home canonical');
includes(home, 'application/ld+json', 'home structured data');
ok(!home.includes('__PUBLIC_ORIGIN__'), 'home still contains the PUBLIC_ORIGIN build placeholder');
if (requireCurrentRelease) {
  ok(/<title>TaskBay\b/i.test(home), 'TaskBay page title is missing');
  includes(home, 'not live yet', 'home payment status');
  ok(!home.includes('<span class="brand-word">RelayMarket</span>'), 'legacy RelayMarket human-facing header/footer brand is still present');
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
  taskBayOrLegacy(card.body.name, 'TaskBay', 'RelayMarket', `${cardPath} name`);
  ok(card.body.protocolVersion === '0.3.0', `${cardPath} advertises unexpected A2A version`);
  ok(card.body.url === `${origin}/a2a`, `${cardPath} A2A URL mismatch`);
}

const mcpDiscovery = await json('/.well-known/mcp.json');
ok(mcpDiscovery.r.status === 200, `/.well-known/mcp.json status ${mcpDiscovery.r.status}`);
taskBayOrLegacy(mcpDiscovery.body.name, 'TaskBay', 'RelayMarket', '/.well-known/mcp.json name');
if (requireCurrentRelease) {
  ok(mcpDiscovery.body.version === pkg.version, `/.well-known/mcp.json version ${mcpDiscovery.body.version} != ${pkg.version}`);
  ok(mcpDiscovery.body.transport === 'streamable-http', '/.well-known/mcp.json transport mismatch');
  ok(mcpDiscovery.body.endpoint === `${origin}/mcp`, '/.well-known/mcp.json MCP endpoint mismatch');
  ok(mcpDiscovery.body.officialRegistryName === 'io.github.Kosta1985/relaymarket', '/.well-known/mcp.json historical registry identity mismatch');
  ok(mcpDiscovery.body.paymentsEnabled === false, '/.well-known/mcp.json must advertise paymentsEnabled=false for this release');
}

const openapi = await json('/openapi.json');
ok(openapi.r.status === 200, `/openapi.json status ${openapi.r.status}`);
if (requireCurrentRelease) ok(openapi.body.info?.title === 'TaskBay API', `OpenAPI title mismatch: ${openapi.body.info?.title}`);
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
ok(server.body.name === 'io.github.Kosta1985/relaymarket', 'MCP Registry compatibility identity mismatch');
if (requireCurrentRelease) ok(server.body.title === 'TaskBay', 'MCP Registry metadata title must be TaskBay');
ok(server.body.version === pkg.version, 'server.json version mismatch');
ok(server.body.remotes?.[0]?.url === `${origin}/mcp`, 'server.json MCP URL mismatch');

const mcpGet = await request('/mcp');
ok(mcpGet.status === 405, `GET /mcp expected 405, got ${mcpGet.status}`);
const initialize = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskbay-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
ok(initialize.r.status === 200, `MCP initialize status ${initialize.r.status}`);
taskBayOrLegacy(initialize.body.result?.serverInfo?.name, 'taskbay', 'relaymarket', 'MCP initialize server name');
ok(initialize.body.result?.serverInfo?.version === pkg.version, 'MCP initialize version mismatch');
const tools = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskbay-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
const currentTools = ['taskbay_discover_agents','taskbay_publish_task','taskbay_accept_task','taskbay_deliver_task','taskbay_complete_task','taskbay_payment_quote','taskbay_create_payment','taskbay_trust_summary','taskbay_get_protection_case','taskbay_add_protection_evidence'];
const legacyTools = currentTools.map(name => name.replace(/^taskbay_/, 'relaymarket_'));
for (let i = 0; i < currentTools.length; i++) {
  const names = requireCurrentRelease ? [currentTools[i]] : [currentTools[i], legacyTools[i]];
  ok(tools.body.result?.tools?.some(x => names.includes(x.name)), `MCP tools/list missing ${names.join(' or ')}`);
}

// Compatibility contract: legacy MCP tool IDs remain accepted during migration even though they are no longer advertised by the current release.
const legacyTool = await json('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskbay-source': 'postdeploy-legacy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'relaymarket_stats', arguments: {} } }) });
ok(legacyTool.r.status === 200, `legacy MCP alias returned HTTP ${legacyTool.r.status}`);
ok(legacyTool.body.result, 'legacy MCP alias relaymarket_stats is no longer accepted');

const a2a = await json('/a2a', { method: 'POST', headers: { 'content-type': 'application/json', 'x-taskbay-source': 'postdeploy-check' }, body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'message/send', params: { message: { messageId: 'postdeploy-discovery', role: 'user', parts: [{ kind: 'data', data: { action: 'discover_agents', filters: {} } }] } } }) });
ok(a2a.r.status === 200, `A2A status ${a2a.r.status}`);
ok(a2a.body.result?.kind === 'task', 'A2A did not return a Task');
ok(a2a.body.result?.status?.state === 'completed', 'A2A discovery Task not completed');

const llmsResponse = await request('/llms.txt');
ok(llmsResponse.status === 200, `/llms.txt status ${llmsResponse.status}`);
const llms = await llmsResponse.text();
for (const path of ['/mcp','/a2a','/openapi.json','/api/v1/stats','/api/v1/payments/quote','/api/v1/payments/stats']) includes(llms, `${origin}${path}`, 'llms.txt');

console.log(`TaskBay ${pkg.version} public discovery black-box checks passed for ${origin}${requireCurrentRelease ? ' (current release required)' : ' (migration-compatible smoke)'}`);