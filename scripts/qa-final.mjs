export default async function (page) {
  const viewports = [
    { name: 'p360', width: 360, height: 800 },
    { name: 'p390', width: 390, height: 844 },
    { name: 'p430', width: 430, height: 932 },
    { name: 't768', width: 768, height: 1024 },
    { name: 't820', width: 820, height: 1180 },
    { name: 't1024', width: 1024, height: 1366 },
    { name: 'd1280', width: 1280, height: 900 },
    { name: 'd1440', width: 1440, height: 900 },
  ];

  const results = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    const report = await page.evaluate(() => {
      const issues = [];
      const vw = document.documentElement.clientWidth;
      const sw = document.documentElement.scrollWidth;
      if (sw > vw + 1) issues.push(`overflow-x ${sw - vw}`);

      const nav = document.querySelector('#mobile-nav');
      if (nav && vw < 900) {
        const closed = nav.hidden || getComputedStyle(nav).display === 'none';
        if (!closed) issues.push('nav-open-default');
      }

      // containers symmetry
      document.querySelectorAll('.container').forEach((c, i) => {
        if (i > 5) return;
        const r = c.getBoundingClientRect();
        const L = r.left;
        const R = vw - r.right;
        if (Math.abs(L - R) > 5) issues.push(`asym#${i} L${L.toFixed(0)} R${R.toFixed(0)}`);
      });

      // slot text
      document.querySelectorAll('.slot').forEach((slot, idx) => {
        const time = slot.querySelector('.slot-time');
        const label = slot.querySelector('strong');
        if (!time || !label) return;
        const a = time.getBoundingClientRect();
        const b = label.getBoundingClientRect();
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) issues.push(`slot-overlap-${idx}`);
      });

      // week
      const week = document.querySelector('.week-strip');
      const weekScroll = week ? week.scrollWidth > week.clientWidth + 2 : false;
      if (weekScroll) issues.push('week-h-scroll');

      // chips overlap
      const chips = [...document.querySelectorAll('.day-chip')];
      for (let i = 0; i < chips.length; i++) {
        for (let j = i + 1; j < chips.length; j++) {
          const a = chips[i].getBoundingClientRect();
          const b = chips[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 1 && oy > 1) issues.push(`chip-overlap-${i}-${j}`);
        }
      }

      // header children
      const kids = [...document.querySelectorAll('.header-inner > *')].filter((el) => getComputedStyle(el).display !== 'none');
      for (let i = 0; i < kids.length; i++) {
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i].getBoundingClientRect();
          const b = kids[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) issues.push('header-overlap');
        }
      }

      // footer badges
      const badges = [...document.querySelectorAll('.dev-links > a')];
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          const a = badges[i].getBoundingClientRect();
          const b = badges[j].getBoundingClientRect();
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 2 && oy > 2) issues.push('badge-overlap');
        }
      }

      return { issues, chipW: chips.map((c) => Math.round(c.getBoundingClientRect().width)) };
    });

    results.push({ ...vp, ...report });
  }

  // visual finals
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-360-top.png' });

  await page.evaluate(() => document.querySelector('.week-strip')?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-360-week.png' });

  await page.evaluate(() => {
    const el = document.querySelector('#frames');
    if (!el) return;
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 80);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-360-frames.png' });

  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-360-footer.png' });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-768-top.png' });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-final-1280-top.png' });

  return results;
}
