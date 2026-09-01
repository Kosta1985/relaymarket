(() => {
  'use strict';

  window.va = window.va || function () {
    (window.vaq = window.vaq || []).push(arguments);
  };

  const safeText = (value, max = 80) => {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, max);
  };

  const sourcePart = (value, max = 32) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]/g, '')
    .slice(0, max);

  const urlParams = new URLSearchParams(window.location.search);
  const currentReferrer = (() => {
    try {
      if (!document.referrer) return 'direct';
      return new URL(document.referrer).hostname || 'direct';
    } catch {
      return 'unknown';
    }
  })();

  const attribution = {
    source: safeText(urlParams.get('utm_source') || ''),
    medium: safeText(urlParams.get('utm_medium') || ''),
    campaign: safeText(urlParams.get('utm_campaign') || ''),
    content: safeText(urlParams.get('utm_content') || ''),
    referrer: safeText(currentReferrer),
  };

  const marketSource = (() => {
    const parts = ['taskbay-landing'];
    const utmSource = sourcePart(attribution.source);
    const campaign = sourcePart(attribution.campaign);
    if (utmSource) parts.push(utmSource);
    if (campaign) parts.push(campaign);
    return parts.join('.').slice(0, 80);
  })();

  try {
    const firstTouchKey = 'taskbay.analytics.firstTouch';
    if (!sessionStorage.getItem(firstTouchKey)) {
      sessionStorage.setItem(firstTouchKey, JSON.stringify({ ...attribution, marketSource }));
    }
  } catch {
    // Analytics must never block the landing page.
  }

  const compact = (data) => Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== '' && value !== null && value !== undefined),
  );

  const track = (name, data = {}) => {
    try {
      window.va('event', {
        name,
        data: compact({ ...attribution, marketSource, ...data }),
      });
    } catch {
      // Never interrupt a user action because telemetry failed.
    }
  };

  const carryMarketplaceAttribution = () => {
    document.querySelectorAll('a[href]').forEach((link) => {
      try {
        const target = new URL(link.href, window.location.href);
        if (target.hostname !== 'relaymarket.notary-labs.workers.dev') return;
        target.searchParams.set('source', marketSource);
        link.href = target.toString();
      } catch {
        // Invalid or non-HTTP links are ignored.
      }
    });
  };

  carryMarketplaceAttribution();
  window.TaskBayAnalytics = Object.freeze({ track, marketSource });

  track('Landing Engaged', {
    path: window.location.pathname,
    viewport: window.innerWidth < 600 ? 'mobile' : window.innerWidth < 1000 ? 'tablet' : 'desktop',
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[data-analytics]');
    if (!link) return;

    let destination = '';
    try {
      const parsed = new URL(link.href, window.location.href);
      destination = `${parsed.hostname}${parsed.pathname}${parsed.hash || ''}`;
    } catch {
      destination = safeText(link.getAttribute('href') || '');
    }

    track('CTA Click', {
      cta: safeText(link.dataset.analytics),
      position: safeText(link.dataset.position || ''),
      destination: safeText(destination, 120),
    });
  });

  const sectionSeen = new Set();
  if ('IntersectionObserver' in window) {
    const sectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || entry.intersectionRatio < 0.35) continue;
        const section = entry.target.id || entry.target.dataset.analyticsSection;
        if (!section || sectionSeen.has(section)) continue;
        sectionSeen.add(section);
        track('Section Viewed', { section: safeText(section) });
      }
    }, { threshold: [0.35] });

    document.querySelectorAll('[data-analytics-section]').forEach((section) => sectionObserver.observe(section));
  }

  const reachedDepths = new Set();
  const depthThresholds = [25, 50, 75, 90];
  const measureScroll = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return;
    const depth = Math.round((window.scrollY / scrollable) * 100);
    for (const threshold of depthThresholds) {
      if (depth >= threshold && !reachedDepths.has(threshold)) {
        reachedDepths.add(threshold);
        track('Scroll Depth', { percent: threshold });
      }
    }
  };
  window.addEventListener('scroll', measureScroll, { passive: true });

  const engagementTimers = [15, 30, 60];
  engagementTimers.forEach((seconds) => {
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        track('Engaged Time', { seconds });
      }
    }, seconds * 1000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') measureScroll();
  });
})();
