// تحويل قراءات الإنفرتر الخام إلى نموذج موحّد
import { trTitle, trValue, isEmptyVal } from './i18n.js';

export const num = (v) => {
  if (isEmptyVal(v)) return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// "2026-10-28 19:17:29" بتوقيت الجهاز (المحلي)
export function parseTs(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
}

// قارئ موحّد يعمل على قراءة حيّة أو على صف من السجل
export function reader(map) {
  const find = (...patterns) => {
    for (const re of patterns) for (const [k, v] of map) if (re.test(k)) return v;
    return undefined;
  };
  return { find, n: (...re) => num(find(...re)) };
}

const MODE_TITLES = [/^working state$/, /^work mode$/, /^operating mode$/, /^mode$/, /^model$/];

export function extract(map) {
  const { find, n } = reader(map);
  const ts = parseTs(find(/^timestamp$/, /^time$/, /^date$/));
  const pv1W = n(/^pv1 charging power/, /^pv1 .*power/, /^pv charging power/, /^pv input power/);
  const pv2W = n(/^pv2 charging power/, /^pv2 .*power/);
  const batV = n(/^battery voltage$/);
  const chgA = n(/^battery charging current/);
  const disA = n(/^battery discharg.* current/);
  const modeRaw = find(...MODE_TITLES);
  const mode = modeRaw && /mode/i.test(String(modeRaw)) ? String(modeRaw) : null;
  const fault = find(/^inverter fault/, /^fault code/, /^fault$/);
  const warning = find(/^warning code/, /^warning$/);
  return {
    ts,
    mode,
    pvW: pv1W === null && pv2W === null ? null : (pv1W || 0) + (pv2W || 0),
    pv1W, pv2W,
    pv1V: n(/^pv1 input voltage/, /^pv input voltage/, /^pv1 voltage/),
    pv2V: n(/^pv2 input voltage/, /^pv2 voltage/),
    pv1A: n(/^pv1 input current/),
    pv2A: n(/^pv2 input current/),
    gridV: n(/^grid voltage/, /^ac input voltage/),
    gridHz: n(/^grid frequency/, /^ac input frequency/),
    feedW: n(/^solar feed to grid power/),
    batV, chgA, disA,
    batW: batV !== null && (chgA !== null || disA !== null) ? Math.round(batV * ((chgA || 0) - (disA || 0))) : null,
    soc: n(/^battery capacity/, /^soc$/, /state of charge/),
    outV: n(/^ac output voltage/, /^ac1 output voltage/, /^output voltage/),
    outHz: n(/^ac output frequency/, /^ac1 output frequency/, /^output frequency/),
    outW: n(/^ac output active power/, /^ac1 output active power/, /^output active power/),
    outVA: n(/^ac output apparent power/, /^ac1 output apparent power/, /^output apparent power/),
    loadPct: n(/^output load percent/, /^load percent/),
    loadStatus: find(/^load status/),
    todayWh: n(/^today generation/, /^energy today/),
    totalWh: n(/^total generation/, /^energy total/),
    busV: n(/^bus voltage/),
    temp: n(/temperature/),
    ratedW: n(/^ac output rating active power/),
    ratedV: n(/^battery rating voltage/),
    fault: isEmptyVal(fault) || /^0+$/.test(String(fault)) ? null : String(fault),
    warning: isEmptyVal(warning) || /^0+$/.test(String(warning)) ? null : String(warning),
  };
}

const toMap = (points) => {
  const map = new Map();
  for (const p of points) map.set(String(p.title || '').trim().toLowerCase(), p.val);
  return map;
};

// تصنيف الحقول لعرضها في صفحات منفصلة
const GROUPS = [
  ['rated', /rating/],
  ['config', /priority|battery type|re-?charge|re-?discharge|bulk|float|max .*current|input range|parallel|cut-?off|under voltage/],
  ['product', /^sn$|machine type|firmware|^id$|^timestamp$/],
];

export function groupOf(title) {
  const t = String(title).toLowerCase();
  for (const [g, re] of GROUPS) if (re.test(t)) return g;
  return 'live';
}

export function normalize(points, staleMin = 15) {
  const map = toMap(points);
  const x = extract(map);
  const age = x.ts ? Date.now() - x.ts : null;
  // الخادم يعيد آخر قراءة محفوظة حتى لو كان الإنفرتر مطفأً، لذا نحكم بالاتصال من عمر القراءة
  const stale = age !== null && age > staleMin * 60000;
  return {
    ...x,
    age,
    stale,
    gridOn: x.gridV !== null && x.gridV >= 90,
    raw: points
      .filter((p) => String(p.title).toLowerCase() !== 'id')
      .map((p) => ({ title: p.title, ar: trTitle(p.title), val: p.val, valAr: trValue(p.val), unit: p.unit, group: groupOf(p.title) })),
  };
}

export function rowsToSamples({ titles, rows }) {
  const keys = titles.map((t) => String(t).trim().toLowerCase());
  return rows
    .map((r) => {
      const m = new Map();
      keys.forEach((k, i) => m.set(k, r[i]));
      return extract(m);
    })
    .filter((s) => s.ts)
    .sort((a, b) => a.ts - b.ts);
}

// صياغة العدد مع المعدود حسب قواعد العربية: ساعة، ساعتين، 3 ساعات، 11 ساعة
const HOUR = ['ساعة', 'ساعتين', 'ساعات', 'ساعة'];
const MIN = ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'];
const DAY = ['يوم', 'يومين', 'أيام', 'يوماً'];
export function countAr(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

export const fmt = {
  w: (w) => (w === null || w === undefined ? '—' : Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + ' كيلوواط' : Math.round(w) + ' واط'),
  wShort: (w) => (w === null || w === undefined ? '—' : Math.abs(w) >= 1000 ? (w / 1000).toFixed(1) + 'kW' : Math.round(w) + 'W'),
  kwh: (k) => (k === null || k === undefined || !Number.isFinite(k) ? '—' : k.toFixed(k >= 100 ? 0 : 2)),
  v: (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d) + ' فولت'),
  hours: (h) => {
    if (!Number.isFinite(h) || h <= 0) return '—';
    if (h > 99) return 'أكثر من 99 ساعة';
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    if (!hh) return countAr(mm, MIN);
    return countAr(hh, HOUR) + (mm ? ' و' + countAr(mm, MIN) : '');
  },
  ago: (ms) => {
    if (ms === null || ms === undefined) return '';
    const m = Math.round(ms / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return 'قبل ' + countAr(m, MIN);
    const h = Math.floor(m / 60);
    if (h < 24) return 'قبل ' + countAr(h, HOUR) + (m % 60 ? ' و' + countAr(m % 60, MIN) : '');
    return 'قبل ' + countAr(Math.floor(h / 24), DAY);
  },
  time: (t) => new Date(t).toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' }),
  dateTime: (t) => new Date(t).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' }),
};
