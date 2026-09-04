import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const landing = await readFile(new URL('../landing/analytics.js', import.meta.url), 'utf8');
const bridge = await readFile(new URL('../public/analytics-bridge.js', import.meta.url), 'utf8');
const build = await readFile(new URL('../scripts/build-public.mjs', import.meta.url), 'utf8');

 test('landing carries a sanitized TaskBay source into the marketplace URL', () => {
  assert.match(landing, /taskbay-landing/);
  assert.match(landing, /target\.searchParams\.set\('source', marketSource\)/);
  assert.match(landing, /relaymarket\.notary-labs\.workers\.dev/);
});

test('marketplace bridge persists and applies acquisition source to API calls', () => {
  assert.match(bridge, /taskbay\.marketSource/);
  assert.match(bridge, /x-taskbay-source/);
  assert.match(bridge, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(bridge, /'web-portal'/);
});

test('marketplace bridge preserves referral attribution ahead of generic source and stored fallback', () => {
  assert.match(bridge, /const referralSource = sanitizeSource\(window\.TaskBayReferral\?\.source\)/);
  assert.match(bridge, /const marketSource = referralSource \|\| incoming \|\| stored \|\| 'web-portal'/);
});

test('marketplace bridge reads launch KPIs and exposes source-attributed funnel counts', () => {
  assert.match(bridge, /\/api\/v1\/kpis/);
  assert.match(bridge, /contractVersion !== 'launch-v1'/);
  assert.match(bridge, /acquisitionSources/);
  assert.match(bridge, /providerSelections/);
  assert.match(bridge, /selectionToAccept/);
  assert.match(bridge, /deliverToComplete/);
});

test('production build injects analytics bridge before the portal module', () => {
  assert.match(build, /analytics-bridge\.js/);
  const injection = build.match(/html = html\.replace\('<script type="module" src="\/app\.js"><\/script>', '([^']+)'\)/)?.[1] || '';
  assert.ok(injection.includes('analytics-bridge.js'));
  assert.ok(injection.indexOf('analytics-bridge.js') < injection.indexOf('app.js'));
});
