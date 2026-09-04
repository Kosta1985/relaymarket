const REQUESTER_REST_ACTIONS = new Set(['select', 'revise', 'complete', 'dispute', 'payment']);
const MCP_PUBLISH_TOOLS = new Set(['taskbay_publish_task', 'relaymarket_publish_task']);
const MCP_REQUESTER_TOOLS = new Set([
  'taskbay_complete_task',
  'relaymarket_complete_task',
  'taskbay_dispute_task',
  'relaymarket_dispute_task',
  'taskbay_create_payment',
  'relaymarket_create_payment'
]);
const A2A_REQUESTER_ACTIONS = new Set(['complete_task', 'dispute_task', 'create_payment']);

export async function enforceRequesterOwnership(request, env) {
  if (request.method !== 'POST') return null;
  const url = new URL(request.url);

  if (url.pathname === '/api/v1/tasks') {
    const body = await readCloneJson(request);
    if (body && !body.requesterAgentId) {
      return apiError('requester_agent_required', 401, 'A requester agent identity and matching API key are required to publish work.');
    }
    return null;
  }

  const rest = url.pathname.match(/^\/api\/v1\/tasks\/([^/]+)\/(select|revise|complete|dispute|payment)$/);
  if (rest && REQUESTER_REST_ACTIONS.has(rest[2])) {
    const body = await readCloneJson(request);
    if (!body) return null;
    const claimed = String(body.requesterAgentId || '');
    if (!claimed) return apiError('requester_agent_required', 401, 'Requester identity is required for this task action.');
    const ownership = await inspectOwnership(env.DB, decodeURIComponent(rest[1]), claimed);
    if (ownership) return apiError(ownership.code, ownership.status, ownership.message);
    return null;
  }

  if (url.pathname === '/mcp') {
    const body = await readCloneJson(request);
    if (!body || body.method !== 'tools/call') return null;
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    if (MCP_PUBLISH_TOOLS.has(name) && !args.requesterAgentId) {
      return rpcError(body.id ?? null, 'A requester agent identity and matching API key are required to publish work.');
    }
    if (MCP_REQUESTER_TOOLS.has(name)) {
      if (!args.requesterAgentId) return rpcError(body.id ?? null, 'Requester identity is required for this task action.');
      const ownership = await inspectOwnership(env.DB, args.taskId, args.requesterAgentId);
      if (ownership) return rpcError(body.id ?? null, ownership.message);
    }
    return null;
  }

  if (url.pathname === '/a2a') {
    const body = await readCloneJson(request);
    if (!body) return null;
    const message = body.params?.message ?? body.message ?? {};
    const data = (message.parts || []).find(part => part?.data)?.data || {};
    if (data.action === 'publish_task') {
      const requesterAgentId = data.task?.requesterAgentId;
      if (!requesterAgentId) return rpcError(body.id ?? null, 'A requester agent identity and matching API key are required to publish work.');
    }
    if (A2A_REQUESTER_ACTIONS.has(data.action)) {
      if (!data.requesterAgentId) return rpcError(body.id ?? null, 'Requester identity is required for this task action.');
      const ownership = await inspectOwnership(env.DB, data.taskId, data.requesterAgentId);
      if (ownership) return rpcError(body.id ?? null, ownership.message);
    }
  }

  return null;
}

async function inspectOwnership(db, taskId, claimedRequesterId) {
  if (!db || !taskId) return null;
  const row = await db.prepare('SELECT requester_agent_id FROM tasks WHERE id=?').bind(String(taskId)).first();
  if (!row) return null;
  const owner = String(row.requester_agent_id || '');
  if (!owner) {
    return {
      code: 'task_requester_unbound',
      status: 409,
      message: 'This legacy task has no bound requester and cannot perform requester-authorized actions.'
    };
  }
  if (owner !== String(claimedRequesterId || '')) {
    return {
      code: 'requester_mismatch',
      status: 403,
      message: 'The authenticated requester does not own this task.'
    };
  }
  return null;
}

async function readCloneJson(request) {
  try { return await request.clone().json(); }
  catch { return null; }
}

function apiError(error, status, message) {
  return json({ error, message }, status);
}

function rpcError(id, message) {
  return json({ jsonrpc: '2.0', id, error: { code: -32001, message } }, 400);
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer'
    }
  });
}
