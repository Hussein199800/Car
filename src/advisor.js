// مستشار الطاقة: تحليلات وتوصيات مبنية فقط على القراءات الفعلية المسجّلة.
// كل رقم هنا إما قراءة من الجهاز أو حساب مباشر منها، ولا نعرض تقديراً كأنه قياس.
import { fmt, countAr, DAY } from './model.js';

const kwh = (v) => (v == null ? '—' : `${v.toFixed(v >= 10 ? 1 : 2)} ك.و.س`);
const pct = (v) => `${Math.round(v)}%`;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const clock = (t) => fmt.time(t);
const minutesOfDay = (t) => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
// «في 3 من 7 أيام» بصيغة صحيحة لأي عدد
const ofDays = (x, n) => `${x} من ${n === 1 ? 'يوم واحد' : n === 2 ? 'يومين' : n <= 10 ? n + ' أيام' : n + ' يوماً'}`;
const lastDays = (n) => (n === 1 ? 'آخر يوم' : 'آخر ' + countAr(n, DAY));
const hhmm = (m) => fmt.time(new Date(2000, 0, 1, Math.floor(m / 60), Math.round(m % 60)).getTime());

// يوم «كامل» = بيانات تغطي معظم ساعاته، حتى لا تُقارن أيام ناقصة بأيام كاملة
export const fullDays = (sums, todayKey) => sums.filter((s) => s && s.date < todayKey && s.count > 1 && s.coveredH >= 18);

// السعة القابلة للاستخدام بالكيلوواط ساعة: من سعة البطارية التي أدخلها المستخدم وجهدها
export const capacityKwh = (ah, volts) => (ah && volts ? (ah * volts) / 1000 : null);

export function analyze(sums, { todayKey, prefs = {}, ratedW = null, volts = null, model = null } = {}) {
  const days = fullDays(sums, todayKey);
  const n = days.length;
  const cap = capacityKwh(prefs.batteryAh, volts);
  const usable = cap ? cap * (1 - (prefs.cutoffSoc ?? 20) / 100) : null;
  const sum = (k) => days.reduce((a, s) => a + (s[k] || 0), 0);
  const indep = days.filter((s) => s.independence != null);

  const r = {
    days: n,
    independence: indep.length ? avg(indep.map((s) => s.independence)) : null,
    independenceDays: indep.map((s) => ({ date: s.date, v: s.independence })),
    avgPv: n ? sum('pvKwh') / n : null,
    avgLoad: n ? sum('loadKwh') / n : null,
    avgNight: n ? sum('nightLoadKwh') / n : null,
    solarChg: sum('solarChgKwh'),
    gridChg: sum('gridChgKwh'),
    cap, usable,
  };

  // ---------- استخدام البطارية ----------
  const dod = days.filter((s) => s.socMin != null).map((s) => s.socMax - s.socMin);
  const lowest = days.reduce((b, s) => (s.socMin != null && (!b || s.socMin < b.socMin) ? s : b), null);
  const fulls = days.filter((s) => s.fullAt);
  r.battery = {
    avgDod: avg(dod),
    lowest: lowest ? { soc: lowest.socMin, at: lowest.socMinAt, date: lowest.date } : null,
    fullDays: fulls.length,
    avgFullTime: fulls.length ? avg(fulls.map((s) => minutesOfDay(s.fullAt))) : null,
    // دورة كاملة مكافئة = تفريغ ما يعادل سعة البطارية كاملة
    cyclesPerDay: cap && n ? sum('disKwh') / n / cap : null,
    soh: model ? healthReading(model) : null,
  };

  r.tips = tips(r, days, { prefs, ratedW, model });
  return r;
}

// بعض البطاريات (عبر BMS) ترسل حالة الصحة؛ نعرضها فقط إن وُجدت فعلاً
export function healthReading(model) {
  const f = (model.raw || []).find((x) => /\bsoh\b|state of health|battery health/i.test(x.title));
  const v = f ? parseFloat(String(f.val)) : NaN;
  return Number.isFinite(v) ? v : null;
}

