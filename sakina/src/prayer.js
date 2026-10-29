// حساب مواقيت الصلاة فلكياً بلا إنترنت (خوارزمية PrayTimes المعتمدة)
// كل الأوقات تُحسب بالتوقيت العالمي ثم تُعرض بالمنطقة الزمنية للموقع.

export const METHODS = {
  mwl: { name: 'رابطة العالم الإسلامي', fajr: 18, isha: 17 },
  makkah: { name: 'أم القرى (مكة المكرمة)', fajr: 18.5, ishaMin: 90 },
  egypt: { name: 'الهيئة المصرية العامة للمساحة', fajr: 19.5, isha: 17.5 },
  karachi: { name: 'جامعة العلوم الإسلامية بكراتشي', fajr: 18, isha: 18 },
  isna: { name: 'الجمعية الإسلامية لأمريكا الشمالية', fajr: 15, isha: 15 },
  gulf: { name: 'منطقة الخليج', fajr: 18.2, isha: 18.2 },
  kuwait: { name: 'وزارة الأوقاف الكويتية', fajr: 18, isha: 17.5 },
  qatar: { name: 'وزارة الأوقاف القطرية', fajr: 18, ishaMin: 90 },
  jordan: { name: 'وزارة الأوقاف الأردنية', fajr: 18, isha: 18 },
  turkey: { name: 'رئاسة الشؤون الدينية التركية', fajr: 18, isha: 17 },
  morocco: { name: 'وزارة الأوقاف المغربية', fajr: 19, isha: 17 },
  algeria: { name: 'وزارة الشؤون الدينية الجزائرية', fajr: 18, isha: 17 },
  tunisia: { name: 'وزارة الشؤون الدينية التونسية', fajr: 18, isha: 18 },
  france: { name: 'اتحاد المنظمات الإسلامية بفرنسا', fajr: 12, isha: 12 },
  singapore: { name: 'سنغافورة وماليزيا وإندونيسيا', fajr: 20, isha: 18 },
};

export const PRAYERS = [
  { key: 'fajr', name: 'الفجر', icon: 'sunrise' },
  { key: 'sunrise', name: 'الشروق', icon: 'sun-low' },
  { key: 'dhuhr', name: 'الظهر', icon: 'sun' },
  { key: 'asr', name: 'العصر', icon: 'sun-dim' },
  { key: 'maghrib', name: 'المغرب', icon: 'sunset' },
  { key: 'isha', name: 'العشاء', icon: 'moon' },
];

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const sin = (d) => Math.sin(rad(d));
const cos = (d) => Math.cos(rad(d));
const tan = (d) => Math.tan(rad(d));
const asin = (x) => deg(Math.asin(x));
const acos = (x) => deg(Math.acos(x));
const atan2 = (y, x) => deg(Math.atan2(y, x));
const acot = (x) => deg(Math.atan(1 / x));
const fix = (a, b) => { const r = a - b * Math.floor(a / b); return r < 0 ? r + b : r; };

function julian(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}

function sunPosition(jd) {
  const D = jd - 2451545.0;
  const g = fix(357.529 + 0.98560028 * D, 360);
  const q = fix(280.459 + 0.98564736 * D, 360);
  const L = fix(q + 1.915 * sin(g) + 0.020 * sin(2 * g), 360);
  const e = 23.439 - 0.00000036 * D;
  const RA = atan2(cos(e) * sin(L), cos(L)) / 15;
  return { decl: asin(sin(e) * sin(L)), eqt: q / 15 - fix(RA, 24) };
}

/**
 * يحسب أوقات يوم واحد.
 * @param {{y:number,m:number,d:number}} date التاريخ المحلي للموقع
 * @param {{lat:number,lng:number}} loc
 * @param {{method:string, asr?:'shafi'|'hanafi', ramadan?:boolean}} opts
 * @returns {Record<string, Date>} أوقات الصلوات كتواريخ مطلقة
 */
export function computeTimes(date, loc, opts) {
  const method = METHODS[opts.method] || METHODS.mwl;
  const { lat, lng } = loc;
  const jd = julian(date.y, date.m, date.d) - lng / (15 * 24);

  const midDay = (t) => fix(12 - sunPosition(jd + t).eqt, 24);
  const angleTime = (angle, t, ccw) => {
    const { decl } = sunPosition(jd + t);
    const T = acos((-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat))) / 15;
    return midDay(t) + (ccw ? -T : T);
  };
  const asrTime = (factor, t) => {
    const { decl } = sunPosition(jd + t);
    return angleTime(-acot(factor + tan(Math.abs(lat - decl))), t);
  };

  // تقدير أولي ثم تكرار واحد للدقة
  let t = { fajr: 5, sunrise: 6, dhuhr: 12, asr: 13, sunset: 18, isha: 18 };
  for (let i = 0; i < 2; i++) {
    const p = (h) => h / 24;
    t = {
      fajr: angleTime(method.fajr, p(t.fajr), true),
      sunrise: angleTime(0.833, p(t.sunrise), true),
      dhuhr: midDay(p(t.dhuhr)),
      asr: asrTime(opts.asr === 'hanafi' ? 2 : 1, p(t.asr)),
      sunset: angleTime(0.833, p(t.sunset)),
      isha: method.isha != null ? angleTime(method.isha, p(t.isha)) : 18,
    };
  }
  // إلى التوقيت العالمي
  for (const k of Object.keys(t)) t[k] -= lng / 15;
  t.maghrib = t.sunset;
  if (method.ishaMin != null) t.isha = t.maghrib + (method.ishaMin + (opts.ramadan ? 30 : 0)) / 60;

  // خطوط العرض العالية: طريقة الزاوية حين لا يغيب الشفق
  const night = fix(t.sunrise - t.sunset, 24);
  const fajrPortion = (method.fajr / 60) * night;
  if (Number.isNaN(t.fajr) || fix(t.sunrise - t.fajr, 24) > fajrPortion) t.fajr = t.sunrise - fajrPortion;
  if (method.ishaMin == null) {
    const ishaPortion = (method.isha / 60) * night;
    if (Number.isNaN(t.isha) || fix(t.isha - t.sunset, 24) > ishaPortion) t.isha = t.sunset + ishaPortion;
  }

  const base = Date.UTC(date.y, date.m - 1, date.d);
  const out = {};
  for (const p of PRAYERS) out[p.key] = new Date(base + Math.round(t[p.key] * 60) * 60000);
  return out;
}

/** اتجاه القبلة بالدرجات من الشمال الجغرافي باتجاه عقارب الساعة */
export function qiblaBearing(lat, lng) {
  const kLat = 21.4225, kLng = 39.8262;
  const dL = rad(kLng - lng);
  const y = Math.sin(dL);
  const x = Math.cos(rad(lat)) * Math.tan(rad(kLat)) - Math.sin(rad(lat)) * Math.cos(dL);
  return fix(deg(Math.atan2(y, x)), 360);
}

/** المسافة إلى الكعبة بالكيلومتر */
export function distanceToKaaba(lat, lng) {
  const kLat = rad(21.4225), kLng = rad(39.8262);
  const a = Math.sin((kLat - rad(lat)) / 2) ** 2 + Math.cos(rad(lat)) * Math.cos(kLat) * Math.sin((kLng - rad(lng)) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
