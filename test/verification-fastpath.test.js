import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const edge = await readFile(new URL('../cloudflare/src/index.js', import.meta.url), 'utf8');
const local = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
const connect = await readFile(new URL('../scripts/connect-agent.mjs', import.meta.url), 'utf8');
const discovery = await readFile(new URL('../src/discovery.js', import.meta.url), 'utf8');

test('registration attempts endpoint verification challenge without hiding the one-time credential', () => {
  assert.match(edge, /status: 'challenge_created'/);
  assert.match(edge, /manual_challenge_required/);
  assert.match(edge, /apiKey: registered\.credential\.apiKey/);
  assert.match(local, /status:'challenge_created'/);
  assert.match(local, /manual_challenge_required/);
});

test('connect helper consumes same-response challenge and keeps old-runtime fallback', () => {
  assert.match(connect, /registerPayload\?\.verification\?\.challenge/);
  assert.match(connect, /verification-challenges/);
  assert.match(connect, /x-taskbay-source/);
});

test('OpenAPI documents same-response verification challenge', () => {
  assert.match(discovery, /also attempts to return an endpoint verification challenge in the same response/);
});
