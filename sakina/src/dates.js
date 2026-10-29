// التاريخ الهجري (تقويم أم القرى عبر Intl مع بديل حسابي) وأدوات المنطقة الزمنية

export const HIJRI_MONTHS = ['محرّم', 'صفر', 'ربيع الأول', 'ربيع الآخر', 'جمادى الأولى', 'جمادى الآخرة', 'رجب', 'شعبان', 'رمضان', 'شوّال', 'ذو القعدة', 'ذو الحجة'];
export const GREG_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const WEEKDAY_LETTERS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

const DAY = 86400000;
const fmtCache = {};
function fmt(key, make) { return fmtCache[key] || (fmtCache[key] = make()); }

/** التاريخ المحلي {y,m,d,wd} لحظة معيّنة في منطقة زمنية */
export function ymdInTz(date, tz) {
  try {
    const f = fmt(`ymd-${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' }));
    const p = {};
    for (const part of f.formatToParts(date)) p[part.type] = part.value;
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
    return { y: +p.year, m: +p.month, d: +p.day, wd };
  } catch (e) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate(), wd: date.getDay() };
  }
}

/** الساعة والدقيقة لحظة معيّنة في منطقة زمنية */
export function hmInTz(date, tz) {
  try {
    const f = fmt(`hm-${tz}`, () => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23', hour12: false }));
    const p = {};
    for (const part of f.formatToParts(date)) p[part.type] = part.value;
    return { h: +p.hour % 24, min: +p.minute };
  } catch (e) {
    return { h: date.getHours(), min: date.getMinutes() };
  }
}

export const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// بديل حسابي (التقويم الهجري الجدولي) إن لم يدعم المتصفح تقويم أم القرى
function tabularHijri(date) {
  const jd = Math.floor(date.getTime() / DAY) + 2440588; // اليوم اليولياني (ظهراً)
  let l = jd - 1948440 + 10632;
  const n = Math.floor((l - 1) / 10631);
  l = l - 10631 * n + 354;
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719) + Math.floor(l / 5670) * Math.floor((43 * l) / 15238);
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const m = Math.floor((24 * l) / 709);
  return { d: l - Math.floor((709 * m) / 24), m, y: 30 * n + j - 30 };
}

let hijriFmt;
function hijriFormatter() {
  if (hijriFmt !== undefined) return hijriFmt;
  hijriFmt = null;
  for (const cal of ['islamic-umalqura', 'islamic-civil', 'islamic']) {
    try {
      const f = new Intl.DateTimeFormat(`en-u-ca-${cal}-nu-latn`, { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
      if (f.resolvedOptions().calendar === cal) { hijriFmt = f; break; }
    } catch (e) { /* غير مدعوم */ }
  }
  return hijriFmt;
}

/**
 * التاريخ الهجري لتاريخ ميلادي محلي.
 * @param {{y:number,m:number,d:number}} g
 * @param {number} adjust تعديل يدوي بالأيام (−٢..+٢)
 */
export function toHijri(g, adjust = 0) {
  const date = new Date(Date.UTC(g.y, g.m - 1, g.d, 12) + adjust * DAY);
  const f = hijriFormatter();
  if (f) {
    const p = {};
    for (const part of f.formatToParts(date)) p[part.type] = part.value;
    const y = parseInt(p.year || p.relatedYear, 10);
    if (y && +p.month && +p.day) return { y, m: +p.month, d: +p.day };
  }
  return tabularHijri(date);
}

/** يضيف أياماً إلى تاريخ ميلادي محلي */
export function addDays(g, n) {
  const t = new Date(Date.UTC(g.y, g.m - 1, g.d) + n * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay() };
}

/**
 * أقرب تاريخ ميلادي (اليوم أو بعده) يوافق يوماً هجرياً معيّناً، بالبحث يوماً بيوم خلال سنة.
 * @returns {{g:object, h:object, days:number}|null}
 */
export function nextHijriDate(today, hm, hd, adjust = 0, maxDays = 390) {
  for (let i = 0; i <= maxDays; i++) {
    const g = addDays(today, i);
    const h = toHijri(g, adjust);
    if (h.m === hm && h.d === hd) return { g, h, days: i };
  }
  return null;
}
