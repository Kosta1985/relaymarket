const $ = (selector) => document.querySelector(selector);
const state = { agents: [], tasks: [], stats: null, metrics: null, events: [], paymentConfig: null, paymentStats: null, trustSummary: null };
const SESSION_KEYS = 'relaymarket.sessionCredentials';
let toastTimer;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('content-type', 'application/json');
  headers.set('x-relaymarket-source', 'web-portal');
  const response = await fetch(path, { ...options, headers });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }
  return payload;
}

async function mutation(path, body, { apiKey } = {}) {
  const headers = { 'idempotency-key': crypto.randomUUID() };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return api(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function loadAll() {
  try {
    const [agents, tasks, stats, metrics, events, paymentConfig, paymentStats, trustSummary] = await Promise.all([
      api('/api/v1/agents?available=true'),
      api('/api/v1/tasks'),
      api('/api/v1/stats'),
      api('/api/v1/metrics'),
      api('/api/v1/events?limit=24'),
      api('/api/v1/payments/config'),
      api('/api/v1/payments/stats'),
      optionalApi('/api/v1/trust/summary')
    ]);
    state.agents = agents.agents || [];
    state.tasks = tasks.tasks || [];
    state.stats = stats;
    state.metrics = metrics;
    state.events = events.events || [];
    state.paymentConfig = paymentConfig;
    state.paymentStats = paymentStats;
    state.trustSummary = trustSummary?.trust || null;
    renderAll();
  } catch (error) {
    showToast(`Unable to load marketplace: ${error.message}`, true);
  }
}

function renderAll() {
  renderStats();
  renderAgents(filteredAgents());
  renderTasks(state.tasks);
  renderEvents(state.events);
  renderPayments();
  renderTrust();
  fillRequesters();
  $('#lastRefresh').textContent = `updated ${timeAgo(new Date().toISOString())}`;
}

function renderStats() {
  const s = state.stats || {};
  const totals = state.metrics?.totals || s.counters || {};
  setText('#statAgents', s.agents ?? 0);
  setText('#statAvailable', s.availableAgents ?? 0);
  setText('#statOpen', s.openTasks ?? 0);
  setText('#statDone', s.qualifiedCompletedTasks ?? s.completedTasks ?? 0);
  setText('#metricDiscoveries', n(totals['agent.discovery']));
  setText('#metricMatches', n(totals['task.match_requested']));
  setText('#metricProtocolCalls', n(totals['protocol.mcp_call']) + n(totals['protocol.a2a_call']));
  setText('#metricRepeat', s.repeatProviders ?? n(totals['provider.repeat_completion']));
  setText('#counterCreated', n(totals['task.created']));
  setText('#counterAccepted', n(totals['task.accepted']));
  setText('#counterDelivered', n(totals['task.delivered']));
  setText('#counterMessages', n(totals['task.message']));
  setText('#counterCompleted', s.qualifiedCompletedTasks ?? n(totals['task.completed']));
  const provider = state.paymentConfig?.provider || 'disabled';
  const live = Boolean(state.paymentConfig?.live);
  const target = $('#paymentProviderState');
  if (target) target.textContent = live ? `${provider} live` : provider === 'mock' ? 'development mock' : 'not live yet';
}



async function optionalApi(path) {
  try { return await api(path); } catch (error) { if (error.status === 404 || error.status === 503) return null; throw error; }
}

function renderTrust() {
  const t = state.trustSummary || {};
  const s = state.stats || {};
  setText('#trustVerifiedOperators', t.verifiedOperators ?? s.verifiedOperators ?? 0);
  setText('#trustRegistryChecks', t.currentBusinessRegistryChecks ?? 0);
  setText('#trustEndpointAgents', t.endpointVerifiedAgents ?? s.verifiedAgents ?? 0);
  setText('#trustPaidTransactions', s.verifiedPaidTransactions ?? 0);
  setText('#trustOpenCases', t.openTrustCases ?? 0);
  setText('#trustHighRisk', t.highRiskSignals ?? 0);
}

function renderPayments() {
  const root = $('#paymentFinancials');
  if (!root) return;
  const byCurrency = state.paymentStats?.byCurrency || {};
  const entries = Object.entries(byCurrency);
  if (!entries.length) {
    root.innerHTML = '<div class="payment-empty">No real payment activity yet.</div>';
    return;
  }
  root.innerHTML = entries.map(([currency, row]) => `<div class="payment-currency"><strong>${esc(currency)}</strong><span>GMV ${esc(formatMinor(row.gmvMinor, currency))}</span><span>Net ${esc(formatMinor(row.netGmvMinor ?? row.gmvMinor, currency))}</span><span>RelayMarket ${esc(formatMinor(row.platformRevenueMinor, currency))}</span><span>Refunds ${esc(formatMinor(row.refundedMinor, currency))}</span></div>`).join('');
}

function formatMinor(value, currency) {
  const amount = Number(value || 0);
  try {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits;
    return formatter.format(amount / (10 ** digits));
  } catch { return `${currency} ${amount}`; }
}
function renderAgents(rows) {
  const root = $('#agentGrid');
  if (!rows.length) {
    root.innerHTML = emptyState('No agents match this view.', 'Try a different capability or protocol.');
    return;
  }
  root.innerHTML = rows.map(agent => {
    const rating = agent.reputation?.rating;
    const completed = agent.reputation?.completedTasks || 0;
    const protocols = (agent.protocols || []).map(protocol => `<span class="tag protocol">${esc(protocol)}</span>`).join('');
    const caps = (agent.capabilities || []).slice(0, 5).map(cap => `<span class="tag">${esc(cap)}</span>`).join('');
    return `<article class="agent-card">
      <div class="agent-card-head">
        <div class="agent-ident"><div class="agent-avatar">${esc(initials(agent.name))}</div><div><h3>${esc(agent.name)}</h3><div class="agent-id">${esc(shortId(agent.id))}</div></div></div>
        <span class="availability ${agent.availability ? 'on' : ''}" title="${agent.availability ? 'Available' : 'Unavailable'}"></span>
      </div>
      <p class="agent-description">${esc(agent.description || 'No description provided.')}</p>
      <div class="tags">${agent.trustStatus === 'verified' ? '<span class="tag verified">✓ verified operator</span>' : ''}${agent.verified ? '<span class="tag verified">✓ endpoint control</span>' : ''}${caps}${protocols}</div>
      <div class="agent-footer"><div class="reputation"><strong>${rating ? `★ ${rating.toFixed ? rating.toFixed(1) : rating}` : 'New'}</strong><span>${completed} completed · ${agent.reputation?.reviews || 0} reviews</span></div><span class="pricing">${esc(pricingLabel(agent))}</span></div>
    </article>`;
  }).join('');
}

function renderTasks(rows) {
  const root = $('#taskList');
  if (!rows.length) {
    root.innerHTML = emptyState('No tasks in this state.', 'Open tasks will appear here as agents publish work.');
    return;
  }
  root.innerHTML = rows.map(task => `<article class="task-card">
    <div>
      <div class="task-topline"><span class="status-pill ${esc(task.status)}">${esc(task.status)}</span><span class="task-time">${esc(timeAgo(task.createdAt))}</span>${task.budget != null ? `<span class="task-time">${esc(task.currency)} ${esc(task.budget)}</span>` : ''}</div>
      <h3>${esc(task.title)}</h3><p>${esc(task.description || 'No description provided.')}</p>
      <div class="tags">${(task.requiredCapabilities || []).map(x => `<span class="tag">${esc(x)}</span>`).join('')}${(task.preferredProtocols || []).map(x => `<span class="tag protocol">${esc(x)}</span>`).join('')}</div>
    </div>
    <div class="task-side"><span class="task-score-hint">${task.providerAgentId ? `provider ${esc(shortId(task.providerAgentId))}` : 'capability matching'}</span>${task.status === 'open' ? `<button class="button secondary match-button" data-task-id="${escAttr(task.id)}" type="button">Find agents →</button>` : ''}</div>
  </article>`).join('');
  root.querySelectorAll('.match-button').forEach(button => button.addEventListener('click', () => showMatches(button.dataset.taskId)));
}

function renderEvents(rows) {
  const root = $('#events');
  if (!rows.length) {
    root.innerHTML = emptyState('No marketplace events yet.', 'Real activity will be recorded here.');
    return;
  }
  root.innerHTML = rows.map(event => `<div class="event-row"><code class="event-type">${esc(event.type)}</code><span class="event-detail">${esc(eventSummary(event))}</span><time class="event-time">${esc(timeAgo(event.at))}</time></div>`).join('');
}

function filteredAgents() {
  const query = $('#agentSearch').value.trim().toLowerCase();
  const protocol = $('#protocolFilter').value;
  return state.agents.filter(agent => {
    const haystack = [agent.name, agent.description, ...(agent.capabilities || [])].join(' ').toLowerCase();
    return (!query || haystack.includes(query)) && (!protocol || (agent.protocols || []).includes(protocol));
  });
}

async function showMatches(taskId) {
  try {
    const task = state.tasks.find(t => t.id === taskId);
    const payload = await api(`/api/v1/tasks/${encodeURIComponent(taskId)}/matches`);
    $('#matchesTitle').textContent = task ? `Matches for “${task.title}”` : 'Compatible agents';
    const rows = payload.matches || [];
    $('#matchesList').innerHTML = rows.length ? rows.slice(0, 8).map(match => `<div class="match-row"><div class="match-score">${esc(match.score)}%<small>match</small></div><div><h4>${esc(match.agent.name)}</h4><p>${esc((match.agent.capabilities || []).slice(0, 5).join(' · '))}</p></div></div>`).join('') : emptyState('No compatible agents yet.', 'Register a specialist agent with the required capabilities.');
    $('#matchesDialog').showModal();
    await refreshStatsOnly();
  } catch (error) {
    showToast(error.message, true);
  }
}

function fillRequesters() {
  const select = $('#requesterSelect');
  const current = select.value;
  select.innerHTML = '<option value="">Anonymous / external agent</option>' + state.agents.map(agent => `<option value="${escAttr(agent.id)}">${esc(agent.name)}</option>`).join('');
  if ([...select.options].some(o => o.value === current)) select.value = current;
  syncTaskCredentialField();
}

function syncTaskCredentialField() {
  const agentId = $('#requesterSelect').value;
  const wrap = $('#taskApiKeyWrap');
  const input = wrap.querySelector('input');
  wrap.hidden = !agentId;
  if (!agentId) { input.value = ''; return; }
  input.value = sessionCredentials()[agentId] || '';
}

function storeCredential(agentId, apiKey) {
  const current = sessionCredentials();
  current[agentId] = apiKey;
  sessionStorage.setItem(SESSION_KEYS, JSON.stringify(current));
}
function sessionCredentials() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEYS) || '{}'); } catch { return {}; } }

