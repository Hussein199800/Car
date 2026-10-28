// ترجمة كل ما يرسله الإنفرتر إلى العربية: أسماء الحقول والقيم والوحدات

const TITLES = {
  'id': 'المعرّف',
  'timestamp': 'وقت القراءة',
  'sn': 'الرقم التسلسلي',
  'machine type': 'نوع الجهاز',
  'main cpu firmware version': 'إصدار برنامج المعالج الرئيسي',
  'secondary cpu firmware version': 'إصدار برنامج المعالج الثانوي',
  'grid voltage': 'جهد الكهرباء الوطنية',
  'grid frequency': 'تردد الكهرباء الوطنية',
  'ac input voltage': 'جهد الدخل المتردد',
  'ac input frequency': 'تردد الدخل المتردد',
  'pv1 input voltage': 'جهد الألواح ١',
  'pv2 input voltage': 'جهد الألواح ٢',
  'pv1 input current': 'تيار الألواح ١',
  'pv2 input current': 'تيار الألواح ٢',
  'pv1 charging power': 'قدرة شحن الألواح ١',
  'pv2 charging power': 'قدرة شحن الألواح ٢',
  'battery voltage': 'جهد البطارية',
  'battery capacity': 'نسبة شحن البطارية',
  'battery charging current': 'تيار شحن البطارية',
  'battery discharge current': 'تيار تفريغ البطارية',
  'battery voltage from scc': 'جهد البطارية من منظم الشحن',
  'ac output voltage': 'جهد الخرج',
  'ac output frequency': 'تردد الخرج',
  'ac output apparent power': 'القدرة الظاهرية للخرج',
  'ac output active power': 'القدرة الفعلية للخرج',
  'output load percent': 'نسبة الحمل',
  'load status': 'حالة الحمل',
  'bus voltage': 'جهد الناقل الداخلي',
  'solar feed to grid power': 'القدرة المُصدَّرة للشبكة',
  'model': 'وضع التشغيل',
  'working state': 'وضع التشغيل',
  'work mode': 'وضع التشغيل',
  'operating mode': 'وضع التشغيل',
  'total generation': 'الإنتاج الكلي',
  'today generation': 'إنتاج اليوم',
  'inverter fault': 'عطل الإنفرتر',
  'fault code': 'رمز العطل',
  'warning code': 'رمز التحذير',
  'inverter heat sink temperature': 'حرارة المبدّد الحراري',
  'heat sink temperature': 'حرارة المبدّد الحراري',
  'grid rating voltage': 'الجهد المقنّن للشبكة',
  'grid rating current': 'التيار المقنّن للشبكة',
  'battery rating voltage': 'الجهد المقنّن للبطارية',
  'ac output rating voltage': 'جهد الخرج المقنّن',
  'ac output rating current': 'تيار الخرج المقنّن',
  'ac output rating frequency': 'تردد الخرج المقنّن',
  'ac output rating apparent power': 'القدرة الظاهرية المقنّنة',
  'ac output rating active power': 'القدرة الفعلية المقنّنة',
  'battery re-charge voltage': 'جهد إعادة الشحن من الكهرباء',
  'battery recharge voltage': 'جهد إعادة الشحن من الكهرباء',
  'battery re-discharge voltage': 'جهد العودة للتفريغ',
  'battery redischarge voltage': 'جهد العودة للتفريغ',
  'battery under voltage': 'جهد انخفاض البطارية',
  'battery cut-off voltage': 'جهد فصل البطارية',
  'battery bulk voltage': 'جهد الشحن السريع',
  'battery float voltage': 'جهد الشحن العائم',
  'battery type': 'نوع البطارية',
  'max ac charging current': 'أقصى تيار شحن من الكهرباء',
  'max charging current': 'أقصى تيار شحن',
  'ac input range': 'نطاق جهد الدخل',
  'output source priority': 'أولوية مصدر الخرج',
  'charger source priority': 'أولوية مصدر الشحن',
  'parallel max num': 'أقصى عدد للأجهزة على التوازي',
  'machine model': 'طراز الجهاز',
  'output mode': 'نمط الخرج',
};

