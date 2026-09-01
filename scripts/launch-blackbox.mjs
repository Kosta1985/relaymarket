import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const rawTarget = process.env.TARGET_ORIGIN || process.env.PUBLIC_ORIGIN;
if (!rawTarget) throw new Error('Set TARGET_ORIGIN to the deployed TaskBay HTTPS origin.');

const target = new URL(rawTarget);
if (target.pathname !== '/' || target.search || target.hash) throw new Error('TARGET_ORIGIN must be an origin only.');
if (target.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(target.hostname)) throw new Error('TARGET_ORIGIN must use HTTPS.');
const origin = target.origin;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`${origin}${path}`, {
      redirect: 'manual',
      ...init,
      headers: {
        'user-agent': `TaskBay-Launch-Blackbox/${pkg.version}`,
        ...(init.headers || {})
      },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function text(path) {
  const response = await request(path);
  const body = await response.text();
  assert(response.status === 200, `${path} expected 200, got ${response.status}`);
  return { response, body };
}

async function json(path, init = {}) {
  const response = await request(path, init);
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); }
  catch { throw new Error(`${path} did not return JSON (status ${response.status})`); }
  assert(response.status === 200, `${path} expected 200, got ${response.status}`);
  return { response, body };
}

const health = await json('/health');
assert(health.body.status === 'ok', '/health status field is not ok');
assert(health.body.service === 'relaymarket', '/health compatibility service changed unexpectedly');
assert(health.body.version === pkg.version, `/health version ${health.body.version} != ${pkg.version}`);

const home = await text('/');
assert(home.body.includes('<title>TaskBay — Work moves between agents</title>'), 'TaskBay page title is not live');
assert(home.body.includes('/mobile.css'), 'TaskBay mobile hardening stylesheet is not linked');
assert(home.body.includes('TaskBay'), 'TaskBay brand missing from homepage');
assert(!home.body.includes('__PUBLIC_ORIGIN__'), 'homepage contains unresolved PUBLIC_ORIGIN placeholder');

const mobile = await text('/mobile.css');
assert((mobile.response.headers.get('content-type') || '').includes('text/css'), '/mobile.css content-type is not CSS');
assert(mobile.body.includes('TaskBay mobile hardening'), '/mobile.css is not the expected TaskBay mobile layer');

const manifest = await json('/.well-known/taskbay.json');
assert(manifest.body.name === 'TaskBay', 'TaskBay manifest name mismatch');
assert(manifest.body.version === pkg.version, 'TaskBay manifest version mismatch');
assert(manifest.body.serviceOrigin === origin, 'TaskBay manifest serviceOrigin mismatch');
assert(manifest.body.registryIdentity === 'io.github.Kosta1985/relaymarket', 'TaskBay manifest registry compatibility identity mismatch');
assert(manifest.body.commercialStatus?.productionPaymentCapture === 'disabled', 'TaskBay manifest must advertise production payment capture as disabled');
for (const action of ['rank_matches', 'select_provider', 'accept_task', 'start_task', 'deliver_artifact', 'request_revision', 'complete_task']) {
  assert(manifest.body.supportedActions?.includes(action), `TaskBay manifest missing supported action ${action}`);
}

const agentBootstrap = await text('/agents.txt');
for (const expected of [
  '# TaskBay agent bootstrap',
  `${origin}/.well-known/taskbay.json`,
  `${origin}/api/v1/tasks/{taskId}/select`,
  `${origin}/api/v1/tasks/{taskId}/revise`,
  'Production payment capture is currently disabled'
]) assert(agentBootstrap.body.includes(expected), `agents.txt missing ${expected}`);
assert(!agentBootstrap.body.includes('__PUBLIC_ORIGIN__'), 'agents.txt contains unresolved PUBLIC_ORIGIN placeholder');

const mcpDiscovery = await json('/.well-known/mcp.json');
assert(['TaskBay', 'RelayMarket'].includes(mcpDiscovery.body.name), 'MCP discovery display name mismatch');
assert(mcpDiscovery.body.version === pkg.version, 'MCP discovery version mismatch');
assert(mcpDiscovery.body.endpoint === `${origin}/mcp`, 'MCP discovery endpoint mismatch');
assert(mcpDiscovery.body.officialRegistryName === 'io.github.Kosta1985/relaymarket', 'MCP registry identity mismatch');
assert(mcpDiscovery.body.paymentsEnabled === false, 'MCP discovery must report paymentsEnabled=false');

const openapi = await json('/openapi.json');
assert(openapi.body.info?.version === pkg.version, 'OpenAPI version mismatch');
for (const path of [
  '/api/v1/tasks/{id}/matches',
  '/api/v1/tasks/{id}/select',
  '/api/v1/tasks/{id}/accept',
  '/api/v1/tasks/{id}/start',
  '/api/v1/tasks/{id}/deliver',
  '/api/v1/tasks/{id}/revise',
  '/api/v1/tasks/{id}/complete',
  '/api/v1/kpis'
]) assert(openapi.body.paths?.[path], `OpenAPI missing launch path ${path}`);

const agents = await json('/api/v1/agents');
assert(Array.isArray(agents.body.agents), '/api/v1/agents did not return an agents array');

const tasks = await json('/api/v1/tasks?status=open');
assert(Array.isArray(tasks.body.tasks), '/api/v1/tasks did not return a tasks array');

const kpis = await json('/api/v1/kpis');
assert(kpis.body.contractVersion === 'launch-v1', 'KPI contract version mismatch');
for (const field of ['selectionToAccept', 'acceptToDeliver', 'deliverToComplete', 'deliveredToDispute']) {
  assert(Object.hasOwn(kpis.body.conversion || {}, field), `KPI conversion missing ${field}`);
}
assert(typeof kpis.body.definitions?.matchRequests === 'string', 'KPI contract missing matchRequests definition');
assert(/not unique users/i.test(kpis.body.definitions.matchRequests), 'KPI matchRequests definition lost its truthfulness boundary');
assert(Array.isArray(kpis.body.acquisitionSources), 'KPI acquisitionSources must be an array');

const payments = await json('/api/v1/payments/config');
assert(payments.body.provider === 'disabled', `production payment provider must remain disabled, got ${payments.body.provider}`);
assert(payments.body.live === false, 'production payments unexpectedly report live=true');
assert(payments.body.platformFeeBps === 100, 'planned TaskBay platform fee must remain 100 bps');
assert(payments.body.platformFeePercent === 1, 'planned TaskBay platform fee must remain 1%');

const server = await json('/server.json');
assert(server.body.name === 'io.github.Kosta1985/relaymarket', 'server.json compatibility identity changed');
assert(server.body.version === pkg.version, 'server.json version mismatch');
assert(server.body.remotes?.[0]?.url === `${origin}/mcp`, 'server.json MCP remote mismatch');

console.log(`TaskBay ${pkg.version} launch black-box checks passed for ${origin}`);
