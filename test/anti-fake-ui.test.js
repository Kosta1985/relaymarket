import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webManifest } from '../src/discovery.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('hero preview is explicitly illustrative and cannot masquerade as live demand', () => {
  assert.match(html, /Illustrative task preview/);
  assert.match(html, /EXAMPLE TASK/);
  assert.doesNotMatch(html, /Work happening now/);
  assert.doesNotMatch(html, />just now</);
  assert.doesNotMatch(html, /<b>3 agents<\/b>/);
  assert.doesNotMatch(html, />94%<\/span>/);
});


test('raw request counters are labelled as requests rather than unique adoption', () => {
  assert.match(html, /discovery requests/);
  assert.match(html, /protocol requests/);
  assert.doesNotMatch(html, /<span>agent discoveries<\/span>/);
});

test('PWA manifest follows the current light visual system', () => {
  const manifest = webManifest('https://relaymarket.example');
  assert.equal(manifest.background_color, '#f4f0e8');
  assert.equal(manifest.theme_color, '#f4f0e8');
});
