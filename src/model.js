// تحويل قراءات الإنفرتر الخام إلى نموذج موحّد + ترجمة عربية

const AR = {
  'grid voltage': 'جهد الكهرباء الوطنية',
  'grid frequency': 'تردد الكهرباء الوطنية',
  'pv1 input voltage': 'جهد الألواح 1',
  'pv2 input voltage': 'جهد الألواح 2',
  'pv1 input current': 'تيار الألواح 1',
  'pv2 input current': 'تيار الألواح 2',
  'pv1 charging power': 'قدرة شحن الألواح 1',
  'pv2 charging power': 'قدرة شحن الألواح 2',
  'battery voltage': 'جهد البطارية',
  'battery capacity': 'نسبة شحن البطارية',
  'battery charging current': 'تيار شحن البطارية',
  'battery discharge current': 'تيار تفريغ البطارية',
  'ac output voltage': 'جهد الخرج',
  'ac output frequency': 'تردد الخرج',
  'ac output apparent power': 'القدرة الظاهرية للخرج',
  'ac output active power': 'القدرة الفعلية للخرج',
  'output load percent': 'نسبة الحمل',
  'timestamp': 'الوقت',
  'sn': 'الرقم التسلسلي',
  'machine type': 'نوع الجهاز',
  'main cpu firmware version': 'إصدار المعالج الرئيسي',
  'secondary cpu firmware version': 'إصدار المعالج الثانوي',
  'working state': 'وضع التشغيل',
  'work mode': 'وضع التشغيل',
  'operating mode': 'وضع التشغيل',
  'bus voltage': 'جهد الناقل',
  'inverter heat sink temperature': 'حرارة المبدد',
  'heat sink temperature': 'حرارة المبدد',
  'output source priority': 'أولوية الخرج',
  'charger source priority': 'أولوية الشحن',
  'today generation': 'إنتاج اليوم',
  'total generation': 'الإنتاج الكلي',
};

const MODE_AR = {
  'battery mode': 'وضع البطارية',
  'line mode': 'وضع الكهرباء الوطنية',
  'standby mode': 'وضع الاستعداد',
  'fault mode': 'وضع العطل',
  'power on mode': 'وضع التشغيل',
  'bypass mode': 'وضع التمرير',
  'power saving mode': 'وضع توفير الطاقة',
};

export function arTitle(title) {
  const key = String(title || '').trim().toLowerCase();
  return AR[key] || MODE_AR[key] || title;
}

