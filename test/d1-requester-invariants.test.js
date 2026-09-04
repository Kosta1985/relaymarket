import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertBoundRequester, requesterOwnsTransition } from '../cloudflare/src/repository-invariants.js';

function capture(fn) {
  try { fn(); return null; }
  catch (error) { return error; }
}

test('D1 requester invariant rejects tasks without a bound requester', () => {
  const error = capture(() => assertBoundRequester({ requesterAgentId: null }, 'agent_x'));
  assert.equal(error?.code, 'task_requester_unbound');
  assert.equal(error?.status, 409);
});

test('D1 requester invariant requires an explicit requester identity', () => {
  const error = capture(() => assertBoundRequester({ requesterAgentId: 'agent_owner' }, ''));
  assert.equal(error?.code, 'requester_agent_required');
  assert.equal(error?.status, 401);
});

test('D1 requester invariant rejects requester substitution', () => {
  const error = capture(() => assertBoundRequester({ requesterAgentId: 'agent_owner' }, 'agent_other'));
  assert.equal(error?.code, 'requester_mismatch');
  assert.equal(error?.status, 403);
});

test('D1 requester invariant accepts the bound requester', () => {
  assert.doesNotThrow(() => assertBoundRequester({ requesterAgentId: 'agent_owner' }, 'agent_owner'));
});

test('revision, completion and dispute are requester-owned transitions', () => {
  assert.equal(requesterOwnsTransition({ status: 'delivered' }, 'working'), true);
  assert.equal(requesterOwnsTransition({ status: 'delivered' }, 'completed'), true);
  assert.equal(requesterOwnsTransition({ status: 'delivered' }, 'disputed'), true);
  assert.equal(requesterOwnsTransition({ status: 'accepted' }, 'working'), false);
  assert.equal(requesterOwnsTransition({ status: 'working' }, 'delivered'), false);
});

test('production Worker installs D1 invariant guards before loading the application', async () => {
  const source = await readFile(new URL('../cloudflare/src/instrumented.js', import.meta.url), 'utf8');
  const guardIndex = source.indexOf("import './repository-invariants.js';");
  const appIndex = source.indexOf("import app from './index.js';");
  assert.ok(guardIndex >= 0);
  assert.ok(appIndex > guardIndex);
});

test('D1 guard wraps createTask, provider selection, requester transitions and payment creation', async () => {
  const source = await readFile(new URL('../cloudflare/src/repository-invariants.js', import.meta.url), 'utf8');
  for (const method of ['createTask', 'selectProvider', 'transition', 'createPayment']) {
    assert.match(source, new RegExp(`proto\\.${method}\\s*=`));
  }
  assert.match(source, /task_requester_unbound/);
  assert.match(source, /requester_mismatch/);
  assert.match(source, /requester_agent_required/);
});
