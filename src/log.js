// سجل الأحداث الموحّد: كل حدث يُسجَّل مرة واحدة (انقطاع الكهرباء، الاتصال، البطارية، الأعطال، تغيير الإعدادات).
// الحدث الذي أرسل إشعاراً يبقى «غير مقروء» حتى يُفتح تبويب التنبيهات، فتظهر شارته في الشريط السفلي.
//
// قبل 3.6 كان هناك سجلان: «التنبيهات» و«الأعطال والانقطاعات»، وكثير من الأحداث يُكتب في الاثنين معاً.
// الفحص في الخلفية (Kotlin) ما زال يرسل الدفعتين منفصلتين، فنوحّدهما هنا عند الاستلام بنفس قاعدة الترحيل.

export const LOG_CAP = 400;

// الفئات بترتيب ظهور الفلاتر
export const CATS = { grid: 'الكهرباء', conn: 'الاتصال', bat: 'البطارية', fault: 'أعطال وتحذيرات', set: 'الإعدادات' };

// الحدث والتنبيه التوأم يُسجَّلان في اللحظة نفسها تقريباً (ميلي ثوانٍ في الواجهة، والوقت نفسه في Kotlin)
const TWIN_MS = 5000;

// مستوى الأهمية للأحداث القديمة: التنبيهات كانت تحمله في kind، والأعطال كانت تحمل نوعها
const OLD_LEVEL = { bad: 'bad', warn: 'warn', ok: 'ok', info: 'info', fault: 'bad', offline: 'bad', comm: 'warn', grid: 'warn', online: 'ok' };
export const levelOf = (e) => (OLD_LEVEL[e.level] ? e.level : OLD_LEVEL[e.kind] || 'info');

// الأحداث الجديدة تحمل فئتها، والقديمة تُصنَّف من عنوانها ونوعها
export function catOf(e) {
  if (CATS[e.cat]) return e.cat;
  const t = String(e.title || '');
  if (e.kind === 'info' || /إعداد/.test(t)) return 'set';
  if (/كهرباء/.test(t)) return 'grid';
  if (e.kind === 'offline' || e.kind === 'comm' || /اتصال|الخادم|غير متصل/.test(t)) return 'conn';
  if (/^البطارية (منخفضة|ممتلئة)/.test(t)) return 'bat';
  return 'fault';
}

const capLog = (list) => list.sort((a, b) => b.at - a.at).slice(0, LOG_CAP);

/**
 * يحوّل دفعة تنبيهات وأحداث إلى أحداث السجل، كل حدث مرة واحدة.
 * التنبيه الذي له حدث توأم (نفس الفئة وفي اللحظة نفسها) يحل محله، لأن نص الإشعار أوضح للمستخدم.
 */
export function toEvents(alerts = [], faults = []) {
  const events = faults.filter(Boolean).map((f) => ({ cat: catOf(f), level: levelOf(f), title: f.title, body: f.body, at: f.at, read: f.read !== false }));
  for (const a of alerts.filter(Boolean)) {
    const cat = catOf(a);
    const ev = { cat, level: levelOf(a), title: a.title, body: a.body, at: a.at, read: a.read === true };
    const i = events.findIndex((f) => !f.twin && f.cat === cat && Math.abs(f.at - a.at) <= TWIN_MS);
    if (i >= 0) events[i] = { ...ev, twin: true };
    else events.push(ev);
  }
  return capLog(events.map(({ twin, ...e }) => e));
}

// ترحيل سجلّي ما قبل 3.6 مرة واحدة. التنبيهات القديمة المقروءة تبقى مقروءة
export const migrateLog = (alerts, faults) => toEvents((alerts || []).map((a) => ({ ...a, read: a.read !== false })), faults || []);

export const addEvents = (log, events) => capLog([...events, ...log]);
