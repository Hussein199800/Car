// اختبارات وحدة للمنطق الأساسي (بدون متصفح): التوقيع، تحليل القراءات، كشف الانقطاع، المصطلحات الثابتة، الملخصات
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha1, quotePlus } from '../../src/api.js';
import { normalize, parseTs, countAr, fmt, rowsToSamples } from '../../src/model.js';
import fs from 'node:fs';
import { trTitle, trValue } from '../../src/i18n.js';
import { summarize } from '../../src/data.js';
import { smartTips } from '../../src/tips.js';

const pad = (x) => String(x).padStart(2, '0');
const stamp = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
// نفس الحقول التي يرسلها جهاز حقيقي
const device = (ageMin, extra = {}) => Object.entries({
  id: '7c95e1', Timestamp: stamp(Date.now() - ageMin * 60000), 'Grid Voltage': '225.9', 'Grid Frequency': '50.0',
  'PV1 Input Voltage': '0.0', 'PV2 Input voltage': '-', 'PV1 Charging Power': '0', 'Battery Voltage': '51.6',
  'Battery Capacity': '53', 'Battery Charging Current': '0', 'Battery Discharge Current': '36', 'AC Output Active Power': '1730',
  'AC Output Apparent Power': '1794', 'Output Load Percent': '27', 'Grid Rating Voltage': '230.0', 'Battery Rating Voltage': '48.0',
  'AC Output Rating Active Power': '6500', 'Battery Type': 'Lib', 'Battery Bulk Voltage': '57.6', 'Battery Float Voltage': '57.6',
  'Output Source Priority': 'Solar Bat Utility', Model: 'Battery Mode', 'Inverter Fault': '-', 'Today generation': '3163', ...extra,
}).map(([title, val]) => ({ title, val, unit: '' }));

test('التوقيع والترميز مطابقان لـ Kotlin وبايثون', async () => {
  assert.equal(quotePlus("a b*~-_.!'()/?=&é"), 'a+b%2A~-_.%21%27%28%29%2F%3F%3D%26%C3%A9');
  assert.equal(await sha1('1700000000000SECRETTOKEN&action=queryDeviceLastData&pn=W0072122216413&devcode=2451&devaddr=1&sn=96342601101639&i18n=en_US'),
    'e246ea2b10e9d70d26173b2e13a8b6ad0f779846');
});

test('قراءة قديمة تعني أن الإنفرتر غير متصل، والحديثة متصلة', () => {
  const stale = normalize(device(99), 15);
  assert.equal(stale.stale, true);
  assert.equal(stale.mode, 'Battery Mode');
  assert.equal(stale.pv2V, null, '«-» تعني غير متوفر');
  assert.equal(stale.batW, Math.round(51.6 * -36));
  assert.equal(normalize(device(2), 15).stale, false);
  assert.ok(!stale.raw.some((r) => r.title === 'id'), 'المعرّف الداخلي مخفي');
});

test('فرق التوقيت يُطبّق على عمر القراءة ووقتها', () => {
  const m = normalize(device(180), 15, 3 * 36e5);
  assert.equal(m.stale, false);
  assert.ok(Math.abs(m.age) < 60000);
});

test('عتبة وجود الكهرباء تتبع الجهد المقنّن', () => {
  assert.equal(normalize(device(1, { 'Grid Voltage': '110', 'Grid Rating Voltage': '120' })).gridOn, true);
  assert.equal(normalize(device(1, { 'Grid Voltage': '60' })).gridOn, false);
});

test('parseTs يفهم صيغة الخادم', () => {
  assert.equal(parseTs('2026-10-28 19:17:29'), new Date(2026, 9, 28, 19, 17, 29).getTime());
  assert.equal(parseTs('غير صالح'), null);
});

