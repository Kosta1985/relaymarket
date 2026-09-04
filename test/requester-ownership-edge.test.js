import test from 'node:test';
import assert from 'node:assert/strict';
import { enforceRequesterOwnership } from '../cloudflare/src/requester-ownership.js';

function envWithTask(requesterAgentId, providerAgentId = null) {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return requesterAgentId === undefined ? null : { requester_agent_id: requesterAgentId, provider_agent_id: providerAgentId };
              }
            };
          }
        };
      }
    }
  };
}

const envWithRequester = requesterAgentId => envWithTask(requesterAgentId);

async function payload(response) {
  return response ? response.json() : null;
}

test('edge rejects publishing a REST task without a requester identity', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Unowned task' })
  });
  const response = await enforceRequesterOwnership(request, envWithRequester(undefined));
  assert.equal(response.status, 401);
  assert.equal((await payload(response)).error, 'requester_agent_required');
});

test('edge allows a REST task publish when requester identity is present', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Owned task', requesterAgentId: 'agent_requester' })
  });
  assert.equal(await enforceRequesterOwnership(request, envWithRequester(undefined)), null);
});

test('legacy unbound tasks cannot perform requester-authorized actions', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_legacy/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requesterAgentId: 'agent_attacker' })
  });
  const response = await enforceRequesterOwnership(request, envWithRequester(null));
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, 'task_requester_unbound');
});

test('requester-authorized actions reject a different claimed requester', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_owned/dispute', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requesterAgentId: 'agent_other' })
  });
  const response = await enforceRequesterOwnership(request, envWithRequester('agent_owner'));
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error, 'requester_mismatch');
});

test('requester-authorized actions pass the ownership guard for the bound requester', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_owned/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ requesterAgentId: 'agent_owner' })
  });
  assert.equal(await enforceRequesterOwnership(request, envWithRequester('agent_owner')), null);
});

test('legacy unbound tasks cannot be cancelled by an arbitrary actor', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_legacy/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actorAgentId: 'agent_attacker' })
  });
  const response = await enforceRequesterOwnership(request, envWithTask(null, null));
  assert.equal(response.status, 409);
  assert.equal((await payload(response)).error, 'task_requester_unbound');
});

test('assigned provider may cancel a legacy unbound task', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_legacy/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actorAgentId: 'agent_provider' })
  });
  assert.equal(await enforceRequesterOwnership(request, envWithTask(null, 'agent_provider')), null);
});

test('owned task cancellation rejects a non-participant actor', async () => {
  const request = new Request('https://taskbay.example/api/v1/tasks/task_owned/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actorAgentId: 'agent_other' })
  });
  const response = await enforceRequesterOwnership(request, envWithTask('agent_owner', 'agent_provider'));
  assert.equal(response.status, 403);
  assert.equal((await payload(response)).error, 'actor_not_authorized');
});

test('MCP publish rejects an anonymous requester before tool execution', async () => {
  const request = new Request('https://taskbay.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'taskbay_publish_task', arguments: { title: 'Anonymous MCP task' } } })
  });
  const response = await enforceRequesterOwnership(request, envWithRequester(undefined));
  const body = await payload(response);
  assert.equal(response.status, 400);
  assert.equal(body.id, 7);
  assert.match(body.error.message, /requester agent identity/i);
});

test('MCP cancellation rejects a non-participant actor before tool execution', async () => {
  const request = new Request('https://taskbay.example/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'taskbay_cancel_task', arguments: { taskId: 'task_owned', actorAgentId: 'agent_other' } } })
  });
  const response = await enforceRequesterOwnership(request, envWithTask('agent_owner', 'agent_provider'));
  const body = await payload(response);
  assert.equal(response.status, 400);
  assert.equal(body.id, 8);
  assert.match(body.error.message, /bound requester or assigned provider/i);
});

test('A2A publish rejects an anonymous requester before task creation', async () => {
  const request = new Request('https://taskbay.example/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'a2a-1', method: 'message/send', params: { message: { parts: [{ data: { action: 'publish_task', task: { title: 'Anonymous A2A task' } } }] } } })
  });
  const response = await enforceRequesterOwnership(request, envWithRequester(undefined));
  const body = await payload(response);
  assert.equal(response.status, 400);
  assert.equal(body.id, 'a2a-1');
  assert.match(body.error.message, /requester agent identity/i);
});

test('A2A cancellation allows the assigned provider on a legacy unbound task', async () => {
  const request = new Request('https://taskbay.example/a2a', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'a2a-2', method: 'message/send', params: { message: { parts: [{ data: { action: 'cancel_task', taskId: 'task_legacy', actorAgentId: 'agent_provider' } }] } } })
  });
  assert.equal(await enforceRequesterOwnership(request, envWithTask(null, 'agent_provider')), null);
});