export function arMode(mode) {
  const key = String(mode || '').trim().toLowerCase();
  return MODE_AR[key] || mode || '—';
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// يبحث عن أول حقل يطابق أحد الأنماط
function pick(map, ...patterns) {
  for (const re of patterns) {
    for (const [k, v] of map) if (re.test(k)) return v;
  }
  return undefined;
}

export function normalize(points) {
  const map = new Map();
  for (const p of points) map.set(String(p.title || '').toLowerCase(), p);
  const n = (...re) => num(pick(map, ...re)?.val);

  const pv1W = n(/^pv1 charging power/, /^pv1 .*power/, /^pv charging power/, /^pv input power/) ?? 0;
  const pv2W = n(/^pv2 charging power/, /^pv2 .*power/) ?? 0;
  const pv1V = n(/^pv1 input voltage/, /^pv input voltage/, /^pv1 voltage/) ?? 0;
  const pv2V = n(/^pv2 input voltage/, /^pv2 voltage/) ?? 0;
  const batV = n(/^battery voltage/) ?? 0;
  const chgA = n(/^battery charging current/) ?? 0;
  const disA = n(/^battery discharg/) ?? 0;
  const outW = n(/output active power/, /^load .*power/) ?? 0;
  const gridV = n(/^grid voltage/, /^ac input voltage/) ?? 0;

  let mode = pick(map, /working state/, /work mode/, /operating mode/, /^mode$/, / mode$/)?.val;
  if (!mode || num(mode) !== null) {
    if (disA > 0 || (gridV < 90 && outW > 0)) mode = 'Battery Mode';
    else if (gridV >= 90) mode = 'Line Mode';
    else mode = 'Standby Mode';
  }

  const batW = Math.round(batV * (chgA - disA));
  const pvW = pv1W + pv2W;
  // تقدير قدرة الشبكة: ما يتبقى من الحمل والشحن بعد الألواح والبطارية
  const gridW = /line|bypass/i.test(mode) ? Math.max(0, Math.round(outW + Math.max(0, batW) - pvW - Math.max(0, -batW))) : 0;

  return {
    mode,
    grid: { v: gridV, hz: n(/^grid frequency/, /^ac input frequency/) ?? 0, w: gridW },
    pv: { v: Math.max(pv1V, pv2V), w: pvW, v1: pv1V, v2: pv2V, w1: pv1W, w2: pv2W },
    battery: { v: batV, soc: n(/^battery capacity/, /^soc/, /state of charge/) ?? 0, chgA, disA, w: batW },
    load: {
      v: n(/^ac output voltage/, /^ac1 output voltage/, /^output voltage/) ?? 0,
      hz: n(/^ac output frequency/, /^ac1 output frequency/, /^output frequency/) ?? 0,
      w: outW,
      va: n(/apparent power/) ?? 0,
      pct: n(/load percent/) ?? 0,
    },
    temp: n(/temperature/),
    raw: points,
  };
}

// بيانات تجريبية واقعية مبنية على قراءات جهازك (Master 7KW)
export function demoPoints(t = Date.now()) {
  const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
  const jitter = (a) => (Math.random() - 0.5) * a;
  const pvW = Math.round(sun * 4200 + (sun ? jitter(150) : 0));
  const load = Math.round(380 + 250 * Math.max(0, Math.sin(((h - 15) / 8) * Math.PI)) + jitter(40));
  const soc = Math.round(Math.min(100, Math.max(20, 55 + 40 * sun - (h > 18 || h < 6 ? 10 : 0))));
  const batV = +(48.5 + soc * 0.055).toFixed(1);
  const net = pvW - load;
  const chg = net > 0 ? Math.round(net / batV) : 0;
  const dis = net < 0 ? Math.round(-net / batV) : 0;
  const pts = [
    ['Grid Voltage', (230 + jitter(2)).toFixed(1), 'V'],
    ['Grid Frequency', (50 + jitter(0.2)).toFixed(1), 'Hz'],
    ['PV1 Input Voltage', (sun ? 280 + jitter(20) : 0).toFixed(1), 'V'],
    ['PV1 Charging Power', pvW, 'W'],
    ['Battery Voltage', batV, 'V'],
    ['Battery Capacity', soc, '%'],
    ['Battery Charging Current', chg, 'A'],
    ['Battery Discharge Current', dis, 'A'],
    ['AC Output Voltage', '230.0', 'V'],
    ['AC Output Frequency', '50.0', 'Hz'],
    ['AC Output Apparent Power', Math.round(load * 1.3), 'VA'],
    ['AC Output Active Power', load, 'W'],
    ['Output Load Percent', Math.round((load / 6500) * 100), '%'],
  ];
  return pts.map(([title, val, unit]) => ({ title, val: String(val), unit }));
}

export function demoHistory(date) {
  const titles = ['Timestamp', 'PV1 Charging Power', 'Battery Voltage', 'Battery Capacity', 'AC Output Active Power', 'Grid Voltage'];
  const rows = [];
  const base = new Date(date + 'T00:00:00').getTime();
  const end = Math.min(base + 864e5, Date.now());
  for (let t = base; t <= end; t += 5 * 60000) {
    const p = Object.fromEntries(demoPoints(t).map((x) => [x.title, x.val]));
    const d = new Date(t);
    const ts = `${date} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;
    rows.push([ts, p['PV1 Charging Power'], p['Battery Voltage'], p['Battery Capacity'], p['AC Output Active Power'], p['Grid Voltage']]);
  }
  return { titles, rows };
}

// تحويل سجل اليوم إلى سلاسل للرسم
export function historySeries({ titles, rows }) {
  const idx = (re) => titles.findIndex((t) => re.test(String(t).toLowerCase()));
  const it = idx(/timestamp|time/);
  const cols = {
    pv: titles.map((t, i) => (/pv\d? (charging|input) power|pv\d? power/i.test(t) ? i : -1)).filter((i) => i >= 0),
    load: idx(/output active power/),
    soc: idx(/battery capacity|soc/),
    batV: idx(/battery voltage/),
    gridV: idx(/grid voltage/),
  };
  const out = { t: [], pv: [], load: [], soc: [], batV: [], gridV: [] };
  const sorted = [...rows].sort((a, b) => String(a[it]).localeCompare(String(b[it])));
  for (const r of sorted) {
    const ts = String(r[it] || '');
    out.t.push(ts.slice(11, 16) || ts);
    out.pv.push(cols.pv.length ? cols.pv.reduce((s, i) => s + (num(r[i]) || 0), 0) : null);
    out.load.push(cols.load >= 0 ? num(r[cols.load]) : null);
    out.soc.push(cols.soc >= 0 ? num(r[cols.soc]) : null);
    out.batV.push(cols.batV >= 0 ? num(r[cols.batV]) : null);
    out.gridV.push(cols.gridV >= 0 ? num(r[cols.gridV]) : null);
  }
  // الطاقة اليومية (kWh) بالتكامل على الفترات الزمنية
  const energy = (arr) => {
    let wh = 0;
    for (let i = 1; i < sorted.length; i++) {
      const dt = (Date.parse(String(sorted[i][it]).replace(' ', 'T')) - Date.parse(String(sorted[i - 1][it]).replace(' ', 'T'))) / 36e5;
      if (dt > 0 && dt < 1 && arr[i] != null) wh += arr[i] * dt;
    }
    return wh / 1000;
  };
  out.pvKwh = energy(out.pv);
  out.loadKwh = energy(out.load);
  return out;
}

export const fmt = {
  w: (w) => (Math.abs(w) >= 1000 ? (w / 1000).toFixed(2) + ' كيلوواط' : Math.round(w) + ' واط'),
  wShort: (w) => (Math.abs(w) >= 1000 ? (w / 1000).toFixed(1) + 'kW' : Math.round(w) + 'W'),
  hours: (h) => {
    if (!Number.isFinite(h) || h <= 0) return '—';
    if (h > 99) return 'أكثر من 99 ساعة';
    const hh = Math.floor(h);
    const mm = Math.round((h - hh) * 60);
    return hh ? `${hh} ساعة${mm ? ' و' + mm + ' دقيقة' : ''}` : `${mm} دقيقة`;
  },
};
