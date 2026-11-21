// لقطات فعلية للتبويبات الخمسة والمشاهد الثلاثة (وضع تجريبي): node tests/e2e/shots.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const VER = require('../../package.json').version;
const ROOT = path.join(__dirname, '../../www');
const OUT = path.join(__dirname, 'out', 'shots');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});

async function open(browser, { theme = 'light', scene = 'photo', fs: fontScale = 1, width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.route(/api\.github\.com|open-meteo/, (r) => r.abort());
  await page.addInitScript(({ theme, scene, fontScale, VER }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    localStorage.setItem('taqati.tourSeen', 'true');
    localStorage.setItem('taqati.seenVersion', JSON.stringify(VER));
    const now = Date.now(), H = 36e5;
    localStorage.setItem('taqati.log', JSON.stringify([
      { cat: 'grid', level: 'ok', title: 'عادت كهرباء الشبكة', body: 'الجهد 228 فولت', at: now - 0.5 * H, read: true },
      { cat: 'grid', level: 'warn', title: 'انقطعت كهرباء الشبكة', body: 'المنظومة تعمل على البطارية', at: now - 1.2 * H, read: true },
      { cat: 'bat', level: 'warn', title: 'البطارية منخفضة', body: 'وصلت إلى 28%', at: now - 26 * H, read: true },
      { cat: 'fault', level: 'bad', title: 'حمل زائد', body: 'الحمل 92% من قدرة الإنفرتر', at: now - 27 * H, read: true },
    ]));
    localStorage.setItem('taqati.prefs', JSON.stringify({ theme, sceneStyle: scene, fontScale, batteryAh: 200, pvKwp: 2.9, price: 0.12, currency: 'USD', exRate: 13000 }));
  }, { theme, scene, fontScale, VER });
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.click('#demoBtn');
  await page.waitForSelector('.flow-card', { timeout: 20000 });
  await page.waitForTimeout(800);
  return page;
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const errors = [];
  for (const theme of ['light', 'dark']) {
    const p = await open(browser, { theme });
    for (const [tab, wait] of [['home', '.kpis'], ['reports', '.rep-hero canvas'], ['calc', '.calc-res'], ['alerts', '.big-title'], ['more', '.inv-hero']]) {
      await p.evaluate((t) => window.__nav(t, null), tab);
      await p.waitForSelector(wait, { timeout: 60000 }).catch(() => null);
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(OUT, `${tab}-${theme}.png`) });
      await p.screenshot({ path: path.join(OUT, `full-${tab}-${theme}.png`), fullPage: true });
    }
    errors.push(...p.errors);
    await p.context().close();
  }
  // المشاهد: الاختيار من بطاقة الإعدادات، ثم إعادة فتح التطبيق للتأكد من حفظه
  const results = [];
  const p = await open(browser, { scene: 'photo' });
  for (const scene of ['photo', '3d', 'classic']) {
    await p.evaluate(() => window.__nav('more', 'settings'));
    await p.waitForSelector('.scene-opts');
    await p.click(`[data-scene-opt="${scene}"]`);
    await p.waitForTimeout(300);
    if (scene === '3d') await (await p.$('.scene-opts')).screenshot({ path: path.join(OUT, 'scene-picker.png') });
    await p.reload();
    await p.waitForSelector('#demoBtn, .flow-card', { timeout: 20000 });
    if (await p.$('#demoBtn')) await p.click('#demoBtn');
    await p.waitForSelector('.flow-card', { timeout: 20000 });
    await p.waitForTimeout(900);
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs')).sceneStyle);
    const cls = await p.$eval('.scene', (e) => e.className);
    results.push(`${scene}: saved=${st} scene=${cls}`);
    await p.screenshot({ path: path.join(OUT, `scene-${scene}.png`) });
  }
  console.log(results.join('\n'));
  errors.push(...p.errors);
  await p.context().close();
  // هاتف صغير بخط أكبر
  const s = await open(browser, { width: 340, height: 720, fs: 1.2 });
  for (const tab of ['home', 'reports', 'more']) {
    await s.evaluate((t) => window.__nav(t, null), tab);
    await s.waitForTimeout(1500);
    await s.screenshot({ path: path.join(OUT, `small-${tab}.png`), fullPage: true });
  }
  errors.push(...s.errors);
  await browser.close();
  server.close();
  console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'ok');
})();
