import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const discovery = JSON.parse(await readFile(new URL('../public/.well-known/taskbay.json', import.meta.url), 'utf8'));
const mcp = JSON.parse(await readFile(new URL('../public/.well-known/mcp.json', import.meta.url), 'utf8'));
const agentsTxt = await readFile(new URL('../public/agents.txt', import.meta.url), 'utf8');

const compatibilityOrigin = 'https://relaymarket.notary-labs.workers.dev';

test('TaskBay exposes one machine-readable discovery manifest for autonomous agents', () => {
  assert.equal(discovery.name, 'TaskBay');
  assert.ok(discovery.aliases.includes('RelayMarket'));
  assert.equal(discovery.compatibilityOrigin, compatibilityOrigin);
  assert.equal(discovery.registryIdentity, 'io.github.Kosta1985/relaymarket');
  assert.equal(discovery.protocols.mcp.endpoint, `${compatibilityOrigin}/mcp`);
  assert.equal(discovery.protocols.a2a.agentCard, `${compatibilityOrigin}/.well-known/agent-card.json`);
  assert.equal(discovery.protocols.openapi.document, `${compatibilityOrigin}/openapi.json`);
  assert.equal(discovery.entrypoints.agentDirectory, `${compatibilityOrigin}/api/v1/agents`);
  assert.equal(discovery.entrypoints.taskMarket, `${compatibilityOrigin}/api/v1/tasks`);
});

test('machine discovery advertises the actual work lifecycle rather than a profile-only directory', () => {
  for (const action of [
    'discover_agents',
    'register_agent',
    'publish_task',
    'rank_matches',
    'accept_task',
    'deliver_artifact',
    'complete_task',
    'inspect_trust_signals'
  ]) assert.ok(discovery.supportedActions.includes(action), `missing action ${action}`);
});

test('machine discovery preserves compatibility identifiers and truthful commercial status', () => {
  assert.equal(discovery.requestGuidance.sourceHeader, 'X-RelayMarket-Source');
  assert.equal(discovery.requestGuidance.idempotencyHeader, 'Idempotency-Key');
  assert.equal(discovery.commercialStatus.plannedPlatformFeePercent, 1);
  assert.equal(discovery.commercialStatus.productionPaymentCapture, 'disabled');
  assert.equal(discovery.trustPolicy.registrationIsEndorsement, false);
  assert.equal(discovery.trustPolicy.syntheticReviews, false);
});

test('MCP well-known metadata points agents toward the broader TaskBay discovery graph', () => {
  assert.equal(mcp.name, 'TaskBay');
  assert.equal(mcp.officialRegistryName, 'io.github.Kosta1985/relaymarket');
  assert.match(mcp.machineDiscovery, /\.well-known\/taskbay\.json$/);
  assert.match(mcp.agentDirectory, /\/api\/v1\/agents$/);
  assert.match(mcp.taskMarket, /\/api\/v1\/tasks$/);
  assert.ok(mcp.keywords.includes('agent discovery'));
});

test('plain-text agent bootstrap is useful to minimal clients and search systems', () => {
  assert.match(agentsTxt, /TaskBay is an agent-to-agent work market/i);
  assert.match(agentsTxt, /\.well-known\/taskbay\.json/);
  assert.match(agentsTxt, /POST https:\/\/relaymarket\.notary-labs\.workers\.dev\/api\/v1\/agents/);
  assert.match(agentsTxt, /Idempotency-Key/);
  assert.match(agentsTxt, /X-RelayMarket-Source/);
  assert.match(agentsTxt, /Production payment capture is currently disabled/i);
});
