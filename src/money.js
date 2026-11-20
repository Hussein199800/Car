// سعر الكهرباء بعملة يختارها المستخدم: دولار أو ليرة سورية (أو اسم عملة يكتبه)، مع سعر صرف اختياري
// للتحويل بينهما. لا سعر افتراضي: الأرقام المالية لا تظهر إلا بعد أن يُدخل المستخدم سعره.
export const CUR = {
  USD: { label: 'دولار', sym: '$', dec: 2 },
  SYP: { label: 'ليرة سورية', sym: 'ل.س', dec: 0 },
};

// العملة المحفوظة قبل 3.14 كانت نصاً حراً: «$» أو «دولار» ← USD، و«ل.س» أو «ليرة» ← SYP
export function curCode(p = {}) {
  const c = String(p.currency || '').trim();
  if (CUR[c]) return c;
  if (/^(\$|usd|دولار)/i.test(c)) return 'USD';
  if (/^(ل\.?س|ليرة|syp|sp)/i.test(c)) return 'SYP';
  return c ? 'OTHER' : 'SYP';
}

export const curSym = (code, p = {}) => (CUR[code] ? CUR[code].sym : (String(p.currency || '').trim().replace(/^OTHER$/, '')));

export function fmtMoney(v, code) {
  if (v == null || !Number.isFinite(v)) return '—';
  const dec = code === 'USD' ? (Math.abs(v) >= 100 ? 0 : 2) : 0;
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/** كلفة كمية بالكيلوواط ساعة: بالعملة المختارة، وبالأخرى إن أُدخل سعر الصرف (ليرة لكل دولار) */
export function costOf(kwh, p = {}) {
  const price = Number(p.price);
  if (kwh == null || !Number.isFinite(kwh) || !(price > 0)) return null;
  const code = curCode(p);
  const v = kwh * price;
  const rate = Number(p.exRate);
  let alt = null;
  if (rate > 0 && code === 'USD') alt = { v: v * rate, code: 'SYP' };
  else if (rate > 0 && code === 'SYP') alt = { v: v / rate, code: 'USD' };
  return { v, code, sym: curSym(code, p), alt: alt && { ...alt, sym: CUR[alt.code].sym } };
}

/** نص قصير: «0.13 $ (≈ 1,690 ل.س)» */
export function costText(c) {
  if (!c) return '—';
  return `${fmtMoney(c.v, c.code)} ${c.sym}${c.alt ? ` (≈ ${fmtMoney(c.alt.v, c.alt.code)} ${c.alt.sym})` : ''}`;
}