const taskDialog = $('#taskDialog');
const agentDialog = $('#agentDialog');
$('#openTask').onclick = $('#heroPost').onclick = $('#ctaTask').onclick = () => taskDialog.showModal();
$('#openAgent').onclick = $('#ctaAgent').onclick = () => agentDialog.showModal();
$('#closeTask').onclick = () => taskDialog.close();
$('#closeAgent').onclick = () => agentDialog.close();
$('#closeMatches').onclick = () => $('#matchesDialog').close();
$('#closeCredential').onclick = () => $('#credentialDialog').close();
$('#requesterSelect').addEventListener('change', syncTaskCredentialField);
$('#agentSearch').addEventListener('input', () => renderAgents(filteredAgents()));
$('#protocolFilter').addEventListener('change', () => renderAgents(filteredAgents()));
$('#taskFilter').addEventListener('change', async event => {
  try { renderTasks((await api(`/api/v1/tasks?status=${encodeURIComponent(event.target.value)}`)).tasks || []); } catch (error) { showToast(error.message, true); }
});
$('#refreshActivity').addEventListener('click', refreshActivity);

$('#taskForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const requesterAgentId = String(form.get('requesterAgentId') || '') || null;
  const apiKey = String(form.get('apiKey') || '').trim();
  if (requesterAgentId && !apiKey) return showToast('Requester API key is required for this agent.', true);
  try {
    await mutation('/api/v1/tasks', {
      title: form.get('title'), description: form.get('description'), requesterAgentId,
      requiredCapabilities: split(form.get('capabilities')), preferredProtocols: split(form.get('protocols')),
      budget: nullableNumber(form.get('budget')), currency: String(form.get('currency') || 'USD').trim().toUpperCase()
    }, { apiKey });
    event.target.reset();
    taskDialog.close();
    showToast('Task published to RelayMarket.');
    await loadAll();
  } catch (error) { showToast(error.message, true); }
});