test('صياغة الأعداد بالعربية', () => {
  assert.equal(countAr(1, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']), 'ساعة');
  assert.equal(countAr(2, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']), 'ساعتين');
  assert.equal(countAr(5, ['ساعة', 'ساعتين', 'ساعات', 'ساعة']), '5 ساعات');
  assert.equal(fmt.ago(99 * 60000), 'قبل ساعة و39 دقيقة');
});

test('ترجمة الحقول والقيم', () => {
  assert.equal(trTitle('Battery Re-Discharge Voltage'), 'جهد العودة للتفريغ');
  assert.equal(trValue('Solar Bat Utility'), 'ألواح ← بطارية ← كهرباء (SBU)');
  assert.equal(trValue('Lib'), 'ليثيوم');
});

test('المصطلحات ثابتة: «الإنفرتر» و«كهرباء الشبكة» في كل النصوص', () => {
  const dirs = ['src', 'android/app/src/main/java/com/taqati/solar'];
  const files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.(js|kt)$/.test(f)).map((f) => `${d}/${f}`));
  const old = files.filter((f) => /رافع|الكهرباء الوطنية|العاكس/.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(old, [], 'بقايا مصطلحات قديمة');
  assert.ok(fs.readFileSync('src/calc.js', 'utf8').includes("'مكيف 1 طن إنفرتر'"), 'نوع المكيف يبقى «إنفرتر»');
  assert.equal(trTitle('Grid Voltage'), 'جهد كهرباء الشبكة');
});

test('ملخص اليوم يتجاهل الفجوات الطويلة ويأخذ الإنتاج من عدّاد الجهاز', () => {
  const t0 = new Date(2026, 9, 28, 10).getTime();
  const rows = [0, 5, 10, 60].map((m, i) => ({ ts: t0 + m * 60000, outW: 1200, pvW: 2000, soc: 50 + i, gridV: 230, todayWh: 1000 * (i + 1) }));
  const s = summarize('2026-10-28', rows, 'server');
  assert.equal(s.pvKwh, 4);
  assert.equal(s.pvFromMeter, true);
  assert.ok(Math.abs(s.loadKwh - 0.2) < 1e-9, '10 دقائق فقط محسوبة، والفجوة 50 دقيقة مستبعدة');
  assert.equal(s.socMin, 50);
  assert.equal(s.socMax, 53);
});

test('rowsToSamples يحوّل صفوف السجل', () => {
  const out = rowsToSamples({ titles: ['Timestamp', 'Battery Capacity', 'AC Output Active Power'], rows: [['2026-10-28 10:05:00', '60', '900'], ['2026-10-28 10:00:00', '59', '800']] });
  assert.deepEqual(out.map((x) => x.soc), [59, 60], 'مرتبة زمنياً');
});

test('النصائح المخصّصة عامة وتتكيف مع جهد النظام', () => {
  const m48 = normalize(device(1), 15);
  assert.ok(smartTips(m48, {}).some((t) => /16 خلية/.test(t.body)));
  const m24 = normalize(device(1, { 'Battery Rating Voltage': '24.0', 'Battery Bulk Voltage': '28.8', 'Battery Float Voltage': '28.8' }), 15);
  assert.ok(smartTips(m24, {}).some((t) => /8 خلية/.test(t.body) && /26\\.8|26.8/.test(t.body)));
  assert.deepEqual(smartTips(normalize(device(99), 15), {}).map((t) => t.level), ['bad'], 'لا نصائح على قيم قديمة');
});

// ---------- حاسبة الأحمال وشرح الإعدادات (الإصدار 3.1) ----------
import { convert, summarizeLoads, defaultsCalc, APPLIANCES } from '../../src/calc.js';
import { settingInfo, optionAr, hintRange } from '../../src/settings-info.js';
import { errorAr } from '../../src/api.js';

test('المحوّل: 1 أمبير على 220 فولت = 220 واط و≈5.1 أمبير من بطارية 48', () => {
  const c = { ...defaultsCalc(), mode: 'ac', input: 1, acV: 220, kind: 'res', eff: 90 };
  const r = convert(c, 48);
  assert.equal(r.watts, 220);
  assert.equal(r.dc48.toFixed(2), '5.09');
  assert.equal(r.dc24.toFixed(2), '10.19');
  assert.equal(r.dc12.toFixed(2), '20.37');
});

test('المحوّل يعمل بالاتجاهين ويحترم معامل قدرة المحركات', () => {
  const base = { ...defaultsCalc(), acV: 220, eff: 90 };
  const fromDc = convert({ ...base, mode: 'dc', input: 10, kind: 'res' }, 48);
  assert.equal(Math.round(fromDc.watts), 432);
  const motor = convert({ ...base, mode: 'w', input: 880, kind: 'motor' }, 48);
  assert.equal(motor.acA, 5, '880 واط محرك = 5 أمبير لأن معامل القدرة 0.8');
});

test('قائمة الأجهزة: الحمل والإقلاع والطاقة اليومية', () => {
  const c = { ...defaultsCalc(), acV: 220, eff: 90, sunH: 5, backupH: 8 };
  const fridge = { ...APPLIANCES.find((a) => a.id === 'fridge'), qty: 1, hours: 24 };
  const tv = { ...APPLIANCES.find((a) => a.id === 'tv'), qty: 2, hours: 5 };
  const s = summarizeLoads([fridge, tv], c, 48);
  assert.equal(s.run, 350);
  assert.equal(s.peak, 350 + 150 * 2, 'أكبر تيار إقلاع (ثلاجة ×3) يُضاف مرة واحدة');
  assert.equal(s.whDay, 150 * 24 * 0.4 + 200 * 5);
});

test('شرح الإعدادات بالعربية لأسماء الأجهزة الحقيقية', () => {
  for (const name of ['Output Source Priority', 'LED Status', 'LED Speed', 'Restore To Default', 'Over Temperature Auto Restart',
    'Real-time Activate Battery Equalization', 'Battery Equalization Time Out', 'Equalization Period', 'Equalization Voltage',
    'LCD Auto-return to Main Screen', 'Max AC Charging Current', 'Battery Re-Discharge Voltage']) {
    const info = settingInfo(name);
    assert.ok(info && /[؀-ۿ]/.test(info.ar) && info.desc.length > 20, name);
  }
  assert.equal(settingInfo('Real-time Activate Battery Equalization').ar, 'تشغيل المعادلة الآن');
  assert.equal(settingInfo('Battery Equalization Time Out').ar, 'أقصى مدة للمعادلة');
  assert.equal(settingInfo('Restore To Default').risk, 'high');
  assert.equal(optionAr('Means Low'), 'منخفضة');
  assert.equal(optionAr('SBU Priority'), 'ألواح ← بطارية ← كهرباء (SBU)');
});

test('نطاق الإعداد من ملاحظة الجهاز', () => {
  assert.deepEqual(hintRange('48.0~58.4V'), [48, 58.4]);
  assert.deepEqual(hintRange('0-900min'), [0, 900]);
  assert.equal(hintRange('prefix 1~2V'), null);
});

test('أخطاء الخادم مترجمة حتى مع التفاصيل الإضافية', () => {
  assert.equal(errorAr('ERR_UNSUPPORTED(cmd is null!!)', 9), 'هذا الإعداد لا يدعم قراءة قيمته الحالية');
  assert.match(errorAr('ERR_SYSTEM_EXCEPTION', 1), /لم يستطع خادم/);
  assert.equal(errorAr('', 7), 'خطأ من الخادم (7)');
  assert.equal(errorAr('ERR_NEW_THING', 3), 'رفض خادم WatchPower الطلب (ERR_NEW_THING)', 'رمز غير معروف لا يُعرض وحده بالإنجليزية');
});

// ---------- مراجعة الإصدار 3.3: أخطاء حسابية ومنطقية ----------
import { latinDigits, gridPresent } from '../../src/model.js';
import { cacheSummary, cachedSummary, toCsv, today } from '../../src/data.js';
import { demoPoints } from '../../src/demo.js';
import { WatchPowerApi } from '../../src/api.js';

test('المدة تُقرّب للدقائق أولاً: لا «ساعة و60 دقيقة»', () => {
  assert.equal(fmt.hours(1.999), 'ساعتين');
  assert.equal(fmt.hours(0.004), 'أقل من دقيقة');
  assert.equal(fmt.hours(2.5), 'ساعتين و30 دقيقة');
  assert.equal(fmt.hours(1 / 60), 'دقيقة');
});

test('الأرقام العربية والفاصلة العشرية تتحول قبل إرسال الإعداد', () => {
  assert.equal(latinDigits('٥٤٫٥'), '54.5');
  assert.equal(latinDigits('۱۲'), '12');
  assert.equal(latinDigits('57,6'), '57.6');
  assert.equal(Number(latinDigits('٣٠')), 30);
});

test('وجود الكهرباء يتبع الجهد المقنّن', () => {
  assert.equal(gridPresent(225, 230), true);
  assert.equal(gridPresent(60, 230), false);
  assert.equal(gridPresent(110, 120), true);
  assert.equal(gridPresent(null, 230), false);
});

test('عدّاد إنتاج اليوم يُصفَّر عند منتصف الليل ولا تُحمل قيمة الأمس', () => {
  const t0 = new Date(2026, 9, 28, 0, 0).getTime();
  // أول قراءتين تحملان عدّاد الأمس (8000) ثم يُصفّر الجهاز العداد
  const rows = [8000, 8000, 0, 500, 1500].map((wh, i) => ({ ts: t0 + i * 5 * 60000, outW: 500, pvW: 0, soc: 50, gridV: 230, todayWh: wh }));
  const s = summarize('2026-10-28', rows, 'server');
  assert.equal(s.pvKwh, 1.5);
});

test('ساعات توفر الكهرباء على شبكة 120 فولت', () => {
  const t0 = new Date(2026, 9, 28, 10).getTime();
  const rows = [0, 5, 10].map((m) => ({ ts: t0 + m * 60000, outW: 100, pvW: 0, soc: 50, gridV: 110, gridRatedV: 120 }));
  const s = summarize('2026-10-28', rows, 'server');
  assert.ok(s.gridH > 0.16 && s.gridH < 0.17, String(s.gridH));
});

test('ملخص الأيام الماضية يُخزَّن نهائياً فقط إذا كان من الخادم', () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), get length() { return mem.size; }, key: (i) => [...mem.keys()][i] };
  const date = today(-2);
  cacheSummary('X', { v: 2, date, count: 10, source: 'local' });
  assert.equal(cachedSummary('X', date), null, 'القراءات المحلية قد تكون جزئية');
  cacheSummary('X', { v: 2, date, count: 10, source: 'server' });
  assert.equal(cachedSummary('X', date).source, 'server');
  cacheSummary('X', { date: today(-3), count: 10, source: 'server' });
  assert.equal(cachedSummary('X', today(-3)), null, 'ملخص بصيغة قديمة يُعاد حسابه بالحقول الجديدة');
  delete globalThis.localStorage;
});

