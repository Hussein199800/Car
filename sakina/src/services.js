// منطق التطبيق المشترك: الموقع والمواقيت، الفترة الزمنية، التقدّم والعادات، جدولة التنبيهات
import { state, save, today, doneOf } from './store.js';
import { CITIES, DEFAULT_CITY } from './data/cities.js';
import { CATEGORY_BY_ID } from './data/adhkar.js';
import { computeTimes, PRAYERS } from './prayer.js';
import { ymdInTz, toHijri, addDays, dateKey } from './dates.js';
import { scheduleAll, notificationsSupported } from './native.js';

export const deviceTz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } };

export function location() {
  const l = state.settings.location;
  if (l.type === 'gps' && Number.isFinite(l.lat)) return { name: l.name || 'موقعي الحالي', lat: l.lat, lng: l.lng, tz: l.tz || deviceTz(), method: l.method || 'mwl', gps: true };
  const c = CITIES[l.cityId] || DEFAULT_CITY;
  return { name: c.name, country: c.country, lat: c.lat, lng: c.lng, tz: c.tz, method: c.method };
}

export const methodKey = () => (state.settings.method === 'auto' ? location().method : state.settings.method);

export const localToday = (now = new Date()) => ymdInTz(now, location().tz);
export const hijriOf = (g) => toHijri(g, state.settings.hijriAdjust);

export function timesFor(g) {
  const loc = location();
  return computeTimes(g, loc, { method: methodKey(), asr: state.settings.asr, ramadan: hijriOf(g).m === 9 });
}

const FIVE = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** الصلاة القادمة (من الخمس) مع وقتها، والسابقة */
export function nextPrayer(now = new Date()) {
  const g = localToday(now);
  const t = timesFor(g);
  for (const k of FIVE) if (t[k] > now) return { key: k, at: t[k], times: t, tomorrow: false };
  const t2 = timesFor(addDays(g, 1));
  return { key: 'fajr', at: t2.fajr, times: t, tomorrow: true };
}

/** فترة اليوم لتلوين السماء واقتراح الورد */
export function dayPeriod(now = new Date()) {
  const t = timesFor(localToday(now));
  if (now < t.fajr) return 'night';
  if (now < t.sunrise) return 'fajr';
  if (now < t.asr) return 'day';
  if (now < t.maghrib) return 'asr';
  if (now < new Date(t.isha.getTime() + 30 * 60000)) return 'maghrib';
  return 'night';
}

export const GREETINGS = {
  fajr: { title: 'صباح النور والسكينة', sub: 'أشرق يومك بذكر الله' },
  day: { title: 'نهارك مبارك', sub: 'ألا بذكر الله تطمئن القلوب' },
  asr: { title: 'طاب عصرك بذكر الله', sub: 'وقت أذكار المساء قد أقبل' },
  maghrib: { title: 'مساء الخير والسكينة', sub: 'أمسينا وأمسى الملك لله' },
  night: { title: 'ليلة هادئة مطمئنة', sub: 'باسمك ربي وضعت جنبي' },
};

/** الورد المقترح الآن حسب الوقت وما أُنجز */
export function suggestedWird(now = new Date()) {
  const t = timesFor(localToday(now));
  const h = today();
  if (now >= t.fajr && now < t.dhuhr) return 'morning';
  if (now >= t.dhuhr && now < t.asr) return h.m ? 'prayer' : 'morning';
  if (now >= t.asr && now < t.isha) return 'evening';
  if (now >= t.isha) return h.e ? 'sleep' : 'evening';
  return 'sleep';
}

// ---------- التقدّم ----------
export function itemsOf(catId) {
  if (catId === 'custom') return state.custom.map((c) => ({ ...c, cat: 'custom' }));
  if (catId === 'favorites') {
    return state.favorites.map((id) => {
      if (id.startsWith('custom-')) { const c = state.custom.find((x) => x.id === id); return c && { ...c, cat: 'custom' }; }
      const [cat] = id.split('-');
      return CATEGORY_BY_ID[cat] && CATEGORY_BY_ID[cat].items.find((x) => x.id === id);
    }).filter(Boolean);
  }
  return CATEGORY_BY_ID[catId] ? CATEGORY_BY_ID[catId].items : [];
}

