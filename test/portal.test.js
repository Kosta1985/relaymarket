import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('portal exposes core TaskBay marketplace and measurement surfaces', () => {
  for (const marker of [
    'Work moves', 'TaskBay', 'id="agentGrid"', 'id="taskList"', 'id="events"',
    'id="metricDiscoveries"', 'id="counterCompleted"', 'id="credentialDialog"', 'id="matchesDialog"',
    '1% when paid work goes live', 'id="paymentFinancials"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
});

test('portal mutations preserve compatibility identity, attribution and retry safety', () => {
  assert.match(app, /x-taskbay-source/);
  assert.match(app, /idempotency-key/);
  assert.match(app, /authorization/);
  assert.match(app, /sessionStorage/);
  assert.match(app, /credential\?\.apiKey/);
  assert.match(app, /renderPayments/);
});

test('portal completes the public agent onboarding path with endpoint verification', () => {
  assert.match(html, /Public HTTPS endpoint/);
  assert.match(html, /id="verificationStep"/);
  assert.match(html, /id="verifyEndpoint"/);
  assert.match(app, /\/verification-challenges/);
  assert.match(app, /verifyPendingEndpoint/);
  assert.match(app, /eligible for public discovery and matching/);
});

test('empty marketplace gives real agents a useful founding-market path', () => {
  assert.match(html, /Founding market/i);
  assert.match(html, /List an agent/i);
  assert.match(app, /Founding 100/);
  assert.match(app, /List a real agent/);
  assert.match(app, /join\.html/);
});

test('headline supply counters come from the verified public directory', () => {
  assert.match(app, /setText\('#statAgents', demoMetric\(state\.agents\.length\)\)/);
  assert.match(app, /api\('\/api\/v1\/agents'\)/);
  assert.doesNotMatch(app, /api\('\/api\/v1\/agents\?available=true'\)/);
});

test('portal does not imply that disabled production payments are already usable', () => {
  assert.doesNotMatch(html, /pay securely/i);
  assert.doesNotMatch(html, /track delivery and pay through/i);
  assert.match(html, /not live yet/i);
  assert.match(html, /when production payment capture is enabled/i);
  assert.match(html, /planned platform fee is 1%|planned platform fee.*1%/i);
  assert.match(html, /Example requester total/);
  assert.match(html, /Example provider quote/);
});

test('static CTA bindings required by app.js remain present in the portal HTML', () => {
  for (const id of [
    'openTask', 'heroPost', 'ctaTask', 'openAgent', 'ctaAgent',
    'closeTask', 'closeAgent', 'closeMatches', 'closeCredential',
    'requesterSelect', 'agentSearch', 'protocolFilter', 'taskFilter',
    'refreshActivity', 'taskForm', 'agentForm', 'copyCredential',
    'copyVerificationToken', 'verifyEndpoint'
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `missing static DOM binding #${id}`);
  }
});

test('portal event wiring is resilient to optional CTA removal', () => {
  assert.match(app, /function bind\(selector, event, handler\)/);
  assert.match(app, /if \(target\) target\.addEventListener/);
  assert.match(app, /for \(const selector of \['#openTask', '#heroPost', '#ctaTask'\]\)/);
  assert.match(app, /for \(const selector of \['#openAgent', '#ctaAgent'\]\)/);
  assert.doesNotMatch(app, /\.onclick\s*=\s*\$\('#/);
});

test('portal is TaskBay-branded while compatibility code remains intact and responsive', () => {
  assert.match(html, /TaskBay/);
  assert.doesNotMatch(html, /<span class="brand-word">RelayMarket<\/span>/);
  assert.match(css, /@media\(max-width:(?:1000|680)px\)/);
  assert.match(css, /\.agent-grid/);
  assert.match(css, /\.task-board/);
});

test('portal trust architecture distinguishes evidence layers from full verification', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/Trust architecture/i);
  assert.match(html,/registration, endpoint control, business evidence, operator verification and transaction history/i);
  assert.match(html,/Verified operators/);
  assert.match(js,/\/api\/v1\/trust\/summary/);
  assert.match(js,/verified operator/);
});

test('portal JSON-LD is valid JSON before production placeholder substitution', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const match=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match);assert.doesNotThrow(()=>JSON.parse(match[1]));
});

test('task publishing immediately continues into capability matching', () => {
  assert.match(app, /const taskId = created\?\.task\?\.id/);
  assert.match(app, /if \(taskId\) await showMatches\(taskId\)/);
  assert.match(app, /\/api\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/matches/);
});

test('requester selection and provider acceptance require the correct browser-held credentials', () => {
  assert.match(app, /const canSelect = Boolean\(task\?\.requesterAgentId && credentials\[task\.requesterAgentId\]\)/);
  assert.match(app, /const canAccept = Boolean\(credentials\[agent\.id\] && \(!task\?\.selectedProviderAgentId \|\| selected\)\)/);
  assert.match(app, /match-select-button/);
  assert.match(app, /async function selectMatchedProvider/);
  assert.match(app, /Requester credential is required to select a provider/);
  assert.match(app, /\/api\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/select/);
  assert.match(app, /match-accept-button/);
  assert.match(app, /async function acceptMatchedTask/);
  assert.match(app, /sessionCredentials\(\)\[agentId\]/);
  assert.match(app, /\/api\/v1\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/accept/);
  assert.match(app, /providerAgentId: agentId/);
});

test('agent cards expose evidence-backed profiles and a task handoff path', () => {
  assert.match(app, /agent-profile-button/);
  assert.match(app, /async function showAgentProfile/);
  assert.match(app, /Market evidence/);
  assert.match(app, /Provider actions require the agent owner API key/);
  assert.match(app, /prefillTaskForAgent/);
});