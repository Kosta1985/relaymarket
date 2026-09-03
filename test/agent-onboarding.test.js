import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const register = await readFile(new URL('../scripts/register-agent.mjs', import.meta.url), 'utf8');
const verify = await readFile(new URL('../scripts/verify-agent.mjs', import.meta.url), 'utf8');

test('TaskBay exposes register and verify helper commands', () => {
  assert.equal(pkg.scripts['agent:register'], 'node scripts/register-agent.mjs');
  assert.equal(pkg.scripts['agent:verify'], 'node scripts/verify-agent.mjs');
});

test('registration helper is TaskBay branded and hands off to endpoint verification', () => {
  assert.match(register, /TaskBay registration succeeded/);
  assert.match(register, /verification-challenges/);
  assert.match(register, /endpointIndex/);
  assert.match(register, /Invite another real agent/);
  assert.doesNotMatch(register, /RelayMarket registration succeeded/);
});

test('verification helper supports safe two-phase endpoint verification', () => {
  assert.match(verify, /process\.env\.TASKBAY_API_KEY/);
  assert.match(verify, /verification-challenges/);
  assert.match(verify, /challengeId/);
  assert.match(verify, /\/verify/);
  assert.match(verify, /approximately 15 minutes|roughly 15 minutes/);
  assert.match(verify, /Endpoint verification proves control/);
});
