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

async function newPage(browser, { viewport = { width: 390, height: 844 }, scheme = 'light', api, loggedIn = true, prefs, storage = {}, release = relOf(VER), locale } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: scheme, acceptDownloads: true, ...(locale ? { locale } : {}) });
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
  await page.addInitScript(({ loggedIn, SESSION, DEVICE, prefs, storage, VER }) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.clear();
    // الجولة التعريفية و«ما الجديد» تُختبران في قسمهما، فنتجاوزهما في باقي الاختبارات
    if (!storage.__tour) { localStorage.setItem('taqati.tourSeen', 'true'); localStorage.setItem('taqati.seenVersion', JSON.stringify(VER)); }
    if (loggedIn) {
      localStorage.setItem('taqati.session', JSON.stringify(SESSION));
      localStorage.setItem('taqati.devices', JSON.stringify([{ ...DEVICE, alias: DEVICE.devalias }]));
    }
    if (prefs) localStorage.setItem('taqati.prefs', JSON.stringify(prefs));
    for (const [k, v] of Object.entries(storage)) if (k !== '__tour') localStorage.setItem('taqati.' + k, JSON.stringify(v));
  }, { loggedIn, SESSION, DEVICE, prefs, storage, VER });
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

    // 3) الإنفرتر مطفأ: آخر قراءة قبل 99 دقيقة
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
      // بيانات الاختبار إنتاجها صفر: بين 10 و2 ظهراً بتوقيت الجهاز يكون تنبيه «لا إنتاج وقت الظهر» صحيحاً
      const hr = new Date().getHours();
      const tipB = await page.$('.tip-banner');
      check('ملاحظة عاجلة من النصائح لا تظهر بلا داعٍ', !tipB || (hr >= 10 && hr <= 14 && (await text(page, '.tip-banner')).includes('وقت الظهر')), tipB ? await text(page, '.tip-banner') : '');
      check('أربعة تبويبات فقط', (await page.$$('.tabbar button')).length === 4);
      const cards = await page.$$eval('.gcard', (e) => e.map((x) => x.dataset.page));
      check('بطاقات الرئيسية: الحمل والألواح والكهرباء والإنفرتر (البطارية في المخطط والحلقة)', cards.join() === 'load,solar,grid,device', cards.join());
      check('لا يوجد اختيار جهاز لحساب بجهاز واحد', !(await page.$('#devPick')));
      await page.click('.battery-card .ring'); await page.waitForTimeout(250);
      check('الضغط على حلقة البطارية يفتح صفحتها', (await text(page, '.page-title')) === 'البطارية');
      await page.click('#backBtn'); await page.click('.gcard[data-page=device]'); await page.waitForTimeout(250);
      check('كل القراءات داخل صفحة الإنفرتر', (await text(page, '#view')).includes('كل القراءات الحيّة'));
      await page.click('#backBtn');
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
        storage: { devPollSec: 10 },
        api: (a, _p, n) => (a === 'queryDeviceLastData' ? { err: 0, dat: points(Date.now() - 180 * 60000 - 60000 + n * 20000) } : null),
      });
      await page.waitForSelector('.flow-card');
      await page.waitForTimeout(11500);
      check('اكتشاف فرق التوقيت تلقائياً', (await text(page, '.dev-sub')).includes('آخر قراءة') && !(await page.$('.banner.off')));
      const offline = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.log') || '[]').filter((e) => e.cat === 'conn').length);
      check('لا تنبيه انقطاع كاذب بسبب التوقيت', offline === 0);
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

    // 8) تعديل إعداد في الإنفرتر مع التأكيد
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
      // هاتف بلغة عربية (السعودية) تعرض تواريخه افتراضياً بالأرقام الهندية: يجب أن يبقى التطبيق على 0-9
      const page = await newPage(browser, { loggedIn: false, locale: 'ar-SA' });
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      const mixed = [];
      const PAGES = {
        home: [null, 'load', 'battery', 'solar', 'grid', 'device'],
        reports: [null, 'advisor', 'day', 'week', 'month'],
        alerts: [null, 'rules'],
        more: [null, 'setup', 'edit', 'calc', 'tips', 'tips/lithium', 'settings', 'update', 'about'],
      };
      for (const [tab, pages] of Object.entries(PAGES)) {
        for (const pg of pages) {
          await page.evaluate(({ tab, pg }) => window.__nav?.(tab, pg), { tab, pg });
          await page.waitForTimeout(['week', 'month', 'compare', 'day', 'advisor'].includes(pg) ? 2200 : 250);
          const ok = (await page.$eval('#view', (v) => v.textContent.trim().length > 0)) && (await noHScroll(page));
          check(`صفحة ${tab}${pg ? '/' + pg : ''} تعمل بلا تمرير أفقي`, ok);
          if (/[\u0660-\u0669\u06F0-\u06F9]/.test(await page.$eval('body', (b) => b.innerText))) mixed.push(`${tab}/${pg}`);
        }
      }
      check('نظام أرقام واحد (0-9) في كل الصفحات حتى على هاتف بلغة عربية', mixed.length === 0, mixed.join(', '));
      // الحاسبة
      await page.evaluate(() => window.__nav('more', 'calc'));
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
      check('حول التطبيق: الإصدار والخصوصية', about.includes(VER) && about.includes('الخصوصية'));
      await page.evaluate(() => window.__nav('more', null));
      check('اسم المطوّر ظاهر أعلى المزيد', (await text(page, '.dev-top')).includes('حسين محمد علي الطويل'));
      check('زر تسجيل الخروج أحمر ومنفصل في آخر المزيد', await page.$eval('#logoutBtn', (b) => getComputedStyle(b).backgroundColor === 'rgb(239, 68, 68)' && b.previousElementSibling?.classList.contains('lcards')));
      // نسبة التغيّر داخل التقرير الأسبوعي بدل صفحة المقارنة
      await page.evaluate(() => window.__nav('reports', 'week'));
      await page.waitForSelector('.stat .trend', { timeout: 15000 }).catch(() => null);
      check('التقرير الأسبوعي يعرض نسبة التغيّر عن الأسبوع السابق', (await page.$$('.stat .trend')).length === 4 && (await text(page, '#view')).includes('الأسبوع السابق'));
      await page.evaluate(() => window.__nav('reports', null));
      check('لا توجد صفحة مقارنة منفصلة', !(await page.$('[data-page=compare]')));
      // التصدير من داخل التقرير اليومي
      await page.evaluate(() => window.__nav('reports', 'day'));
      await page.waitForSelector('#expDay', { timeout: 8000 }).catch(() => null);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#expDay')]);
      const csv = dl ? fs.readFileSync(await dl.path(), 'utf8') : '';
      check('تصدير CSV بترميز يفتح في Excel', csv.startsWith('﻿') && csv.includes('الوقت'));
      check('وقت القراءات في CSV بصيغة ثابتة يفهمها Excel', /\n"?\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/.test(csv), csv.slice(0, 160));
      // المظهر
      await page.evaluate(() => window.__nav('more', 'settings'));
      await page.click('[data-theme-opt=dark]');
      check('التبديل للوضع الليلي', (await page.getAttribute('html', 'data-theme')) === 'dark');
      await page.evaluate(() => window.__nav('home', null));
      check('المصطلحات الثابتة في الواجهة', (await text(page, '#view')).includes('الإنفرتر') && !(await text(page, 'body')).includes('الرافع'));
      check('بلا أخطاء JavaScript أو مخالفات CSP (تجريبي)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 13) مستشار الطاقة والتقرير اليومي وحجم الخط (تجريبي)
    {
      const page = await newPage(browser, { loggedIn: false, viewport: { width: 320, height: 640 } });
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      // مؤشر الاستقلالية في رأس تبويب التقارير، والضغط عليه يفتح الملاحظات
      await page.click('[data-tab=reports]');
      await page.waitForSelector('#view .adv-big', { timeout: 15000 }).catch(() => null);
      const first = await page.$eval('#view > div > :first-child', (e) => e.className).catch(() => '');
      check('مؤشر الاستقلالية أول ما في تبويب التقارير', first.includes('adv-ind') && /\d+%/.test(await text(page, '.adv-big b')), first);
      await page.click('#view button.adv-ind');
      await page.waitForSelector('.adv-tip', { timeout: 15000 }).catch(() => null);
      const adv = await text(page, '#view');
      check('مستشار الطاقة: الضغط على المؤشر يفتح استخدام البطارية والتوصيات', (await text(page, '.page-title')) === 'ملاحظات على منظومتك' && adv.includes('استخدام البطارية') && (await page.$$('.adv-tip')).length > 0, adv.slice(0, 200));
      // شريط التبويبات بلا خانة فارغة: الهامشان على الطرفين متساويان
      const gaps = await page.evaluate(() => { const bar = document.querySelector('.tabbar').getBoundingClientRect(); const bs = [...document.querySelectorAll('.tabbar button')].map((b) => b.getBoundingClientRect()); return [Math.min(...bs.map((r) => r.left)) - bar.left, bar.right - Math.max(...bs.map((r) => r.right)), bs.length]; });
      check('شريط التبويبات متوازن بلا مكان فارغ', Math.abs(gaps[0] - gaps[1]) < 2 && gaps[2] === 4, gaps.join(','));
      check('المستشار لا يخترع حالة صحة البطارية', adv.includes('لا يرسل حالة صحة البطارية'));
      check('ملاحظات الآن وآخر 7 أيام في صفحة واحدة', adv.includes('الآن') && adv.includes('آخر 7 أيام') && (await page.$$('#view .alerts .alert')).length > 0);
      check('المؤشر لم يعد مكرراً داخل صفحة الملاحظات', !(await page.$('#view .adv-ind')));
      await page.evaluate(() => window.__nav('more', 'tips'));
      await page.click('[data-page="reports:advisor"]'); await page.waitForTimeout(300);
      check('بطاقة ملاحظات الجهاز في النصائح تفتح صفحة التقارير', (await text(page, '.page-title')) === 'ملاحظات على منظومتك' && !!(await page.$('.tabbar [data-tab=reports].on')));
      await page.evaluate(() => window.__nav('reports', 'day'));
      await page.waitForTimeout(1500);
      const day = await text(page, '#view');
      check('التقرير اليومي: أدنى وأعلى نسبة مع الوقت والشحن من الألواح والكهرباء والاستقلالية', ['أدنى نسبة للبطارية', 'الساعة', 'شحن من الألواح', 'شحن من الكهرباء', 'الاستقلالية'].every((w) => day.includes(w)));
      await page.evaluate(() => window.__nav('more', 'settings'));
      await page.click('[data-fs="1.2"]');
      const fs = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--fs').trim());
      const h1 = await page.$eval('.page-title', (e) => parseFloat(getComputedStyle(e).fontSize));
      check('تكبير الخط يطبّق على التطبيق كله', fs === '1.2' && h1 > 18, `${fs} ${h1}`);
      for (const [tab, pg] of [['home', null], ['reports', 'advisor'], ['more', null]]) {
        await page.evaluate(({ tab, pg }) => window.__nav(tab, pg), { tab, pg }); await page.waitForTimeout(300);
        check(`خط أكبر على شاشة 320: ${tab}${pg ? '/' + pg : ''} بلا تمرير أفقي`, await noHScroll(page));
      }
      check('بلا أخطاء JavaScript (المستشار)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }
    {
      // الحرارة: تظهر وتُنبّه فقط عندما يرسلها الجهاز
      const page = await newPage(browser, { api: lastData(2, { 'Inverter heat sink temperature': '85' }) });
      await page.waitForSelector('.flow-card');
      await page.evaluate(() => window.__nav('home', 'device'));
      check('صفحة الإنفرتر تعرض الحرارة المرسلة', (await text(page, '#view')).includes('حرارة المبدّد الحراري'));
      await page.click('[data-tab=alerts]');
      check('تنبيه ارتفاع حرارة الإنفرتر', /حرارة الإنفرتر مرتفعة/.test(await text(page, '#view')));
      await page.evaluate(() => window.__nav('alerts', 'rules'));
      check('إعدادات الحرارة تظهر لما يرسله الجهاز فقط', !!(await page.$('[data-pref=alertTemp]')) && !!(await page.$('[data-pref=tempInv]')) && !(await page.$('[data-pref=tempBat]')));
      await page.context().close();
      const plain = await newPage(browser, { api: lastData(2) });
      await plain.waitForSelector('.flow-card');
      await plain.evaluate(() => window.__nav('alerts', 'rules'));
      check('شروط التنبيه تخفي الحرارة وتوضّح السبب', (await text(plain, '#view')).includes('لا يرسل قراءات الحرارة') && !(await plain.$('[data-pref=alertTemp]')));
      await plain.context().close();
    }

    // 15) السجل الموحّد: ترحيل سجلّي الإصدارات السابقة بلا تكرار
    {
      const t = Date.now() - 3600e3;
      const page = await newPage(browser, {
        api: lastData(2),
        storage: {
          faults: [{ kind: 'grid', title: 'انقطاع الكهرباء الوطنية', body: 'جهد الشبكة 0 فولت', at: t }, { kind: 'info', title: 'تغيير إعداد', body: 'أولوية مصدر الخرج ← SBU', at: t - 60e3 }],
          alerts: [{ kind: 'warn', title: 'انقطعت الكهرباء الوطنية', body: 'المنظومة تعمل على البطارية', at: t + 2, read: false }, { kind: 'bad', title: 'البطارية منخفضة', body: 'نسبة الشحن 25%', at: t - 120e3, read: true }],
        },
      });
      await page.waitForSelector('.flow-card');
      check('شارة التنبيهات تعدّ غير المقروء بعد الترحيل', (await text(page, '#alertBadge')) === '1');
      await page.click('[data-tab=alerts]');
      check('السجل الموحّد: كل حدث مرة واحدة', (await page.$$('.alerts .alert')).length === 3 && (await page.$$('.alert.new')).length === 1);
      const chips = await page.$$eval('.log-filter button', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
      check('فلاتر بعدّادات للفئات الموجودة فقط', chips.join('|') === 'الكل 3|الكهرباء 1|البطارية 1|الإعدادات 1', chips.join('|'));
      await page.click('.log-filter [data-filter=grid]');
      check('الفلتر يعرض فئته فقط', (await page.$$('.alerts .alert')).length === 1 && (await text(page, '.alerts')).includes('انقطعت'));
      const stored = await page.evaluate(() => ({ alerts: localStorage.getItem('taqati.alerts'), faults: localStorage.getItem('taqati.faults') }));
      check('المفاتيح القديمة تُحذف بعد الترحيل', stored.alerts === null && stored.faults === null);
      check('بلا أخطاء JavaScript (السجل)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 14) تبديل الجهاز أثناء جلب قراءته: لا تظهر قراءة الجهاز السابق باسم الجهاز الجديد
    {
      const A = { ...DEVICE, sn: 'AAAA1111', devalias: 'جهاز أ', alias: 'جهاز أ' };
      const B = { ...DEVICE, sn: 'BBBB2222', devalias: 'جهاز ب', alias: 'جهاز ب' };
      const page = await newPage(browser, {
        storage: { devices: [A, B], devSn: A.sn },
        api: async (a, q) => {
          if (a !== 'queryDeviceLastData') return null;
          if (q.get('sn') === A.sn) { await new Promise((r) => setTimeout(r, 1500)); return { err: 0, dat: points(Date.now() - 60000, { 'Battery Capacity': '11' }) }; }
          return { err: 0, dat: points(Date.now() - 60000, { 'Battery Capacity': '88' }) };
        },
      });
      await page.waitForTimeout(300);
      await page.click('#devPick');
      await page.click(`.modal [data-sn="${B.sn}"]`);
      await page.waitForTimeout(2500);
      await page.evaluate(() => window.__nav('home', null));
      await page.waitForSelector('.ring-txt');
      const ring = await text(page, '.ring-txt b');
      check('تبديل الجهاز أثناء الطلب: تظهر قراءة الجهاز الجديد فقط', ring.includes('88') && (await text(page, '.dev-name')).includes('جهاز ب'), ring);
      await page.context().close();
    }
    {
      // التحديث الدوري لا يطوي الأقسام التي فتحها المستخدم
      const page = await newPage(browser, { api: lastData(2), storage: { devPollSec: 10 } });
      await page.waitForSelector('.flow-card');
      await page.evaluate(() => window.__nav('home', 'device'));
      await page.click('details.fold:nth-of-type(2) summary');
      const before = page.calls.filter((c) => c.action === 'queryDeviceLastData').length;
      await page.waitForTimeout(11500);
      const after = page.calls.filter((c) => c.action === 'queryDeviceLastData').length;
      check('التحديث الدوري لا يطوي القسم المفتوح', after > before && await page.$eval('details.fold:nth-of-type(2)', (d) => d.open));
      await page.context().close();
    }

    // 15) الإصدار 3.7: الأرقام العربية، الشرح ⓘ، المشهد والطقس، التوفير، السنوي، سجل الخادم، الموقع
    {
      const page = await newPage(browser, { loggedIn: false });
      await page.route(/geocoding-api\.open-meteo\.com/, (rt) => rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ results: [{ name: 'إدلب', admin1: 'محافظة ادلب', country: 'سوريا', latitude: 35.93, longitude: 36.63 }] }) }));
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      // المشهد: كل حالة طقس بسماء وجملة مختلفة ومنطقية
      const scenes = {};
      for (const k of ['clear', 'rain', 'night']) {
        await page.click(`[data-demo-sky="${k}"]`); await page.waitForTimeout(700);
        scenes[k] = { cls: await page.$eval('.scene', (e) => e.className), story: await text(page, '.story b'), bat: await text(page, '.n-bat .bt'), img: await page.$eval('.ph-img', (e) => e.getAttribute('src')).catch(() => '') };
      }
      check('المشهد المشمس: سماء صافية والألواح تشحن البطارية', scenes.clear.cls.includes('sky-clear') && scenes.clear.story.includes('تشحن البطارية') && scenes.clear.bat.includes('تشحن'), JSON.stringify(scenes.clear));
      check('المشهد الماطر: إنتاج ضعيف متوقع والبطارية تكمّل', scenes.rain.cls.includes('sky-rain') && scenes.rain.story.includes('متوقع') && scenes.rain.bat.includes('تُفرّغ'), JSON.stringify(scenes.rain));
      check('المشهد الليلي: البيت على البطارية', scenes.night.cls.includes('sky-night') && scenes.night.story.includes('ليل') && scenes.night.bat.includes('تُفرّغ'), JSON.stringify(scenes.night));
      await page.click('[data-demo-sky="clear"]'); await page.waitForTimeout(600);
      check('حرارة الجو تظهر من الطقس', (await text(page, '.tchips')).includes('24°') && (await text(page, '.tchips')).includes('الجو'));
      check('مشهد الصور افتراضياً: صورة النهار والمطر والليل حسب الطقس', scenes.clear.img.endsWith('day.webp') && scenes.rain.img.endsWith('rain.webp') && scenes.night.img.endsWith('night.webp'), [scenes.clear.img, scenes.rain.img, scenes.night.img].join(' '));
      {
        const soc = parseInt((await text(page, '.n-bat b')).replace(/\D/g, ''), 10);
        const lit = await page.$$eval('.bat-segs .bseg.on', (a) => a.length);
        check('شرائح البطارية على الصورة بنسبة الشحن الحقيقية', lit === Math.max(1, Math.round((soc / 100) * 6)), `${soc}% → ${lit}`);
        const imgOk = await page.$eval('.ph-img', (e) => e.complete && e.naturalWidth === 1088);
        check('صورة المشهد تُحمَّل من التطبيق نفسه', imgOk);
      }
      const arrows = await page.$$eval('animateMotion', (a) => a.length);
      check('خطوط الطاقة متحركة في المشهد', arrows >= 6);
      // ⓘ داخل بطاقة: يفتح الشرح ولا يفتح البطاقة
      await page.click('[data-demo-sky=""]'); await page.waitForTimeout(500);
      await page.click('.gcard [data-info="loadNow"]');
      await page.waitForSelector('.isheet.show', { timeout: 3000 }).catch(() => null);
      check('زر ⓘ يفتح الشرح دون فتح البطاقة', (await text(page, '.isheet h3')) === 'الحمل' && !(await page.$('.page-title')));
      await page.click('.isheet [data-close]'); await page.waitForTimeout(400);
      check('الشرح يُغلق بزر «تم»', !(await page.$('.isheet')));
      // الألواح: الإنتاج الكلي مع ⓘ وتاريخ التسجيل، وإنتاج كل كيلوواط
      await page.evaluate(() => window.__nav('home', 'solar')); await page.waitForTimeout(400);
      await page.click('[data-info="totalWh"]'); await page.waitForTimeout(300);
      const tot = await text(page, '.isheet');
      check('شرح الإنتاج الكلي: عدّاد الإنفرتر ومنذ متى', tot.includes('منذ تشغيل الإنفرتر') && tot.includes('2024'), tot.slice(0, 120));
      await page.click('.isheet [data-close]'); await page.waitForTimeout(300);
      check('إنتاج كل كيلوواط ألواح يظهر عند معرفة القدرة', (await text(page, '#view')).includes('إنتاج كل كيلوواط ألواح'));
      // سعة البطارية بالأرقام العربية
      await page.evaluate(() => window.__nav('more', 'settings')); await page.waitForTimeout(300);
      await page.fill('[data-pref=batteryAh]', '٢٥٠'); await page.press('[data-pref=batteryAh]', 'Enter'); await page.waitForTimeout(300);
      const ah = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs')).batteryAh);
      check('سعة البطارية تقبل الأرقام العربية ٢٥٠', ah === 250 && (await text(page, '#batSum')).includes('12.00'), String(ah));
      await page.fill('[data-pref=batteryAh]', '3'); await page.press('[data-pref=batteryAh]', 'Enter'); await page.waitForTimeout(300);
      check('قيمة خارج المسموح تُصحَّح مع رسالة', (await page.inputValue('[data-pref=batteryAh]')) === '10' && (await text(page, '.toast')).includes('بين 10'));
      // الموقع للطقس
      await page.fill('#locQ', 'إدلب'); await page.$eval('#locGo', (e) => e.scrollIntoView({ block: 'center' })); await page.click('#locGo'); await page.waitForSelector('.loc-it', { timeout: 5000 }).catch(() => null);
      await page.$eval('.loc-it', (e) => e.scrollIntoView({ block: 'center' })); await page.click('.loc-it'); await page.waitForTimeout(300);
      const loc = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs')).loc);
      check('البحث عن المدينة بالعربية وحفظ موقعها', loc?.name === 'إدلب' && loc.lat === 35.93 && (await text(page, '#locCard')).includes('إدلب'));
      // التوفير في الحاسبة
      await page.evaluate(() => window.__nav('more', 'calc')); await page.waitForTimeout(300);
      await page.click('[data-ctab=save]'); await page.waitForTimeout(200);
      await page.fill('#svPrice', '١٥٠٠'); await page.waitForTimeout(900);
      const sv = await text(page, '.sv');
      check('التوفير: السعر بالأرقام العربية ونتائج اليوم ومنذ تشغيل الإنفرتر', sv.includes('اليوم') && sv.includes('منذ تشغيل الإنفرتر') && /\d{1,3}(,\d{3})+/.test(sv), sv.slice(0, 160));
      // التقرير السنوي
      await page.evaluate(() => window.__nav('reports', 'year')); await page.waitForSelector('#cYear', { timeout: 5000 }).catch(() => null);
      const yr = await text(page, '#view');
      check('التقرير السنوي: إنتاج السنة وأفضل شهر ومنذ أول قراءة والتوفير', ['إنتاج السنة', 'أفضل شهر', 'منذ أول قراءة', 'توفير السنة'].every((x) => yr.includes(x)) && !!(await page.$('#cYear')));
      // سجل الإنفرتر في الخادم
      await page.evaluate(() => window.__nav('alerts', 'srvlog')); await page.waitForSelector('.alerts .alert', { timeout: 5000 }).catch(() => null);
      check('سجل الإنفرتر في الخادم مترجم مع النص الأصلي', (await text(page, '#view')).includes('جهد البطارية منخفض') && (await text(page, '.orig')).includes('Battery voltage low'));
      // وحدة الواي فاي
      await page.evaluate(() => window.__nav('home', 'device')); await page.waitForSelector('#wifiRestart', { timeout: 3000 }).catch(() => null);
      check('وحدة الواي فاي: كل كم ترفع القراءة وزر إعادة التشغيل', (await text(page, '#view')).includes('5 دقائق') && !!(await page.$('#wifiRestart')));
      await page.$eval('#wifiRestart', (e) => e.scrollIntoView({ block: 'center' })); await page.click('#wifiRestart'); await page.click('.modal [data-v="1"]'); await page.waitForTimeout(400);
      check('إعادة تشغيل الوحدة تعطي نتيجة واضحة', (await page.$$eval('.toast', (t) => t.map((x) => x.textContent).join(' | '))).includes('أُعيد تشغيل الوحدة'));
      check('بلا أخطاء JavaScript (3.7)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }
    {
      // ميزة يرفضها خادم الحساب تختفي بدل أن تبقى زراً لا يعمل
      const page = await newPage(browser, {
        api: (a) => (a === 'authSource' ? { err: 0, dat: { token: 'T2', secret: 'S2', expire: 7200 } } : a === 'queryDeviceLastData' ? { err: 0, dat: points(Date.now() - 60000) } : a === 'queryDeviceEnergyYearPerMonth' ? { err: 260, desc: 'ERR_NO_AUTH' } : a === 'queryDeviceEnergyTotal' ? { err: 0, dat: { energy: '900' } } : null),
      });
      await page.waitForSelector('.flow-card');
      await page.evaluate(() => window.__nav('reports', 'year')); await page.waitForTimeout(800);
      check('التقرير السنوي: رسالة واضحة عند رفض الخادم', (await text(page, '#view')).includes('لا يتيح التقرير السنوي'));
      await page.evaluate(() => window.__nav('reports', null)); await page.waitForTimeout(300);
      check('بطاقة التقرير السنوي تختفي بعد رفض الخادم', !(await page.$('[data-page=year]')));
      await page.context().close();
    }

    // 16) الجولة التعريفية عند أول تثبيت، و«ما الجديد» بعد التحديث
    {
      const page = await newPage(browser, { loggedIn: false, storage: { __tour: true } });
      await page.click('#demoBtn');
      await page.waitForSelector('.tour.show', { timeout: 5000 }).catch(() => null);
      check('الجولة تظهر عند أول تشغيل', (await text(page, '.tour h2')).includes('أهلاً بك'));
      await page.click('[data-t=next]'); await page.waitForTimeout(300);
      const c1 = await text(page, '.tour-case');
      await page.waitForTimeout(3300);
      const c2 = await text(page, '.tour-case');
      check('شاشة الرئيسية في الجولة تعرض حالات مختلفة للمشهد تلقائياً', (await text(page, '.tour h2')) === 'الرئيسية' && c1 && c2 && c1 !== c2, `${c1} → ${c2}`);
      const titles = [];
      for (let k = 0; k < 4; k++) { await page.click('[data-t=next]'); await page.waitForTimeout(200); titles.push(await text(page, '.tour h2')); }
      check('التالي ينتقل بين الشاشات بالترتيب', titles.join('|') === 'التقارير|التنبيهات|المزيد|ⓘ بجانب كل رقم', titles.join('|'));
      await page.click('[data-t=prev]'); await page.waitForTimeout(200);
      check('السابق يعود للشاشة قبلها', (await text(page, '.tour h2')) === 'المزيد');
      await page.click('[data-t=next]'); await page.click('[data-t=next]'); await page.waitForTimeout(400);
      check('«ابدأ» يغلق الجولة ولا تعود', !(await page.$('.tour')) && (await page.evaluate(() => localStorage.getItem('taqati.tourSeen'))) === 'true');
      await page.evaluate(() => window.__nav('more', null)); await page.waitForTimeout(300);
      await page.$eval('[data-page="tour"]', (e) => e.scrollIntoView({ block: 'center' }));
      await page.click('[data-page="tour"]'); await page.waitForTimeout(300);
      check('الجولة متاحة من «المزيد»', !!(await page.$('.tour')));
      await page.click('[data-t=skip]'); await page.waitForTimeout(400);
      check('تخطي يغلق الجولة', !(await page.$('.tour')));
      check('بلا أخطاء JavaScript (الجولة)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
      const up = await newPage(browser, { loggedIn: false, storage: { __tour: true, tourSeen: true, seenVersion: '0.0.1' } });
      await up.click('#demoBtn');
      await up.waitForSelector('.isheet.show', { timeout: 5000 }).catch(() => null);
      check('«ما الجديد» يظهر مرة بعد التحديث', (await text(up, '.isheet h3')).includes('ما الجديد') && (await up.$$('.wn li')).length >= 3);
      await up.click('.isheet [data-close]'); await up.waitForTimeout(300);
      check('«ما الجديد» لا يعود بعد إغلاقه', (await up.evaluate(() => JSON.parse(localStorage.getItem('taqati.seenVersion')))) === VER);
      await up.context().close();
    }

    // 17) 3.9: أشكال المشهد، الكتابة في الإعدادات بلا إعادة رسم، والبحث عن المدينة أثناء الكتابة
    {
      const page = await newPage(browser, { loggedIn: false, viewport: { width: 890, height: 1335 } });
      let geo = 0;
      await page.route(/geocoding-api\.open-meteo\.com/, (rt) => {
        geo++;
        const name = new URL(rt.request().url()).searchParams.get('name');
        const results = name === 'إدلب' ? [{ name: 'إدلب', admin1: 'محافظة ادلب', country: 'سوريا', latitude: 35.93, longitude: 36.63 }] : name === 'ادلب' ? [{ name: 'ادلبودن', admin1: 'برن', country: 'سويسرا', latitude: 46.9, longitude: 7.4 }] : [];
        return rt.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ results }) });
      });
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      // اللوحي العمودي: نسب الهاتف نفسها (المشهد يملأ العرض، والبطاقات عمودان كما في الهاتف)
      const lay = await page.evaluate(() => {
        const sc = document.querySelector('.flow-card').getBoundingClientRect(), g = [...document.querySelectorAll('.gcard')].map((e) => e.getBoundingClientRect());
        return { zoom: Number(document.documentElement.style.zoom || 1), scene: +(sc.width / innerWidth).toFixed(2), cols: new Set(g.map((r) => Math.round(r.left))).size };
      });
      check('لوحي عمودي: الواجهة مكبّرة بنسب الهاتف', lay.zoom > 1.5 && lay.scene > 0.85 && lay.cols === 2, JSON.stringify(lay));
      // التدوير إلى الأفقي: عمودان متساويان كل منهما بعرض شاشة هاتف تقريباً
      await page.setViewportSize({ width: 1335, height: 890 }); await page.waitForTimeout(500);
      const land = await page.evaluate(() => {
        const a = document.querySelector('.col-a').getBoundingClientRect(), b = document.querySelector('.col-b').getBoundingClientRect(), z = Number(document.documentElement.style.zoom || 1);
        return { side: Math.abs(a.top - b.top) < 60, equal: Math.abs(a.width - b.width) < 8, colLogical: Math.round(a.width / z), zoom: z };
      });
      check('لوحي أفقي بعد التدوير: عمودان متساويان بعرض هاتف', land.side && land.equal && land.colLogical > 380 && land.colLogical < 560, JSON.stringify(land));
      await page.setViewportSize({ width: 890, height: 1335 }); await page.waitForTimeout(500);
      check('الجهاز اللوحي: بلا تمرير أفقي', await noHScroll(page));
      await page.evaluate(() => window.__nav('more', 'settings')); await page.waitForTimeout(400);
      // اللمس في أي مكان من الصفحة لا يعيد رسمها ولا يغيّر المظهر (كان محدد [data-theme] يطابق <html>)
      const before = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs') || '{}').theme);
      const inp = '[data-pref=batteryAh]';
      await page.$eval(inp, (e) => e.scrollIntoView({ block: 'center' }));
      await page.click(inp);
      check('الضغط على خانة الإعدادات يبقي التركيز فيها', await page.$eval(inp, (e) => document.activeElement === e));
      await page.keyboard.type('٢٠٠', { delay: 120 });
      await page.waitForTimeout(1300);
      const pr = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs')));
      check('كتابة السعة بالأرقام العربية حرفاً حرفاً تُحفظ', pr.batteryAh === 200 && (await page.inputValue(inp)) === '٢٠٠', JSON.stringify(pr.batteryAh));
      check('اللمس في الإعدادات لا يغيّر المظهر المختار', (pr.theme ?? 'auto') === (before ?? 'auto'), `${before} → ${pr.theme}`);
      const pv = '[data-pref=pvKwp]';
      await page.click(pv); await page.fill(pv, '');
      await page.keyboard.type('4', { delay: 50 }); await page.waitForTimeout(1100);
      await page.keyboard.type('٫', { delay: 50 }); await page.waitForTimeout(1100);
      await page.keyboard.type('4', { delay: 50 }); await page.waitForTimeout(1100);
      check('رقم عشري مع توقف أثناء الكتابة لا تُمسح فاصلته', (await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.prefs')).pvKwp)) === 4.4, await page.inputValue(pv));
      // البحث عن المدينة أثناء الكتابة، والكتابة بلا همزة تجد «إدلب»
      await page.$eval('#locQ', (e) => e.scrollIntoView({ block: 'center' }));
      await page.click('#locQ');
      await page.keyboard.type('ادلب', { delay: 80 });
      await page.waitForSelector('.loc-it', { timeout: 4000 }).catch(() => null);
      check('البحث يبدأ أثناء الكتابة ويبقى النص والتركيز في الخانة', geo > 0 && (await page.inputValue('#locQ')) === 'ادلب' && (await page.$eval('#locQ', (e) => document.activeElement === e)));
      check('«ادلب» بلا همزة تجد إدلب أولاً', (await text(page, '.loc-it b')) === 'إدلب', await text(page, '.loc-list'));
      // اختيار شكل المشهد
      check('ثلاثة أشكال للمشهد، والصور مختارة افتراضياً', (await page.$$('[data-scene-opt]')).length === 3 && !!(await page.$('[data-scene-opt=photo].on')));
      const thumbs = await page.$$eval('.scene-opt img', (a) => a.map((i) => i.complete && i.naturalWidth > 0));
      check('صور مصغّرة لكل شكل', thumbs.length === 3 && thumbs.every(Boolean), JSON.stringify(thumbs));
      for (const [st, sel, label] of [['3d', '.bseg', 'رسم ثلاثي الأبعاد'], ['classic', '.battery-box', 'الكلاسيكي']]) {
        await page.evaluate(() => window.__nav('more', 'settings')); await page.waitForTimeout(300);
        await page.$eval(`[data-scene-opt="${st}"]`, (e) => e.scrollIntoView({ block: 'center' }));
        await page.click(`[data-scene-opt="${st}"]`); await page.waitForTimeout(300);
        await page.evaluate(() => window.__nav('home', null)); await page.waitForTimeout(500);
        const ok = await page.$(`.scene.st-${st} ${sel}`);
        const moving = await page.$$eval('.scene animateMotion', (a) => a.length);
        check(`الشكل «${label}» يظهر في الرئيسية ويتحرك`, !!ok && moving >= 3, `${!!ok} ${moving}`);
      }
      check('بلا أخطاء JavaScript (3.9)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 18) 3.10: ألوان التدفق حسب الاتجاه، شريط الحالة، صيغة الوقت، نوع الخط
    {
      const page = await newPage(browser, { loggedIn: false });
      await page.click('#demoBtn'); await page.waitForSelector('.flow-card');
      const kinds = async () => page.$$eval('.scene .arrow', (a) => [...new Set(a.map((e) => [...e.classList].find((c) => c.startsWith('k-'))))].sort().join(','));
      const legend = async () => page.$$eval('.flow-legend .fl', (a) => a.map((e) => e.textContent.trim()).join('|'));
      await page.click('[data-demo-sky="clear"]'); await page.waitForTimeout(600);
      const day = { k: await kinds(), l: await legend(), bar: await text(page, '.status-bar') };
      await page.click('[data-demo-sky="night"]'); await page.waitForTimeout(600);
      const night = { k: await kinds(), l: await legend(), bar: await text(page, '.status-bar') };
      check('نهاراً: أسهم الألواح والشحن والبيت بألوان مختلفة', day.k === 'k-chg,k-load,k-sun', JSON.stringify(day));
      check('ليلاً: سحب البطارية بلون التفريغ وليس لون الشحن أو الألواح', night.k === 'k-dis,k-load' && night.l.includes('من البطارية'), JSON.stringify(night));
      check('شريط الحالة: متصل والوضع وما تفعله البطارية', day.bar.includes('متصل') && day.bar.includes('تشحن') && night.bar.includes('تُفرّغ'), `${day.bar} / ${night.bar}`);
      const gap = await page.evaluate(() => document.querySelector('.flow-card').getBoundingClientRect().top - document.querySelector('.status-bar').getBoundingClientRect().bottom);
      check('شريط الحالة منفصل عن المشهد بمسافة', gap >= 10, String(gap));
      // البطارية ممتلئة ولا يمر فيها شيء: لا أسهم لها
      await page.evaluate(() => { const m = window.__state.model; window.__state.model = { ...m, soc: 100, batW: 0 }; window.__render(); });
      await page.waitForTimeout(300);
      check('بطارية ممتلئة بلا شحن ولا تفريغ: لا أسهم دخول أو خروج لها', (await page.$$('.scene .arrow.a-bat')).length === 0 && !(await legend()).includes('البطارية'));
      // الشروق والغروب بصيغة 12 ساعة افتراضياً، و24 من الإعدادات
      await page.click('[data-demo-sky="clear"]'); await page.waitForTimeout(500);
      const t12 = await text(page, '.sun-t');
      check('الشروق والغروب بصيغة 12 ساعة (ص/م)', /\d{1,2}:\d{2} ص/.test(t12) && /\d{1,2}:\d{2} م/.test(t12), t12);
      await page.evaluate(() => window.__nav('more', 'settings')); await page.waitForTimeout(300);
      await page.click('[data-clock="24"]'); await page.waitForTimeout(200);
      await page.$eval('[data-font="Tajawal"]', (e) => e.scrollIntoView({ block: 'center' }));
      await page.click('[data-font="Tajawal"]'); await page.waitForTimeout(200);
      await page.$eval('[data-fs="0.8"]', (e) => e.scrollIntoView({ block: 'center' }));
      await page.click('[data-fs="0.8"]'); await page.waitForTimeout(200);
      await page.evaluate(() => window.__nav('home', null)); await page.waitForTimeout(500);
      const t24 = await text(page, '.sun-t');
      check('صيغة 24 ساعة تُطبَّق على الأوقات', /\d{2}:\d{2}/.test(t24) && !/[صم]\b/.test(t24.replace('إلى', '')), t24);
      const look = await page.evaluate(() => ({ font: getComputedStyle(document.body).fontFamily, fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(), loaded: document.fonts.check("16px 'Tajawal'", 'طاقتي') }));
      check('تغيير نوع الخط وتصغيره يُطبّقان على التطبيق كله', look.font.startsWith('Tajawal') && look.fs === '0.8' && look.loaded, JSON.stringify(look));
      check('بلا أخطاء JavaScript (3.10)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();
    }

    // 19) 3.11: أولوية مصدر الطاقة بتحقق من الجهاز (محاكاة)، التقدير، عدّاد الشبكة
    {
      const OUT_ITEMS = [{ key: '0', val: 'Utility first' }, { key: '1', val: 'Solar first' }, { key: '2', val: 'SBU' }];
      const CHG_ITEMS = [{ key: '0', val: 'Solar first' }, { key: '3', val: 'Only solar charging permitted' }];
      const dev = { out: '2', chg: '3', apply: true, reject: false, sent: [] };
      const page = await newPage(browser, {
        storage: { devCtlDelayMs: 250 },
        api: (a, q) => {
          if (a === 'queryDeviceLastData') return { err: 0, dat: points(Date.now() - 60000) };
          if (a === 'queryDeviceCtrlField') return { err: 0, dat: { field: [{ id: 'bse_output_source_priority', name: 'Output Source Priority', item: OUT_ITEMS }, { id: 'bse_charger_source_priority', name: 'Charger Source Priority', item: CHG_ITEMS }] } };
          if (a === 'queryDeviceCtrlValue') return { err: 0, dat: { val: q.get('id').includes('output') ? dev.out : dev.chg } };
          if (a === 'queryDeviceParsEs') return { err: 0, dat: { parameter: [] } };
          if (a === 'ctrlDevice') {
            dev.sent.push([q.get('id'), q.get('val')]);
            if (dev.reject) return { err: 1, desc: 'ERR_DEVICE_RESPONSE_TIMEOUT' };
            if (dev.apply) dev.out = q.get('val');
            return { err: 0, dat: {} };
          }
          return null;
        },
      });
      await page.waitForSelector('.flow-card');
      await page.evaluate(() => window.__nav('more', 'power'));
      await page.waitForSelector('.ctl-cur .ctl-name', { timeout: 8000 }).catch(() => null);
      check('يقرأ الوضع الحالي من الجهاز ويعرض ترتيب مصادره', (await text(page, '.ctl-cur .src-order')).replace(/\s/g, '') === 'الألواح←البطارية←الشبكة', await text(page, '.ctl-cur'));
      check('يعرض الأوضاع التي يدعمها الجهاز فقط، والحالي بلا زر', (await page.$$('.ctl-opt')).length === 3 && (await page.$$('[data-ctl]')).length === 2);
      check('أولوية الشحن تُعرض للقراءة فقط', (await text(page, '#view')).includes('أولوية مصدر الشحن الآن') && dev.sent.length === 0);
      // إلغاء التأكيد: لا يُرسل شيء
      await page.click('[data-ctl="0"]'); await page.click('.modal [data-v="0"]'); await page.waitForTimeout(200);
      check('إلغاء التأكيد لا يرسل أي أمر', dev.sent.length === 0);
      // تحويل ناجح: يُرسل مرة واحدة لإعداد الخرج فقط، ثم يتأكد من الجهاز
      await page.click('[data-ctl="0"]');
      check('نافذة التأكيد تذكر الوضعين وأن أولوية الشحن لن تتغيّر', (await text(page, '.modal')).includes('لن تتغيّر') && (await text(page, '.modal')).includes('الشبكة ثم الألواح ثم البطارية'), await text(page, '.modal'));
      await page.click('.modal [data-v="1"]');
      await page.waitForSelector('.ctl-state.wait', { timeout: 3000 }).catch(() => null);
      check('أثناء التحقق يُعرض «المطلوب» لا «تم»', (await text(page, '.ctl-state')).includes('المطلوب'));
      await page.waitForSelector('.ctl-state.confirmed', { timeout: 6000 }).catch(() => null);
      check('بعد أن يعيد الجهاز الوضع الجديد يظهر «تأكّد»', !!(await page.$('.ctl-state.confirmed')) && (await page.$eval('.ctl-opt.on', (e) => e.textContent)).includes('الشبكة'));
      check('أُرسل أمر واحد لإعداد أولوية الخرج وحده', dev.sent.length === 1 && dev.sent[0][0] === 'bse_output_source_priority' && dev.sent[0][1] === '0', JSON.stringify(dev.sent));
      // الجهاز يقبل الأمر ولا يطبّقه: لا يظهر نجاح
      dev.apply = false;
      await page.click('[data-ctl="2"]'); await page.click('.modal [data-v="1"]');
      await page.waitForSelector('.ctl-state.unconfirmed', { timeout: 8000 }).catch(() => null);
      check('أمر لم يطبّقه الجهاز لا يُعرض كنجاح', !!(await page.$('.ctl-state.unconfirmed')) && !(await page.$('.ctl-state.confirmed')) && dev.sent.length === 2);
      // رفض الأمر (انتهاء المهلة) برسالة عربية
      dev.reject = true;
      await page.click('[data-ctl="2"]'); await page.click('.modal [data-v="1"]');
      await page.waitForSelector('.ctl-state.rejected', { timeout: 6000 }).catch(() => null);
      check('رفض الأمر يظهر بسببه بالعربية', (await text(page, '.ctl-state')).includes('لم يرد في الوقت المحدد'), await text(page, '.ctl-state'));
      const log = await page.$$eval('.ctl-log li', (a) => a.map((e) => e.className));
      check('سجل التحويلات يحفظ النتائج الثلاث', log.join(',') === 'rejected,unconfirmed,confirmed', log.join(','));
      const saved = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('taqati.ctl.')).length);
      check('السجل محفوظ دائماً', saved === 1);
      // الجدولة المرنة: قواعد بأيام وأوقات مختلفة، ومنع التداخل، وتسليم الإعدادات لأندرويد
      dev.reject = false; dev.apply = true;
      const sent0 = dev.sent.length;
      await page.click('[data-mode="schedule"]'); await page.waitForTimeout(150);
      check('الجدولة تبدأ بقاعدة 5:00 م إلى 10:00 م كل يوم قابلة للتعديل', (await page.$$('.slot')).length === 1 && (await page.inputValue('[data-slot="0"] [data-s=start]')) === '17:00' && (await page.inputValue('[data-slot="0"] [data-s=end]')) === '22:00');
      // القاعدة الأولى: السبت فقط ساعتان من 3 م
      await page.fill('[data-slot="0"] [data-s=start]', '15:00'); await page.$eval('[data-slot="0"] [data-s=start]', (e) => e.dispatchEvent(new Event('change')));
      await page.fill('[data-slot="0"] [data-s=end]', '17:00'); await page.$eval('[data-slot="0"] [data-s=end]', (e) => e.dispatchEvent(new Event('change')));
      for (const d of [0, 1, 2, 3, 4, 5]) { await page.click(`[data-slot="0"] [data-day="${d}"]`); await page.waitForTimeout(40); }
      check('قاعدة السبت وحده من 3:00 م إلى 5:00 م', (await text(page, '[data-slot="0"] .hint')).includes('السبت: من 3:00 م إلى 5:00 م'), await text(page, '[data-slot="0"] .hint'));
      // قاعدة ثانية: الأحد أربع ساعات من 7 م، وثالثة لمرة واحدة تعبر منتصف الليل
      await page.click('#slotAdd'); await page.waitForTimeout(100);
      await page.fill('[data-slot="1"] [data-s=start]', '19:00'); await page.$eval('[data-slot="1"] [data-s=start]', (e) => e.dispatchEvent(new Event('change')));
      await page.fill('[data-slot="1"] [data-s=end]', '23:00'); await page.$eval('[data-slot="1"] [data-s=end]', (e) => e.dispatchEvent(new Event('change')));
      for (const d of [1, 2, 3, 4, 5, 6]) { await page.click(`[data-slot="1"] [data-day="${d}"]`); await page.waitForTimeout(40); }
      await page.click('#slotAdd'); await page.waitForTimeout(100);
      await page.click('[data-slot="2"] [data-kind="date"]'); await page.waitForTimeout(100);
      await page.fill('[data-slot="2"] [data-s=start]', '22:00'); await page.$eval('[data-slot="2"] [data-s=start]', (e) => e.dispatchEvent(new Event('change')));
      await page.fill('[data-slot="2"] [data-s=end]', '02:00'); await page.$eval('[data-slot="2"] [data-s=end]', (e) => e.dispatchEvent(new Event('change')));
      check('قاعدة لمرة واحدة تعبر منتصف الليل', (await text(page, '[data-slot="2"] .hint')).includes('(اليوم التالي)') && !!(await page.$('[data-slot="2"] input[type=date]')));
      // نجعل القاعدة الثانية كل يوم (7 م إلى 11 م) فتتداخل مع قاعدة اليوم (10 م إلى 2 ص): يُرفض الحفظ
      for (const d of [1, 2, 3, 4, 5, 6]) { await page.click(`[data-slot="1"] [data-day="${d}"]`); await page.waitForTimeout(40); }
      await page.click('#ctlSave'); await page.waitForTimeout(200);
      check('القواعد المتداخلة تُرفض قبل التأكيد', (await text(page, '.toast')).includes('تتداخلان') && !(await page.$('.modal')), await text(page, '.toast'));
      for (const d of [1, 2, 3, 4, 5, 6]) { await page.click(`[data-slot="1"] [data-day="${d}"]`); await page.waitForTimeout(40); }
      await page.click('[data-del="2"]'); await page.waitForTimeout(80);
      await page.screenshot({ path: path.join(OUT, 'power-schedule.png'), fullPage: true });
      await page.click('#ctlSave');
      const sumTxt = await text(page, '.modal');
      check('نافذة التأكيد تلخّص القواعد بتوقيت سوريا', sumTxt.includes('السبت: من 3:00 م إلى 5:00 م') && sumTxt.includes('الأحد: من 7:00 م إلى 11:00 م') && sumTxt.includes('بتوقيت سوريا'), sumTxt);
      await page.click('.modal [data-v="1"]'); await page.waitForTimeout(300);
      const handed = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.ctlNative')));
      check('الإعدادات المسلَّمة لأندرويد: الإعداد والأوضاع والقواعد والجهاز وتوقيت سوريا', handed.mode === 'schedule' && handed.fieldId === 'bse_output_source_priority' && handed.slots.length === 2 && handed.slots[0].days.join() === '6' && handed.slots[1].startMin === 1140 && handed.utcOffsetMin === 180 && handed.items['2'] === 'SBU' && handed.device.sn && handed.defaultKey === '2', JSON.stringify(handed));
      check('حالة الجدولة والتحويل التالي ظاهرة', (await text(page, '.ctl-now')).includes('الجدولة فعّالة') && (await text(page, '.ctl-now')).includes('التحويل التالي'), await text(page, '.ctl-now'));
      check('تفعيل الجدولة لا يرسل أي أمر من الواجهة', dev.sent.length === sent0);
      // الإدارة الذكية: حدود متسقة
      await page.evaluate(() => { window.__state.prefs.batteryAh = 200; });
      await page.click('[data-mode="smart"]'); await page.waitForTimeout(200);
      {
        const sg = await text(page, '.sugg');
        const low = Number(await page.inputValue('[data-sm="low"]')), target = Number(await page.inputValue('[data-sm="target"]'));
        check('الإدارة الذكية تبدأ بترتيب محسوب من البطارية واستهلاك الليل مع أسبابه', sg.includes('الترتيب المقترح لمنظومتك') && sg.includes('احتياطياً للانقطاع') && low >= 35 && low <= 70 && low % 5 === 0 && target === low + 20, `${low}/${target} ${sg.slice(0, 120)}`);
      }
      await page.fill('[data-sm="low"]', '40'); await page.$eval('[data-sm="low"]', (e) => e.dispatchEvent(new Event('change')));
      await page.fill('[data-sm="target"]', '45'); await page.$eval('[data-sm="target"]', (e) => e.dispatchEvent(new Event('change')));
      await page.click('#ctlSave'); await page.waitForTimeout(200);
      { const last = await page.$$eval('.toast', (a) => a.map((e) => e.textContent).pop() || ''); check('الإدارة الذكية ترفض نسبة عودة قريبة من حد التحويل (منعاً للتذبذب)', last.includes('10%') && !(await page.$('.modal')), last); }
      await page.fill('[data-sm="target"]', '٦٠'); await page.$eval('[data-sm="target"]', (e) => e.dispatchEvent(new Event('change')));
      await page.click('#ctlSave'); await page.click('.modal [data-v="1"]'); await page.waitForTimeout(300);
      const sm = await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.ctlNative')));
      check('الإدارة الذكية تُفعَّل بحدودها ووضعيها', sm.mode === 'smart' && sm.low === 40 && sm.target === 60 && sm.gridKey === '0' && sm.solarKey === '2', JSON.stringify(sm));
      check('نمط واحد فعّال: تفعيل الذكية أوقف الجدولة', (await text(page, '.ctl-now')).includes('الإدارة الذكية فعّالة') && !(await text(page, '.ctl-now')).includes('الجدولة'));
      await page.click('[data-mode="manual"]'); await page.click('#ctlSave'); await page.click('.modal [data-v="1"]'); await page.waitForTimeout(300);
      check('العودة للتحكم اليدوي توقف التلقائي', (await page.evaluate(() => JSON.parse(localStorage.getItem('taqati.ctlNative')).mode)) === 'manual' && !(await page.$('.ctl-now')));
      check('بلا أخطاء JavaScript (التحكم)', page.errors.length === 0, page.errors.join(' | '));
      await page.context().close();

      // التقدير وعدّاد الشبكة (وضع تجريبي)
      const d = await newPage(browser, { loggedIn: false, prefs: { batteryAh: 200 } });
      await d.click('#demoBtn'); await d.waitForSelector('.flow-card');
      await d.evaluate(() => window.__nav('reports', null)); await d.waitForTimeout(300);
      check('التقارير فيها «تقدير الأسبوعين القادمين» و«كهرباء الشبكة»', !!(await d.$('[data-page=forecast]')) && !!(await d.$('[data-page=gridmeter]')));
      await d.evaluate(() => window.__nav('reports', 'forecast'));
      await d.waitForSelector('.fc-rows', { timeout: 30000 }).catch(() => null);
      const ft = await text(d, '#view');
      check('التقدير موسوم بأنه ليس توقعاً مؤكداً ولا يغيّر الإعدادات', ft.includes('تقدير وليس توقعاً مؤكداً') && ft.includes('لا يُطبَّق أي اقتراح تلقائياً'));
      check('مقارنة الأسبوعين وتقدير 14 يوماً', (await d.$$('table.cmp tbody tr')).length === 5 && (await d.$$('.fc-r')).length === 14);
      check('اقتراح الاحتياطي يظهر عند إدخال سعة البطارية', ft.includes('احتياطي البطارية المقترح'));
      await d.evaluate(() => window.__nav('reports', 'gridmeter'));
      await d.waitForSelector('.stats', { timeout: 60000 }).catch(() => null);
      const gt = await text(d, '#view');
      check('عدّاد الشبكة موسوم بأنه تقدير ويعرض بداية السجل', gt.includes('تقدير محسوب، لا عدّاد من الجهاز') && gt.includes('بداية السجل المتاح') && (await d.$$('.stats .stat')).length === 4);
      check('بلا تمرير أفقي في الصفحات الجديدة', await noHScroll(d));
      check('بلا أخطاء JavaScript (التقدير والعدّاد)', d.errors.length === 0, d.errors.join(' | '));
      await d.context().close();
    }

    // 11) التحقق من التحديثات
    {
      const page = await newPage(browser, { api: lastData(2), release: relOf('9.9.0', 'ميزة رائعة\nإصلاحات') });
      await page.waitForSelector('.flow-card');
      await page.waitForSelector('.toast:not(.notice)', { timeout: 5000 }).catch(() => null);
      check('إشعار مرة واحدة عند توفر إصدار جديد', (await text(page, '.toast:not(.notice)')).includes('9.9.0'));
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

    // 10) أحجام الشاشات والاتجاهات
    const SIZES = { 'هاتف صغير': [320, 640], 'هاتف': [390, 844], 'هاتف أفقي': [844, 390], 'لوحي عمودي': [800, 1280], 'لوحي أفقي': [1280, 800] };
    for (const [name, [w, h]] of Object.entries(SIZES)) {
      const page = await newPage(browser, { viewport: { width: w, height: h }, api: lastData(2) });
      await page.waitForSelector('.flow-card');
      await page.waitForTimeout(300);
      check(`${name} ${w}×${h}: بلا تمرير أفقي`, await noHScroll(page));
      const flowVisible = await page.$eval('.flow-card', (el) => { const r = el.getBoundingClientRect(); return r.width > 200 && r.right <= window.innerWidth + 1; });
      check(`${name}: مخطط التدفق ظاهر كاملاً`, flowVisible);
      // اللوحي العمودي بتصميم الهاتف نفسه مكبّراً؛ العمودان للعرض الأفقي العريض فقط
      const lay = await page.evaluate(() => ({ grid: getComputedStyle(document.querySelector('.home-grid')).display === 'grid', zoom: Number(document.documentElement.style.zoom || 1), scene: document.querySelector('.flow-card').getBoundingClientRect().width / window.innerWidth }));
      if (w >= 720 && w > h) check(`${name}: تخطيط عمودين`, lay.grid, JSON.stringify(lay));
      if (Math.min(w, h) >= 600 && h > w) check(`${name}: تصميم الهاتف مكبّراً بنفس النسب`, !lay.grid && lay.zoom > 1.3 && lay.scene > 0.85, JSON.stringify(lay));
      if (Math.min(w, h) < 600) check(`${name}: بلا تكبير على الهاتف`, lay.zoom === 1, JSON.stringify(lay));
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
