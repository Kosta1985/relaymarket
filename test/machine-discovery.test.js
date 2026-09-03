import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const discovery = JSON.parse(await readFile(new URL('../public/.well-known/taskbay.json', import.meta.url), 'utf8'));
const mcp = JSON.parse(await readFile(new URL('../public/.well-known/mcp.json', import.meta.url), 'utf8'));
const agentsTxt = await readFile(new URL('../public/agents.txt', import.meta.url), 'utf8');

const compatibilityOrigin = 'https://relaymarket.notary-labs.workers.dev';
const publicOrigin = '__PUBLIC_ORIGIN__';

test('TaskBay exposes one portable machine-readable discovery manifest for autonomous agents', () => {
  assert.equal(discovery.name, 'TaskBay');
  assert.equal(discovery.schemaVersion, '1.4');
  assert.equal(discovery.version, '__TASKBAY_VERSION__');
  assert.equal(discovery.serviceOrigin, publicOrigin);
  assert.equal(discovery.compatibilityOrigin, compatibilityOrigin);
  assert.equal(discovery.registryIdentity, 'io.github.Kosta1985/relaymarket');
  assert.equal(discovery.protocols.mcp.endpoint, `${publicOrigin}/mcp`);
  assert.equal(discovery.protocols.a2a.agentCard, `${publicOrigin}/.well-known/agent-card.json`);
  assert.equal(discovery.protocols.openapi.document, `${publicOrigin}/openapi.json`);
  assert.equal(discovery.entrypoints.agentDirectory, `${publicOrigin}/api/v1/agents`);
  assert.equal(discovery.entrypoints.taskMarket, `${publicOrigin}/api/v1/tasks`);
  assert.equal(discovery.entrypoints.agentBootstrap, `${publicOrigin}/agents.txt`);
});

test('machine discovery gives autonomous clients actionable search and handoff templates', () => {
  assert.match(discovery.queryTemplates.findAgentsByCapability, /capability=\{capability\}/);
  assert.match(discovery.queryTemplates.findAgentsByProtocol, /protocol=\{protocol\}/);
  assert.match(discovery.queryTemplates.findAgentsByCapabilityAndProtocol, /available=true/);
  assert.match(discovery.queryTemplates.rankAgentsForTask, /\{taskId\}\/matches$/);
  assert.match(discovery.queryTemplates.selectProviderForTask, /\{taskId\}\/select$/);
  assert.match(discovery.queryTemplates.requestTaskRevision, /\{taskId\}\/revise$/);
  assert.match(discovery.queryTemplates.inspectAgentTrust, /\{agentId\}\/trust$/);
  assert.ok(discovery.agentOnboarding.minimumUsefulProfile.includes('capabilities'));
  assert.match(discovery.capabilityGuidance.format, /hyphens.*underscores/i);
  assert.match(discovery.requestGuidance.retrySafety, /Idempotency-Key/);
});

test('machine discovery advertises the actual two-sided work lifecycle rather than a profile-only directory', () => {
  for (const action of [
    'discover_agents','register_agent','publish_task','rank_matches','select_provider','accept_task','start_task','deliver_artifact','request_revision','complete_task','inspect_trust_signals'
  ]) assert.ok(discovery.supportedActions.includes(action), `missing action ${action}`);
  assert.match(discovery.consentModel,/separate authenticated actions/i);
  assert.ok(discovery.taskLifecycle.includes('revision_requested'));
});

test('machine discovery is TaskBay-first while preserving compatibility identifiers', () => {
  assert.equal(discovery.requestGuidance.sourceHeader, 'X-TaskBay-Source');
  assert.equal(discovery.requestGuidance.legacySourceHeader, 'X-RelayMarket-Source');
  assert.equal(discovery.requestGuidance.idempotencyHeader, 'Idempotency-Key');
  assert.equal(discovery.commercialStatus.plannedPlatformFeePercent, 1);
  assert.equal(discovery.commercialStatus.productionPaymentCapture, 'disabled');
  assert.equal(discovery.trustPolicy.registrationIsEndorsement, false);
  assert.equal(discovery.trustPolicy.syntheticReviews, false);
});

test('MCP well-known metadata points agents toward the broader TaskBay discovery graph', () => {
  assert.equal(mcp.name, 'TaskBay');
  assert.equal(mcp.version, '__TASKBAY_VERSION__');
  assert.equal(mcp.officialRegistryName, 'io.github.Kosta1985/relaymarket');
  assert.match(mcp.machineDiscovery, /\.well-known\/taskbay\.json$/);
  assert.match(mcp.agentDirectory, /\/api\/v1\/agents$/);
  assert.match(mcp.taskMarket, /\/api\/v1\/tasks$/);
  assert.ok(mcp.keywords.includes('agent discovery'));
});

test('plain-text agent bootstrap is useful to minimal clients and search systems', () => {
  assert.match(agentsTxt, /TaskBay is an agent-to-agent work market/i);
  assert.match(agentsTxt, /GET __PUBLIC_ORIGIN__\/\.well-known\/taskbay\.json/);
  assert.match(agentsTxt, /POST __PUBLIC_ORIGIN__\/api\/v1\/agents/);
  assert.match(agentsTxt, /capability=api-review&available=true/);
  assert.match(agentsTxt, /api-review, api_review, and api review/i);
  assert.match(agentsTxt, /Idempotency-Key/);
  assert.match(agentsTxt, /X-TaskBay-Source/);
  assert.match(agentsTxt, /historical X-RelayMarket-Source/i);
  assert.match(agentsTxt, /Production payment capture is currently disabled/i);
});
