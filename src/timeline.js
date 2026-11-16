// قواعد مشتركة للرسوم الزمنية وإعادة مشاهدة اليوم ومحاكاة جهاز على الحمل الحالي. لا شبكة ولا أوامر.
import { validity } from './model.js';
export const MAX_GAP_MS = 20 * 60000;
const finite = Number.isFinite;
export function timePoints(times, values, maxGap = MAX_GAP_MS) {
  const out = [];
  times.forEach((x, i) => {
    if (i && x - times[i - 1] > maxGap) out.push({ x: (x + times[i - 1]) / 2, y: null });
    out.push({ x, y: finite(values[i]) ? values[i] : null });
  });
  return out;
}
export function replayAt(samples, at, maxGap = MAX_GAP_MS) {
  let low = 0, high = samples.length - 1, i = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (samples[mid].ts <= at) { i = mid; low = mid + 1; } else high = mid - 1;
  }
  if (i < 0) return null;
  const s = samples[i], next = samples[i + 1];
  if (s.ts === at) return s;
  // لا استيفاء ولا تمديد ولا إبقاء لقيمة عبر فجوة معروفة
  if (!next || next.ts - s.ts > maxGap) return null;
  return s;
}
export function simulateDevice(m, { watts, minutes, alreadyOn = false, batteryAh, efficiency = 0.9, cutoffSoc = 20, staleMin = 15 }, now = Date.now()) {
  if (!finite(watts) || watts <= 0 || !finite(minutes) || minutes <= 0 || minutes > 1440 || efficiency <= 0 || efficiency > 1)
    return { error: 'أدخل قدرة موجبة ومدة بين 0 و1440 دقيقة وكفاءة صالحة.' };
  const energyWh = watts * minutes / 60;
  if (!m || m.stale || validity(m.ts, staleMin, now).stale || !finite(m.outW) || m.outW < 0)
    return { energyWh, unavailable: 'لا توجد قراءة حمل حديثة؛ هامش الإنفرتر وأثر البطارية غير متاحين.' };
  const addedW = alreadyOn ? 0 : watts;
  const totalW = m.outW + addedW;
  const result = { energyWh, addedWh: addedW * minutes / 60, addedW, totalW,
    headroomW: finite(m.ratedW) && m.ratedW > 0 ? m.ratedW - totalW : null,
    battery: null };
  // في وضع الشبكة لا نعرف كيف ستستجيب البطارية لحمل إضافي، فلا نقدّره
  if (!/battery/i.test(m.mode || '') || !finite(m.batW) || !finite(m.soc) || m.soc < 0 || m.soc > 100 || !(batteryAh > 0) || !(m.ratedV > 0)) return result;
  const capWh = batteryAh * m.ratedV;
  const projectedBatW = m.batW - addedW / efficiency;
  const projectedSoc = m.soc + projectedBatW * minutes / 60 / capWh * 100;
  result.battery = { projectedBatW, projectedSoc: Math.max(0, Math.min(100, projectedSoc)), extraSocDrop: addedW / efficiency * minutes / 60 / capWh * 100,
    belowReserve: projectedSoc < cutoffSoc, outsideCapacity: projectedSoc < 0 || projectedSoc > 100 };
  return result;
}
