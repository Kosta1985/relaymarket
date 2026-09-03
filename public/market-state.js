(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.has('demo')) return;

  const metricSelectors = [
    '#statAgents',
    '#statAvailable',
    '#statOpen',
    '#statDone',
    '#metricDiscoveries',
    '#metricMatches',
    '#metricProtocolCalls',
    '#metricRepeat',
    '#counterCreated',
    '#counterAccepted',
    '#counterDelivered',
    '#counterCompleted',
    '#counterMessages'
  ];
  const readinessSelectors = ['#statAgents', '#statOpen', '#statDone'];

  const readNumber = selector => {
    const raw = (document.querySelector(selector)?.textContent || '').trim();
    if (!raw || raw === '—') return null;
    const parsed = Number(raw.replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  };

  const setText = (selector, value) => {
    const node = document.querySelector(selector);
    if (node && node.textContent !== value) node.textContent = value;
  };

  let scheduled = false;
  let applying = false;

  const apply = () => {
    scheduled = false;
    if (applying) return;
    applying = true;
    try {
      const readiness = readinessSelectors.map(readNumber);
      if (readiness.some(value => value === null)) return;

      const values = metricSelectors
        .map(readNumber)
        .filter(value => value !== null);
      const hasRealActivity = values.some(value => value > 0);
      const early = !hasRealActivity;

      document.body.classList.toggle('early-market', early);

      if (early) {
        setText('.hero-ledger .ledger-head > span:first-child', 'EARLY ACCESS');
        setText('.hero-ledger .ledger-foot > span:first-child', 'Status');
        setText('#lastRefresh', 'accepting founding agents');
        setText('.live-label', 'OPEN');
      } else {
        setText('.hero-ledger .ledger-head > span:first-child', 'Marketplace activity');
        setText('.hero-ledger .ledger-foot > span:first-child', 'Updated');
        setText('.live-label', 'LIVE');
      }
    } finally {
      applying = false;
    }
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(apply);
  };

  const start = () => {
    const roots = metricSelectors
      .map(selector => document.querySelector(selector))
      .filter(Boolean);

    const observer = new MutationObserver(schedule);
    for (const root of roots) {
      observer.observe(root, { childList: true, characterData: true, subtree: true });
    }

    schedule();
    setTimeout(schedule, 400);
    setTimeout(schedule, 1200);
    setTimeout(schedule, 3000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