function tips(r, days, { prefs, ratedW, model }) {
  const out = [];
  const add = (level, title, text) => out.push({ level, title, text });
  const n = days.length;
  if (!n) return out;

  // 1) الإنتاج مقابل الاستهلاك
  if (r.avgPv != null && r.avgLoad != null && r.avgLoad > 0) {
    if (r.avgPv >= r.avgLoad) add('ok', 'الألواح تغطي استهلاكك', `متوسط إنتاجك ${kwh(r.avgPv)} يومياً مقابل استهلاك ${kwh(r.avgLoad)}.`);
    else add('warn', 'الإنتاج أقل من الاستهلاك', `متوسط إنتاجك ${kwh(r.avgPv)} يومياً واستهلاكك ${kwh(r.avgLoad)}، والفرق يأتي من كهرباء الشبكة. تقليل الاستهلاك الليلي أو زيادة الألواح يرفع استقلاليتك.`);
  }

  // 2) الشحن من الكهرباء
  if (r.gridChg >= 0.5) {
    const prio = (model?.raw || []).find((x) => /charger (source )?priority/i.test(x.title))?.val || '';
    const utilityToo = /utility|grid|mains/i.test(prio) && !/only/i.test(prio);
    add('info', 'شحن من كهرباء الشبكة', `شُحنت البطارية من الكهرباء ${kwh(r.gridChg)} خلال ${n === 1 ? 'اليوم الماضي' : lastDays(n)}، ومن الألواح ${kwh(r.solarChg)}.${utilityToo ? ' إذا كانت الشمس تكفي لشحنها، اجعل «أولوية مصدر الشحن» على الألواح أولاً من إعدادات الإنفرتر لتوفير الكهرباء.' : ''}`);
  }

  // 3) انخفاض البطارية
  const lowDays = days.filter((s) => s.socMin != null && s.socMin <= (prefs.lowSoc ?? 30));
  if (lowDays.length) {
    const l = r.battery.lowest;
    add('bad', 'البطارية تنخفض كثيراً', `وصلت البطارية إلى ${l.soc}% (${dayLabel(l.date)}${l.at ? ' الساعة ' + clock(l.at) : ''}) ونزلت تحت ${prefs.lowSoc ?? 30}% في ${ofDays(lowDays.length, n)}. خفّف الأحمال الليلية، فالتفريغ العميق المتكرر يقصّر عمر البطارية.`);
  }

  // 4) وقت امتلاء البطارية = أفضل وقت للأحمال الكبيرة
  if (r.battery.avgFullTime != null && r.battery.avgFullTime < 15 * 60) {
    add('ok', 'وقت مناسب للأحمال الكبيرة', `تمتلئ بطاريتك عادة قرابة ${hhmm(r.battery.avgFullTime)} (في ${ofDays(r.battery.fullDays, n)}). بعدها شغّل الغسالة والمضخة والمكواة والشمس موجودة لتستفيد من الفائض بدل أن يضيع.`);
  } else if (n >= 3 && r.battery.fullDays === 0) {
    add('warn', 'البطارية لا تمتلئ', `لم تصل البطارية إلى 100% في ${lastDays(n)}. الامتلاء الكامل من حين لآخر يساعد نظام إدارة بطاريات الليثيوم على موازنة الخلايا.`);
  }

  // 5) انخفاض الإنتاج مقارنة بالمعتاد
  const drop = productionDrop(days);
  if (drop) add('warn', 'انخفاض في الإنتاج', `${drop.text} إذا كان الجو صحواً فقد تحتاج الألواح إلى تنظيف أو فحص.`);

  // 6) ذروة الحمل
  if (ratedW) {
    const peaks = days.filter((s) => s.peakW != null && s.peakW >= 0.8 * ratedW);
    if (peaks.length) add('warn', 'ذروة حمل مرتفعة', `تجاوز الحمل 80% من قدرة الإنفرتر في ${ofDays(peaks.length, n)} (أعلى ذروة ${fmt.w(Math.max(...peaks.map((s) => s.peakW)))}). تجنّب تشغيل الأجهزة الكبيرة معاً.`);
  }

  // 7) الاستهلاك الليلي مقابل ما تخزنه البطارية
  if (r.usable && r.avgNight != null && r.avgNight > 0) {
    if (r.avgNight > r.usable) add('warn', 'البطارية لا تكفي الليل', `تستهلك ${kwh(r.avgNight)} يومياً حين لا تنتج الألواح، بينما تخزن بطاريتك فعلياً قرابة ${kwh(r.usable)} (حتى ${prefs.cutoffSoc ?? 20}%). الباقي يأتي من كهرباء الشبكة.`);
    else add('ok', 'البطارية تكفي الليل', `تستهلك ${kwh(r.avgNight)} حين لا تنتج الألواح، وبطاريتك تخزن قرابة ${kwh(r.usable)}، أي بهامش ${pct((1 - r.avgNight / r.usable) * 100)}.`);
  }
  return out;
}

