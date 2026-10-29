// اختبارات شاملة للواجهة في متصفح Chromium مع خادم WatchPower وهمي يعيد حقول جهاز حقيقي.
// التشغيل: npm run test:e2e   (الصور تُحفظ في tests/e2e/out)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const ROOT = path.join(__dirname, '../../www');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ---------- خادم ملفات بسيط للواجهة ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const file = p.endsWith('/') ? path.join(p, 'index.html') : p;
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// ---------- بيانات جهاز حقيقي ----------
const pad = (x) => String(x).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
function points(ts, extra = {}) {
  const P = {
    id: '7c95e164763112e14109989f40c20b3a', Timestamp: stamp(ts), SN: '96342601101639', 'Machine Type': 'Off Grid',
    'Main CPU Firmware Version': '00069.00', 'Grid Voltage': '225.9', 'Grid Frequency': '50.0', 'PV1 Input Voltage': '0.0',
    'PV2 Input voltage': '-', 'PV1 Charging Power': '0', 'Battery Voltage': '51.6', 'Battery Capacity': '53',
    'Battery Charging Current': '0', 'Battery Discharge Current': '36', 'AC Output Voltage': '230.0', 'AC Output Frequency': '50.0',
    'AC Output Apparent Power': '1794', 'AC Output Active Power': '1730', 'Output Load Percent': '27', 'Grid Rating Voltage': '230.0',
    'Battery Rating Voltage': '48.0', 'AC Output Rating Active Power': '6500', 'Battery Re-Charge Voltage': '48.0',
    'Battery Bulk Voltage': '57.6', 'Battery Float Voltage': '57.6', 'Battery Type': 'Lib', 'Max AC Charging Current': '40.0',
    'AC Input Range': 'UPS', 'Output Source Priority': 'Solar Bat Utility', 'Charger Source Priority': 'Solar + Utility',
    'Battery Re-Discharge Voltage': '54.0', 'Bus Voltage': '358', 'Load Status': 'Load on', Model: 'Battery Mode',
    'Total generation': '867100', 'Today generation': '3163', 'Inverter Fault': '-', ...extra,
  };
  return Object.entries(P).map(([title, val]) => ({ title, val, unit: '' }));
}

const VER = require('../../package.json').version;
const relOf = (v, notes = '') => ({ tag_name: 'v' + v, body: notes, published_at: '2026-11-01T10:00:00Z', assets: [
  { name: `taqati-${v}.apk`, size: 4800000, browser_download_url: `https://github.com/Hussein199800/Car/releases/download/v${v}/taqati-${v}.apk` }] });
const DEVICE = { pn: 'W0072122216413', sn: '55355535553555', devcode: 2451, devaddr: 1, devalias: 'Master 7KW', status: 0 };
const SESSION = { profile: 'dess', usr: 'tester', pwdHash: 'x', token: 'tok', secret: 'sec', expire: Date.now() + 36e5 };

let failures = 0;
const results = [];
function check(name, cond, info = '') {
  results.push(`${cond ? '✓' : '✗'} ${name}${!cond && info ? ' — ' + info : ''}`);
  if (!cond) failures++;
}

async function newPage(browser, { viewport = { width: 390, height: 844 }, scheme = 'light', api, loggedIn = true, prefs, storage = {}, release = relOf(VER) } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.calls = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  await page.route(/dessmonitor\.com|shinemonitor\.com/, async (route) => {
    const u = new URL(route.request().url());
    const action = u.searchParams.get('action');
    page.calls.push({ action, params: Object.fromEntries(u.searchParams) });
    const r = api ? await api(action, u.searchParams, page.calls.filter((c) => c.action === action).length) : null;
    if (r === 'abort') return route.abort('internetdisconnected');
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(r || { err: 0, dat: {} }) });
  });
  // خادم التحديثات الوهمي: افتراضياً آخر إصدار هو المثبّت نفسه
  page.ghCalls = 0;
  await page.route(/api\.github\.com/, async (route) => {
    page.ghCalls++;
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(release) });
  });
  await page.addInitScript(({ loggedIn, SESSION, DEVICE, prefs, storage }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    if (loggedIn) {
      localStorage.setItem('taqati.session', JSON.stringify(SESSION));
      localStorage.setItem('taqati.devices', JSON.stringify([{ ...DEVICE, alias: DEVICE.devalias }]));
    }
    if (prefs) localStorage.setItem('taqati.prefs', JSON.stringify(prefs));
    for (const [k, v] of Object.entries(storage)) localStorage.setItem('taqati.' + k, JSON.stringify(v));
  }, { loggedIn, SESSION, DEVICE, prefs, storage });
  await page.goto(`http://localhost:${server.address().port}/`);
  return page;
}