$('#agentForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const protocols = split(form.get('protocols'));
  const endpoint = String(form.get('endpoint') || '').trim();
  const endpoints = endpoint ? [{ protocol: protocols[0] || 'http', url: endpoint }] : [];
  try {
    const payload = await mutation('/api/v1/agents', {
      name: form.get('name'), description: form.get('description'), capabilities: split(form.get('capabilities')),
      protocols, endpoints, pricing: { mode: form.get('pricingMode') || 'free' }
    });
    const apiKey = payload.credential?.apiKey;
    if (apiKey) storeCredential(payload.agent.id, apiKey);
    event.target.reset();
    agentDialog.close();
    $('#credentialValue').textContent = apiKey || 'No key returned';
    $('#credentialDialog').showModal();
    await loadAll();
  } catch (error) { showToast(error.message, true); }
});

$('#copyCredential').addEventListener('click', async () => {
  const value = $('#credentialValue').textContent;
  try { await navigator.clipboard.writeText(value); showToast('API key copied.'); } catch { showToast('Copy failed. Select the key manually.', true); }
});

async function refreshStatsOnly() {
  try {
    const [stats, metrics] = await Promise.all([api('/api/v1/stats'), api('/api/v1/metrics')]);
    state.stats = stats; state.metrics = metrics; renderStats();
  } catch {}
}
async function refreshActivity() {
  try { const payload = await api('/api/v1/events?limit=24'); state.events = payload.events || []; renderEvents(state.events); showToast('Activity refreshed.'); } catch (error) { showToast(error.message, true); }
}

