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
