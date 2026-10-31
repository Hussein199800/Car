// نسبة التغيّر في التقرير الأسبوعي والشهري: نقارن الأيام المكتملة فقط بنفس عددها من الفترة السابقة،
// لأن اليوم الجاري ناقص دائماً فيُظلم الفترة الحالية لو دخل في المقارنة.
import { addDays } from './data.js';

const p2 = (x) => String(x).padStart(2, '0');

/**
 * dates: أيام الفترة المعروضة (YYYY-MM-DD)، والشهر يبدأ دائماً من يومه الأول.
 * الأسبوع: كل يوم مكتمل يقابله اليوم نفسه من الأسبوع السابق.
 * الشهر: أول N يوماً من الشهر السابق، وN عدد الأيام المكتملة (ولا يتجاوز طول الشهر السابق).
 */
export function trendDates(kind, dates, todayKey) {
  const done = dates.filter((d) => d < todayKey);
  if (!done.length) return { cur: [], prev: [] };
  if (kind === 'week') return { cur: done, prev: done.map((d) => addDays(d, -7)) };
  const [y, m] = done[0].split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const n = Math.min(done.length, new Date(py, pm, 0).getDate());
  return { cur: done.slice(0, n), prev: Array.from({ length: n }, (_, i) => `${py}-${p2(pm)}-${p2(i + 1)}`) };
}

// better: «up» الزيادة أفضل (الإنتاج)، «down» النقص أفضل (الاستهلاك)
export function change(cur, prev, better = 'up') {
  if (cur == null || !prev) return null;
  const pct = ((cur - prev) / prev) * 100;
  if (!Number.isFinite(pct)) return null;
  const flat = Math.abs(pct) < 1;
  return {
    pct,
    cls: flat ? '' : (pct > 0) === (better === 'up') ? 'good' : 'bad',
    text: `${flat ? '' : pct > 0 ? '▲ ' : '▼ '}${Math.abs(pct).toFixed(0)}%`,
  };
}
