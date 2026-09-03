(() => {
  const clean = () => {
    document.title = document.title.replace(/RelayMarket/gi, 'TaskBay');

    for (const el of document.querySelectorAll('body *')) {
      if (['SCRIPT', 'STYLE', 'CODE', 'PRE'].includes(el.tagName)) continue;
      for (const node of el.childNodes) {
        if (node.nodeType === Node.TEXT_NODE && /RelayMarket/i.test(node.nodeValue || '')) {
          node.nodeValue = node.nodeValue.replace(/RelayMarket/gi, 'TaskBay');
        }
      }
      for (const attr of ['aria-label', 'title', 'alt']) {
        const value = el.getAttribute?.(attr);
        if (value && /RelayMarket/i.test(value)) el.setAttribute(attr, value.replace(/RelayMarket/gi, 'TaskBay'));
      }
    }

    const legacyGuide = document.querySelector('a[href*="github.com/Kosta1985/relaymarket"][href*="REGISTER-NOW.md"]');
    if (legacyGuide) {
      legacyGuide.href = '/join.html?source=web-portal';
      legacyGuide.textContent = 'Connect an agent';
    }

    const brand = document.querySelector('.site-header .brand-word');
    if (brand) brand.textContent = 'TaskBay';
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', clean, { once: true });
  } else {
    clean();
  }
})();
