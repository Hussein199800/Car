// اختبار واجهة سريع: يفتح كل الشاشات في Chromium بحجم هاتف، ويتأكد من غياب أخطاء JavaScript، ويحفظ لقطات
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '../../www');
const OUT = path.join(__dirname, 'out');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/index.html`;
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const shots = process.argv.includes('--shots');
  for (const theme of ['oasis', 'midnight', 'dawn', 'royal']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar', timezoneId: 'Africa/Cairo', hasTouch: true });
    await ctx.addInitScript((t) => {
      if (!localStorage.getItem('sakina.v1')) localStorage.setItem('sakina.v1', JSON.stringify({ settings: { theme: t, location: { type: 'city', cityId: 5 } } }));
    }, theme);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${theme}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${theme}: ${m.text()}`); });
    const routes = theme === 'oasis'
      ? ['home', 'library', 'read/morning', 'read/evening:3', 'tasbih', 'journal', 'settings', 'qibla', 'names', 'read/favorites', 'read/custom']
      : ['home', 'read/morning', 'tasbih', 'journal'];
    for (const r of routes) {
      await page.goto(`${base}#/${r}`);
      await page.waitForTimeout(450);
      if (shots) await page.screenshot({ path: path.join(OUT, `${theme}-${r.replace(/[/:]/g, '_')}.png`), fullPage: r !== 'read/morning' });
    }
    if (theme === 'oasis') {
      // تفاعلات أساسية
      await page.goto(`${base}#/read/morning`);
      await page.waitForTimeout(300);
      await page.click('.big-counter');
      await page.waitForTimeout(800);
      const label = await page.textContent('[data-rb-count]');
      if (!/١ من/.test(label)) errors.push(`عدّاد القارئ لم يتقدّم: ${label}`);
      await page.click('[data-act="r-mode"]');
      await page.waitForTimeout(300);
      await page.click('.d-card:nth-child(2) .pill-counter');
      await page.goto(`${base}#/tasbih`);
      for (let i = 0; i < 5; i++) await page.click('[data-tb-tap]');
      const c = await page.textContent('[data-tb-count]');
      if (c.trim() !== '٥') errors.push(`المسبحة لم تعدّ: ${c}`);
      await page.goto(`${base}#/home`);
      await page.waitForTimeout(300);
      await page.click('[data-act="mood"]');
      await page.waitForTimeout(500);
      if (shots) await page.screenshot({ path: path.join(OUT, 'oasis-mood-sheet.png') });
      await page.click('[data-mood-tap]');
      await page.goto(`${base}#/library`);
      await page.fill('#lib-q', 'استغفر');
      await page.waitForTimeout(200);
      const n = await page.$$eval('.result', (els) => els.length);
      if (!n) errors.push('البحث بدون تشكيل لم يُرجع نتائج');
      if (shots) await page.screenshot({ path: path.join(OUT, 'oasis-search.png') });
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sakina.v1')));
      if (!saved || !saved.progress || !Object.keys(saved.progress.counts).length) errors.push('لم يُحفظ التقدّم في localStorage');
    }
    await ctx.close();
  }
  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('✓ كل الشاشات تعمل بلا أخطاء');
})();
