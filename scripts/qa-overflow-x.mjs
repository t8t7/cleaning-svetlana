export default async function (page) {
  const widths = [360, 390, 430, 768];
  const out = [];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const report = await page.evaluate((vw) => {
      const doc = document.documentElement;
      const offenders = [];
      for (const el of document.body.querySelectorAll('*')) {
        const st = getComputedStyle(el);
        if (st.display === 'none' || st.visibility === 'hidden') continue;
        if (st.position === 'fixed' || st.position === 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.right > vw + 1 || r.left < -1) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
            left: Math.round(r.left),
            right: Math.round(r.right),
            w: Math.round(r.width),
          });
          if (offenders.length >= 12) break;
        }
      }
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        overflow: doc.scrollWidth - doc.clientWidth,
        offenders,
      };
    }, width);

    out.push({ width, ...report });
  }

  return out;
}
