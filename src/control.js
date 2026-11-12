// التحكم بأولوية مصدر الخرج: قراءة الوضع من الجهاز، تغييره بطلب صريح من المستخدم، ثم التحقق
// بقراءة الإعداد من الجهاز نفسه. إرسال الأمر لا يُعدّ نجاحاً؛ النجاح هو أن يعيد الجهاز القيمة المطلوبة.
// لا يلمس هذا الملف أي إعداد آخر (خصوصاً أولوية الشحن)، ولا يرسل شيئاً من تلقاء نفسه.

const norm = (s) => String(s ?? '').trim().toLowerCase();

export const isOutputPriority = (name) => /output (source )?priority/i.test(name || '');
export const isChargerPriority = (name) => /charger (source )?priority|charging (source )?priority/i.test(name || '');

export const findField = (fields, test) => (fields || []).find((f) => test(f.name) && (f.item || []).length > 1) || null;

const SRC = { S: 'الألواح', B: 'البطارية', U: 'الشبكة' };

/**
 * ترتيب المصادر لخيار كما يسمّيه الجهاز. نعيد null إن لم نتعرّف عليه بثقة، فيُعرض نصه الأصلي بلا تفسير.
 * الترتيب هنا هو المتعارف عليه في هذه العائلة من الإنفرترات، ويبقى على المستخدم تأكيده على جهازه.
 */
export function orderOf(label) {
  const t = norm(label).replace(/[^a-z]+/g, ' ').trim();
  const words = t.split(' ');
  const code = (c) => ({ code: c, order: [...c].map((x) => SRC[x]) });
  if (/^(sbu|sub|usb)$/.test(t)) return code(t.toUpperCase());
  // «Solar Bat Utility» أو «Solar Utility Bat»: أول حرف من كل مصدر بترتيب وروده
  const letters = words.map((w) => (/^sol|^pv/.test(w) ? 'S' : /^bat/.test(w) ? 'B' : /^uti|^grid|^line|^mains/.test(w) ? 'U' : '')).join('');
  if (/^(SBU|SUB|USB)$/.test(letters)) return code(letters);
  if (/^(uti|utility|grid) first$/.test(t) || t === 'utility') return code('USB');
  if (/^(solar|pv) first$/.test(t)) return code('SUB');
  if (/^sbu priority$/.test(t)) return code('SBU');
  return null;
}

