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
