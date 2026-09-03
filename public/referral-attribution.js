(() => {
  'use strict';

  const SOURCE_KEY = 'taskbay.marketSource';
  const params = new URLSearchParams(window.location.search);
  const clean = (value, max = 48) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, '')
    .slice(0, max);

  const ref = clean(params.get('ref'));
  if (!ref) return;

  const base = clean(params.get('source'), 28) || 'agent-invite';
  const attributed = `${base}:ref:${ref}`.slice(0, 80);

  try {
    sessionStorage.setItem(SOURCE_KEY, attributed);
  } catch {
    // Attribution must never block onboarding.
  }

  window.TaskBayReferral = Object.freeze({ referrer: ref, source: attributed });
})();
