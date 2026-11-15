(() => {
  const STORAGE_KEY = 'sv.vid.v1';
  const once = new Set();

  const uuid = () => {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
  };

  const visitorId = (() => {
    try {
      const existing = localStorage.getItem(STORAGE_KEY);
      if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
      const next = uuid();
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    } catch {
      return uuid();
    }
  })();

  const params = new URLSearchParams(location.search);
  const utmSource = params.get('utm_source') || '';
  const utmMedium = params.get('utm_medium') || '';

  const device = () => {
    const w = window.innerWidth || 0;
    const ua = navigator.userAgent || '';
    if (/iPad|Tablet|Android(?!.*Mobile)/i.test(ua) || (w >= 600 && w <= 1024)) return 'tablet';
    if (/Mobi|iPhone|Android.*Mobile/i.test(ua) || w < 600) return 'phone';
    return 'desktop';
  };

  const source = () => {
    const utm = `${utmSource} ${utmMedium}`.toLowerCase();
    const ref = String(document.referrer || '').toLowerCase();
    if (/avito/.test(utm) || /avito\.ru/.test(ref)) return 'avito';
    if (/yandex|ya\.ru/.test(utm) || /yandex\.|ya\.ru/.test(ref)) return 'yandex';
    if (/google/.test(utm) || /google\./.test(ref)) return 'google';
    if (/\bvk\b|vkontakte/.test(utm) || /(?:^|\/\/|\.)vk\.(?:com|ru|me)\b/.test(ref)) return 'vk';
    if (!ref) return 'direct';
    return 'other';
  };

  const send = (type, extra = {}) => {
    if (!type) return;
    const payload = {
      type,
      visitorId,
      device: device(),
      source: source(),
      referrer: document.referrer || '',
      utmSource,
      utmMedium,
      path: location.pathname || '/',
      width: window.innerWidth || 0,
      ...extra,
    };
    const body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon('/api/track', blob)) return;
      }
    } catch {
      /* fall through */
    }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {});
  };

  const onceSend = (key, type) => {
    if (once.has(key)) return;
    once.add(key);
    send(type);
  };

  send('page_view');

  document.addEventListener(
    'click',
    (event) => {
      const link = event.target.closest('a[href^="tel:"]');
      if (link) send('call_click');
      if (event.target.closest('[data-open-frame]')) send('photo_open');
    },
    true
  );

  if ('IntersectionObserver' in window) {
    const map = [
      { sel: '#schedule', type: 'schedule_open' },
      { sel: '#pricing', type: 'price_view' },
      { sel: '#reviews', type: 'reviews_view' },
    ];
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
          const type = entry.target.getAttribute('data-track-type');
          if (!type) return;
          onceSend(`view:${type}`, type);
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.25 }
    );
    map.forEach(({ sel, type }) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.setAttribute('data-track-type', type);
      io.observe(el);
    });
  }
})();