test('تصدير CSV يقتبس الفواصل والأسطر', () => {
  assert.equal(toCsv(['a', 'b'], [['x,y', 'l1\r\nl2']]).replace(/^﻿/, ''), 'a,b\r\n"x,y","l1\r\nl2"');
});

test('بطارية الاحتياط تُحسب على متوسط السحب الفعلي', () => {
  const c = { ...defaultsCalc(), acV: 220, eff: 90, sunH: 5, backupH: 8 };
  const fridge = { ...APPLIANCES.find((a) => a.id === 'fridge'), qty: 1, hours: 24 };
  const s = summarizeLoads([fridge], c, 48);
  assert.equal(s.avg, fridge.w * fridge.duty);
  assert.ok(Math.abs(s.batAh - (fridge.w * fridge.duty * 8) / (48 * 0.8 * 0.9)) < 1e-9);
});

test('الوضع التجريبي لا يعرض «وضع الشبكة» أثناء إنتاج الألواح', () => {
  const noon = new Date(2026, 9, 28, 12, 30).getTime();
  const p = Object.fromEntries(demoPoints(noon).map((x) => [x.title, x.val]));
  assert.equal(p.Model, 'Battery Mode');
  assert.ok(Number(p['PV1 Charging Power']) > 0);
});

test('طلبات متزامنة بعد انتهاء الرمز تسجّل الدخول مرة واحدة فقط', async () => {
  const api = new WatchPowerApi({ usr: 'u', pwdHash: 'h', profile: 'dess' });
  let logins = 0;
  api.doAuthenticate = async function () { logins++; await new Promise((r) => setTimeout(r, 10)); this.token = 't'; this.secret = 's'; };
  await Promise.all([api.authenticate(), api.authenticate(), api.authenticate()]);
  assert.equal(logins, 1);
  await api.authenticate();
  assert.equal(logins, 2, 'بعد انتهاء المحاولة يمكن تسجيل الدخول من جديد');
});

// ---------- التحديثات من داخل التطبيق ----------
import { isNewer, parseVer, fetchLatest } from '../../src/update.js';
import { readFileSync } from 'node:fs';

test('مقارنة الإصدارات', () => {
  assert.deepEqual(parseVer('v3.4.0'), [3, 4, 0]);
  assert.equal(isNewer('v3.10.0', '3.9.9'), true);
  assert.equal(isNewer('3.4.0', '3.4.0'), false);
  assert.equal(isNewer('3.3.9', '3.4.0'), false);
  assert.equal(isNewer('garbage', '3.4.0'), false);
});

test('قراءة آخر إصدار من GitHub واختيار ملف APK من المستودع نفسه فقط', async () => {
  const ok = (body, status = 200) => async () => ({ status, ok: status < 300, json: async () => body });
  const rel = { tag_name: 'v3.5.0', body: 'ملاحظات', published_at: '2026-11-01T10:00:00Z', assets: [
    { name: 'taqati-debug.apk', browser_download_url: 'https://github.com/Hussein199800/Car/releases/download/v3.5.0/taqati-debug.apk' },
    { name: 'taqati-3.5.0.apk', size: 4800000, browser_download_url: 'https://github.com/Hussein199800/Car/releases/download/v3.5.0/taqati-3.5.0.apk' },
  ] };
  const r = await fetchLatest(ok(rel));
  assert.equal(r.version, '3.5.0');
  assert.match(r.url, /taqati-3\.5\.0\.apk$/);
  assert.equal(await fetchLatest(ok({}, 404)), null, 'لا يوجد إصدار منشور بعد');
  assert.equal(await fetchLatest(ok({ ...rel, assets: [{ name: 'x.apk', browser_download_url: 'https://evil.example/x.apk' }] })), null);
  await assert.rejects(fetchLatest(ok({}, 403)), /مشغول/);
  await assert.rejects(fetchLatest(async () => { throw new Error('net'); }), /تحقق من الإنترنت/);
});

test('رقم الإصدار موحّد في package.json والتطبيق وأندرويد (وإلا يظهر تحديث وهمي)', () => {
  const ver = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version;
  const main = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8').match(/const VERSION = '([\d.]+)'/)[1];
  const gradle = readFileSync(new URL('../../android/app/build.gradle', import.meta.url), 'utf8').match(/versionName "([\d.]+)"/)[1];
  assert.equal(main, ver);
  assert.equal(gradle, ver);
});

