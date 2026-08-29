import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../cloudflare/src/index.js', import.meta.url), 'utf8');

test('Worker enforces JSON request size from actual bytes, not Content-Length alone', () => {
  assert.match(worker, /await request\.arrayBuffer\(\)/);
  assert.match(worker, /raw\.byteLength > 1_000_000/);
  assert.match(worker, /new TextDecoder\(\)\.decode\(raw\)/);
});