const VALUES = {
  'battery mode': 'وضع البطارية',
  'line mode': 'وضع الكهرباء الوطنية',
  'standby mode': 'وضع الاستعداد',
  'fault mode': 'وضع العطل',
  'power on mode': 'وضع بدء التشغيل',
  'bypass mode': 'وضع التمرير',
  'power saving mode': 'وضع توفير الطاقة',
  'shutdown mode': 'وضع الإيقاف',
  'off grid': 'منفصل عن الشبكة',
  'on grid': 'متصل بالشبكة',
  'hybrid': 'هجين',
  'lib': 'ليثيوم',
  'lithium': 'ليثيوم',
  'agm': 'AGM',
  'flooded': 'بطارية سائلة',
  'user': 'مخصّص',
  'ups': 'UPS (170-280 فولت)',
  'appliance': 'أجهزة منزلية (90-280 فولت)',
  'solar bat utility': 'ألواح ← بطارية ← كهرباء (SBU)',
  'solar utility bat': 'ألواح ← كهرباء ← بطارية (SUB)',
  'utility solar bat': 'كهرباء ← ألواح ← بطارية (USB)',
  'sbu priority': 'ألواح ← بطارية ← كهرباء (SBU)',
  'sub priority': 'ألواح ← كهرباء ← بطارية (SUB)',
  'utility first': 'الكهرباء أولاً',
  'solar first': 'الألواح أولاً',
  'solar + utility': 'الألواح والكهرباء معاً',
  'only solar charging permitted': 'الشحن من الألواح فقط',
  'only solar': 'الألواح فقط',
  'load on': 'الحمل يعمل',
  'load off': 'الحمل متوقف',
  'enable': 'مفعّل',
  'disable': 'معطّل',
  'enabled': 'مفعّل',
  'disabled': 'معطّل',
  'on': 'تشغيل',
  'off': 'إيقاف',
  'normal': 'طبيعي',
  'single': 'جهاز منفرد',
  'parallel': 'توازي',
};

const UNITS = {
  v: 'فولت', a: 'أمبير', w: 'واط', kw: 'كيلوواط', hz: 'هرتز', va: 'فولت أمبير',
  wh: 'واط ساعة', kwh: 'كيلوواط ساعة', '%': '%', '°c': 'م°', 'c': 'م°', 'ah': 'أمبير ساعة',
};

// قاموس كلمات احتياطي لأي حقل جديد غير معروف
const WORDS = {
  battery: 'البطارية', voltage: 'جهد', current: 'تيار', power: 'قدرة', frequency: 'تردد', grid: 'الشبكة',
  rating: 'المقنّن', output: 'الخرج', input: 'الدخل', charging: 'الشحن', charge: 'الشحن', discharge: 'التفريغ',
  max: 'أقصى', ac: 'المتردد', dc: 'المستمر', pv: 'الألواح', solar: 'الشمسية', load: 'الحمل', status: 'حالة',
  type: 'نوع', temperature: 'حرارة', fault: 'عطل', warning: 'تحذير', mode: 'وضع', total: 'الكلي', today: 'اليوم',
  generation: 'الإنتاج', energy: 'الطاقة', priority: 'أولوية', source: 'مصدر', range: 'نطاق', float: 'العائم',
  bulk: 'السريع', inverter: 'الإنفرتر', time: 'الوقت', version: 'إصدار', percent: 'نسبة', apparent: 'الظاهرية',
  active: 'الفعلية', utility: 'الكهرباء', bus: 'الناقل', feed: 'تغذية', to: 'إلى', from: 'من', setting: 'إعداد',
  number: 'رقم', cutoff: 'فصل', low: 'منخفض', high: 'مرتفع', back: 'عودة', buzzer: 'الصفارة', restart: 'إعادة تشغيل',
  overload: 'الحمل الزائد', bypass: 'التمرير', backlight: 'الإضاءة', capacity: 'سعة', parallel: 'التوازي',
};

const clean = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function trTitle(title) {
  const key = clean(title);
  if (TITLES[key]) return TITLES[key];
  const words = key.replace(/[^a-z0-9.+\- ]/g, ' ').split(' ').filter(Boolean);
  const out = words.map((w) => WORDS[w] || (/^\d/.test(w) ? w : WORDS[w.replace(/s$/, '')])).filter(Boolean);
  // نترجم فقط إن عرفنا معظم الكلمات، وإلا نعرض الاسم الأصلي بدل ترجمة مضلّلة
  return out.length >= Math.ceil(words.length * 0.6) ? out.reverse().join(' ') : String(title);
}

export function trValue(val) {
  const key = clean(val);
  return VALUES[key] || String(val ?? '');
}

export function trUnit(unit) {
  const key = clean(unit);
  return UNITS[key] ?? String(unit ?? '');
}

export const isEmptyVal = (v) => v === undefined || v === null || /^\s*-*\s*$/.test(String(v));
