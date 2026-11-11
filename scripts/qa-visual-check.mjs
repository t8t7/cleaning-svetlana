export default async function (page) {
  const shots = [];

  async function shot(name, width, height, prepare) {
    await page.setViewportSize({ width, height });
    await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    if (prepare) await prepare();
    await page.waitForTimeout(300);
    const path = `E:/My_prodjek/clining_compani/releases/qa-v-${name}.png`;
    await page.screenshot({ path, fullPage: false });
    shots.push(name);
  }

  await shot('phone360-hero', 360, 800);
  await shot('phone360-week', 360, 800, async () => {
    await page.evaluate(() => {
      document.querySelector('.week-strip')?.scrollIntoView({ block: 'center' });
    });
  });
  await shot('phone360-slots', 360, 800, async () => {
    await page.evaluate(() => {
      document.querySelector('.day-panel')?.scrollIntoView({ block: 'center' });
    });
  });
  await shot('phone360-frames', 360, 800, async () => {
    await page.evaluate(() => {
      const el = document.querySelector('#frames');
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo(0, top);
    });
  });
  await shot('phone360-footer', 360, 800, async () => {
    await page.evaluate(() => {
      document.querySelector('.site-footer')?.scrollIntoView({ block: 'end' });
    });
  });
  await shot('tablet768-week', 768, 1024, async () => {
    await page.evaluate(() => {
      document.querySelector('.week-strip')?.scrollIntoView({ block: 'center' });
    });
  });
  await shot('tablet768-frames', 768, 1024, async () => {
    await page.evaluate(() => {
      const el = document.querySelector('#frames');
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo(0, top);
    });
  });
  await shot('tablet1024-header', 1024, 768);
  await shot('desktop-header', 1280, 900);

  // open/close menu check
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:3080/', { waitUntil: 'networkidle' });
  const before = await page.evaluate(() => {
    const nav = document.querySelector('#mobile-nav');
    return { hidden: nav?.hidden, display: getComputedStyle(nav).display };
  });
  await page.click('#menu-toggle');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'E:/My_prodjek/clining_compani/releases/qa-v-menu-open.png', fullPage: false });
  const open = await page.evaluate(() => {
    const nav = document.querySelector('#mobile-nav');
    const hero = document.querySelector('.hero');
    const nr = nav.getBoundingClientRect();
    const hr = hero.getBoundingClientRect();
    const ox = Math.min(nr.right, hr.right) - Math.max(nr.left, hr.left);
    const oy = Math.min(nr.bottom, hr.bottom) - Math.max(nr.top, hr.top);
    return {
      hidden: nav.hidden,
      display: getComputedStyle(nav).display,
      overlapsHero: ox > 2 && oy > 2,
      headerHeight: document.querySelector('.site-header').getBoundingClientRect().height,
    };
  });
  await page.click('#menu-toggle');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => {
    const nav = document.querySelector('#mobile-nav');
    return { hidden: nav?.hidden, display: getComputedStyle(nav).display };
  });

  return { shots, menu: { before, open, after } };
}
