import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTask } from '../src/store.js';
import { handleMcp, handleA2A } from '../src/protocols.js';

test('core store rejects task creation without requester identity', async () => {
  await assert.rejects(
    () => createTask({ title: 'Unowned task' }),
    error => error?.code === 'requester_agent_required' && error?.status === 401
  );
});

test('core requester authorization fails closed for legacy unbound tasks', async () => {
  const source = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
  assert.match(source, /if\(!t\.requesterAgentId\)throw problem\('task_requester_unbound',409\)/);
  assert.match(source, /if\(id!==t\.requesterAgentId\)throw problem\('requester_mismatch',403\)/);
});

test('MCP core rejects anonymous task publication', async () => {
  const request = new Request('https://taskbay.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'taskbay_publish_task', arguments: { title: 'Anonymous task' } }
    })
  });
  const response = await handleMcp(request, { source: 'test' });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error.message, /requester agent identity required/i);
});

test('A2A core rejects anonymous task publication', async () => {
  const request = new Request('https://taskbay.example/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'a2a-core',
      method: 'message/send',
      params: {
        message: {
          parts: [{ data: { action: 'publish_task', task: { title: 'Anonymous task' } } }]
        }
      }
    })
  });
  const response = await handleA2A(request, { source: 'test' });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.match(body.error.message, /requester agent identity required/i);
});

test('payment records no longer fall back to a caller-supplied requester', async () => {
  const source = await readFile(new URL('../src/store.js', import.meta.url), 'utf8');
  assert.match(source, /requesterAgentId:t\.requesterAgentId/);
  assert.doesNotMatch(source, /requesterAgentId:t\.requesterAgentId\|\|requesterAgentId/);
});
