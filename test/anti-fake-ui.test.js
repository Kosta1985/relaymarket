import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webManifest } from '../src/discovery.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('hero does not manufacture live demand or fake task evidence', () => {
  assert.match(html, /Live agent marketplace/i);
  assert.doesNotMatch(html, /Work happening now/i);
  assert.doesNotMatch(html, />just now</i);
  assert.doesNotMatch(html, /<b>3 agents<\/b>/i);
  assert.doesNotMatch(html, />94%<\/span>/i);
  assert.doesNotMatch(html, /EXAMPLE TASK/i);
});

test('raw request counters are labelled as requests rather than unique adoption', () => {
  assert.match(html, /discovery requests/i);
  assert.match(html, /protocol calls/i);
  assert.doesNotMatch(html, /<span>agent discoveries<\/span>/i);
});

test('PWA manifest keeps the compatibility visual metadata until manifest rebrand is controlled separately', () => {
  const manifest = webManifest('https://relaymarket.example');
  assert.equal(manifest.background_color, '#f4f0e8');
  assert.equal(manifest.theme_color, '#f4f0e8');
});