// ---------- الإصدار 3.5: مستشار الطاقة والاستقلالية والحرارة ----------
import { analyze, productionDrop } from '../../src/advisor.js';

const sampleDay = (date, { pv = 0, load = 500, chg = 0, mode = 'Battery Mode', socs = null } = {}) => {
  const t0 = new Date(date + 'T00:00:00').getTime();
  return Array.from({ length: 289 }, (_, i) => ({
    ts: t0 + i * 5 * 60000, outW: load, pvW: pv, batW: chg, gridV: 230, gridRatedV: 230, mode,
    soc: socs ? socs(i) : 50,
  }));
};

test('تقسيم الشحن بين الألواح والكهرباء والاستقلالية', () => {
  // وضع البطارية: كل الشحن من الألواح ولا شيء من الكهرباء، والاستقلالية 100%
  const a = summarize('2026-10-20', sampleDay('2026-10-20', { pv: 1500, load: 500, chg: 1000 }), 'server');
  assert.ok(Math.abs(a.solarChgKwh - 24) < 0.01 && a.gridChgKwh === 0, `${a.solarChgKwh} ${a.gridChgKwh}`);
  assert.equal(Math.round(a.independence), 100);
  // وضع الشبكة: الحمل من الكهرباء، والشحن 1000 واط منها 300 من الألواح و700 من الكهرباء
  const b = summarize('2026-10-21', sampleDay('2026-10-21', { pv: 300, load: 500, chg: 1000, mode: 'Line Mode' }), 'server');
  assert.ok(Math.abs(b.solarChgKwh - 7.2) < 0.01 && Math.abs(b.gridChgKwh - 16.8) < 0.01);
  assert.equal(b.independence, 0);
  // بدون وضع التشغيل لا نحسب الاستقلالية
  const c = summarize('2026-10-22', sampleDay('2026-10-22', { mode: null }), 'server');
  assert.equal(c.independence, null);
  assert.equal(c.gridLoadKwh, null);
});

test('أدنى وأعلى نسبة للبطارية مع الوقت، ووقت الامتلاء', () => {
  const socs = (i) => (i < 72 ? 40 - i / 6 : Math.min(100, 28 + (i - 72) / 2));
  const s = summarize('2026-10-23', sampleDay('2026-10-23', { socs }), 'server');
  assert.equal(s.socMin, 28);
  assert.equal(new Date(s.socMinAt).getHours(), 6);
  assert.equal(s.socMax, 100);
  assert.equal(new Date(s.fullAt).getHours(), 18);
  assert.equal(s.socMaxAt, s.fullAt, 'أول وصول لأعلى نسبة');
});

test('الحرارة تُقرأ فقط إن أرسلها الجهاز، ويُتجاهل الصفر', () => {
  assert.equal(normalize(device(2)).temps.length, 0);
  const m = normalize(device(2, { 'Inverter heat sink temperature': '61', 'Battery Temperature': '0' }));
  assert.equal(m.invTemp, 61);
  assert.equal(m.batTemp, null);
  assert.equal(m.temps[0].ar, 'حرارة المبدّد الحراري');
});

test('مستشار الطاقة: توصيات من بيانات فعلية فقط', () => {
  const sums = [];
  for (let d = 20; d <= 27; d++) {
    const date = `2026-10-${d}`;
    const low = d === 25;
    sums.push(summarize(date, sampleDay(date, { pv: d === 26 ? 200 : 1200, load: 600, chg: 300, socs: (i) => (low ? 20 + (i % 50) : Math.min(100, 50 + i / 3)) }), 'server'));
  }
  const r = analyze(sums, { todayKey: '2026-10-27', prefs: { lowSoc: 30, batteryAh: 200, cutoffSoc: 20 }, ratedW: 6500, volts: 48 });
  assert.equal(r.days, 7, 'اليوم الجاري لا يدخل في المتوسطات');
  assert.equal(Math.round(r.independence), 100);
  assert.ok(Math.abs(r.cap - 9.6) < 1e-9);
  const titles = r.tips.map((t) => t.title);
  assert.ok(titles.includes('البطارية تنخفض كثيراً'), titles.join('|'));
  assert.ok(titles.includes('انخفاض في الإنتاج'), 'إنتاج آخر يوم أقل بكثير من المعتاد');
  assert.ok(!titles.includes('شحن من كهرباء الشبكة'), 'لا شحن من الكهرباء في وضع البطارية');
  assert.equal(r.battery.soh, null, 'لا نخترع حالة صحة غير مرسلة');
});

test('انخفاض الإنتاج بسبب امتلاء البطارية يُشرح', () => {
  const days = [5, 5, 5, 5, 2].map((pv, i) => ({ date: `2026-10-1${i}`, pvKwh: pv, fullAt: i === 4 ? new Date(2026, 9, 14, 11, 30).getTime() : null }));
  const d = productionDrop(days);
  assert.equal(Math.round(d.by), 60);
  assert.match(d.text, /امتلأت/);
  assert.equal(productionDrop(days.slice(0, 3)), null, 'تحتاج 4 أيام على الأقل');
});

test('التواريخ والأوقات بالأرقام 0-9 دائماً', () => {
  const t = new Date(2026, 9, 30, 13, 5).getTime();
  for (const v of [fmt.time(t), fmt.dateTime(t), fmt.day('2026-10-30', { weekday: 'long', day: 'numeric', month: 'long' })]) {
    assert.ok(!/[\u0660-\u0669\u06F0-\u06F9]/.test(v), v);
    assert.ok(/[0-9]/.test(v), v);
  }
  assert.equal(fmt.iso(t), '2026-10-30 13:05:00');
});

test('الوحدات بالعربية في المخطط أيضاً', () => {
  assert.equal(fmt.wShort(408), '408 واط');
  assert.equal(fmt.wShort(4230), '4.2 ك.واط');
  assert.equal(fmt.wShort(null), '—');
});

// ---------- السجل الموحّد ----------
import { toEvents, migrateLog, addEvents, catOf, LOG_CAP } from '../../src/log.js';

