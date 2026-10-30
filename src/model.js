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
  // الحرارة: بعض الأجهزة ترسلها (حرارة المشتت أو البطارية) وبعضها لا يرسلها أبداً.
  // نتجاهل الصفر والقيم غير المنطقية لأنها تعني غالباً حساساً غير موجود
  const temps = [];
  for (const [k, v] of map) {
    if (!/temp/.test(k)) continue;
    const t = num(v);
    if (t !== null && t > 0 && t < 150) temps.push({ key: k, v: t, bat: /bat/.test(k) });
  }
  const maxOf = (list) => (list.length ? Math.max(...list.map((t) => t.v)) : null);
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
    temps,
    temp: maxOf(temps),
    batTemp: maxOf(temps.filter((t) => t.bat)),
    invTemp: maxOf(temps.filter((t) => !t.bat)),
    ratedW: n(/^ac output rating active power/),
    ratedV: n(/^battery rating voltage/),
    gridRatedV: n(/^grid rating voltage/, /^ac output rating voltage/),
    fault: isEmptyVal(fault) || /^0+$/.test(String(fault)) ? null : String(fault),
    warning: isEmptyVal(warning) || /^0+$/.test(String(warning)) ? null : String(warning),
  };
}

const toMap = (points) => {
  const map = new Map();
  for (const p of points) map.set(String(p.title || '').trim().toLowerCase(), p.val);
  return map;
};

// وجود الكهرباء: جهد أعلى من 40% من الجهد المقنّن (يناسب شبكات 110 و230 فولت)
export const gridPresent = (v, rated) => v !== null && v !== undefined && v >= 0.4 * (rated || 230);

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

// offsetMs: فرق الساعة بين وقت الخادم وهاتف المستخدم (يُكتشف تلقائياً في main.js)
export function normalize(points, staleMin = 15, offsetMs = 0) {
  const map = toMap(points);
  const x = extract(map);
  // نحوّل وقت القراءة إلى توقيت الهاتف ليظهر صحيحاً للمستخدم
  const rawTs = x.ts;
  if (x.ts) x.ts += offsetMs;
  const age = x.ts ? Date.now() - x.ts : null;
  // الخادم يعيد آخر قراءة محفوظة حتى لو كان الإنفرتر مطفأً، لذا نحكم بالاتصال من عمر القراءة
  const stale = age !== null && age > staleMin * 60000;
  return {
    ...x,
    temps: x.temps.map((t) => ({ ...t, ar: trTitle(t.key) })),
    rawTs,
    age,
    stale,
    gridOn: gridPresent(x.gridV, x.gridRatedV),
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
export const DAY = ['يوم', 'يومين', 'أيام', 'يوماً'];
// الأرقام العربية (٠-٩ و۰-۹) والفاصلة العشرية «٫» أو «,» إلى صيغة يفهمها Number والجهاز
export function latinDigits(s) {
  return String(s ?? '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u066B,]/g, '.')
    .replace(/\u066C/g, '');
}

export function countAr(n, [one, two, few, many]) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

// نظام أرقام واحد في كل التطبيق: الأرقام 0-9 (كما في الوحدات والقراءات)، مهما كانت لغة الهاتف.
// بدون هذا تعرض بعض الهواتف التواريخ بالأرقام الهندية ٠-٩ بجانب قراءات بالأرقام 0-9
export const LOC = 'ar-u-nu-latn';
const p2 = (x) => String(x).padStart(2, '0');

export const fmt = {
  // نسبة داخل نص عربي: نعزلها اتجاهياً حتى لا تظهر «(%45)» بين الأقواس
  pct: (n) => `\u2066${n}%\u2069`,
  w: (w) => (w === null || w === undefined ? '—' : Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + ' كيلوواط' : Math.round(w) + ' واط'),
  // صيغة مختصرة للمخطط بنفس الوحدات العربية المستخدمة في باقي الشاشات
  wShort: (w) => (w === null || w === undefined ? '—' : Math.abs(w) >= 1000 ? (w / 1000).toFixed(1) + ' ك.واط' : Math.round(w) + ' واط'),
  kwh: (k) => (k === null || k === undefined || !Number.isFinite(k) ? '—' : k.toFixed(k >= 100 ? 0 : 2)),
  v: (v, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d) + ' فولت'),
  hours: (h) => {
    if (!Number.isFinite(h) || h <= 0) return '—';
    if (h > 99) return 'أكثر من 99 ساعة';
    // نقرّب إلى أقرب دقيقة أولاً حتى لا تظهر «ساعة و60 دقيقة»
    const total = Math.round(h * 60);
    if (total < 1) return 'أقل من دقيقة';
    const hh = Math.floor(total / 60);
    const mm = total % 60;
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
  time: (t) => new Date(t).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' }),
  dateTime: (t) => new Date(t).toLocaleString(LOC, { dateStyle: 'medium', timeStyle: 'short' }),
  // تاريخ يوم بصيغة YYYY-MM-DD (منتصف النهار لتجنّب مشاكل التوقيت الصيفي)
  day: (date, opts) => new Date(date + 'T12:00:00').toLocaleDateString(LOC, opts),
  // للملفات المصدّرة: صيغة ثابتة يفهمها Excel بلا رموز اتجاه مخفية
  iso: (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; },
};
