// الطقس الحقيقي من Open-Meteo (مجاني وبلا مفتاح) لموقع المنظومة، ومنطق «المشهد»:
// ما الذي يحدث الآن ولماذا، بمقارنة إنتاج الألواح الفعلي بما تسمح به الشمس في هذه اللحظة.
import { fmt } from './model.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

// رموز WMO للطقس إلى حالة المشهد
export function skyOf(code, cloud, isDay) {
  if (!isDay) return 'night';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code === 45 || code === 48) return 'fog';
  if (code === 3 || cloud >= 80) return 'cloudy';
  if (code === 1 || code === 2 || cloud >= 30) return 'partly';
  return 'clear';
}

export const SKY_AR = { clear: 'مشمس', partly: 'غائم جزئياً', cloudy: 'غائم', rain: 'ماطر', storm: 'عاصف', snow: 'ثلج', fog: 'ضباب', night: 'ليل' };

async function get(url, fetchFn) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetchFn(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(r.status === 429 ? 'خدمة الطقس مشغولة، تُعاد المحاولة لاحقاً' : 'تعذّر جلب الطقس');
    return await r.json();
  } catch (e) {
    throw new Error(e.message?.startsWith('خدمة') ? e.message : 'تعذّر جلب الطقس، تحقق من الإنترنت');
  } finally {
    clearTimeout(t);
  }
}

export async function fetchWeather(lat, lon, fetchFn = fetch) {
  const q = `latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,cloud_cover,is_day,shortwave_radiation,precipitation&daily=sunrise,sunset&timezone=auto&forecast_days=1`;
  const d = await get(`${FORECAST}?${q}`, fetchFn);
  const c = d.current || {};
  return {
    temp: Number.isFinite(c.temperature_2m) ? Math.round(c.temperature_2m) : null,
    code: c.weather_code ?? 0,
    cloud: c.cloud_cover ?? 0,
    isDay: c.is_day === 1,
    rad: Number.isFinite(c.shortwave_radiation) ? c.shortwave_radiation : null, // واط/م² على سطح أفقي
    rain: c.precipitation ?? 0,
    sunrise: d.daily?.sunrise?.[0]?.slice(11, 16) || null,
    sunset: d.daily?.sunset?.[0]?.slice(11, 16) || null,
    sky: skyOf(c.weather_code ?? 0, c.cloud_cover ?? 0, c.is_day === 1),
    at: Date.now(),
  };
}

// توحيد الكتابة العربية للمقارنة: الهمزات والتاء المربوطة والألف المقصورة والتشكيل
export const normAr = (s) => String(s || '').trim().replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();

// صيغ الاسم التي يُبحث بها: كثيرون يكتبون «ادلب» والخدمة تعرفها «إدلب»
export function nameVariants(name) {
  const q = String(name || '').trim();
  const out = [q];
  if (/^ا/.test(q)) out.push(q.replace(/^ا/, 'إ'), q.replace(/^ا/, 'أ'));
  if (/ه$/.test(q)) out.push(q.replace(/ه$/, 'ة'));
  return [...new Set(out)];
}

