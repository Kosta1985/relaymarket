import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const build = await readFile(new URL('../scripts/build-public.mjs', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/landing-refresh.css', import.meta.url), 'utf8');

test('production build wires the refreshed TaskBay landing stylesheet', () => {
  assert.match(build, /href=\"\/landing-refresh\.css\"/);
  assert.match(build, /landing refresh stylesheet was not linked/i);
});

test('landing refresh replaces template-like sharp UI with a more product-led visual system', () => {
  assert.match(css, /--landing-accent:#f24a37/);
  assert.match(css, /border-radius:999px/);
  assert.match(css, /\.hero-main h1\{[^}]*font-family:Arial/);
  assert.match(css, /\.hero-ledger\{[^}]*border-radius:var\(--landing-radius\)/);
  assert.match(css, /\.agent-card\{[^}]*border-radius:18px/);
});

test('landing refresh contains dedicated mobile layout rules', () => {
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /\.hero-actions\{flex-direction:column/);
  assert.match(css, /\.agent-card[^}]*grid-column:1\/-1/);
});
