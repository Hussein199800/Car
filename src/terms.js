// المصطلحات المحلية: يختار المستخدم ما يُسمّى به الجهاز والكهرباء في بلده.
// النصوص في الكود مكتوبة بـ«الرافع» و«الكهرباء الوطنية»، وتُحوّل هنا عند العرض.

export const INV_TERMS = {
  inverter: { label: 'الإنفرتر', base: 'إنفرتر' },
  rafe: { label: 'الرافع', base: 'رافع' },
  akis: { label: 'العاكس', base: 'عاكس' },
};

export const GRID_TERMS = {
  grid: { label: 'كهرباء الشبكة', short: 'الشبكة', adj: 'الشبكة', idafa: true },
  watani: { label: 'الكهرباء الوطنية', short: 'الوطنية', adj: 'الوطنية' },
  umumia: { label: 'الكهرباء العمومية', short: 'العمومية', adj: 'العمومية' },
  hukuma: { label: 'كهرباء الحكومة', short: 'الحكومة', adj: 'الحكومة', idafa: true },
};

const AR = 'ء-ي';
// لا نغيّر «إنفرتر» بين قوسين لأنها تعني نوع المكيّفات وليس الجهاز
const INV_RE = new RegExp(`(?<![${AR}«])(لل|بال|وال|ال|ل|ب|و)?(?:رافع|إنفرتر)(ك)?(?![${AR}])`, 'g');
const GRID_RE = new RegExp(`(?<![${AR}])(لل|بال|وال|ال)كهرباء الوطنية(?![${AR}])`, 'g');
const GRID_SHORT_RE = new RegExp(`(?<![${AR}])الوطنية(?![${AR}])`, 'g');
// «كهرباء الشبكة» إضافة لا تقبل «ال» على أولها، فنحوّل السوابق
const IDAFA_PREFIX = { 'ال': '', 'لل': 'ل', 'بال': 'ب', 'وال': 'و' };

export function makeLocalizer(prefs) {
  const inv = INV_TERMS[prefs.invTerm] || INV_TERMS.inverter;
  const grid = GRID_TERMS[prefs.gridTerm] || GRID_TERMS.grid;
  return (text) => {
    if (text === null || text === undefined) return text;
    let s = String(text);
    if (inv.base !== 'رافع' || /إنفرتر/.test(s)) s = s.replace(INV_RE, (_, pre = '', suf = '') => (pre || '') + inv.base + (suf || ''));
    if (grid.adj !== 'الوطنية') {
      s = s.replace(GRID_RE, (_, pre) => (grid.idafa ? IDAFA_PREFIX[pre] : pre) + 'كهرباء ' + grid.adj);
      s = s.replace(GRID_SHORT_RE, grid.short);
    }
    return s;
  };
}