export async function searchPlace(name, fetchFn = fetch) {
  const vs = nameVariants(name);
  const all = await Promise.all(vs.map((v) => get(`${GEOCODE}?name=${encodeURIComponent(v)}&count=6&language=ar`, fetchFn).catch((e) => (v === vs[0] ? Promise.reject(e) : {}))));
  const seen = new Set();
  const list = [];
  for (const d of all) {
    for (const r of d.results || []) {
      const k = `${(+r.latitude).toFixed(2)},${(+r.longitude).toFixed(2)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      list.push({ name: r.name, area: [r.admin1, r.country].filter(Boolean).join('، '), lat: r.latitude, lon: r.longitude });
    }
  }
  // الاسم المطابق أولاً، ثم الباقي بترتيب الخدمة
  const q = normAr(name);
  const rank = (x) => (normAr(x.name) === q ? 0 : 1);
  return list.map((x, i) => [x, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([x]) => x).slice(0, 8);
}

// الإنتاج الذي تسمح به الشمس الآن: القدرة المركّبة × الإشعاع ÷ 1000 × 0.75 (فواقد الحرارة والأسلاك والزاوية)
export const expectedPv = (kwp, rad) => (kwp > 0 && rad != null ? kwp * 1000 * (rad / 1000) * 0.75 : null);

/**
 * جملة الحالة الآن، مبنية على القراءة الحية والطقس معاً.
 * level: ok (طبيعي) أو info (معلومة) أو warn (يستحق الانتباه) أو bad (مشكلة)
 */
export function sceneStory(m, w, { kwp = null, lowSoc = 30 } = {}) {
  if (!m) return null;
  if (m.stale) return { level: 'bad', title: 'الإنفرتر غير متصل', text: 'لا تصل قراءات جديدة. القيم المعروضة آخر ما سُجّل.' };
  const pv = m.pvW ?? 0;
  const bat = m.batW ?? 0;
  const soc = m.soc;
  const line = /line|utility|bypass/i.test(m.mode || '');
  const night = w ? !w.isDay : pv < 20;
  const exp = w ? expectedPv(kwp, w.rad) : null;
  const w$ = (x) => fmt.w(Math.abs(x));

  if (night) {
    if (line && m.gridOn) return { level: 'info', title: 'ليل · كهرباء الشبكة تغذّي البيت', text: `الحمل ${w$(m.outW)}، والبطارية ${soc ?? '—'}% محفوظة.` };
    if (bat < -10) return { level: soc != null && soc <= lowSoc ? 'warn' : 'info', title: 'ليل · البيت على البطارية', text: `تسحب ${w$(bat)} والبطارية ${soc ?? '—'}%.${soc != null && soc <= lowSoc ? ' خفّف الأحمال.' : ''}` };
    return { level: 'info', title: 'ليل · لا إنتاج من الألواح', text: `الحمل ${w$(m.outW)}.` };
  }

  const sky = w?.sky;
  const dark = ['rain', 'storm', 'cloudy', 'fog', 'snow'].includes(sky);
  const full = soc != null && soc >= 98;

  // البطارية ممتلئة: الإنفرتر يأخذ من الألواح بقدر الحمل فقط، فالرقم المنخفض طبيعي
  if (full && bat <= 30 && (exp == null || pv < exp * 0.6)) {
    return { level: 'ok', title: 'البطارية ممتلئة', text: `الألواح تغذّي الحمل (${w$(m.outW)}) ويأخذ الإنفرتر منها بقدر الحاجة فقط. وقت مناسب للأحمال الكبيرة.` };
  }
  // طقس سيئ وإنتاج ضعيف: متوقع
  if (dark && (exp == null || pv <= exp * 1.3 + 100)) {
    return { level: 'info', title: `${SKY_AR[sky]} · إنتاج ضعيف وهذا متوقع`, text: `الألواح تنتج ${w$(pv)}${exp != null ? ` من نحو ${w$(exp)} تسمح بها السماء الآن` : ''}.${bat < -10 ? ` البطارية تكمّل الفرق بـ ${w$(bat)}.` : ''}` };
  }
  // سماء صافية وإنتاج أقل بكثير مما تسمح به الشمس، والبطارية ليست ممتلئة: يستحق الفحص
  if (!dark && exp != null && exp > 300 && pv < exp * 0.35 && !full) {
    return { level: 'warn', title: 'الشمس متاحة لكن الإنتاج منخفض', text: `الألواح تنتج ${w$(pv)} والمتوقع نحو ${w$(exp)}. افحص قاطع الألواح أو نظافتها أو ظلاً عليها.` };
  }
  if (bat < -10) return { level: 'info', title: 'الألواح لا تكفي الحمل', text: `الألواح ${w$(pv)} والحمل ${w$(m.outW)}، والبطارية تكمّل الفرق بـ ${w$(bat)}.` };
  if (bat > 10) return { level: 'ok', title: sky ? `${SKY_AR[sky]} · الألواح تشحن البطارية` : 'الألواح تشحن البطارية', text: `إنتاج ${w$(pv)}، يغذّي البيت ${w$(m.outW)} ويشحن البطارية ${w$(bat)}.` };
  if (line && m.gridOn) return { level: 'info', title: 'كهرباء الشبكة تغذّي البيت', text: `الحمل ${w$(m.outW)}.` };
  return { level: 'ok', title: sky ? `${SKY_AR[sky]} · الألواح تغذّي البيت` : 'الألواح تغذّي البيت', text: `إنتاج ${w$(pv)} والحمل ${w$(m.outW)}.` };
}

// الإشعاع الشمسي اليومي (MJ/م²) للأيام الماضية والقادمة: أساس تقدير إنتاج الألواح.
// الخدمة تتوقع حتى 16 يوماً؛ ما بعدها يُقدَّر من المتوسط وحده.
export async function fetchRadiation(lat, lon, fetchFn = fetch) {
  const q = `latitude=${lat}&longitude=${lon}&daily=shortwave_radiation_sum,temperature_2m_min&timezone=auto&past_days=14&forecast_days=16`;
  const d = await get(`${FORECAST}?${q}`, fetchFn);
  const t = d.daily?.time || [], r = d.daily?.shortwave_radiation_sum || [], tm = d.daily?.temperature_2m_min || [];
  const days = t.map((date, i) => ({ date, rad: Number.isFinite(r[i]) ? r[i] : null, tmin: Number.isFinite(tm[i]) ? tm[i] : null })).filter((x) => x.rad !== null);
  if (!days.length) throw new Error('لا توجد بيانات إشعاع من خدمة الطقس');
  return { days, at: Date.now() };
}