// مقارنة أمس بمتوسط الأيام الكاملة التي قبله
export function productionDrop(days) {
  if (days.length < 4) return null;
  const last = days[days.length - 1];
  const prev = days.slice(0, -1).map((s) => s.pvKwh).filter((v) => v != null && v > 0);
  const base = avg(prev);
  if (!base || last.pvKwh == null || last.pvKwh >= 0.7 * base) return null;
  const by = (1 - last.pvKwh / base) * 100;
  // عندما تمتلئ البطارية ويقل الحمل يخفض الشاحن سحبه من الألواح، فيظهر الإنتاج أقل دون مشكلة
  const full = last.fullAt ? ` البطارية امتلأت الساعة ${clock(last.fullAt)}، وبعد الامتلاء يأخذ الشاحن من الألواح بقدر الحمل فقط، فقد يكون هذا سبب الانخفاض.` : '';
  return { by, text: `إنتاج ${dayLabel(last.date)} ${kwh(last.pvKwh)}، أقل بـ ${pct(by)} من متوسط الأيام السابقة (${kwh(base)}).${full}` };
}

const dayLabel = (date) => fmt.day(date, { weekday: 'long' });

// ---------- أسئلة عن منظومتك: أجوبة من القراءات الفعلية ----------
export function answers(r, model, { todayKey, sums = [] } = {}) {
  const out = [];
  const days = fullDays(sums, todayKey);
  const todaySum = sums.find((s) => s?.date === todayKey);

  // لماذا انخفض الإنتاج؟
  {
    const d = productionDrop(days);
    let a = d ? d.text + ' أسباب أخرى شائعة: الغيوم والغبار، أو ظل على جزء من الألواح.' : days.length >= 4
      ? `لا يوجد انخفاض واضح: إنتاج آخر يوم كامل ${kwh(days[days.length - 1].pvKwh)} ومتوسط الأيام السابقة ${kwh(avg(days.slice(0, -1).map((s) => s.pvKwh).filter((v) => v != null)))}.`
      : 'نحتاج أربعة أيام كاملة على الأقل من البيانات للمقارنة.';
    if (model && !model.stale && model.pv1W > 100 && model.pv2V != null && model.pv2V > 30 && !model.pv2W) a += ' ملاحظة الآن: المدخل الأول ينتج والمدخل الثاني عليه جهد لكنه لا ينتج — افحص توصيلاته.';
    if (todaySum?.count > 1) a += ` إنتاج اليوم حتى الآن ${kwh(todaySum.pvKwh)}.`;
    out.push({ q: 'لماذا انخفض الإنتاج؟', a });
  }

  // هل البطارية تعمل بكفاءة؟
  {
    const b = r.battery;
    const parts = [];
    if (b.soh != null) parts.push(`البطارية ترسل حالة صحة (SOH) ${b.soh}%.`);
    if (b.avgDod != null) parts.push(`متوسط عمق التفريغ اليومي ${pct(b.avgDod)}.`);
    if (b.lowest) parts.push(`أدنى نسبة في الفترة ${b.lowest.soc}%.`);
    if (r.days) parts.push(`امتلأت إلى 100% في ${ofDays(b.fullDays, r.days)}.`);
    if (b.cyclesPerDay != null) parts.push(`تقوم بقرابة ${b.cyclesPerDay.toFixed(2)} دورة كاملة يومياً (محسوبة من طاقة التفريغ وسعة البطارية التي أدخلتها).`);
    if (b.soh == null) parts.push('الإنفرتر لا يرسل حالة صحة البطارية، لذلك لا يمكن قياس نسبة التدهور بدقة من التطبيق. علامات تستحق الانتباه: انخفاض النسبة بسرعة أكبر من المعتاد بنفس الحمل، أو هبوط كبير في الجهد عند تشغيل حمل كبير.');
    out.push({ q: 'هل البطارية تعمل بكفاءة؟', a: parts.join(' ') || 'لا توجد بيانات كافية بعد.' });
  }

  // ما سبب ارتفاع الحرارة؟
  {
    const t = model?.temps || [];
    let a;
    if (!t.length) a = 'جهازك لا يرسل قراءات الحرارة إلى خادم WatchPower، لذلك لا يمكن متابعتها من التطبيق. تأكد بنفسك من تهوية الإنفرتر وأن مراوحه تعمل، وأن البطارية بعيدة عن الشمس المباشرة.';
    else {
      a = `القراءات الآن: ${t.map((x) => `${x.ar} ${x.v}°`).join('، ')}.`;
      if (model.loadPct != null) a += ` الحمل ${model.loadPct}% من قدرة الإنفرتر${model.loadPct >= 70 ? '، وهو مرتفع ويرفع الحرارة' : ''}.`;
      if (model.batW != null && model.batW > 1500) a += ' البطارية تُشحن بقدرة عالية الآن، والشحن السريع يرفع حرارتها.';
      a += ' أسباب شائعة أخرى: ضعف التهوية حول الجهاز، أو غبار على فتحات التبريد، أو حرارة الغرفة.';
    }
    out.push({ q: 'ما سبب ارتفاع الحرارة؟', a });
  }

  // هل الألواح كافية؟
  out.push({ q: 'هل الألواح كافية لاستهلاكي؟', a: r.avgPv != null && r.avgLoad != null
    ? (r.avgPv >= r.avgLoad
      ? `نعم في المتوسط: تنتج ${kwh(r.avgPv)} وتستهلك ${kwh(r.avgLoad)} يومياً.`
      : `ليس بالكامل: تنتج ${kwh(r.avgPv)} وتستهلك ${kwh(r.avgLoad)} يومياً. تحتاج قرابة ${kwh(r.avgLoad - r.avgPv)} إضافية يومياً؛ استخدم «حاسبة الأحمال» لتقدير الألواح المطلوبة.`)
    : 'لا توجد أيام كاملة كافية بعد.' });

  // متى أشغّل الأحمال الكبيرة؟
  out.push({ q: 'متى أشغّل الأحمال الكبيرة؟', a: r.battery.avgFullTime != null
    ? `بعد امتلاء البطارية — قرابة ${hhmm(r.battery.avgFullTime)} حسب أيامك الأخيرة — وما دامت الشمس قوية، حتى يأتي الحمل من الألواح لا من البطارية.`
    : 'بطاريتك لم تمتلئ في الأيام الأخيرة؛ شغّل الأحمال الكبيرة وقت ذروة الشمس (عادة بين 11 و2 ظهراً) واحداً تلو الآخر.' });
  return out;
}

