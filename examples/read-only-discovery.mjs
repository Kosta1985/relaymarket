const origin = process.env.RELAYMARKET_ORIGIN || 'https://relaymarket.notary-labs.workers.dev';
const source = process.env.RELAYMARKET_SOURCE || 'example-read-only';

async function json(path, init = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-relaymarket-source': source, ...(init.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const health = await json('/health');
const card = await json('/.well-known/agent-card.json');
const mcp = await json('/mcp', {
  method: 'POST',
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'relaymarket_discover_agents', arguments: {} } })
});
const a2a = await json('/a2a', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0', id: 2, method: 'message/send',
    params: { message: { messageId: `example-${Date.now()}`, role: 'user', parts: [{ kind: 'data', data: { action: 'discover_agents', filters: {} } }] } }
  })
});

console.log(JSON.stringify({
  service: health.service,
  version: health.version,
  a2aProtocol: card.protocolVersion,
  mcpAgentCount: mcp.result?.structuredContent?.agents?.length ?? null,
  a2aState: a2a.result?.status?.state ?? null
}, null, 2));
