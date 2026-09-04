import app from './index.js';
import { enforceRequesterOwnership } from './requester-ownership.js';

const INTERNAL_SOURCES = new Set([
  'system',
  'postdeploy-check',
  'production-smoke',
  'smoke',
  'ci',
  'github-actions',
  'health-check'
]);
const AGENT_CARD_PATHS = new Set(['/.well-known/agent.json', '/.well-known/agent-card.json']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    const ownershipError = await enforceRequesterOwnership(request, env);
    if (ownershipError) return ownershipError;

    if (request.method === 'GET' && AGENT_CARD_PATHS.has(url.pathname)) {
      return serveSecuredAgentCard(request, env, ctx);
    }

    if (request.method === 'GET' && url.pathname === '/api/v1/traffic') {
      if (!env.DB) return json({ error: 'd1_not_bound' }, 503);
      return json(await trafficSnapshot(env.DB));
    }

    if (request.method === 'POST' && url.pathname === '/mcp' && env.DB) {
      try { await recordMcpClient(request, env.DB); }
      catch { /* Traffic attribution must never break MCP. */ }
    }

    return app.fetch(request, env, ctx);
  }
};

async function serveSecuredAgentCard(request, env, ctx) {
  const response = await app.fetch(request, env, ctx);
  if (!response.ok) return response;
  let card;
  try { card = await response.clone().json(); }
  catch { return response; }
  const secured = {
    ...card,
    securitySchemes: {
      ...(card.securitySchemes || {}),
      agentBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'TaskBay agent API key returned once at agent registration and sent in the Authorization header.'
      }
    },
    security: [{ agentBearer: [] }]
  };
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(secured), { status: response.status, headers });
}

async function recordMcpClient(request, db) {
  const stamp = new Date().toISOString();
  const day = stamp.slice(0, 10);
  const source = cleanSource(request.headers.get('x-taskbay-source') || request.headers.get('x-relaymarket-source') || 'direct');
  const ua = String(request.headers.get('user-agent') || '').slice(0, 300);
  const trafficClass = classifyTraffic(source, ua);
  const family = userAgentFamily(ua);
  const ip = String(request.headers.get('cf-connecting-ip') || 'unknown');
  const authHint = String(request.headers.get('authorization') || '').slice(0, 24);
  const clientHash = await sha256(`${day}|${ip}|${ua}|${authHint}`);

  await db.prepare(`INSERT INTO mcp_client_daily(day,client_hash,traffic_class,source,user_agent_family,request_count,first_seen_at,last_seen_at)
    VALUES(?,?,?,?,?,1,?,?)
    ON CONFLICT(day,client_hash,traffic_class,source) DO UPDATE SET
      request_count=request_count+1,
      last_seen_at=excluded.last_seen_at,
      user_agent_family=excluded.user_agent_family`)
    .bind(day, clientHash, trafficClass, source, family, stamp, stamp).run();
}

async function trafficSnapshot(db) {
  const today = new Date().toISOString().slice(0, 10);
  const [tracked, todayRows, sources, total] = await db.batch([
    db.prepare(`SELECT traffic_class, COUNT(DISTINCT day || ':' || client_hash) unique_client_days, SUM(request_count) calls
      FROM mcp_client_daily GROUP BY traffic_class`),
    db.prepare(`SELECT traffic_class, COUNT(DISTINCT client_hash) unique_clients, SUM(request_count) calls
      FROM mcp_client_daily WHERE day=? GROUP BY traffic_class`).bind(today),
    db.prepare(`SELECT source, traffic_class, SUM(request_count) calls, COUNT(DISTINCT day || ':' || client_hash) unique_client_days
      FROM mcp_client_daily GROUP BY source,traffic_class ORDER BY calls DESC LIMIT 50`),
    db.prepare(`SELECT COALESCE(SUM(count),0) total_mcp_calls FROM marketplace_daily_counters WHERE metric='protocol.mcp_call' AND source='all'`)
  ]);

  const byClass = rowsToClass(tracked.results || [], 'unique_client_days');
  const todayByClass = rowsToClass(todayRows.results || [], 'unique_clients');
  return {
    trackingVersion: 'mcp-attribution-v1',
    trackingStartedWithMigration: '0009_mcp_traffic_attribution.sql',
    totalMcpCallsAllTime: Number(total.results?.[0]?.total_mcp_calls || 0),
    trackedCalls: {
      external: byClass.external.calls,
      internal: byClass.internal.calls,
      total: byClass.external.calls + byClass.internal.calls
    },
    uniqueClientDays: {
      external: byClass.external.unique,
      internal: byClass.internal.unique
    },
    today: {
      day: today,
      externalCalls: todayByClass.external.calls,
      internalCalls: todayByClass.internal.calls,
      externalUniqueClients: todayByClass.external.unique,
      internalUniqueClients: todayByClass.internal.unique
    },
    bySource: (sources.results || []).map(r => ({
      source: r.source,
      class: r.traffic_class,
      calls: Number(r.calls || 0),
      uniqueClientDays: Number(r.unique_client_days || 0)
    })),
    notes: [
      'Unique clients are privacy-preserving daily hashes; raw IP addresses are not stored.',
      'Historical MCP calls before this tracker was deployed cannot be uniquely attributed retroactively.',
      'Internal classification uses explicit TaskBay CI/smoke/check source or user-agent markers.'
    ]
  };
}

function rowsToClass(rows, uniqueField) {
  const out = { external: { calls: 0, unique: 0 }, internal: { calls: 0, unique: 0 } };
  for (const row of rows) {
    const key = row.traffic_class === 'internal' ? 'internal' : 'external';
    out[key] = { calls: Number(row.calls || 0), unique: Number(row[uniqueField] || 0) };
  }
  return out;
}

function classifyTraffic(source, ua) {
  const s = cleanSource(source);
  const marker = `${s} ${String(ua || '').toLowerCase()}`;
  if (INTERNAL_SOURCES.has(s)) return 'internal';
  if (/(taskbay|relaymarket)[-_ /]?(production[-_ ]?)?(smoke|check|ci|postdeploy|health)/i.test(marker)) return 'internal';
  if (/github[-_ ]?actions|actions\/runner/i.test(marker)) return 'internal';
  return 'external';
}

function userAgentFamily(ua) {
  const v = String(ua || '').toLowerCase();
  if (!v) return 'unknown';
  if (v.includes('claude')) return 'claude';
  if (v.includes('openai') || v.includes('chatgpt')) return 'openai';
  if (v.includes('cursor')) return 'cursor';
  if (v.includes('mcp')) return 'mcp-client';
  if (v.includes('curl')) return 'curl';
  if (v.includes('python')) return 'python';
  if (v.includes('node')) return 'node';
  return 'other';
}

function cleanSource(value) {
  return String(value || 'direct').toLowerCase().replace(/[^a-z0-9_.:-]/g, '').slice(0, 80) || 'direct';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
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
