import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');

test('local Node runtime does not advertise wildcard browser CORS', () => {
  assert.doesNotMatch(source, /access-control-allow-origin['"]?\s*:\s*['"]\*['"]/i);
  assert.doesNotMatch(source, /['"]access-control-allow-origin['"]\s*,?\s*['"]\*['"]/i);
});