test('ترحيل السجلين القديمين: كل حدث مرة واحدة والتنبيه غير المقروء يبقى كذلك', () => {
  const t = 1_800_000_000_000;
  const faults = [
    { kind: 'grid', title: 'انقطاع الكهرباء الوطنية', body: 'جهد الشبكة 0 فولت', at: t },
    { kind: 'offline', title: 'انقطع اتصال الرافع', body: 'آخر قراءة', at: t + 60_000 },
    { kind: 'info', title: 'تغيير إعداد', body: 'أولوية مصدر الخرج ← SBU', at: t + 120_000 },
    { kind: 'comm', title: 'تعذّر الاتصال بالخادم', body: 'تعذّر الاتصال', at: t + 180_000 },
  ];
  const alerts = [
    { kind: 'warn', title: 'انقطعت الكهرباء الوطنية', body: 'المنظومة تعمل على البطارية', at: t + 3, read: false },
    { kind: 'bad', title: 'الرافع غير متصل', body: 'لم تصل قراءات جديدة', at: t + 60_002, read: true },
    { kind: 'bad', title: 'البطارية منخفضة', body: 'نسبة الشحن 25%', at: t + 4, read: false },
  ];
  const log = migrateLog(alerts, faults);
  assert.equal(log.length, 5, 'التنبيهان التوأمان لا يتكرران، وتنبيه البطارية يبقى مستقلاً');
  const grid = log.find((e) => e.cat === 'grid');
  assert.equal(grid.title, 'انقطعت الكهرباء الوطنية', 'نص الإشعار أوضح من نص الحدث');
  assert.equal(grid.read, false);
  assert.equal(log.find((e) => e.cat === 'conn' && /غير متصل/.test(e.title)).read, true);
  assert.deepEqual(log.map((e) => e.cat).sort(), ['bat', 'conn', 'conn', 'grid', 'set']);
  assert.ok(log.every((e, i) => i === 0 || log[i - 1].at >= e.at), 'الأحدث أولاً');
});

test('أحداث الخلفية من Kotlin تُوحَّد عند الاستلام وتبقى غير مقروءة', () => {
  const at = 1_800_000_500_000;
  const fresh = toEvents(
    [{ title: 'انقطعت كهرباء الشبكة', body: 'المنظومة تعمل على البطارية', kind: 'warn', at }, { title: 'البطارية ممتلئة', body: '100%', kind: 'ok', at }],
    [{ title: 'انقطاع كهرباء الشبكة', body: 'جهد الشبكة 0 فولت', kind: 'grid', at }, { title: 'حمل زائد', body: '85%', kind: 'warn', at }],
  );
  assert.equal(fresh.length, 3);
  assert.equal(fresh.filter((e) => e.read === false).length, 2, 'التنبيهان غير مقروءين، والحدث بلا إشعار مقروء');
  assert.equal(catOf({ title: 'حمل زائد', kind: 'warn' }), 'fault');
  assert.equal(catOf({ title: 'عادت كهرباء الشبكة', kind: 'ok' }), 'grid');
  const many = Array.from({ length: LOG_CAP + 50 }, (_, i) => ({ cat: 'conn', level: 'info', title: 'x', body: '', at: i, read: true }));
  assert.equal(addEvents(many, fresh).length, LOG_CAP);
  assert.equal(addEvents(many, fresh)[0].at, at, 'الحدث الجديد في أول السجل');
});

// ---------- نسبة التغيّر في التقارير ----------
import { trendDates, change } from '../../src/trend.js';

