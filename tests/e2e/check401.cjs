// لقطات 4.0.1: الرئيسية (مشهد ثلاثي الأبعاد، نهاري) والتقارير بأنواعها الخمسة
const path = require('path'); const fs = require('fs'); const http = require('http');
const { chromium } = require('playwright');
const VER = require('../../package.json').version;
const OUT = path.join(__dirname, 'out', 'v401'); fs.mkdirSync(OUT, { recursive: true });
const ROOT = path.join(__dirname, '../../www');
const s = http.createServer((q, r) => { const f = path.join(ROOT, q.url.split('?')[0].replace(/\/$/, '/index.html')); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' }); r.end(b); }); });
(async () => {
  await new Promise((r) => s.listen(0, r));
  const b = await chromium.launch();
  const errors = [];
  for (const theme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.route(/api\.github\.com|open-meteo/, (r) => r.abort());
    await p.addInitScript(({ theme, VER }) => { if (sessionStorage.s) return; sessionStorage.s = 1; localStorage.clear(); localStorage.setItem('taqati.tourSeen', 'true'); localStorage.setItem('taqati.seenVersion', JSON.stringify(VER)); localStorage.setItem('taqati.prefs', JSON.stringify({ theme, sceneStyle: '3d', batteryAh: 200, price: 0.12, currency: 'USD', exRate: 13000 })); }, { theme, VER });
    await p.goto('http://localhost:' + s.address().port + '/');
    await p.click('#demoBtn'); await p.waitForSelector('.flow-card'); await p.waitForTimeout(1000);
    await p.screenshot({ path: path.join(OUT, `${theme}-1-home.png`) });
    await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(OUT, `${theme}-2-home-scroll.png`) });
    await p.evaluate(() => window.__nav('reports', null));
    for (const [i, k] of [['3', 'day'], ['4', 'week'], ['5', 'month'], ['6', 'year'], ['7', 'period']]) {
      await p.click(`[data-hk=${k}]`);
      await p.waitForSelector(k === 'year' ? '#cYear, .empty' : k === 'period' ? '.per-key' : '.rep-hero canvas', { timeout: 60000 }).catch(() => null);
      await p.waitForTimeout(900);
      await p.screenshot({ path: path.join(OUT, `${theme}-${i}-reports-${k}.png`) });
    }
    await ctx.close();
  }
  await b.close(); s.close();
  console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'ok');
})();
