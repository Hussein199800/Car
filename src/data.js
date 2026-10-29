// التخزين المحلي، تسجيل القراءات، ملخصات الأيام، والتصدير
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { gridPresent } from './model.js';

const P = 'taqati.';
export const store = {
  get(k, d) {
    try { const v = localStorage.getItem(P + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(P + k); } catch { /* تجاهل */ } },
  keys(prefix) {
    const out = [];
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith(P + prefix)) out.push(k.slice(P.length)); } } catch { /* تجاهل */ }
    return out;
  },
};

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const today = (offset = 0) => dayKey(Date.now() + offset * 864e5);
export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dayKey(d.getTime());
}

// ---------- تسجيل القراءات محلياً (يعمل كاحتياط عند تعذّر سجل الخادم) ----------
const REC_FIELDS = ['ts', 'pvW', 'outW', 'soc', 'batV', 'gridV', 'batW', 'todayWh', 'mode', 'gridRatedV'];
const KEEP_DAYS = 62;

export function recordSample(sn, s) {
  if (!s.ts || s.stale) return;
  const key = `rec.${sn}.${dayKey(s.ts)}`;
  const rows = store.get(key, []);
  if (rows.length && rows[rows.length - 1][0] >= s.ts) return; // نفس القراءة سبق تسجيلها
  rows.push(REC_FIELDS.map((f) => s[f] ?? null));
  if (!store.set(key, rows)) { pruneRecords(sn, 20); store.set(key, rows); }
  if (Math.random() < 0.02) pruneRecords(sn, KEEP_DAYS);
}

export function localDay(sn, date) {
  return store.get(`rec.${sn}.${date}`, []).map((r) => Object.fromEntries(REC_FIELDS.map((f, i) => [f, r[i]])));
}

function pruneRecords(sn, keepDays) {
  const cutoff = today(-keepDays);
  store.keys(`rec.${sn}.`).forEach((k) => { if (k.slice(-10) < cutoff) store.del(k); });
}

// ---------- ملخص يوم ----------
const MAX_GAP_H = 0.34; // فجوة أكبر من 20 دقيقة تعني انقطاع البيانات فلا نحسبها

export function summarize(date, samples, source) {
  const s = samples.filter((x) => x.ts);
  let loadWh = 0, pvWh = 0, gridH = 0, batH = 0, coveredH = 0;
  for (let i = 1; i < s.length; i++) {
    const dt = (s[i].ts - s[i - 1].ts) / 36e5;
    if (dt <= 0 || dt > MAX_GAP_H) continue;
    coveredH += dt;
    if (s[i].outW != null) loadWh += s[i].outW * dt;
    if (s[i].pvW != null) pvWh += s[i].pvW * dt;
    if (gridPresent(s[i].gridV, s[i].gridRatedV)) gridH += dt;
    if (/battery/i.test(s[i].mode || '') || (s[i].batW != null && s[i].batW < -20)) batH += dt;
  }
  // عدّاد «إنتاج اليوم» في الجهاز قد يحمل قيمة الأمس لدقائق بعد منتصف الليل قبل أن يُصفَّر،
  // فنأخذ القيم بعد آخر تصفير فقط
  let meter = s.map((x) => x.todayWh).filter((v) => v != null);
  for (let i = meter.length - 1; i > 0; i--) {
    if (meter[i] < meter[i - 1]) { meter = meter.slice(i); break; }
  }
  const today = meter;
  const socs = s.map((x) => x.soc).filter((v) => v != null);
  const loads = s.map((x) => x.outW).filter((v) => v != null);
  return {
    date,
    source,
    count: s.length,
    // الإنتاج من عدّاد الجهاز نفسه إن وُجد، وإلا بالتكامل على قدرة الألواح
    pvKwh: today.length ? Math.max(...today) / 1000 : s.length > 1 ? pvWh / 1000 : null,
    pvFromMeter: today.length > 0,
    loadKwh: s.length > 1 ? loadWh / 1000 : null,
    socMin: socs.length ? Math.min(...socs) : null,
    socMax: socs.length ? Math.max(...socs) : null,
    peakW: loads.length ? Math.max(...loads) : null,
    gridH,
    batH,
    coveredH,
  };
}

export function cachedSummary(sn, date) {
  return store.get(`sum.${sn}.${date}`, null);
}
export function cacheSummary(sn, sum) {
  // نحفظ ملخص الأيام الماضية نهائياً فقط إذا كان من سجل الخادم الكامل؛ القراءات المحلية
  // قد تكون جزئية (التطبيق لم يكن مفتوحاً طوال اليوم) فلا نمنع جلب بيانات أكمل لاحقاً
  if (sum.date < today() && sum.count > 0 && sum.source === 'server') store.set(`sum.${sn}.${sum.date}`, sum);
}

// ---------- التصدير ----------
export function toCsv(header, rows) {
  const q = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [header, ...rows].map((r) => r.map(q).join(',')).join('\r\n');
}

export async function shareFile(name, text, { mime = 'text/csv;charset=utf-8', dialog = 'مشاركة التقرير' } = {}) {
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
    await Share.share({ title: name, url: res.uri, dialogTitle: dialog });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
