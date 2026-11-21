(() => {
  const applyContact = (data) => {
    if (!data || !data.phoneTel) return;
    const display = String(data.phoneDisplay || data.phoneTel);
    const tel = String(data.phoneTel);
    document.querySelectorAll('[data-phone-display]').forEach((el) => {
      el.textContent = display;
    });
    document.querySelectorAll('[data-phone-link]').forEach((el) => {
      el.setAttribute('href', `tel:${tel}`);
      if (el.hasAttribute('data-phone-display') || el.dataset.phoneShow === '1') {
        el.textContent = display;
      }
    });
  };

  const loadContact = () =>
    fetch('/api/contact', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then(applyContact)
      .catch(() => {});

  loadContact();

  if (!window.EventSource) return;
  let source = null;
  const connect = () => {
    if (source) {
      source.close();
      source = null;
    }
    source = new EventSource('/api/pricing/stream');
    source.addEventListener('contact', (event) => {
      try {
        applyContact(JSON.parse(event.data));
      } catch {
        /* ignore */
      }
    });
    source.onerror = () => {
      if (source) {
        source.close();
        source = null;
      }
      window.setTimeout(() => {
        if (document.visibilityState === 'visible') connect();
      }, 2500);
    };
  };
  connect();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadContact();
      connect();
    } else if (source) {
      source.close();
      source = null;
    }
  });
})();