export function catProgress(catId) {
  const items = itemsOf(catId);
  if (!items.length) return 0;
  return items.reduce((s, it) => s + Math.min(doneOf(it.id), it.n) / it.n, 0) / items.length;
}

const HABIT_FLAG = { morning: 'm', evening: 'e', prayer: 'p' };

/** تسجيل تكرار واحد لذكر. يعيد {itemDone, catDone} */
export function countOnce(item, catId) {
  const h = today();
  const done = doneOf(item.id);
  if (done >= item.n) return { itemDone: true, catDone: false, already: true };
  state.progress.counts[item.id] = done + 1;
  h.r += 1;
  const itemDone = done + 1 >= item.n;
  let catDone = false;
  if (itemDone) {
    catDone = itemsOf(catId).every((it) => doneOf(it.id) >= it.n);
    if (catDone && HABIT_FLAG[catId]) h[HABIT_FLAG[catId]] = 1;
  }
  save();
  return { itemDone, catDone };
}

export function resetCat(catId) {
  for (const it of itemsOf(catId)) delete state.progress.counts[it.id];
  save();
}

// ---------- العادات ----------
const dayRec = (k) => state.history[k] || { m: 0, e: 0, p: 0, r: 0, t: 0, pr: [0, 0, 0, 0, 0] };
export const lit = (k) => { const r = dayRec(k); return r.m || r.e ? (r.m && r.e ? 2 : 1) : 0; };

export function streak() {
  today();
  let d = new Date();
  if (!lit(dateKey(d))) d = new Date(d.getTime() - 86400000);
  let n = 0;
  while (lit(dateKey(d)) && n < 3650) { n += 1; d = new Date(d.getTime() - 86400000); }
  return n;
}

/** آخر ٧ أيام (الأقدم أولاً) */
export function lastWeek() {
  today();
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = dateKey(d);
    out.push({ key: k, date: d, rec: dayRec(k), isToday: i === 0 });
  }
  return out;
}

export const palms = () => Object.keys(state.history).filter((k) => lit(k) === 2).length;

// ---------- التنبيهات ----------
const parseTime = (s) => { const [h, m] = s.split(':').map(Number); return { hour: h || 0, minute: m || 0 }; };

export async function rescheduleNotifications() {
  if (!notificationsSupported) return;
  const n = state.settings.notif;
  const list = [];
  if (n.morning.on) list.push({ id: 1, title: 'أذكار الصباح ☀', body: 'أصبحنا وأصبح الملك لله، حان وقت وردك الصباحي', daily: parseTime(n.morning.time) });
  if (n.evening.on) list.push({ id: 2, title: 'أذكار المساء', body: 'أمسينا وأمسى الملك لله، لا تنسَ أذكار المساء', daily: parseTime(n.evening.time) });
  if (n.sleep.on) list.push({ id: 3, title: 'أذكار النوم', body: 'باسمك ربي وضعت جنبي، اختم يومك بذكر الله', daily: parseTime(n.sleep.time) });
  if (n.friday) list.push({ id: 4, title: 'جمعة مباركة', body: 'اقرأ سورة الكهف وأكثر من الصلاة على النبي ﷺ', weekly: { weekday: 6, hour: 10, minute: 0 } });
  if (n.prayers) {
    const now = new Date();
    let g = localToday(now);
    for (let day = 0; day < 6; day++) {
      const t = timesFor(g);
      FIVE.forEach((k, i) => {
        if (t[k] > now) {
          const name = PRAYERS.find((p) => p.key === k).name;
          list.push({ id: 100 + day * 10 + i, title: `حان وقت صلاة ${name}`, body: `حيّ على الصلاة، حيّ على الفلاح — ${location().name}`, at: t[k] });
        }
      });
      g = addDays(g, 1);
    }
  }
  try { await scheduleAll(list); } catch (e) { /* تجاهل أخطاء الجدولة */ }
}
