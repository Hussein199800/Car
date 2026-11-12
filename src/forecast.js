// تحليل آخر أسبوعين وتقدير الأسبوعين القادمين. كل ما هنا «تقدير» مبني على ملخصات الأيام الفعلية
// (وتوقع الإشعاع الشمسي إن توفر)، يُعرض بمدى لا برقم واحد، ولا يغيّر أي إعداد في الإنفرتر.

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// يوم مكتمل: بيانات تغطي معظم ساعاته، حتى لا يُقارن يوم ناقص بيوم كامل
const isFull = (s) => s && s.count > 1 && s.coveredH >= 18 && s.loadKwh != null && s.pvKwh != null;

const KEYS = ['pvKwh', 'loadKwh', 'solarChgKwh', 'gridChgKwh', 'gridLoadKwh', 'nightLoadKwh'];

function weekStats(days) {
  const out = { n: days.length };
  for (const k of KEYS) {
    const v = days.map((s) => s[k]).filter((x) => x != null);
    out[k] = v.length ? avg(v) : null;
  }
  // استيراد الشبكة التقديري = ما غذّى البيت مباشرة + ما شحن البطارية
  const g = days.filter((s) => s.gridLoadKwh != null).map((s) => s.gridLoadKwh + (s.gridChgKwh || 0));
  out.gridKwh = g.length ? avg(g) : null;
  return out;
}

const change = (a, b) => (a != null && b ? ((a - b) / b) * 100 : null);

/**
 * sums: ملخصات الأيام (أي ترتيب). todayKey: تاريخ اليوم YYYY-MM-DD.
 * radPast: {date: إشعاع اليوم MJ/m²} للأيام الماضية، radFuture: [{date, rad}] للقادمة (اختياريان).
 */
export function analyzeTwoWeeks(sums, todayKey, { radPast = null, radFuture = null, capKwh = null, cutoffSoc = 20, reserveHours = 6, horizon = 14 } = {}) {
  const by = new Map((sums || []).filter(Boolean).map((s) => [s.date, s]));
  const range = (from, to) => { const out = []; for (let i = from; i <= to; i++) { const s = by.get(addDays(todayKey, i)); if (isFull(s)) out.push(s); } return out; };
  const last = range(-7, -1), prev = range(-14, -8);
  const w1 = weekStats(last), w0 = weekStats(prev);
  const res = {
    last: w1, prev: w0,
    // نقارن فقط إذا كان في كل أسبوع 4 أيام مكتملة على الأقل
    comparable: last.length >= 4 && prev.length >= 4,
    delta: Object.fromEntries([...KEYS, 'gridKwh'].map((k) => [k, change(w1[k], w0[k])])),
    missing: 14 - last.length - prev.length,
    days: [], ok: last.length >= 3,
  };
  if (!res.ok) return res;

  // ----- الاستهلاك: متوسط الأسبوع الأخير مع اتجاه التغيّر بين الأسبوعين، بسقف يمنع المبالغة -----
  const g = res.comparable && w0.loadKwh ? clamp(w1.loadKwh / w0.loadKwh, 0.9, 1.25) : 1;
  const loads = last.map((s) => s.loadKwh);
  const loadSpread = w1.loadKwh ? clamp((Math.max(...loads) - Math.min(...loads)) / 2 / w1.loadKwh, 0.1, 0.4) : 0.2;
  res.loadTrend = g;

  // ----- الإنتاج: إنتاجك الفعلي لكل وحدة إشعاع × الإشعاع المتوقع؛ وبلا طقس متوسط الأسبوع الأخير -----
  const both = [...prev, ...last];
  const pairs = radPast ? both.filter((s) => radPast[s.date] > 0.5).map((s) => [s.pvKwh, radPast[s.date]]) : [];
  const yieldPerRad = pairs.length >= 4 ? pairs.reduce((a, [p]) => a + p, 0) / pairs.reduce((a, [, r]) => a + r, 0) : null;
  // تشتت الإنتاج الفعلي حول ما يفسّره الإشعاع: يحدد عرض المدى
  const pvSpread = yieldPerRad
    ? clamp(Math.sqrt(avg(pairs.map(([p, r]) => ((p - yieldPerRad * r) / Math.max(0.2, yieldPerRad * r)) ** 2))), 0.15, 0.5)
    : (() => { const p = last.map((s) => s.pvKwh); return w1.pvKwh ? clamp((Math.max(...p) - Math.min(...p)) / 2 / w1.pvKwh, 0.2, 0.6) : 0.4; })();
  res.method = yieldPerRad ? 'weather' : 'average';
  res.yieldPerRad = yieldPerRad;
  const fut = new Map((radFuture || []).map((x) => [x.date, x.rad]));

  for (let i = 0; i < horizon; i++) {
    const date = addDays(todayKey, i);
    const rad = fut.get(date);
    const fromWeather = yieldPerRad != null && rad != null;
    const pv = fromWeather ? yieldPerRad * rad : w1.pvKwh;
    // الأسبوع الأول نصف الاتجاه، والثاني الاتجاه كاملاً
    const load = w1.loadKwh * (i < 7 ? 1 + (g - 1) / 2 : g);
    // بعد مدى توقع الطقس يتسع المدى لأن التقدير صار من المتوسط وحده
    const sp = fromWeather ? pvSpread : Math.max(pvSpread, 0.35);
    res.days.push({
      date, fromWeather,
      pv, pvLo: pv * (1 - sp), pvHi: pv * (1 + sp),
      load, loadLo: load * (1 - loadSpread), loadHi: load * (1 + loadSpread),
      deficit: Math.max(0, load - pv), deficitHi: Math.max(0, load * (1 + loadSpread) - pv * (1 - sp)),
    });
  }
  const wk = (a, b) => res.days.slice(a, b);
  const sumOf = (list, k) => list.reduce((a, d) => a + d[k], 0);
  res.weeks = [wk(0, 7), wk(7, 14)].map((l) => ({ pv: sumOf(l, 'pv') / l.length, load: sumOf(l, 'load') / l.length, deficit: sumOf(l, 'deficit') / l.length, deficitHi: sumOf(l, 'deficitHi') / l.length, weatherDays: l.filter((d) => d.fromWeather).length }));

  // ----- اقتراحات (تُعرض فقط، ولا تُطبَّق) -----
  const nightKwh = w1.nightLoadKwh;
  const nightH = avg(last.map((s) => s.nightH).filter((x) => x > 0)) || 14;
  const nightKw = nightKwh != null ? nightKwh / nightH : null;
  res.night = { kwh: nightKwh, hours: nightH, kw: nightKw };
  if (capKwh && nightKw) {
    // احتياطي يكفي ساعات انقطاع يحددها المستخدم بمعدل استهلاك الليل، فوق حد الفصل
    const reserve = clamp(Math.round((cutoffSoc + ((nightKw * reserveHours) / capKwh) * 100) / 5) * 5, cutoffSoc + 10, 80);
    const deficit = res.weeks[0].deficit, deficitHi = res.weeks[0].deficitHi;
    res.suggest = {
      reserveSoc: reserve, reserveHours,
      // ساعات تغذية البيت من الشبكة اللازمة يومياً لتغطية العجز بمعدل استهلاك المساء
      gridHours: deficit / nightKw, gridHoursHi: deficitHi / nightKw,
      // ما تعطيه البطارية بين الامتلاء والاحتياطي
      usableKwh: (capKwh * (100 - reserve)) / 100,
    };
  }
  return res;
}

