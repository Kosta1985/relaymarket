import { VERSION } from './domain.js';
import { MCP_LEGACY_VERSION, agentCard, openApi, mcpTools } from './discovery.js';
import { createTask, getTask, listAgents, matches, listMessages, createMessage, acceptTask, startTask, deliverTask, completeTask, disputeTask, cancelTask, stats, authenticateApiKey, getIdempotent, saveIdempotent, createPayment } from './store.js';
import { paymentQuote } from './payments.js';
import { requestFingerprint } from './security.js';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

export { agentCard, openApi };

export async function handleMcp(request, ctx = {}) {
  const body = await request.json();
  const id = body.id ?? null;
  try {
    if (body.method === 'server/discover') {
      return rpc(id, {
        supportedVersions: [MCP_LEGACY_VERSION],
        capabilities: { tools: { listChanged: false } },
        instructions: 'Use TaskBay tools to discover agents, publish tasks, rank matches, inspect tasks, read task messages, and query marketplace statistics.',
        ttlMs: 300000,
        cacheScope: 'public',
        _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'taskbay', version: VERSION } }
      });
    }
    if (body.method === 'initialize') {
      return rpc(id, {
        protocolVersion: MCP_LEGACY_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'taskbay', version: VERSION },
        instructions: 'TaskBay is an agent-to-agent marketplace. Prefer the discovery and task tools over scraping the human portal.'
      });
    }
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (body.method === 'tools/list') return rpc(id, { tools: mcpTools() });
    if (body.method === 'tools/call') return rpc(id, await callTool(body.params?.name, body.params?.arguments || {}, request, ctx));
    return rpcError(id, -32601, 'Method not found');
  } catch (e) {
    return rpcError(id, -32000, e.message || 'Tool error');
  }
}

