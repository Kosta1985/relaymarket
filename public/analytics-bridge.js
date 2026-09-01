(() => {
  'use strict';

  const SOURCE_KEY = 'taskbay.marketSource';
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
  const set = (root, key, value) => {
    const node = root.querySelector(`[data-kpi="${key}"]`);
    if (node) node.textContent = String(value);
  };

  function mountPanel() {
    const metrics = document.querySelector('.metrics-board');
    if (!metrics || document.querySelector('#taskbayFunnelPanel')) return null;

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

    const style = document.createElement('style');
    style.textContent = `
      #taskbayFunnelPanel{margin-top:18px;border:1px solid currentColor;padding:20px;background:rgba(255,255,255,.36)}
      .taskbay-funnel-head{display:flex;justify-content:space-between;gap:16px;align-items:start;margin-bottom:16px}
      .taskbay-funnel-head strong{display:block;font-size:18px}.taskbay-funnel-head span{display:block;opacity:.66;font-size:12px;margin-top:3px}.taskbay-funnel-head code{font-size:11px;word-break:break-all}
      .taskbay-funnel-grid{display:grid;grid-template-columns:repeat(5,1fr);border-top:1px solid currentColor;border-left:1px solid currentColor}
      .taskbay-funnel-grid>div{padding:14px;border-right:1px solid currentColor;border-bottom:1px solid currentColor}.taskbay-funnel-grid span{display:block;font-size:11px;opacity:.7}.taskbay-funnel-grid strong{display:block;font-size:26px;margin-top:5px}
      .taskbay-funnel-conversion,.taskbay-source-row{display:flex;gap:18px;flex-wrap:wrap;padding-top:14px;font-size:12px}.taskbay-source-row{border-top:1px solid rgba(0,0,0,.18);margin-top:14px}
      @media(max-width:780px){.taskbay-funnel-grid{grid-template-columns:1fr 1fr}.taskbay-funnel-head{display:block}.taskbay-funnel-head code{display:block;margin-top:8px}}
    `;
    document.head.appendChild(style);
    return panel;
  }

  async function loadKpis() {
    const panel = mountPanel();
    if (!panel) return;
    try {
      const response = await nativeFetch('/api/v1/kpis', { headers: { 'x-relaymarket-source': marketSource } });
      if (!response.ok) return;
      const kpis = await response.json();
      if (kpis?.contractVersion !== 'launch-v1') return;
      set(panel, 'selected', n(kpis.providerSelections));
      set(panel, 'accepted', n(kpis.acceptedTasks));
      set(panel, 'delivered', n(kpis.deliveredTasks));
      set(panel, 'completed', n(kpis.completedTasks));
      set(panel, 'repeat', n(kpis.repeatProviders));
      set(panel, 'selectAccept', pct(kpis.conversion?.selectionToAccept));
      set(panel, 'acceptDeliver', pct(kpis.conversion?.acceptToDeliver));
      set(panel, 'deliverComplete', pct(kpis.conversion?.deliverToComplete));
      const source = (kpis.acquisitionSources || []).find((row) => row.source === marketSource) || {};
      set(panel, 'sourceRegs', n(source.agentRegistrations));
      set(panel, 'sourceTasks', n(source.taskCreations));
      set(panel, 'sourceMatches', n(source.matchRequests));
      set(panel, 'sourceSelections', n(source.providerSelections));
    } catch {
      // KPI display is supplemental and must never block marketplace use.
    }
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadKpis, { once: true });
  else loadKpis();
})();