// دقة تقدير الأمس: نحفظ تقدير كل يوم، ثم نقارنه بما حدث فعلاً
export function rememberForecast(saved, res, todayKey) {
  const out = { ...(saved || {}) };
  const t = res.days?.[0];
  if (t && !out[todayKey]) out[todayKey] = { pv: +t.pv.toFixed(2), load: +t.load.toFixed(2) };
  for (const k of Object.keys(out)) if (k < addDays(todayKey, -30)) delete out[k];
  return out;
}

export function accuracy(saved, sums, todayKey) {
  const y = addDays(todayKey, -1);
  const f = saved?.[y];
  const s = (sums || []).find((x) => x && x.date === y);
  if (!f || !isFull(s)) return null;
  return { date: y, pvF: f.pv, pvA: s.pvKwh, loadF: f.load, loadA: s.loadKwh };
}

// ===== عدّاد كهرباء الشبكة (تقدير من وضع الشبكة، لا من عدّاد في الجهاز) =====
export function gridMeter(sums, todayKey, from = null) {
  const days = (sums || []).filter((s) => s && s.count > 1 && s.gridLoadKwh != null && (!from || s.date >= from)).sort((a, b) => a.date.localeCompare(b.date));
  const tot = (list) => ({
    load: list.reduce((a, s) => a + s.gridLoadKwh, 0),
    chg: list.reduce((a, s) => a + (s.gridChgKwh || 0), 0),
    days: list.length,
    coveredH: list.reduce((a, s) => a + (s.coveredH || 0), 0),
    // أيام ناقصة التغطية: المجموع فيها أقل من الحقيقي
    partial: list.filter((s) => s.date < todayKey && s.coveredH < 18).length,
  });
  const since = (n) => days.filter((s) => s.date > addDays(todayKey, -n));
  return {
    start: days[0]?.date || null,
    today: tot(days.filter((s) => s.date === todayKey)),
    week: tot(since(7)), month: tot(since(30)), all: tot(days),
    perDay: days.map((s) => ({ date: s.date, load: s.gridLoadKwh, chg: s.gridChgKwh || 0, coveredH: s.coveredH })),
  };
}
