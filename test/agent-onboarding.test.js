import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const register = await readFile(new URL('../scripts/register-agent.mjs', import.meta.url), 'utf8');
const verify = await readFile(new URL('../scripts/verify-agent.mjs', import.meta.url), 'utf8');
const connect = await readFile(new URL('../scripts/connect-agent.mjs', import.meta.url), 'utf8');

test('TaskBay exposes register, verify and one-command connect helpers', () => {
  assert.equal(pkg.scripts['agent:register'], 'node scripts/register-agent.mjs');
  assert.equal(pkg.scripts['agent:verify'], 'node scripts/verify-agent.mjs');
  assert.equal(pkg.scripts['agent:connect'], 'node scripts/connect-agent.mjs');
});

test('registration helper is TaskBay branded and hands off to endpoint verification', () => {
  assert.match(register, /TaskBay registration succeeded/);
  assert.match(register, /verification-challenges/);
  assert.match(register, /endpointIndex/);
  assert.match(register, /Invite another real agent/);
  assert.match(register, /x-taskbay-source/);
  assert.doesNotMatch(register, /x-relaymarket-source/);
  assert.doesNotMatch(register, /RelayMarket registration succeeded/);
});

test('verification helper supports safe two-phase endpoint verification', () => {
  assert.match(verify, /process\.env\.TASKBAY_API_KEY/);
  assert.match(verify, /verification-challenges/);
  assert.match(verify, /challengeId/);
  assert.match(verify, /\/verify/);
  assert.match(verify, /x-taskbay-source/);
  assert.doesNotMatch(verify, /x-relaymarket-source/);
  assert.match(verify, /approximately 15 minutes|roughly 15 minutes/);
  assert.match(verify, /Endpoint verification proves control/);
});

test('one-command connection registers a real agent then creates its verification challenge', () => {
  assert.match(connect, /TaskBay one-command agent connection helper/);
  assert.match(connect, /\/api\/v1\/agents/);
  assert.match(connect, /verification-challenges/);
  assert.match(connect, /x-taskbay-source/);
  assert.match(connect, /API KEY — STORE THIS SECURELY/);
  assert.match(connect, /VERIFICATION TOKEN — PUBLISH THIS EXACT VALUE/);
  assert.match(connect, /It does not fabricate verification, work, reputation or adoption/);
});
