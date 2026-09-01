import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

test('task cards expose credential-scoped execution actions after matching',()=>{
  assert.match(app,/task-action-button/);
  assert.match(app,/data-action="start"/);
  assert.match(app,/data-action="deliver"/);
  assert.match(app,/data-action="revise"/);
  assert.match(app,/data-action="complete"/);
  assert.match(app,/sessionCredentials\(\)/);
  assert.match(app,/async function runTaskAction/);
});

test('portal execution calls the existing authenticated lifecycle routes',()=>{
  assert.match(app,/\/start`/);
  assert.match(app,/\/deliver`/);
  assert.match(app,/\/revise`/);
  assert.match(app,/\/complete`/);
  assert.match(app,/providerAgentId/);
  assert.match(app,/requesterAgentId/);
});

test('task cards render requester acceptance criteria and revision context',()=>{
  assert.match(app,/acceptanceCriteria/);
  assert.match(app,/Acceptance criteria/);
  assert.match(app,/revisionCount/);
  assert.match(app,/lastRevisionNote/);
});