const lastData = (ageMin, extra) => (action) => (action === 'queryDeviceLastData' ? { err: 0, dat: points(Date.now() - ageMin * 60000, extra) } : null);
const text = (page, sel) => page.textContent(sel).catch(() => '');
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  await new Promise((r) => server.listen(0, r));
  const browser = await playwright.chromium.launch();
  try {
    // 1) تسجيل الدخول واكتشاف الجهاز
    {
      const page = await newPage(browser, {
        loggedIn: false,
        api: (a) => ({
          authSource: { err: 0, dat: { token: 'T', secret: 'S', expire: 7200 } },
          queryPlants: { err: 0, dat: { plant: [{ pid: 7 }] } },
          webQueryDeviceEs: { err: 0, dat: { device: [DEVICE] } },
          queryDeviceLastData: { err: 0, dat: points(Date.now() - 60000) },
        })[a],
      });
      check('روابط إنشاء حساب وإعداد الواي فاي في شاشة الدخول', (await page.$$('[data-guide]')).length === 2);
      await page.click('[data-guide=wifi]');
      check('دليل الواي فاي يفتح قبل الدخول', (await text(page, '#view')).includes('Wi-Fi Config') && (await text(page, '#view')).includes('12345678'));
      const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), page.click('.fold[open] [data-open-app=wifi]')]);
      check('زر WatchPower يفتح صفحة التطبيق الحقيقي', !!popup && popup.url().includes('wifiapp.volfw.watchpower'));
      if (popup) await popup.close();
      await page.click('#guideBack');
      await page.fill('[name=usr]', 'tester');
      await page.fill('[name=pwd]', 'secret');
      await page.click('#pwdEye');
      check('زر إظهار كلمة المرور', (await page.getAttribute('[name=pwd]', 'type')) === 'text');
      await page.click('button[type=submit]');
      await page.waitForSelector('.flow-card', { timeout: 8000 }).catch(() => {});
      const auth = page.calls.find((c) => c.action === 'authSource');
      check('الدخول يرسل التوقيع والملح ومفتاح الشركة', !!(auth && /^[0-9a-f]{40}$/.test(auth.params.sign) && auth.params.salt && auth.params['company-key'] === 'bnrl_frRFjEz8Mkn'));
      check('لا تُرسل كلمة المرور نفسها في الطلب', !page.calls.some((c) => JSON.stringify(c.params).includes('secret')));
      check('اكتشاف الجهاز ثم عرض لوحته', (await text(page, '.dev-name')).includes('Master 7KW'));
      check('الطلبات اللاحقة تستخدم الرمز', page.calls.some((c) => c.action === 'queryDeviceLastData' && c.params.token === 'T'));
      check('بلا أخطاء JavaScript (دخول)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 2) خطأ كلمة مرور برسالة عربية
    {
      const page = await newPage(browser, { loggedIn: false, api: () => ({ err: 1, desc: 'ERR_PASSWORD_VERIF_FAIL' }) });
      await page.fill('[name=usr]', 'x'); await page.fill('[name=pwd]', 'y'); await page.click('button[type=submit]');
      await page.waitForSelector('.err');
      check('رسالة خطأ كلمة المرور مفهومة', (await text(page, '.err')).includes('كلمة المرور غير صحيحة'));
      check('جُرّب الخادمان قبل الرفض', new Set(page.calls.map((c) => c.action)).size === 2);
      await page.context().close();
    }

    // 3) الرافع مطفأ: آخر قراءة قبل 99 دقيقة
    {
      const page = await newPage(browser, { api: lastData(99), scheme: 'dark' });
      await page.waitForSelector('.banner.off');
      check('يظهر «غير متصل» للقراءة القديمة', (await text(page, '.banner.off')).includes('غير متصل'));
      check('بطاقات التفاصيل رمادية', !!(await page.$('.gcards.stale')));
      check('لا حركة تدفق مع قراءة قديمة', !(await page.$('.flow-line')) && !(await page.$('.arrow')));
      await page.screenshot({ path: path.join(OUT, 'stale-dark.png'), fullPage: true });
      check('بلا أخطاء JavaScript (انقطاع)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 4) متصل: قراءة قبل دقيقتين
    {
      const page = await newPage(browser, { api: lastData(2) });
      await page.waitForSelector('.flow-card');
      check('النقطة خضراء والقراءة حديثة', !!(await page.$('.dev .dot.on')) && !(await page.$('.banner.off')));
      check('حركة تدفق البطارية والحمل', (await page.$$('.flow-line')).length >= 2);
      // البيانات الحقيقية: تفريغ 36 أمبير → الأسهم تخرج من البطارية (عكس اتجاه الخط)
      const batAnim = await page.$eval('.a-bat animateMotion', (a) => ({ rot: a.getAttribute('rotate'), keys: a.getAttribute('keyPoints') }));
      check('التفريغ: أسهم خارجة من البطارية', batAnim.rot === 'auto-reverse' && batAnim.keys === '1;0');
      check('التفريغ مكتوب تحت البطارية', (await text(page, '.n-bat .bt')).includes('تُفرّغ'));
      const loadAnim = await page.$eval('.a-load animateMotion', (a) => a.getAttribute('rotate'));
      check('الحمل: أسهم داخلة إلى البيت', loadAnim === 'auto');
      await page.click('.n-load'); await page.waitForTimeout(250);
      check('الضغط على البيت يفتح تفاصيل الحمل', (await text(page, '.page-title')) === 'الحمل');
      await page.click('#backBtn'); await page.click('.n-inv'); await page.waitForTimeout(250);
      check('الضغط على الإنفرتر يفتح صفحته', (await text(page, '.page-title')).length > 0 && !!(await page.$('.fold')));
      await page.click('#backBtn'); await page.click('.n-solar'); await page.waitForTimeout(250);
      check('الضغط على الألواح يفتح تفاصيلها', (await text(page, '.page-title')) === 'الألواح الشمسية');
      await page.click('#backBtn');
      check('ملاحظة عاجلة من النصائح لا تظهر بلا داعٍ', !(await page.$('.tip-banner')));
      await page.context().close();
    }

    // 4ب) شحن: الأسهم تدخل البطارية
    {
      const page = await newPage(browser, { api: lastData(2, { 'Battery Charging Current': '12', 'Battery Discharge Current': '0', 'PV1 Charging Power': '900' }) });
      await page.waitForSelector('.flow-card');
      const a = await page.$eval('.a-bat animateMotion', (x) => x.getAttribute('rotate'));
      check('الشحن: أسهم داخلة إلى البطارية', a === 'auto' && (await text(page, '.n-bat .bt')).includes('تشحن'));
      await page.context().close();
    }

    // 5) فرق توقيت: الخادم متأخر 3 ساعات والقراءات تتجدد
    {
      const page = await newPage(browser, {
        prefs: { pollSec: 10 },
        api: (a, _p, n) => (a === 'queryDeviceLastData' ? { err: 0, dat: points(Date.now() - 180 * 60000 - 60000 + n * 20000) } : null),
      });
      await page.waitForSelector('.flow-card');
      await page.waitForTimeout(11500);
      check('اكتشاف فرق التوقيت تلقائياً', (await text(page, '.dev-sub')).includes('آخر قراءة') && !(await page.$('.banner.off')));
      const alerts = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.alerts') || '[]').length);
      check('لا تنبيه انقطاع كاذب بسبب التوقيت', alerts === 0);
      await page.context().close();
    }

    // 6) لا إنترنت ولا بيانات محفوظة → رسالة وزر إعادة محاولة
    {
      const page = await newPage(browser, { api: () => 'abort' });
      await page.waitForSelector('#retryBtn');
      check('زر إعادة المحاولة عند تعذّر الاتصال', (await text(page, '.empty')).includes('تعذّر'));
      await page.context().close();
    }

    // 7) لا إنترنت مع بيانات محفوظة → تظهر مع وقتها
    {
      const page = await newPage(browser, {
        api: () => 'abort',
        storage: { [`last.${DEVICE.sn}`]: { points: points(Date.now() - 3 * 60000), at: Date.now() - 2 * 60000 } },
      });
      await page.waitForSelector('.banner.warn');
      check('عرض آخر بيانات محفوظة بدون إنترنت', (await text(page, '.banner.warn')).includes('آخر بيانات محفوظة'));
      await page.context().close();
    }

    // 8) تعديل إعداد في الرافع مع التأكيد
    {
      const page = await newPage(browser, {
        api: (a) => ({
          queryDeviceLastData: { err: 0, dat: points(Date.now() - 60000) },
          queryDeviceCtrlField: { err: 0, dat: { field: [
            { id: 'los_output_source_priority', name: 'Output Source Priority', item: [{ key: '0', val: 'Utility First' }, { key: '2', val: 'SBU Priority' }] },
            { id: 'eq_time', name: 'Battery Equalization Time', unit: 'min', hint: '5~900min' },
            { id: 'restore', name: 'Restore To Default', item: [{ key: '1', val: 'Execute' }] },
          ] } },
          queryDeviceParsEs: { err: 0, dat: { parameter: [] } },
          ctrlDevice: { err: 0, dat: {} },
        })[a],
      });
      await page.route(/dessmonitor/, async (route) => {
        const u = new URL(route.request().url());
        const a = u.searchParams.get('action');
        if (a !== 'queryDeviceCtrlValue') return route.fallback();
        page.calls.push({ action: a, params: Object.fromEntries(u.searchParams) });
        const body = u.searchParams.get('id') === 'eq_time' ? { err: 1, desc: 'ERR_SYSTEM_EXCEPTION' } : { err: 0, dat: { val: '2' } };
        await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
      });
      await page.waitForSelector('.flow-card');
      await page.click('[data-tab=more]'); await page.click('[data-page=edit]');
      await page.waitForSelector('.field-h'); await page.click('.field-h');
      await page.waitForSelector('.f-in');
      check('القيمة الحالية معروضة بالعربية', (await text(page, '.cur')).includes('SBU'));
      await page.selectOption('.f-in', '0'); await page.click('.f-save');
      await page.waitForSelector('.modal');
      check('طلب تأكيد قبل الإرسال', (await text(page, '.modal')).includes('الكهرباء أولاً'));
      await page.click('.modal [data-v="1"]'); await page.waitForTimeout(400);
      const ctrl = page.calls.find((c) => c.action === 'ctrlDevice');
      check('إرسال الإعداد بالمعرّف والقيمة الصحيحين', ctrl?.params.id === 'los_output_source_priority' && ctrl?.params.val === '0' && ctrl?.params.sn === DEVICE.sn);
      const titles = await page.$$eval('.fh-t b', (e) => e.map((x) => x.textContent));
      check('أسماء الإعدادات بالعربية مع شرح', titles.some((t) => t.includes('استعادة إعدادات المصنع')) && titles.some((t) => t.includes('مدة المعادلة')) && (await page.$$('.fh-t small')).length >= 3);
      // قيمة تعذّرت قراءتها: يظهر الإعداد مع شرح بدل رسالة خطأ فقط
      await page.click('.field[data-i="1"] .field-h');
      await page.waitForSelector('.field[data-i="1"] .f-save');
      const eqText = await text(page, '.field[data-i="1"] .field-b');
      check('ERR_SYSTEM_EXCEPTION: الإعداد يبقى قابلاً للتعديل مع شرح عربي', eqText.includes('غير متاحة') && eqText.includes('لم يستطع خادم'));
      await page.fill('.field[data-i="1"] .f-in', '2000'); await page.click('.field[data-i="1"] .f-save');
      check('رفض قيمة خارج النطاق المسموح', !(await page.$('.modal')) && !page.calls.some((c) => c.action === 'ctrlDevice' && c.params.id === 'eq_time'));
      // لوحة المفاتيح العربية: «٦٠» تُرسل 60
      await page.fill('.field[data-i="1"] .f-in', '٦٠'); await page.click('.field[data-i="1"] .f-save');
      await page.waitForSelector('.modal');
      await page.click('.modal [data-v="1"]'); await page.waitForTimeout(400);
      const eqSent = page.calls.find((c) => c.action === 'ctrlDevice' && c.params.id === 'eq_time');
      check('الأرقام العربية في الإعدادات تُرسل كأرقام صحيحة', eqSent?.params.val === '60', JSON.stringify(eqSent?.params));
      // إعداد بخيار واحد = زر إجراء، لا يُقرأ ولا يظهر ERR_UNSUPPORTED
      await page.click('.field[data-i="2"] .field-h');
      await page.waitForSelector('.field[data-i="2"] .f-act');
      check('استعادة المصنع زر إجراء دون قراءة قيمة', !page.calls.some((c) => c.action === 'queryDeviceCtrlValue' && c.params.id === 'restore'));
      await page.click('.f-act'); await page.click('.modal [data-v="1"]'); await page.waitForTimeout(150);
      check('إجراء حساس يطلب تأكيداً ثانياً', (await text(page, '.modal')).includes('تأكيد أخير'));
      await page.click('.modal [data-v="0"]'); await page.waitForTimeout(200);
      check('إلغاء التأكيد الثاني لا يرسل شيئاً', !page.calls.some((c) => c.action === 'ctrlDevice' && c.params.id === 'restore'));
      await page.context().close();
    }

    // 9) الوضع التجريبي: كل الصفحات والتقارير والتصدير وحجم الشاشات
    {
      const page = await newPage(browser, { loggedIn: false });
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      const PAGES = {
        home: [null, 'load', 'battery', 'solar', 'grid', 'device', 'all'],
        reports: [null, 'day', 'week', 'month', 'compare', 'export'],
        calc: [null],
        alerts: [null, 'rules'],
        more: [null, 'setup', 'edit', 'tips', 'tips/smart', 'tips/lithium', 'monitor', 'custom', 'account', 'backup', 'update', 'about'],
      };
      for (const [tab, pages] of Object.entries(PAGES)) {
        for (const pg of pages) {
          await page.evaluate(({ tab, pg }) => window.__nav?.(tab, pg), { tab, pg });
          await page.waitForTimeout(pg === 'week' || pg === 'month' || pg === 'compare' || pg === 'day' ? 2200 : 250);
          const ok = (await page.$eval('#view', (v) => v.textContent.trim().length > 0)) && (await noHScroll(page));
          check(`صفحة ${tab}${pg ? '/' + pg : ''} تعمل بلا تمرير أفقي`, ok);
        }
      }
      // الحاسبة
      await page.evaluate(() => window.__nav('calc', null));
      await page.fill('#calcInput', '1'); await page.waitForTimeout(150);
      const res = await page.$$eval('.res-main b', (e) => e.map((x) => x.textContent));
      const bat = await page.$$eval('.bat-v b', (e) => e.map((x) => x.textContent));
      check('الحاسبة: 1 أمبير = 220 واط و5.1 أمبير من 48 فولت', res[0] === '220' && bat[2] === '5.1', `${res} | ${bat}`);
      await page.click('[data-ctab=list]'); await page.click('[data-add=fridge]'); await page.click('[data-add=tv]'); await page.waitForTimeout(150);
      check('الحاسبة: إضافة أجهزة وحساب الحمل', (await page.$$('.ld')).length === 2 && (await text(page, '.res-main b')) === '250');
      check('الحاسبة: حكم على قدرة الإنفرتر', !!(await page.$('.verdict.ok')));
      // المزيد: اسم المطوّر وزر الخروج
      await page.evaluate(() => window.__nav('more', 'about'));
      const about = await text(page, '#view');
      check('حول التطبيق يذكر الحاسبة والنصائح والمراقبة ودليل الربط', ['حاسبة أحمال', 'نصائح', 'في الخلفية', 'الواي فاي'].every((w) => about.includes(w)));
      await page.evaluate(() => window.__nav('more', null));
      check('اسم المطوّر ظاهر أعلى المزيد', (await text(page, '.dev-top')).includes('حسين محمد علي الطويل'));
      check('زر تسجيل الخروج أحمر ومنفصل في آخر المزيد', await page.$eval('#logoutBtn', (b) => getComputedStyle(b).backgroundColor === 'rgb(239, 68, 68)' && b.previousElementSibling?.classList.contains('lcards')));
      // التصدير
      await page.evaluate(() => window.__nav('reports', 'export'));
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('[data-page="x-today"]')]);
      const csv = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
      check('تصدير CSV بترميز يفتح في Excel', csv.startsWith('﻿') && csv.includes('الوقت'));
      // المظهر
      await page.evaluate(() => window.__nav('more', 'custom'));
      await page.click('[data-theme=dark]');
      check('التبديل للوضع الليلي', (await page.getAttribute('html', 'data-theme')) === 'dark');
      await page.click('[data-term="invTerm:akis"]');
      await page.evaluate(() => window.__nav('home', null));
      check('تغيير المصطلح يظهر في الواجهة', (await text(page, '#view')).includes('العاكس'));
      check('بلا أخطاء JavaScript أو مخالفات CSP (تجريبي)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 11) التحقق من التحديثات
    {
      const page = await newPage(browser, { api: lastData(2), release: relOf('9.9.0', 'ميزة رائعة\nإصلاحات') });
      await page.waitForSelector('.flow-card');
      await page.waitForSelector('.toast', { timeout: 5000 }).catch(() => null);
      check('إشعار مرة واحدة عند توفر إصدار جديد', (await text(page, '.toast')).includes('9.9.0'));
      check('التحقق التلقائي يطلب GitHub مرة واحدة', page.ghCalls === 1, String(page.ghCalls));
      await page.click('[data-tab=more]');
      check('شارة «جديد» على بطاقة التحديثات', (await text(page, '[data-page=update]')).includes('جديد'));
      await page.click('[data-page=update]');
      const u = await text(page, '#view');
      check('صفحة التحديث تعرض الإصدار والملاحظات وحجم الملف', u.includes('9.9.0') && u.includes('ميزة رائعة') && u.includes('4.6 ميغابايت') && u.includes(VER));
      const [pop] = await Promise.all([page.waitForEvent('popup', { timeout: 3000 }).catch(() => null), page.click('#updGo')]);
      check('زر التحديث يفتح ملف APK من صفحة إصدارات المستودع', !!pop && pop.url().includes('/Hussein199800/Car/releases/download/v9.9.0/'));
      if (pop) await pop.close();
      check('بلا أخطاء JavaScript (التحديثات)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }
    {
      const page = await newPage(browser, { api: lastData(2), storage: { updateAt: Date.now() - 60000 } });
      await page.waitForSelector('.flow-card'); await page.waitForTimeout(300);
      check('لا يُعاد التحقق التلقائي قبل 12 ساعة', page.ghCalls === 0);
      await page.evaluate(() => window.__nav('more', 'update'));
      await page.click('#updCheck'); await page.waitForTimeout(400);
      check('التحقق اليدوي: «تطبيقك محدّث» عندما لا يوجد أحدث', page.ghCalls === 1 && (await text(page, '#view')).includes('تطبيقك محدّث'));
      await page.context().close();
    }

    // 12) النسخة الاحتياطية: إنشاء ثم استعادة بعد «إعادة التثبيت»
    {
      const HASH = 'e5e9fa1ba31ecd1ae84f75caaa474f3a663f05f4';
      const page = await newPage(browser, { api: lastData(2), prefs: { batteryAh: 321, invTerm: 'akis' }, storage: { session: { ...SESSION, pwdHash: HASH } } });
      await page.waitForSelector('.flow-card');
      await page.evaluate(() => window.__nav('more', 'backup'));
      await page.fill('#bkCode', 'abc123'); await page.fill('#bkCode2', 'abc999'); await page.click('#bkMake');
      check('رفض رمزين غير متطابقين', (await text(page, '.toast')).includes('غير متطابقين'));
      await page.fill('#bkCode2', 'abc123');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }).catch(() => null), page.click('#bkMake')]);
      const file = dl ? path.join(OUT, 'backup.json') : null;
      if (dl) await dl.saveAs(file);
      const body = file ? fs.readFileSync(file, 'utf8') : '';
      check('ملف النسخة الاحتياطية مشفّر بلا اسم مستخدم أو بصمة', body.includes('taqati-backup') && !body.includes('tester') && !body.includes(HASH) && /taqati-backup-\d{4}-\d\d-\d\d\.json/.test(dl?.suggestedFilename() || ''));
      await page.context().close();

      const fresh = await newPage(browser, {
        loggedIn: false,
        api: (a) => ({
          authSource: { err: 0, dat: { token: 'T', secret: 'S', expire: 7200 } },
          queryPlants: { err: 0, dat: { plant: [{ pid: 7 }] } },
          webQueryDeviceEs: { err: 0, dat: { device: [DEVICE] } },
          queryDeviceLastData: { err: 0, dat: points(Date.now() - 60000) },
        })[a],
      });
      await fresh.click('#restoreBtn');
      if (file) await fresh.setInputFiles('#bkFile', file);
      await fresh.fill('#bkCodeIn', 'wrong1'); await fresh.click('#bkRestore');
      await fresh.waitForSelector('#bkErr:not([hidden])', { timeout: 15000 }).catch(() => null);
      check('رمز خاطئ: رسالة واضحة ولا اتصال بالخادم', (await text(fresh, '#bkErr')).includes('الرمز غير صحيح') && !fresh.calls.some((c) => c.action === 'authSource'));
      await fresh.fill('#bkCodeIn', 'abc123'); await fresh.click('#bkRestore');
      await fresh.waitForSelector('.flow-card', { timeout: 15000 }).catch(() => null);
      const auth = fresh.calls.find((c) => c.action === 'authSource');
      check('الاستعادة تدخل الحساب مباشرة دون كلمة المرور', !!(await fresh.$('.flow-card')) && auth?.params.usr === 'tester');
      const restored = await fresh.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs') || '{}'));
      check('الاستعادة تعيد الإعدادات (سعة البطارية والمصطلحات)', restored.batteryAh === 321 && restored.invTerm === 'akis' && (await text(fresh, '#view')).includes('العاكس'));
      check('بلا أخطاء JavaScript (النسخة الاحتياطية)', fresh.errors.length === 0, fresh.errors.join(' | '));
      await fresh.context().close();
    }
    {
      // زر الرجوع في شاشة الاستعادة يعيد لشاشة الدخول
      const page = await newPage(browser, { loggedIn: false });
      await page.click('#restoreBtn'); await page.click('#restoreBack');
      check('الرجوع من شاشة الاستعادة إلى الدخول', !!(await page.$('#loginForm')));
      await page.context().close();
    }

    // 10) أحجام الشاشات والاتجاهات
    const SIZES = { 'هاتف صغير': [320, 640], 'هاتف': [390, 844], 'هاتف أفقي': [844, 390], 'لوحي عمودي': [800, 1280], 'لوحي أفقي': [1280, 800] };
    for (const [name, [w, h]] of Object.entries(SIZES)) {
      const page = await newPage(browser, { viewport: { width: w, height: h }, api: lastData(2) });
      await page.waitForSelector('.flow-card');
      await page.waitForTimeout(300);
      check(`${name} ${w}×${h}: بلا تمرير أفقي`, await noHScroll(page));
      const flowVisible = await page.$eval('.flow-card', (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.right <= window.innerWidth + 1; });
      check(`${name}: مخطط التدفق ظاهر كاملاً`, flowVisible);
      if (w >= 720) check(`${name}: تخطيط عمودين`, await page.$eval('.home-grid', (el) => getComputedStyle(el).display === 'grid'));
      await page.screenshot({ path: path.join(OUT, `size-${w}x${h}.png`) });
      await page.context().close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures} نجح، ${failures} فشل`);
  process.exit(failures ? 1 : 0);
})();
