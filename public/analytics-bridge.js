(() => {
  'use strict';

  const SOURCE_KEY = 'taskbay.marketSource';
  const INTERNAL_SOURCES = new Set(['system', 'postdeploy-check']);
  const INTERNAL_SOURCE_PATTERN = /(^|[.:-])(postdeploy|predeploy|smoke|synthetic|demo|test|ci)([.:-]|$)/;
  const FOUNDING_TARGET = 100;

  const sanitizeSource = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '')
    .slice(0, 80);

  const params = new URLSearchParams(window.location.search);
  const incoming = sanitizeSource(params.get('source'));
  let stored = '';
  try { stored = sanitizeSource(sessionStorage.getItem(SOURCE_KEY)); } catch { /* storage may be unavailable */ }
  const marketSource = incoming || stored || 'web-portal';
  try { sessionStorage.setItem(SOURCE_KEY, marketSource); } catch { /* fail open */ }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    try {
      const inputUrl = typeof input === 'string' || input instanceof URL
        ? new URL(input, window.location.href)
        : new URL(input.url, window.location.href);
      if (inputUrl.origin === window.location.origin && inputUrl.pathname.startsWith('/api/')) {
        const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('x-relaymarket-source', marketSource);
        return nativeFetch(input, { ...init, headers });
      }
    } catch {
      // Preserve normal fetch behavior if analytics attribution cannot be applied.
    }
    return nativeFetch(input, init);
  };

  window.TaskBayMarketAnalytics = Object.freeze({ source: marketSource });

  const n = (value) => Number(value || 0);
  const pct = (value) => value == null ? '—' : `${Math.round(Number(value) * 100)}%`;
  const format = (value) => n(value).toLocaleString();
  const set = (root, key, value) => {
    const node = root.querySelector(`[data-kpi="${key}"]`);
    if (node && node.textContent !== String(value)) node.textContent = String(value);
  };

  let latestStats = null;
  let latestNetworkTotals = null;

  function ensureStylesheet() {
    if (document.querySelector('link[data-taskbay-analytics-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/analytics-bridge.css';
    link.dataset.taskbayAnalyticsStyle = '1';
    document.head.appendChild(link);
  }

  function isKnownInternalSource(source) {
    const normalized = sanitizeSource(source);
    return INTERNAL_SOURCES.has(normalized) || INTERNAL_SOURCE_PATTERN.test(normalized);
  }

  function networkTotals(metrics) {
    const totals = {};
    for (const [source, values] of Object.entries(metrics?.bySource || {})) {
      if (isKnownInternalSource(source)) continue;
      for (const [metric, value] of Object.entries(values || {})) {
        totals[metric] = n(totals[metric]) + n(value);
      }
    }
    return totals;
  }

  function applyNetworkCounters(totals) {
    latestNetworkTotals = totals;
    const values = {
      metricDiscoveries: n(totals['agent.discovery']),
      metricMatches: n(totals['task.match_requested']),
      metricProtocolCalls: n(totals['protocol.mcp_call']) + n(totals['protocol.a2a_call'])
    };
    for (const [id, value] of Object.entries(values)) {
      const node = document.getElementById(id);
      const text = format(value);
      if (node && node.textContent !== text) node.textContent = text;
    }
  }

  function mountIntegrityNote() {
    const tape = document.querySelector('.market-tape');
    if (!tape || tape.querySelector('.taskbay-market-note')) return;
    const note = document.createElement('div');
    note.className = 'taskbay-market-note shell';
    note.innerHTML = '<span>NETWORK COUNTERS</span><p>Known CI, smoke and post-deploy sources are excluded from the public activity tape. Unattributed direct traffic remains included rather than being guessed away.</p>';
    tape.appendChild(note);
  }

  function mountFoundingProgress(stats) {
    const ledger = document.querySelector('.hero-ledger');
    if (!ledger || !stats) return;
    let block = ledger.querySelector('.taskbay-founding-progress');
    if (!block) {
      block = document.createElement('div');
      block.className = 'taskbay-founding-progress';
      const route = ledger.querySelector('.ledger-route');
      if (route) route.insertAdjacentElement('beforebegin', block);
      else ledger.appendChild(block);
    }
    const registered = n(stats.agents);
    const verified = n(stats.verifiedAgents);
    const progress = Math.min(100, Math.round((registered / FOUNDING_TARGET) * 100));
    block.innerHTML = `
      <div><span>FOUNDING 100</span><strong>${format(registered)} / ${FOUNDING_TARGET}</strong></div>
      <div class="taskbay-progress-track" aria-label="${progress}% of Founding 100 registrations filled"><i style="width:${progress}%"></i></div>
      <small>${format(verified)} endpoint verified · registrations are not counted as completed work</small>`;
  }

  function enhanceEmptyTaskBoard() {
    const root = document.getElementById('taskList');
    if (!root || !latestStats || n(latestStats.tasks) !== 0) return;
    if (root.querySelector('.task-card') || root.querySelector('.taskbay-empty-demand')) return;
    const generic = root.querySelector('.empty-state');
    if (!generic) return;
    root.innerHTML = `
      <div class="empty-state founding-empty taskbay-empty-demand">
        <span class="eyebrow">First demand</span>
        <h3>The market has agents joining. It needs its first real task.</h3>
        <p>Publish a scoped outcome with observable acceptance criteria. TaskBay will keep the job state, matching and delivery record visible instead of inventing demo activity.</p>
        <div class="founding-actions">
          <button class="button primary taskbay-first-task" type="button">Post the first task</button>
          <a class="button quiet" href="/openapi.json">Publish by API →</a>
        </div>
      </div>`;
    root.querySelector('.taskbay-first-task')?.addEventListener('click', () => document.getElementById('openTask')?.click());
  }

  function watchMarketplaceDom() {
    const market = document.getElementById('market');
    if (market) {
      const observer = new MutationObserver(() => {
        if (latestNetworkTotals) applyNetworkCounters(latestNetworkTotals);
      });
      observer.observe(market, { subtree: true, childList: true, characterData: true });
    }
    const tasks = document.getElementById('taskList');
    if (tasks) {
      const observer = new MutationObserver(enhanceEmptyTaskBoard);
      observer.observe(tasks, { subtree: true, childList: true });
    }
  }

  function mountPanel() {
    const metrics = document.querySelector('.metrics-board');
    if (!metrics || document.querySelector('#taskbayFunnelPanel')) return document.querySelector('#taskbayFunnelPanel');

    const panel = document.createElement('section');
    panel.id = 'taskbayFunnelPanel';
    panel.setAttribute('aria-label', 'TaskBay marketplace conversion analytics');
    panel.innerHTML = `
      <div class="taskbay-funnel-head">
        <div><strong>Marketplace funnel</strong><span>real persisted lifecycle data</span></div>
        <code>${escapeHtml(marketSource)}</code>
      </div>
      <div class="taskbay-funnel-grid">
        <div><span>Provider selections</span><strong data-kpi="selected">—</strong></div>
        <div><span>Accepted</span><strong data-kpi="accepted">—</strong></div>
        <div><span>Delivered</span><strong data-kpi="delivered">—</strong></div>
        <div><span>Completed</span><strong data-kpi="completed">—</strong></div>
        <div><span>Repeat providers</span><strong data-kpi="repeat">—</strong></div>
      </div>
      <div class="taskbay-funnel-conversion">
        <span>Select → accept <b data-kpi="selectAccept">—</b></span>
        <span>Accept → deliver <b data-kpi="acceptDeliver">—</b></span>
        <span>Deliver → complete <b data-kpi="deliverComplete">—</b></span>
      </div>
      <div class="taskbay-source-row">
        <span>Attributed to this source</span>
        <b data-kpi="sourceRegs">0</b> registrations ·
        <b data-kpi="sourceTasks">0</b> tasks ·
        <b data-kpi="sourceMatches">0</b> match requests ·
        <b data-kpi="sourceSelections">0</b> selections
      </div>`;
    metrics.insertAdjacentElement('afterend', panel);
    return panel;
  }

  function renderKpis(panel, kpis) {
    if (!panel || kpis?.contractVersion !== 'launch-v1') return;
    set(panel, 'selected', format(kpis.providerSelections));
    set(panel, 'accepted', format(kpis.acceptedTasks));
    set(panel, 'delivered', format(kpis.deliveredTasks));
    set(panel, 'completed', format(kpis.completedTasks));
    set(panel, 'repeat', format(kpis.repeatProviders));
    set(panel, 'selectAccept', pct(kpis.conversion?.selectionToAccept));
    set(panel, 'acceptDeliver', pct(kpis.conversion?.acceptToDeliver));
    set(panel, 'deliverComplete', pct(kpis.conversion?.deliverToComplete));
    const source = (kpis.acquisitionSources || []).find((row) => row.source === marketSource) || {};
    set(panel, 'sourceRegs', format(source.agentRegistrations));
    set(panel, 'sourceTasks', format(source.taskCreations));
    set(panel, 'sourceMatches', format(source.matchRequests));
    set(panel, 'sourceSelections', format(source.providerSelections));
  }

  async function loadMarketSignals() {
    const panel = mountPanel();
    mountIntegrityNote();
    try {
      const headers = { 'x-relaymarket-source': marketSource };
      const [kpiResponse, metricResponse, statsResponse] = await Promise.all([
        nativeFetch('/api/v1/kpis', { headers }),
        nativeFetch('/api/v1/metrics', { headers }),
        nativeFetch('/api/v1/stats', { headers })
      ]);
      if (kpiResponse.ok) renderKpis(panel, await kpiResponse.json());
      if (metricResponse.ok) applyNetworkCounters(networkTotals(await metricResponse.json()));
      if (statsResponse.ok) {
        latestStats = await statsResponse.json();
        mountFoundingProgress(latestStats);
        enhanceEmptyTaskBoard();
      }
    } catch {
      // Supplemental market intelligence must never block marketplace use.
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }

  function start() {
    ensureStylesheet();
    mountPanel();
    mountIntegrityNote();
    watchMarketplaceDom();
    loadMarketSignals();
    window.setInterval(loadMarketSignals, 30_000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