// ---------- رسالة الحالة عند فتح التطبيق: سطر واحد يصف أهم ما يحدث الآن ----------
export function openingNotice(m, prefs = {}) {
  if (!m || m.stale || m.fault) return null;
  const w = (v) => fmt.w(Math.abs(v));
  const chg = m.batW != null && m.batW > 30;
  const dis = m.batW != null && m.batW < -30;
  const pv = (m.pvW ?? 0) > 30;
  const line = /line|utility|bypass/i.test(m.mode || '');
  if (m.loadPct != null && m.loadPct >= (prefs.overloadPct ?? 80)) return { kind: 'bad', text: `حمل البيت مرتفع: ${m.loadPct}% (${w(m.outW)})` };
  if (line && m.gridOn) {
    if (!chg) return { kind: 'info', text: `كهرباء الشبكة تغذّي البيت بـ ${w(m.outW)}` };
    return { kind: 'info', text: pv ? 'كهرباء الشبكة تغذّي البيت والألواح تشحن البطارية' : `كهرباء الشبكة تغذّي البيت وتشحن البطارية (${fmt.pct(m.soc ?? '—')})` };
  }
  if (pv && chg) return { kind: 'ok', text: (m.outW ?? 0) > 30 ? `الألواح تغذّي البيت وتشحن البطارية بـ ${w(m.batW)}` : `الألواح تشحن البطارية بـ ${w(m.batW)}` };
  if (pv && !dis) return { kind: 'ok', text: `الألواح تغذّي البيت بـ ${w(m.pvW)}` };
  if (dis) return { kind: m.soc != null && m.soc <= (prefs.lowSoc ?? 30) ? 'warn' : 'info', text: `البيت يعمل على البطارية (${fmt.pct(m.soc ?? '—')}) بسحب ${w(m.batW)}` };
  if (m.outW != null) return { kind: 'info', text: `الإنفرتر يعمل والحمل ${w(m.outW)}` };
  return null;
}
