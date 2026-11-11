export default async function (page) {
  const viewports = [
    { name: 'phone-360', width: 360, height: 800 },
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'phone-430', width: 430, height: 932 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'tablet-820', width: 820, height: 1180 },
    { name: 'tablet-1024', width: 1024, height: 1366 },
    { name: 'desktop-1280', width: 1280, height: 900 },
  ];

  const out = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // full page shot of key sections
    await page.screenshot({
      path: `E:/My_prodjek/clining_compani/releases/qa-${vp.name}-top.png`,
      fullPage: false,
    });

    const report = await page.evaluate(() => {
      const issues = [];
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      if (sw > vw + 1) issues.push(`page-overflow ${sw - vw}px`);

      // Any element protruding past viewport horizontally
      const all = Array.from(document.body.querySelectorAll('*'));
      const offenders = [];
      for (const el of all) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') continue;
        if (st.position === 'fixed' || st.position === 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        if (r.right > vw + 2 || r.left < -2) {
          const tag = el.tagName.toLowerCase();
          const cls = (el.className && typeof el.className === 'string') ? el.className.slice(0, 60) : '';
          offenders.push(`${tag}.${cls} L${Math.round(r.left)} R${Math.round(r.right)}`);
          if (offenders.length > 12) break;
        }
      }
      if (offenders.length) issues.push(`protruding: ${offenders.slice(0, 6).join(' | ')}`);

      // Day chips pairwise overlap
      const chips = Array.from(document.querySelectorAll('.day-chip'));
      for (let i = 0; i < chips.length; i++) {
        const a = chips[i].getBoundingClientRect();
        for (let j = i + 1; j < chips.length; j++) {
          const b = chips[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 1 && oy > 1) issues.push(`day-chip overlap ${i}/${j}`);
        }
      }

      // Slot pills overlap
      const slots = Array.from(document.querySelectorAll('.slot-pill, .slot, .time-slot, [data-slot]'));
      for (let i = 0; i < Math.min(slots.length, 24); i++) {
        const a = slots[i].getBoundingClientRect();
        for (let j = i + 1; j < Math.min(slots.length, 24); j++) {
          const b = slots[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) {
            issues.push(`slot overlap ${i}/${j}`);
            break;
          }
        }
      }

      // Header brand / burger / phone clash
      const headerKids = Array.from(document.querySelectorAll('.site-header .container > *'));
      for (let i = 0; i < headerKids.length; i++) {
        for (let j = i + 1; j < headerKids.length; j++) {
          const a = headerKids[i].getBoundingClientRect();
          const b = headerKids[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) {
            issues.push(`header-child overlap ${headerKids[i].className}/${headerKids[j].className}`);
          }
        }
      }

      // Mobile nav must be closed by default
      const mobileNav = document.querySelector('#mobile-nav');
      if (mobileNav) {
        const hidden = mobileNav.hasAttribute('hidden') || getComputedStyle(mobileNav).display === 'none';
        if (!hidden && vw < 900) issues.push('mobile-nav open by default');
      }

      // Dev badges (links only — ignore nested img false positives)
      const badges = Array.from(document.querySelectorAll('.dev-links > a'));
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const a = badges[i].getBoundingClientRect();
          const b = badges[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) issues.push('dev badge overlap');
        }
      }

      // Slot text overlap: time vs strong
      document.querySelectorAll('.slot').forEach((slot, idx) => {
        const time = slot.querySelector('.slot-time');
        const label = slot.querySelector('strong');
        if (!time || !label) return;
        const a = time.getBoundingClientRect();
        const b = label.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) issues.push(`slot-text-overlap #${idx}`);
      });

      // Mobile CTA vs content
      const cta = document.querySelector('.mobile-cta');
      if (cta && getComputedStyle(cta).display !== 'none') {
        const cr = cta.getBoundingClientRect();
        if (Math.abs(cr.left - (vw - cr.right)) > 8) {
          issues.push(`mobile-cta asymmetric L${cr.left.toFixed(1)} R${(vw - cr.right).toFixed(1)}`);
        }
      }

      // Container side equality samples
      document.querySelectorAll('.container').forEach((c, idx) => {
        if (idx > 6) return;
        const r = c.getBoundingClientRect();
        const L = r.left;
        const R = vw - r.right;
        if (Math.abs(L - R) > 4) issues.push(`container#${idx} asym L${L.toFixed(1)} R${R.toFixed(1)}`);
        if (L < 10 || R < 10) issues.push(`container#${idx} edge L${L.toFixed(1)} R${R.toFixed(1)}`);
      });

      // Week strip scroll metrics
      const week = document.querySelector('.week-strip');
      let weekInfo = null;
      if (week) {
        weekInfo = {
          scrollWidth: week.scrollWidth,
          clientWidth: week.clientWidth,
          needsScroll: week.scrollWidth > week.clientWidth + 2,
        };
      }

      // Text truncation suspicious: zero scrollHeight mismatch
      const truncated = [];
      document.querySelectorAll('h1,h2,h3,.brand-title,.slot-pill,.day-chip span, .btn').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 2) {
          truncated.push((el.className || el.tagName) + ` +${el.scrollWidth - el.clientWidth}`);
        }
      });

      return {
        issues,
        weekInfo,
        truncated: truncated.slice(0, 8),
        chipCount: chips.length,
        chipWidths: chips.map((c) => Math.round(c.getBoundingClientRect().width)),
      };
    });

    // scroll to frames and schedule for mid-page shots
    await page.evaluate(() => {
      document.querySelector('#schedule, .live-avail')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `E:/My_prodjek/clining_compani/releases/qa-${vp.name}-schedule.png`,
      fullPage: false,
    });

    await page.evaluate(() => {
      document.querySelector('#frames')?.scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(250);
    await page.screenshot({
      path: `E:/My_prodjek/clining_compani/releases/qa-${vp.name}-frames.png`,
      fullPage: false,
    });

    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `E:/My_prodjek/clining_compani/releases/qa-${vp.name}-footer.png`,
      fullPage: false,
    });

    out.push({ ...vp, ...report });
  }

  return out;
}
