// معالجة النص العربي: إزالة التشكيل والتطبيع للبحث، والأرقام، والتهريب

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۨ-ۭـ]/g;

export const stripTashkeel = (s) => s.replace(TASHKEEL, '');

/** تطبيع للبحث: بلا تشكيل، وتوحيد الألف والتاء المربوطة والياء */
export const normalize = (s) => stripTashkeel(s)
  .replace(/[أإآٱ]/g, 'ا')
  .replace(/ة/g, 'ه')
  .replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/[﴿﴾«»()،,.:؛!؟۝]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
let digitStyle = 'arab';
export const setDigits = (style) => { digitStyle = style; };
/** يحوّل الأرقام حسب اختيار المستخدم (هندية ٠١٢ أو عربية 012) */
export const num = (v) => (digitStyle === 'arab' ? String(v).replace(/[0-9]/g, (d) => AR_DIGITS[d]) : String(v));

export const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
