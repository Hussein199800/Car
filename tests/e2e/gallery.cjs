// معرض مرتّب لكل الشاشات (وضع تجريبي): node tests/e2e/gallery.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const VER = require('../../package.json').version;
const ROOT = path.join(__dirname, '../../www');
const OUT = path.join(__dirname, 'out', 'gallery');
fs.mkdirSync(OUT, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); res.end(b); });
});

async function ctxPage(browser, theme, { width = 390, height = 844, fontScale = 1, demo = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: theme });
  const page = await ctx.newPage();
  await page.route(/api\.github\.com|open-meteo/, (r) => r.abort());
  await page.addInitScript(({ theme, fontScale, VER }) => {
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
    localStorage.setItem('taqati.prefs', JSON.stringify({ theme, sceneStyle: 'photo', fontScale, batteryAh: 200, pvKwp: 2.9, price: 0.12, currency: 'USD', exRate: 13000 }));
  }, { theme, fontScale, VER });
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForSelector('#demoBtn');
  if (demo) { await page.click('#demoBtn'); await page.waitForSelector('.flow-card', { timeout: 20000 }); await page.waitForTimeout(800); }
  return page;
}

let n = 0;
const shot = async (page, name, full = false) => {
  n++;
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, `${String(n).padStart(2, '0')}-${name}.png`), fullPage: full });
};
const go = async (page, tab, pg, wait) => {
  await page.evaluate(([t, p]) => window.__nav(t, p), [tab, pg]);
  if (wait) await page.waitForSelector(wait, { timeout: 60000 }).catch(() => null);
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  for (const theme of ['dark', 'light']) {
    const t = theme === 'dark' ? 'ليلي' : 'نهاري';
    const login = await ctxPage(browser, theme, { demo: false });
    await shot(login, `${t}-تسجيل-الدخول`);
    await login.context().close();
    const p = await ctxPage(browser, theme);
    await shot(p, `${t}-الرئيسية`);
    await shot(p, `${t}-الرئيسية-كاملة`, true);
    await go(p, 'home', 'battery', '.page-title'); await shot(p, `${t}-تفاصيل-البطارية`);
    await go(p, 'reports', null, '.rep-hero canvas'); await shot(p, `${t}-التقارير-اليوم`);
    await p.click('[data-hk=week]'); await p.waitForSelector('.rep-hero canvas', { timeout: 60000 }).catch(() => null);
    await shot(p, `${t}-التقارير-الأسبوع`, true);
    await go(p, 'reports', 'period', '.per-key'); await shot(p, `${t}-تقرير-فترة`);
    await go(p, 'calc', null, '.calc-res'); await shot(p, `${t}-الحاسبة`);
    await p.click('[data-ctab=list]'); await shot(p, `${t}-الحاسبة-أجهزة-بيتي`);
    await p.click('[data-ctab=save]'); await shot(p, `${t}-الحاسبة-التوفير`);
    await p.click('[data-ctab=conv]');
    await go(p, 'alerts', null, '.timeline'); await shot(p, `${t}-التنبيهات`);
    await go(p, 'alerts', 'rules', '.page-title'); await shot(p, `${t}-شروط-التنبيه`);
    await go(p, 'more', null, '.inv-hero'); await shot(p, `${t}-المزيد`);
    await shot(p, `${t}-المزيد-كاملة`, true);
    await go(p, 'more', 'settings', '.scene-opts'); await shot(p, `${t}-الإعدادات`);
    await shot(p, `${t}-الإعدادات-كاملة`, true);
    await p.context().close();
  }
  // المشاهد الثلاثة
  const s = await ctxPage(browser, 'dark');
  for (const [scene, name] of [['photo', 'صور-واقعية'], ['3d', 'ثلاثي-الأبعاد'], ['classic', 'الكلاسيكي']]) {
    await go(s, 'more', 'settings', '.scene-opts');
    await s.click(`[data-scene-opt="${scene}"]`);
    await go(s, 'home', null, '.flow-card');
    await shot(s, `مشهد-${name}`);
  }
  await s.context().close();
  // هاتف صغير بخط أكبر
  const sm = await ctxPage(browser, 'dark', { width: 340, height: 720, fontScale: 1.2 });
  await shot(sm, 'هاتف-صغير-خط-كبير-الرئيسية');
  await go(sm, 'reports', null, '.rep-hero canvas'); await shot(sm, 'هاتف-صغير-خط-كبير-التقارير');
  await go(sm, 'more', null, '.inv-hero'); await shot(sm, 'هاتف-صغير-خط-كبير-المزيد');
  await sm.context().close();
  await browser.close();
  server.close();
  console.log(fs.readdirSync(OUT).join('\n'));
})();
