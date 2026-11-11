export default async function (page) {
  const viewports = [
    { name: 'phone-360', width: 360, height: 800 },
    { name: 'phone-390', width: 390, height: 844 },
    { name: 'phone-430', width: 430, height: 932 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'tablet-820', width: 820, height: 1180 },
    { name: 'tablet-1024', width: 1024, height: 1366 },
    { name: 'desktop-1280', width: 1280, height: 900 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ];

  const results = [];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);

    const report = await page.evaluate(({ width }) => {
      const issues = [];
      const docW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      if (docW > clientW + 1) {
        issues.push({
          type: 'horizontal-overflow',
          detail: `scrollWidth ${docW} > clientWidth ${clientW}`,
        });
      }

      const selectors = [
        'header.site-header',
        '.hero',
        '.live-avail',
        '.week-strip',
        '#services',
        '#pricing',
        '#frames',
        '.frames-grid',
        '#reviews',
        'footer.site-footer',
        '.dev-links',
        '.mobile-cta',
        '.nav',
        '.header-actions',
      ];

      const boxes = [];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || r.width < 1 || r.height < 1) {
          continue;
        }
        boxes.push({
          sel,
          top: r.top,
          left: r.left,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
          fixed: style.position === 'fixed' || style.position === 'sticky',
        });
      }

      // Overlap of major blocks (ignore sticky/fixed vs content false positives lightly)
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i];
          const b = boxes[j];
          if (a.fixed || b.fixed) continue;
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 8 && overlapY > 8) {
            // nested parent/child skip
            const ea = document.querySelector(a.sel);
            const eb = document.querySelector(b.sel);
            if (ea && eb && (ea.contains(eb) || eb.contains(ea))) continue;
            issues.push({
              type: 'overlap',
              detail: `${a.sel} overlaps ${b.sel} by ${Math.round(overlapX)}x${Math.round(overlapY)}`,
            });
          }
        }
      }

      // Edge padding asymmetry for main container sections
      const containers = Array.from(document.querySelectorAll('.section .container, .live-avail .container, .site-footer .container'));
      for (const c of containers.slice(0, 8)) {
        const r = c.getBoundingClientRect();
        const leftGap = r.left;
        const rightGap = clientW - r.right;
        if (Math.abs(leftGap - rightGap) > 6) {
          issues.push({
            type: 'asymmetric-margins',
            detail: `container left ${leftGap.toFixed(1)} right ${rightGap.toFixed(1)} in ${c.parentElement?.id || c.parentElement?.className || 'unknown'}`,
          });
        }
        if (leftGap < 8 || rightGap < 8) {
          issues.push({
            type: 'edge-collision',
            detail: `container too close to edge L${leftGap.toFixed(1)} R${rightGap.toFixed(1)}`,
          });
        }
      }

      // Week chips overflow / squeeze
      const chips = Array.from(document.querySelectorAll('.day-chip'));
      chips.forEach((chip, idx) => {
        const r = chip.getBoundingClientRect();
        if (r.width > 0 && r.width < 36) {
          issues.push({ type: 'chip-too-narrow', detail: `day-chip[${idx}] width ${r.width.toFixed(1)}` });
        }
      });

      // Mobile CTA vs footer content
      const cta = document.querySelector('.mobile-cta');
      if (cta) {
        const cs = getComputedStyle(cta);
        if (cs.display !== 'none') {
          const cr = cta.getBoundingClientRect();
          if (cr.bottom > window.innerHeight + 2) {
            issues.push({ type: 'cta-offscreen', detail: 'mobile-cta bottom beyond viewport' });
          }
        }
      }

      // Header nav wrapping clash on mid widths
      const nav = document.querySelector('.nav');
      const actions = document.querySelector('.header-actions');
      if (nav && actions) {
        const nr = nav.getBoundingClientRect();
        const ar = actions.getBoundingClientRect();
        const ns = getComputedStyle(nav);
        if (ns.display !== 'none') {
          const ox = Math.min(nr.right, ar.right) - Math.max(nr.left, ar.left);
          const oy = Math.min(nr.bottom, ar.bottom) - Math.max(nr.top, ar.top);
          if (ox > 4 && oy > 4) {
            issues.push({ type: 'header-clash', detail: `nav overlaps header-actions ${Math.round(ox)}x${Math.round(oy)}` });
          }
        }
      }

      // Dev credit badges wrapping
      const devLinks = document.querySelector('.dev-links');
      if (devLinks) {
        const kids = Array.from(devLinks.children);
        for (let i = 0; i < kids.length; i += 1) {
          for (let j = i + 1; j < kids.length; j += 1) {
            const a = kids[i].getBoundingClientRect();
            const b = kids[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 2) {
              issues.push({ type: 'dev-badge-overlap', detail: 'developer badges overlap' });
            }
          }
        }
      }

      return {
        viewport: width,
        overflowX: docW - clientW,
        issueCount: issues.length,
        issues,
      };
    }, { width: vp.width });

    await page.screenshot({
      path: `E:/My_prodjek/clining_compani/releases/qa-${vp.name}.png`,
      fullPage: false,
    });

    results.push({ ...vp, ...report });
  }

  return results;
}