test('نسبة التغيّر: الأيام المكتملة فقط مقابل نفس عددها من الفترة السابقة', () => {
  const week = ['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
  const w = trendDates('week', week, '2026-10-31');
  assert.deepEqual(w.cur, week.slice(0, 6), 'اليوم الجاري لا يدخل');
  assert.deepEqual(w.prev, ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  const march = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, '0')}`);
  const m = trendDates('month', march, '2026-04-02');
  assert.equal(m.prev.length, 28, 'فبراير أقصر فنقارن أول 28 يوماً');
  assert.equal(m.cur.length, 28);
  assert.equal(m.prev[0], '2026-02-01');
  const jan = trendDates('month', ['2026-01-01', '2026-01-02', '2026-01-03'], '2026-01-03');
  assert.deepEqual(jan.prev, ['2025-12-01', '2025-12-02'], 'يناير يقابله ديسمبر من السنة السابقة');
  assert.deepEqual(trendDates('week', ['2026-10-31'], '2026-10-31'), { cur: [], prev: [] });
});

test('اتجاه التغيّر ولونه حسب ما هو أفضل', () => {
  assert.deepEqual(change(120, 100, 'up'), { pct: 20, cls: 'good', text: '▲ 20%' });
  assert.equal(change(120, 100, 'down').cls, 'bad', 'زيادة الاستهلاك سيئة');
  assert.equal(change(80, 100, 'down').text, '▼ 20%');
  assert.equal(change(100.4, 100).cls, '', 'أقل من 1% بلا لون');
  assert.equal(change(5, 0), null, 'لا مقارنة مع صفر');
  assert.equal(change(null, 10), null);
});

test('نسبة 0% مع جهد بطارية صفر لا تُحسب أدنى نسبة', () => {
  const t0 = new Date(2026, 9, 29, 20).getTime();
  const rows = [[60, 51.2], [0, 0], [0, null], [58, 51]].map(([soc, batV], i) => ({ ts: t0 + i * 5 * 60000, soc, batV, outW: 200 }));
  const s = summarize('2026-10-29', rows, 'server');
  assert.equal(s.socMin, 58);
  assert.equal(s.socMax, 60);
  const real = summarize('2026-10-29', [{ ts: t0, soc: 0, batV: 44, outW: 1 }, { ts: t0 + 3e5, soc: 5, batV: 46, outW: 1 }], 'server');
  assert.equal(real.socMin, 0, 'بطارية رصاص بجهد مقروء عند 0% تبقى كما هي');
});

// ---------- الإصدار 3.7: المشهد والطقس، الشرح، الترجمات ----------
import { skyOf, sceneStory, expectedPv, fetchWeather, searchPlace } from '../../src/weather.js';
import { INFO, infoBtn } from '../../src/info.js';
import { warnAr } from '../../src/i18n.js';

test('حالة السماء من رمز الطقس', () => {
  assert.equal(skyOf(0, 0, true), 'clear');
  assert.equal(skyOf(2, 40, true), 'partly');
  assert.equal(skyOf(3, 100, true), 'cloudy');
  assert.equal(skyOf(63, 100, true), 'rain');
  assert.equal(skyOf(95, 100, true), 'storm');
  assert.equal(skyOf(45, 100, true), 'fog');
  assert.equal(skyOf(0, 0, false), 'night');
});

test('جملة الحالة تجمع القراءة الحية مع الطقس', () => {
  const base = { stale: false, soc: 60, mode: 'Battery Mode', gridOn: true, outW: 400 };
  const w = (sky, rad, isDay = true) => ({ sky, rad, isDay });
  // ماطر الساعة 11 والألواح 200 واط: ضعيف لكنه متوقع
  const rain = sceneStory({ ...base, pvW: 200, batW: -210 }, w('rain', 90), { kwp: 5.5 });
  assert.equal(rain.level, 'info');
  assert.match(rain.title, /ماطر.*متوقع/);
  assert.match(rain.text, /تكمّل الفرق/);
  // مشمس والإنتاج أقل بكثير مما تسمح به الشمس والبطارية غير ممتلئة: يستحق الفحص
  const low = sceneStory({ ...base, pvW: 300, batW: -100 }, w('clear', 800), { kwp: 5.5 });
  assert.equal(low.level, 'warn');
  assert.match(low.text, /المتوقع نحو 3\.30 كيلوواط/);
  // مشمس والبطارية ممتلئة: الإنتاج المنخفض طبيعي
  const full = sceneStory({ ...base, soc: 100, pvW: 400, batW: 0 }, w('clear', 800), { kwp: 5.5 });
  assert.equal(full.title, 'البطارية ممتلئة');
  // مشمس وإنتاج جيد يشحن البطارية
  assert.match(sceneStory({ ...base, pvW: 3500, batW: 3000 }, w('clear', 800), { kwp: 5.5 }).title, /مشمس · الألواح تشحن البطارية/);
  // ليل: على البطارية، وتحذير إذا انخفضت
  const night = sceneStory({ ...base, soc: 25, pvW: 0, batW: -500 }, w('night', 0, false), { kwp: 5.5, lowSoc: 30 });
  assert.equal(night.level, 'warn');
  assert.match(night.title, /ليل · البيت على البطارية/);
  // وضع الشبكة ليلاً
  assert.match(sceneStory({ ...base, mode: 'Line Mode', pvW: 0, batW: 0 }, w('night', 0, false)).title, /كهرباء الشبكة تغذّي/);
  // بلا طقس ولا قدرة ألواح: جملة صحيحة بلا مقارنة
  assert.ok(sceneStory({ ...base, pvW: 1200, batW: 700 }, null).title.includes('الألواح تشحن البطارية'));
  assert.equal(sceneStory({ ...base, stale: true }, null).level, 'bad');
  assert.equal(expectedPv(5, 1000), 3750);
  assert.equal(expectedPv(null, 800), null);
});

test('قراءة الطقس والبحث عن المدن من Open-Meteo', async () => {
  const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  const w = await fetchWeather(35.93, 36.63, ok({ current: { temperature_2m: 13.6, weather_code: 63, cloud_cover: 98, is_day: 1, shortwave_radiation: 85, precipitation: 1.2 }, daily: { sunrise: ['2026-11-06T06:31'], sunset: ['2026-11-06T16:58'] } }));
  assert.deepEqual([w.sky, w.temp, w.rad, w.sunrise, w.sunset], ['rain', 14, 85, '06:31', '16:58']);
  await assert.rejects(fetchWeather(1, 1, async () => ({ ok: false, status: 429 })), /مشغولة/);
  await assert.rejects(fetchWeather(1, 1, async () => { throw new Error('x'); }), /تحقق من الإنترنت/);
  const places = await searchPlace('إدلب', ok({ results: [{ name: 'إدلب', admin1: 'محافظة ادلب', country: 'سوريا', latitude: 35.93, longitude: 36.63 }] }));
  assert.deepEqual(places[0], { name: 'إدلب', area: 'محافظة ادلب، سوريا', lat: 35.93, lon: 36.63 });
});

test('كل شرح ⓘ له عنوان ونص، والزر لا يُبنى لمفتاح غير موجود', () => {
  for (const [k, [title, body]] of Object.entries(INFO)) assert.ok(title && body.length && body.every((p) => p.length > 10), k);
  assert.match(infoBtn('totalWh'), /data-info="totalWh"/);
  assert.equal(infoBtn('nope'), '');
});

test('ترجمة أعطال الإنفرتر من الخادم', () => {
  assert.equal(warnAr('Battery voltage low').title, 'جهد البطارية منخفض');
  assert.equal(warnAr('Over load').title, 'حمل زائد');
  assert.equal(warnAr('Fan locked').title, 'المروحة متوقفة أو معطلة');
  assert.equal(warnAr('Over temperature').title, 'ارتفاع حرارة الإنفرتر');
  assert.equal(warnAr('Something new 42').title, 'Something new 42', 'غير المعروف يبقى بنصه الأصلي');
});

test('مشهد ثلاثي الأبعاد: الهندسة وخطوط الطاقة وشرائح البطارية بلون حالتها', async () => {
  const { scene3d, P } = await import('../../src/scene3d.js');
  const calls = [];
  const flowLine = (id, d, on, w, rev, kind) => { calls.push({ id, on, rev, kind }); return `<path class="wire" data-id="${id}" d="${d}"/>`; };
  const html = scene3d({ flows: { solar: { on: true, kind: 'sun' }, grid: { on: false, kind: 'grid' }, load: { on: true, kind: 'load' }, bat: { on: true, reverse: true, kind: 'dis' } },
    labels: { solar: { value: '3.6 ك.واط' }, grid: { title: 'الشبكة', value: '230 فولت' }, bat: { value: '73%', tag: '' }, load: { value: '450 واط' } }, flowLine, bat: { lit: 4, color: 'amber', charging: false } });
  assert.deepEqual(calls.map((c) => c.id).sort(), ['bat', 'grid', 'load', 'solar']);
  assert.equal(calls.find((c) => c.id === 'bat').rev, true, 'التفريغ يسير عكس رسم المسار');
  assert.equal(calls.find((c) => c.id === 'bat').kind, 'dis', 'التفريغ بلون مختلف عن الشحن');
  // 4 من 6 شرائح في الصور = 3 من 5 هنا، بلون التفريغ
  assert.equal((html.match(/class="bseg on amber/g) || []).length, 3);
  assert.equal((html.match(/class="bseg/g) || []).length, 5);
  for (const c of ['n-solar', 'n-grid', 'n-bat', 'n-load', 'n-inv']) assert.ok(html.includes(c), c);
  // كل النقاط داخل مساحة الرسم
  // كل العناصر داخل مساحة الرسم (الأرض وحدها تمتد خارجه عمداً لتملأ المشهد)
  const pts = [...html.matchAll(/class="([^"]+)" points="([^"]+)"/g)].filter((m) => !m[1].startsWith('ground')).flatMap((m) => m[2].split(' ').map((p) => p.split(',').map(Number)));
  assert.ok(pts.length > 50 && pts.every(([x, y]) => x > 0 && x < 400 && y > 0 && y < 360), 'لا شيء خارج المشهد');
  assert.deepEqual(P(0, 0, 0).map(Math.round), [198, 104]);
});

test('مشهد الصور: اختيار الصورة حسب الحالة والطقس والغروب', async () => {
  const { photoFor, batLook } = await import('../../src/scenePhoto.js');
  const at = (h, m = 0) => { const d = new Date(2026, 10, 6, h, m); return d; };
  assert.equal(photoFor({ live: false, sky: 'clear' }), 'offline');
  assert.equal(photoFor({ live: true, sky: 'night' }), 'night');
  assert.equal(photoFor({ live: true, sky: 'night', gridFeeds: true }), 'night-grid');
  assert.equal(photoFor({ live: true, sky: 'storm' }), 'rain');
  assert.equal(photoFor({ live: true, sky: 'fog' }), 'cloudy');
  assert.equal(photoFor({ live: true, sky: 'clear', sunset: '17:05', now: at(12) }), 'day');
  assert.equal(photoFor({ live: true, sky: 'partly', sunset: '17:05', now: at(16, 20) }), 'sunset');
  assert.equal(photoFor({ live: true, sky: 'clear', now: at(16, 20) }), 'day');
  // الشرائح الست بنسبة الشحن، واللون من الاتجاه والحد الأدنى
  assert.deepEqual(batLook({ soc: 94, batW: 3700, live: true }), { lit: 6, color: 'green', charging: true });
  assert.equal(batLook({ soc: 45, batW: -561, live: true }).color, 'amber');
  assert.equal(batLook({ soc: 45, batW: -561, live: true }).lit, 3);
  assert.equal(batLook({ soc: 20, batW: -300, live: true, low: 30 }).color, 'red');
  assert.equal(batLook({ soc: 2, batW: 0, live: true }).lit, 1);
  assert.equal(batLook({ soc: 50, batW: 900, live: true, gridCharging: true }).color, 'blue');
  assert.equal(batLook({ soc: 80, batW: 0, live: false }).lit, 0);
});

test('البحث عن المدينة: صيغ الهمزة والتاء المربوطة، والمطابق أولاً', async () => {
  const { nameVariants, normAr, searchPlace } = await import('../../src/weather.js');
  assert.deepEqual(nameVariants('ادلب'), ['ادلب', 'إدلب', 'أدلب']);
  assert.deepEqual(nameVariants('حماه'), ['حماه', 'حماة']);
  assert.equal(normAr('إدلب'), normAr('ادلب'));
  const fake = async (url) => {
    const n = new URL(url).searchParams.get('name');
    const results = n === 'ادلب' ? [{ name: 'ادلبودن', admin1: 'برن', country: 'سويسرا', latitude: 46.9, longitude: 7.4 }] : n === 'إدلب' ? [{ name: 'إدلب', admin1: 'محافظة ادلب', country: 'سوريا', latitude: 35.93, longitude: 36.63 }] : [];
    return { ok: true, json: async () => ({ results }) };
  };
  const r = await searchPlace('ادلب', fake);
  assert.equal(r[0].name, 'إدلب');
  assert.equal(r.length, 2);
});

test('صيغة الوقت: 12 ساعة افتراضياً و24 عند الطلب', async () => {
  const { fmt, setClock12 } = await import('../../src/model.js');
  const t = new Date(2026, 10, 9, 17, 5).getTime();
  setClock12(true);
  assert.equal(fmt.time(t), '5:05 م');
  assert.equal(fmt.hm('06:31'), '6:31 ص');
  assert.equal(fmt.hm('00:15'), '12:15 ص');
  assert.equal(fmt.hm('12:00'), '12:00 م');
  setClock12(false);
  assert.equal(fmt.time(t), '17:05');
  assert.equal(fmt.hm('06:31'), '06:31');
  setClock12(true);
});

test('أولوية الخرج: تفسير الأوضاع، والتحقق من الجهاز بعد الإرسال', async () => {
  const { orderOf, matchItem, changeAndVerify, findField, isOutputPriority, isChargerPriority } = await import('../../src/control.js');
  assert.deepEqual(orderOf('SBU').order, ['الألواح', 'البطارية', 'الشبكة']);
  assert.deepEqual(orderOf('Solar Bat Utility').code, 'SBU');
  assert.deepEqual(orderOf('Solar Utility Bat').code, 'SUB');
  assert.deepEqual(orderOf('Utility first').order, ['الشبكة', 'الألواح', 'البطارية']);
  assert.equal(orderOf('Mystery mode 7'), null, 'وضع غير معروف لا يُفسَّر');
  const items = [{ key: '0', val: 'Utility first' }, { key: '2', val: 'SBU' }];
  const fields = [{ id: 'c1', name: 'Charger Source Priority', item: items }, { id: 'o1', name: 'Output Source Priority', item: items }];
  assert.equal(findField(fields, isOutputPriority).id, 'o1');
  assert.equal(findField(fields, isChargerPriority).id, 'c1');
  assert.equal(matchItem(items, 'sbu').key, '2');
  const sleep = async () => {};
  // الجهاز يطبّق الأمر بعد قراءتين
  let dev = '2', sent = [], reads = 0;
  let r = await changeAndVerify({ read: async () => (++reads >= 3 ? dev : '2'), send: async (k) => { sent.push(k); dev = k; }, items, key: '0', sleep });
  assert.equal(r.status, 'confirmed'); assert.deepEqual(sent, ['0']); assert.equal(r.before.key, '2');
  // أُرسل الأمر والجهاز لم يتغيّر: لا يُعدّ نجاحاً
  sent = [];
  r = await changeAndVerify({ read: async () => '2', send: async (k) => { sent.push(k); }, items, key: '0', sleep, tries: 3 });
  assert.equal(r.status, 'unconfirmed'); assert.equal(r.after.key, '2'); assert.equal(sent.length, 1, 'لا إعادة إرسال تلقائية');
  // رفض الخادم
  r = await changeAndVerify({ read: async () => '2', send: async () => { throw new Error('الإنفرتر لم يرد في الوقت المحدد'); }, items, key: '0', sleep });
  assert.equal(r.status, 'rejected'); assert.match(r.error, /لم يرد/);
  // الوضع الحالي نفسه: لا إرسال
  sent = [];
  r = await changeAndVerify({ read: async () => '2', send: async (k) => sent.push(k), items, key: '2', sleep });
  assert.equal(r.status, 'same'); assert.equal(sent.length, 0);
  // تعذّرت قراءة الوضع الحالي أو كان غير معروف: لا إرسال إطلاقاً
  r = await changeAndVerify({ read: async () => { throw new Error('تعذّر الاتصال'); }, send: async (k) => sent.push(k), items, key: '0', sleep });
  assert.equal(r.status, 'error'); assert.equal(sent.length, 0);
  r = await changeAndVerify({ read: async () => '9', send: async (k) => sent.push(k), items, key: '0', sleep });
  assert.equal(r.status, 'error'); assert.equal(sent.length, 0);
});

test('تحليل الأسبوعين والتقدير وعدّاد الشبكة', async () => {
  const { analyzeTwoWeeks, gridMeter, rememberForecast, accuracy } = await import('../../src/forecast.js');
  const T = '2026-11-15';
  const day = (i, o = {}) => { const d = new Date(T + 'T12:00:00'); d.setDate(d.getDate() + i); const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; return { v: 2, date, count: 200, coveredH: 23, pvKwh: 10, loadKwh: 12, solarChgKwh: 4, gridChgKwh: 1, gridLoadKwh: 2, nightLoadKwh: 7, nightH: 14, ...o }; };
  // الأسبوع السابق: استهلاك 10 وإنتاج 12. الأخير: استهلاك 12 وإنتاج 10. يوم ناقص لا يُحسب
  const sums = [];
  for (let i = -14; i <= -8; i++) sums.push(day(i, { pvKwh: 12, loadKwh: 10 }));
  for (let i = -7; i <= -1; i++) sums.push(day(i));
  sums[9] = { ...sums[9], coveredH: 5, loadKwh: 1 };
  const radPast = Object.fromEntries(sums.map((s) => [s.date, s.pvKwh]));   // إشعاع = الإنتاج: المردود 1 ك.و.س لكل وحدة
  const radFuture = Array.from({ length: 10 }, (_, i) => ({ date: day(i).date, rad: i < 7 ? 6 : 8 }));
  const r = analyzeTwoWeeks(sums, T, { radPast, radFuture, capKwh: 10.24, cutoffSoc: 20, reserveHours: 6 });
  assert.equal(r.last.n, 6); assert.equal(r.prev.n, 7); assert.equal(r.missing, 1); assert.ok(r.comparable);
  assert.equal(Math.round(r.delta.loadKwh), 20); assert.equal(Math.round(r.delta.pvKwh), -17);
  assert.equal(r.last.gridKwh, 3, 'استيراد الشبكة = تغذية البيت + الشحن');
  assert.equal(r.method, 'weather'); assert.ok(Math.abs(r.yieldPerRad - 1) < 1e-9);
  assert.equal(r.days.length, 14);
  assert.ok(Math.abs(r.days[0].pv - 6) < 1e-9 && r.days[0].fromWeather);
  assert.ok(!r.days[12].fromWeather && Math.abs(r.days[12].pv - 10) < 1e-9, 'بعد مدى الطقس: المتوسط');
  // الاتجاه 1.2: نصفه في الأسبوع الأول وكاملاً في الثاني، ولا يتجاوز السقف 1.25
  assert.ok(Math.abs(r.days[0].load - 13.2) < 1e-9 && Math.abs(r.days[7].load - 14.4) < 1e-9);
  assert.ok(r.days.every((d) => d.pvLo < d.pv && d.pv < d.pvHi && d.deficitHi >= d.deficit));
  assert.ok(Math.abs(r.weeks[0].deficit - 7.2) < 1e-9);
  // الاحتياطي: 6 ساعات × 0.5 ك.و = 3 ك.و.س من 10.24 ≈ 29% فوق حد الفصل 20% ← 50%
  assert.equal(r.suggest.reserveSoc, 50);
  assert.ok(Math.abs(r.suggest.gridHours - 14.4) < 1e-9);
  // بلا طقس: متوسط الأسبوع الأخير
  const r2 = analyzeTwoWeeks(sums, T, {});
  assert.equal(r2.method, 'average'); assert.equal(r2.days[0].pv, 10); assert.equal(r2.suggest, undefined);
  // بيانات قليلة: لا تقدير
  assert.equal(analyzeTwoWeeks(sums.slice(0, 7), T, {}).ok, false);
  // دقة تقدير الأمس
  const saved = rememberForecast({}, { days: [{ pv: 9, load: 11 }] }, day(-1).date);
  assert.deepEqual(accuracy(saved, sums, T), { date: day(-1).date, pvF: 9, pvA: 10, loadF: 11, loadA: 12 });
  // عدّاد الشبكة: يتجاهل الأيام مجهولة الوضع، ويحترم تاريخ البداية المختار، ولا يعدّ يوماً مرتين
  const g = gridMeter([...sums, day(0, { gridLoadKwh: 0.5, gridChgKwh: 0 }), day(-20, { gridLoadKwh: null })], T);
  assert.equal(g.start, day(-14).date); assert.equal(g.all.days, 15);
  assert.equal(g.today.load, 0.5); assert.equal(g.week.days, 7);
  assert.ok(Math.abs(g.all.load - 28.5) < 1e-9 && Math.abs(g.all.chg - 14) < 1e-9);
  assert.equal(g.all.partial, 1);
  assert.equal(gridMeter(sums, T, day(-3).date).all.days, 3);
});
