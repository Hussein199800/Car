// اختبارات وحدة للمنطق الأساسي (بدون متصفح): التوقيع، تحليل القراءات، كشف الانقطاع، المصطلحات، الملخصات
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha1, quotePlus } from '../../src/api.js';
import { normalize, parseTs, countAr, fmt, rowsToSamples } from '../../src/model.js';
import { makeLocalizer } from '../../src/terms.js';
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

test('قراءة قديمة تعني أن الرافع غير متصل، والحديثة متصلة', () => {
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

test('المصطلحات تتغير بكل صيغها ولا تمس «إنفرتر» بين قوسين', () => {
  const L = makeLocalizer({ invTerm: 'akis', gridTerm: 'grid' });
  assert.equal(L('إعدادات الرافع للرافع'), 'إعدادات العاكس للعاكس');
  assert.equal(L('انقطعت الكهرباء الوطنية'), 'انقطعت كهرباء الشبكة');
  assert.equal(L('للكهرباء الوطنية'), 'لكهرباء الشبكة');
  assert.equal(L('مكيفات «إنفرتر»'), 'مكيفات «إنفرتر»');
  assert.equal(makeLocalizer({ invTerm: 'rafe', gridTerm: 'watani' })('عطل في الإنفرتر'), 'عطل في الرافع');
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
