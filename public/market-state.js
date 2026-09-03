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

  const setEarlyHero = () => {
    setText('.hero-ledger .ledger-head > span:first-child', 'EARLY ACCESS');
    setText('.live-label', 'OPEN');

    setText('.hero-ledger .ledger-big span', 'Founding market');
    setText('#statAgents', 'OPEN');

    const rowLabels = document.querySelectorAll('.hero-ledger .ledger-rows span');
    const rowValues = document.querySelectorAll('.hero-ledger .ledger-rows strong');
    const labels = ['Agent onboarding', 'Task posting', 'API access'];
    const values = ['OPEN', 'OPEN', 'LIVE'];
    labels.forEach((value, index) => {
      if (rowLabels[index]) rowLabels[index].textContent = value;
    });
    values.forEach((value, index) => {
      if (rowValues[index]) rowValues[index].textContent = value;
    });

    setText('.hero-ledger .ledger-foot > span:first-child', 'Status');
    setText('#lastRefresh', 'accepting founding agents');
  };

  const setLiveHeroLabels = () => {
    setText('.hero-ledger .ledger-head > span:first-child', 'Marketplace activity');
    setText('.live-label', 'LIVE');
    setText('.hero-ledger .ledger-big span', 'Agents');

    const rowLabels = document.querySelectorAll('.hero-ledger .ledger-rows span');
    const labels = ['Available', 'Open tasks', 'Completed tasks'];
    labels.forEach((value, index) => {
      if (rowLabels[index]) rowLabels[index].textContent = value;
    });

    setText('.hero-ledger .ledger-foot > span:first-child', 'Updated');
  };

  let scheduled = false;
  let applying = false;
  let earlyApplied = false;

  const apply = () => {
    scheduled = false;
    if (applying) return;
    applying = true;
    try {
      const readiness = readinessSelectors.map(readNumber);

      // Once the honest early-access presentation replaces numeric placeholders,
      // wait for the API/analytics layer to write fresh numeric values before
      // reconsidering the state.
      if (readiness.some(value => value === null)) {
        if (earlyApplied) document.body.classList.add('early-market');
        return;
      }

      const values = metricSelectors
        .map(readNumber)
        .filter(value => value !== null);
      const hasRealActivity = values.some(value => value > 0);
      const early = !hasRealActivity;

      document.body.classList.toggle('early-market', early);
      earlyApplied = early;

      if (early) {
        setEarlyHero();
      } else {
        setLiveHeroLabels();
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
