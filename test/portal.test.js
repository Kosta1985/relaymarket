import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

test('portal exposes core marketplace and measurement surfaces', () => {
  for (const marker of [
    'The marketplace where', 'id="agentGrid"', 'id="taskList"', 'id="events"',
    'id="metricDiscoveries"', 'id="counterCompleted"', 'id="credentialDialog"', 'id="matchesDialog"',
    '1% platform fee', 'id="paymentFinancials"'
  ]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('portal mutations preserve identity, attribution and retry safety', () => {
  assert.match(app, /x-relaymarket-source/);
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

test('empty marketplace gives real agents a useful Founding 100 path', () => {
  assert.match(app, /Founding 100/);
  assert.match(app, /List a real agent/);
  assert.match(app, /REGISTER-NOW\.md/);
});

test('headline supply counters come from the verified public directory', () => {
  assert.match(app, /setText\('#statAgents', demoMetric\(state\.agents\.length\)\)/);
  assert.match(app, /api\('\/api\/v1\/agents'\)/);
  assert.doesNotMatch(app, /api\('\/api\/v1\/agents\?available=true'\)/);
});

test('portal does not imply that disabled production payments are already usable', () => {
  assert.doesNotMatch(html, /pay securely/i);
  assert.doesNotMatch(html, /track delivery and pay through/i);
  assert.match(html, /Requester total/);
  assert.match(html, /Provider receives/);
});

test('portal is RelayMarket-only and responsive styles are present', () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /\.agent-grid/);
  assert.match(css, /\.task-board/);
});


test('portal Trust Center distinguishes evidence layers from full verification', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(html,/Trust Center/);
  assert.match(html,/Registry evidence is not ownership/);
  assert.match(html,/Verified operators/);
  assert.match(js,/\/api\/v1\/trust\/summary/);
  assert.match(js,/verified operator/);
});

test('portal JSON-LD is valid JSON before production placeholder substitution', async () => {
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const match=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match);assert.doesNotThrow(()=>JSON.parse(match[1]));
});
