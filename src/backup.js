// النسخة الاحتياطية: ملف مشفّر برمز يختاره المستخدم، يعيد الحساب والإعدادات بعد حذف التطبيق.
// لا يحتوي كلمة المرور نفسها، بل بصمتها (SHA-1) التي يستخدمها التطبيق للدخول.
// التشفير AES-256-GCM بمفتاح مشتق من الرمز عبر PBKDF2-SHA256، وكل ذلك داخل الهاتف.
const FORMAT = 'taqati-backup';
const ITER = 310000;
export const MIN_CODE = 6;

export class BackupError extends Error {}

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function keyFrom(code, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptBackup(payload, code) {
  if (String(code || '').length < MIN_CODE) throw new BackupError(`الرمز يجب أن يكون ${MIN_CODE} أحرف أو أرقام على الأقل`);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFrom(code, salt, ITER);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return JSON.stringify({ format: FORMAT, v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

export async function decryptBackup(text, code) {
  let f;
  try { f = JSON.parse(text); } catch { f = null; }
  if (!f || f.format !== FORMAT || !f.salt || !f.iv || !f.data) throw new BackupError('هذا الملف ليس نسخة احتياطية من «طاقتي»');
  if (f.v !== 1) throw new BackupError('النسخة الاحتياطية من إصدار أحدث، حدّث التطبيق أولاً');
  const iter = Number(f.iter);
  if (!Number.isInteger(iter) || iter < 100000 || iter > 5e6) throw new BackupError('ملف النسخة الاحتياطية تالف');
  let plain;
  try {
    const key = await keyFrom(String(code || ''), unb64(f.salt), iter);
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(f.iv) }, key, unb64(f.data));
  } catch {
    // GCM يرفض أي رمز خاطئ أو تعديل في الملف، ولا يمكن التمييز بينهما
    throw new BackupError('الرمز غير صحيح أو الملف تالف');
  }
  const p = JSON.parse(new TextDecoder().decode(plain));
  if (p?.app !== 'taqati' || !p.account?.usr || !/^[0-9a-f]{40}$/.test(p.account.pwdHash || '')) throw new BackupError('محتوى النسخة الاحتياطية غير صالح');
  return p;
}

export function makePayload({ session, prefs, calc, devSn }) {
  return {
    app: 'taqati', v: 1, at: Date.now(),
    account: { usr: session.usr, pwdHash: session.pwdHash, profile: session.profile },
    prefs, calc, devSn,
  };
}

// لا نقبل من الملف إلا المفاتيح المعروفة وبنفس نوع القيمة الافتراضية
export function pickKnown(defaults, obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, d] of Object.entries(defaults)) {
    const v = obj[k];
    if (v === undefined) continue;
    if (d === null ? v === null || typeof v === 'number' : typeof v === typeof d) out[k] = v;
  }
  return out;
}

export const backupName = (t = Date.now()) => {
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `taqati-backup-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
};

// حدود القيم الرقمية كما في حقول الإعدادات، حتى لا يضبط ملف معدَّل قيماً تضر التطبيق
export const PREF_RANGES = { lowSoc: [5, 90], overloadPct: [30, 120], batteryAh: [10, 5000], cutoffSoc: [0, 60], pollSec: [10, 600], staleMin: [5, 180] };

export function cleanPrefs(defaults, obj) {
  const p = pickKnown(defaults, obj);
  for (const [k, [lo, hi]] of Object.entries(PREF_RANGES)) {
    if (typeof p[k] !== 'number') continue;
    if (!Number.isFinite(p[k])) delete p[k];
    else p[k] = Math.min(hi, Math.max(lo, p[k]));
  }
  return p;
}

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampNum = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

// أجهزة الحاسبة: نعيد بناء كل عنصر من حقول معروفة فقط
export function cleanLoads(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 100).filter((it) => it && typeof it === 'object').map((it) => ({
    id: str(it.id, 20) || 'custom', e: str(it.e, 8), name: str(it.name, 60) || 'جهاز',
    w: clampNum(it.w, 1, 100000, 100), qty: Math.round(clampNum(it.qty, 1, 100, 1)), hours: clampNum(it.hours, 0, 24, 4),
    ...(Number.isFinite(it.surge) ? { surge: clampNum(it.surge, 1, 10, 1) } : {}),
    ...(Number.isFinite(it.duty) ? { duty: clampNum(it.duty, 0.05, 1, 1) } : {}),
    ...(it.kind === 'motor' || it.kind === 'res' ? { kind: it.kind } : {}),
  }));
}

const CALC_RANGES = { eff: [70, 99], sunH: [2, 9], backupH: [1, 48], input: [0, 1e6], acV: [100, 260], sysV: [12, 96] };
export function cleanCalc(defaults, obj) {
  const c = pickKnown(defaults, obj);
  for (const [k, [lo, hi]] of Object.entries(CALC_RANGES)) if (typeof c[k] === 'number') c[k] = clampNum(c[k], lo, hi, defaults[k]);
  if (!['ac', 'w', 'dc'].includes(c.mode)) delete c.mode;
  if (!['res', 'motor'].includes(c.kind)) delete c.kind;
  if (!['conv', 'list'].includes(c.tab)) delete c.tab;
  c.list = cleanLoads(obj?.list);
  return c;
}