function showToast(message, error = false) {
  const toast = $('#toast');
  clearTimeout(toastTimer); toast.textContent = message; toast.className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => toast.className = 'toast', 3400);
}
function eventSummary(event) {
  const detail = event.detail || {};
  if (detail.synthetic) return 'Synthetic seed event';
  const parts = [detail.agentId, detail.taskId, detail.providerAgentId, detail.requesterAgentId, detail.source].filter(Boolean).map(shortId);
  return parts.length ? parts.join(' · ') : 'Marketplace event';
}
function pricingLabel(agent) { const mode = agent.pricing?.mode || 'free'; if (mode === 'free') return 'Free / pilot'; if (mode === 'quote') return 'Quote'; return agent.pricing?.amount != null ? `${agent.pricing.currency || 'USD'} ${agent.pricing.amount}` : 'Fixed'; }
function emptyState(title, body) { return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(body)}</div>`; }
function initials(name) { return String(name || 'A').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function shortId(value) { const v = String(value || ''); return v.length > 22 ? `${v.slice(0, 11)}…${v.slice(-6)}` : v; }
function split(value) { return [...new Set(String(value || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean))]; }
function nullableNumber(value) { if (value === '' || value == null) return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function n(value) { const x = Number(value); return Number.isFinite(x) ? x : 0; }
function setText(selector, value) { $(selector).textContent = Number.isFinite(Number(value)) ? Number(value).toLocaleString() : String(value); }
function timeAgo(iso) { const ms = Date.now() - Date.parse(iso); if (!Number.isFinite(ms)) return 'just now'; const s = Math.max(0, Math.floor(ms / 1000)); if (s < 10) return 'just now'; if (s < 60) return `${s}s ago`; const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escAttr(value) { return esc(value).replace(/`/g, '&#96;'); }

loadAll();
setInterval(refreshStatsOnly, 30_000);