export async function handleA2A(request, ctx = {}) {
  const body = await request.json();
  const id = body.id ?? null;
  try {
    if (body.method !== 'message/send' && body.method !== undefined) {
      return json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }, 400);
    }
    const message = body.params?.message ?? body.message ?? {};
    const text = (message.parts || []).map(p => p.text || '').join('\n');
    const data = (message.parts || []).find(p => p.data)?.data || {};
    let result;
    if (data.action === 'discover_agents') result = { agents: listAgents(data.filters || {}) };
    else if (data.action === 'publish_task') {
      const taskInput = data.task || {};
      await requireProtocolAgent(request, taskInput.requesterAgentId);
      result = await protocolMutationLocal(request, 'publish_task', taskInput, async () => ({ task: await createTask(taskInput, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'task_matches') result = { matches: matches(data.taskId) };
    else if (data.action === 'get_task') result = { task: getTask(data.taskId) };
    else if (data.action === 'task_messages') { await requireProtocolTaskParticipant(request, data.taskId); result = { messages: listMessages(data.taskId) }; }
    else if (data.action === 'accept_task') {
      await requireProtocolAgent(request, data.providerAgentId);
      result = await protocolMutationLocal(request, 'accept_task', data, async () => ({ task: await acceptTask(data.taskId, data.providerAgentId, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'start_task') {
      await requireProtocolAgent(request, data.providerAgentId);
      result = await protocolMutationLocal(request, 'start_task', data, async () => ({ task: await startTask(data.taskId, data.providerAgentId, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'deliver_task') {
      await requireProtocolAgent(request, data.providerAgentId);
      result = await protocolMutationLocal(request, 'deliver_task', data, async () => ({ task: await deliverTask(data.taskId, data.providerAgentId, data, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'complete_task') {
      await requireProtocolAgent(request, data.requesterAgentId);
      result = await protocolMutationLocal(request, 'complete_task', data, async () => ({ task: await completeTask(data.taskId, data.requesterAgentId, data, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'dispute_task') {
      await requireProtocolAgent(request, data.requesterAgentId);
      result = await protocolMutationLocal(request, 'dispute_task', data, async () => ({ task: await disputeTask(data.taskId, data.requesterAgentId, data, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'cancel_task') {
      await requireProtocolAgent(request, data.actorAgentId);
      result = await protocolMutationLocal(request, 'cancel_task', data, async () => ({ task: await cancelTask(data.taskId, data.actorAgentId, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'payment_quote') result = { quote: paymentQuote(data.amountMinor, data.currency || 'USD') };
    else if (data.action === 'create_payment') {
      await requireProtocolAgent(request, data.requesterAgentId);
      result = await protocolMutationLocal(request, 'create_payment', data, async () => ({ payment: await createPayment(data.taskId, data.requesterAgentId, data, { source: ctx.source }) }), 'a2a');
    } else if (data.action === 'send_message') {
      await requireProtocolAgent(request, data.fromAgentId);
      result = await protocolMutationLocal(request, 'send_message', data, async () => ({ message: await createMessage(data.taskId, data, { source: ctx.source }) }), 'a2a');
    } else result = { help: 'Use data.action: discover_agents, publish_task, task_matches, get_task, task_messages, accept_task, start_task, deliver_task, complete_task, dispute_task, cancel_task, send_message, payment_quote, or create_payment.', receivedText: text };
    const taskId = `task_${crypto.randomUUID()}`;
    const contextId = message.contextId || `ctx_${crypto.randomUUID()}`;
    return json({
      jsonrpc: '2.0',
      id,
      result: {
        id: taskId,
        contextId,
        kind: 'task',
        status: { state: 'completed', timestamp: new Date().toISOString() },
        artifacts: [{
          artifactId: `artifact_${crypto.randomUUID()}`,
          name: 'TaskBayResult',
          parts: [{ kind: 'data', data: result }]
        }],
        history: message.messageId ? [{ ...message, taskId, contextId, kind: 'message' }] : undefined,
        metadata: { service: 'TaskBay', action: data.action || 'help' }
      }
    });
  } catch (e) {
    return json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message || 'A2A error' } }, 400);
  }
}

async function callTool(name, args, request, ctx = {}) {
  let value;
  if (['taskbay_discover_agents','relaymarket_discover_agents'].includes(name)) value = { agents: listAgents({ capability: args.capability, protocol: args.protocol, available: args.available === false ? undefined : 'true' }) };
  else if (['taskbay_publish_task','relaymarket_publish_task'].includes(name)) {
    await requireProtocolAgent(request, args.requesterAgentId);
    value = await protocolMutationLocal(request, 'publish_task', args, async () => ({ task: await createTask(args, { source: ctx.source }) }));
  } else if (['taskbay_task_matches','relaymarket_task_matches'].includes(name)) value = { matches: matches(args.taskId) };
  else if (['taskbay_get_task','relaymarket_get_task'].includes(name)) value = { task: getTask(args.taskId) };
  else if (['taskbay_task_messages','relaymarket_task_messages'].includes(name)) { await requireProtocolTaskParticipant(request, args.taskId); value = { messages: listMessages(args.taskId) }; }
  else if (['taskbay_accept_task','relaymarket_accept_task'].includes(name)) {
    await requireProtocolAgent(request, args.providerAgentId);
    value = await protocolMutationLocal(request, 'accept_task', args, async () => ({ task: await acceptTask(args.taskId, args.providerAgentId, { source: ctx.source }) }));
  } else if (['taskbay_start_task','relaymarket_start_task'].includes(name)) {
    await requireProtocolAgent(request, args.providerAgentId);
    value = await protocolMutationLocal(request, 'start_task', args, async () => ({ task: await startTask(args.taskId, args.providerAgentId, { source: ctx.source }) }));
  } else if (['taskbay_deliver_task','relaymarket_deliver_task'].includes(name)) {
    await requireProtocolAgent(request, args.providerAgentId);
    value = await protocolMutationLocal(request, 'deliver_task', args, async () => ({ task: await deliverTask(args.taskId, args.providerAgentId, args, { source: ctx.source }) }));
  } else if (['taskbay_complete_task','relaymarket_complete_task'].includes(name)) {
    await requireProtocolAgent(request, args.requesterAgentId);
    value = await protocolMutationLocal(request, 'complete_task', args, async () => ({ task: await completeTask(args.taskId, args.requesterAgentId, args, { source: ctx.source }) }));
  } else if (['taskbay_dispute_task','relaymarket_dispute_task'].includes(name)) {
    await requireProtocolAgent(request, args.requesterAgentId);
    value = await protocolMutationLocal(request, 'dispute_task', args, async () => ({ task: await disputeTask(args.taskId, args.requesterAgentId, args, { source: ctx.source }) }));
  } else if (['taskbay_cancel_task','relaymarket_cancel_task'].includes(name)) {
    await requireProtocolAgent(request, args.actorAgentId);
    value = await protocolMutationLocal(request, 'cancel_task', args, async () => ({ task: await cancelTask(args.taskId, args.actorAgentId, { source: ctx.source }) }));
  } else if (['taskbay_send_message','relaymarket_send_message'].includes(name)) {
    await requireProtocolAgent(request, args.fromAgentId);
    value = await protocolMutationLocal(request, 'send_message', args, async () => ({ message: await createMessage(args.taskId, args, { source: ctx.source }) }));
  } else if (['taskbay_payment_quote','relaymarket_payment_quote'].includes(name)) value = { quote: paymentQuote(args.amountMinor, args.currency || 'USD') };
  else if (['taskbay_create_payment','relaymarket_create_payment'].includes(name)) {
    await requireProtocolAgent(request, args.requesterAgentId);
    value = await protocolMutationLocal(request, 'create_payment', args, async () => ({ payment: await createPayment(args.taskId, args.requesterAgentId, args, { source: ctx.source }) }));
  } else if (['taskbay_stats','relaymarket_stats'].includes(name)) value = stats();
  else throw new Error('Unknown tool');
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}

async function protocolMutationLocal(request, operation, args, fn, protocol = 'mcp') {
  const key = request.headers.get('idempotency-key')?.trim() || null;
  if (key && (key.length < 8 || key.length > 200)) throw new Error('Invalid idempotency key');
  if (!key) return fn();
  const scope = `${protocol}:${operation}`;
  const fingerprint = requestFingerprint('MCP', scope, args);
  const cached = await getIdempotent(scope, key, fingerprint);
  if (cached) return cached.payload;
  const value = await fn();
  await saveIdempotent(scope, key, fingerprint, { status: 200, payload: value });
  return value;
}

async function requireProtocolAgent(request, claimedAgentId) {
  if (!claimedAgentId) throw new Error('Requester agent identity required');
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  const authenticated = await authenticateApiKey(m?.[1]);
  if (!authenticated) throw new Error('Valid agent API key required');
  if (authenticated !== claimedAgentId) throw new Error('API key does not belong to claimed agent');
  return authenticated;
}

async function requireProtocolTaskParticipant(request, taskId) {
  const task=getTask(taskId);
  if(!task)throw new Error('Task not found');
  const auth=request.headers.get('authorization')||'';
  const token=auth.match(/^Bearer\s+(.+)$/i)?.[1];
  const actor=await authenticateApiKey(token);
  if(!actor)throw new Error('Valid agent API key required');
  if(![task.requesterAgentId,task.providerAgentId].filter(Boolean).includes(actor))throw new Error('Actor is not a task participant');
  return actor;
}
function rpc(id, result) { return json({ jsonrpc: '2.0', id, result }); }
function rpcError(id, code, message) { return json({ jsonrpc: '2.0', id, error: { code, message } }, 400); }
function json(v, status = 200) { return new Response(JSON.stringify(v), { status, headers: JSON_HEADERS }); }