// يطابق القيمة المقروءة من الجهاز مع أحد الخيارات: بالمفتاح أو بالنص
export function matchItem(items, val) {
  if (val === null || val === undefined || val === '') return null;
  return (items || []).find((it) => norm(it.key) === norm(val) || norm(it.val) === norm(val)) || null;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * يرسل الوضع المطلوب ثم يتحقق بقراءة الإعداد من الجهاز.
 * النتيجة: confirmed (الجهاز يعيد الوضع المطلوب)، unconfirmed (أُرسل الأمر ولم يتأكد خلال المهلة)،
 * rejected (رفضه الخادم أو الجهاز)، same (الوضع المطلوب هو الحالي أصلاً)، error (تعذّرت القراءة قبل الإرسال).
 */
export async function changeAndVerify({ read, send, items, key, tries = 4, delayMs = 4000, sleep = wait }) {
  const target = (items || []).find((it) => String(it.key) === String(key));
  if (!target) return { status: 'error', error: 'خيار غير معروف' };
  let before;
  try { before = matchItem(items, await read()); } catch (e) { return { status: 'error', error: e.message, target }; }
  // لا نرسل أمراً ونحن لا نعرف الوضع الحالي: قد نغيّر ما لا نقصده
  if (!before) return { status: 'error', error: 'تعذّرت قراءة الوضع الحالي من الجهاز', target };
  if (String(before.key) === String(target.key)) return { status: 'same', before, after: before, target };
  try { await send(target.key); } catch (e) { return { status: 'rejected', error: e.message, before, target }; }
  let after = null, lastErr = null;
  for (let i = 0; i < tries; i++) {
    await sleep(delayMs);
    try {
      after = matchItem(items, await read());
      lastErr = null;
      if (after && String(after.key) === String(target.key)) return { status: 'confirmed', before, after, target, checks: i + 1 };
    } catch (e) { lastErr = e.message; }
  }
  return { status: 'unconfirmed', before, after, target, error: lastErr, checks: tries };
}

// سجل التحويلات: الأحدث أولاً، بحد أقصى ثابت
export const CTL_LOG_MAX = 100;
export function addLog(log, entry) {
  return [entry, ...(log || [])].slice(0, CTL_LOG_MAX);
}

// ===== الجدولة: نفس منطق ControlEngine.kt (للعرض والتحقق في الواجهة؛ التنفيذ في أندرويد) =====
export const SYRIA_OFFSET_MIN = 180;          // سوريا: UTC+3 طوال السنة
const DAYMS = 864e5;
export const DAY_NAMES = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAY_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

export const localDay = (t, off = SYRIA_OFFSET_MIN) => Math.floor((t + off * 60000) / DAYMS);
export const localMin = (t, off = SYRIA_OFFSET_MIN) => (((Math.floor(t / 60000) + off) % 1440) + 1440) % 1440;
export const weekday = (day) => (((day + 4) % 7) + 7) % 7;
export const dateOf = (day) => new Date(day * DAYMS).toISOString().slice(0, 10);
export const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const toMin = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

const startsOn = (s, day) => (s.date ? s.date === dateOf(day) : (s.days || []).includes(weekday(day)));

export function activeSlot(t, slots, off = SYRIA_OFFSET_MIN) {
  const day = localDay(t, off), m = localMin(t, off);
  return (slots || []).find((s) => s.startMin !== s.endMin && (s.startMin < s.endMin
    ? startsOn(s, day) && m >= s.startMin && m < s.endMin
    : (startsOn(s, day) && m >= s.startMin) || (startsOn(s, day - 1) && m < s.endMin))) || null;
}

/** الموعد التالي بعد t: {at, key} حيث key الوضع المطلوب بعده؛ أو null بلا قواعد */
export function nextSwitch(t, slots, defaultKey, off = SYRIA_OFFSET_MIN) {
  const d0 = localDay(t, off);
  let best = null;
  for (let k = -1; k <= 8; k++) {
    const day = d0 + k, base = day * DAYMS - off * 60000;
    for (const s of slots || []) {
      if (s.startMin === s.endMin || !startsOn(s, day)) continue;
      for (const at of [base + s.startMin * 60000, base + (s.endMin > s.startMin ? s.endMin : s.endMin + 1440) * 60000]) {
        if (at > t && (!best || at < best.at)) best = { at };
      }
    }
  }
  if (!best) return null;
  return { at: best.at, key: activeSlot(best.at, slots, off)?.key ?? defaultKey };
}

/** قاعدتان تتداخلان في أي دقيقة من الأسبوع (أو في تاريخ محدد): أول تعارض أو null */
export function overlap(slots) {
  const covers = (s, day, m) => s.startMin !== s.endMin && (s.startMin < s.endMin
    ? startsOn(s, day) && m >= s.startMin && m < s.endMin
    : (startsOn(s, day) && m >= s.startMin) || (startsOn(s, day - 1) && m < s.endMin));
  // أسبوعان يكفيان لأي قاعدة أسبوعية؛ ونضيف أيام القواعد المحددة بتاريخ
  const ref = Math.floor(Date.now() / DAYMS);
  const days = new Set(Array.from({ length: 15 }, (_, i) => ref + i));
  (slots || []).forEach((s) => { if (s.date) { const d = Math.floor(Date.parse(s.date + 'T00:00:00Z') / DAYMS); days.add(d); days.add(d + 1); } });
  for (const day of days) {
    for (let m = 0; m < 1440; m += 5) {
      const hit = (slots || []).map((s, i) => (covers(s, day, m) ? i : -1)).filter((i) => i >= 0);
      if (hit.length > 1) return { a: hit[0], b: hit[1], day, m };
    }
  }
  return null;
}
