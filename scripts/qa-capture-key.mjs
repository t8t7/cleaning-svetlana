export default async function (page) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  // force reveals for visual QA
  await page.evaluate(() => {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-visible'));
  });

  const chipText = await page.evaluate(() => {
    return [...document.querySelectorAll('.day-chip')].map((c) => {
      const full = c.querySelector('.day-state-full');
      const short = c.querySelector('.day-state-short');
      const fs = full ? getComputedStyle(full).display : null;
      const ss = short ? getComputedStyle(short).display : null;
      return {
        label: c.querySelector('.day-name')?.textContent,
        full: full?.textContent?.trim(),
        short: short?.textContent?.trim(),
        fullDisplay: fs,
        shortDisplay: ss,
      };
    });
  });

  await page.evaluate(() => {
    document.querySelector('.week-strip')?.scrollIntoView({ block: 'center' });
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-key-week.png' });

  await page.evaluate(() => {
    const el = document.querySelector('#frames');
    const y = el.getBoundingClientRect().top + window.scrollY - 72;
    window.scrollTo({ top: y, behavior: 'instant' });
  });
  await page.waitForTimeout(350);
  const framesInfo = await page.evaluate(() => {
    const h = document.querySelector('#frames-title');
    const r = h?.getBoundingClientRect();
    return {
      title: h?.textContent,
      visible: r ? r.top >= 60 && r.top < 700 : false,
      top: r?.top,
      opacity: h ? getComputedStyle(h.closest('.reveal') || h).opacity : null,
    };
  });
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-key-frames.png' });

  await page.evaluate(() => {
    document.querySelector('.site-footer')?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(350);
  const footerInfo = await page.evaluate(() => {
    const f = document.querySelector('.site-footer');
    const badges = [...document.querySelectorAll('.dev-links > a')].map((a) => {
      const r = a.getBoundingClientRect();
      return { text: a.textContent.trim(), top: r.top, bottom: r.bottom, height: r.height };
    });
    const cta = document.querySelector('.mobile-cta');
    const cr = cta?.getBoundingClientRect();
    return {
      footerTop: f?.getBoundingClientRect().top,
      footerBg: f ? getComputedStyle(f).backgroundColor : null,
      badges,
      ctaTop: cr?.top,
      badgeCoveredByCta: badges.some((b) => cr && b.bottom > cr.top + 4),
    };
  });
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-key-footer.png' });

  // scroll to absolute end — badges should clear CTA thanks to body padding
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(300);
  const endInfo = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('.dev-links > a')].map((a) => a.getBoundingClientRect());
    const cta = document.querySelector('.mobile-cta')?.getBoundingClientRect();
    return {
      badgeBottoms: badges.map((b) => b.bottom),
      ctaTop: cta?.top,
      clear: badges.every((b) => !cta || b.bottom <= cta.top - 2),
    };
  });
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-key-footer-end.png' });

  return { chipText, framesInfo, footerInfo, endInfo };
}
