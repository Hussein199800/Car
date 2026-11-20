// تقرير PDF للمشاركة: يُرسم التقرير على صفحات A4 بيضاء بخط التطبيق العربي (المتصفح يشكّل الحروف
// ويرتّب الاتجاه بنفسه)، ثم تُجمع الصفحات صوراً في ملف PDF صغير يُكتب هنا دون مكتبات خارجية.
import { Chart } from 'chart.js';

const W = 1240, H = 1754, M = 72;          // A4 بدقة 150 نقطة في البوصة تقريباً
const PT_W = 595.28, PT_H = 841.89;        // A4 بنقاط PDF
const C = { ink: '#0f172a', mute: '#64748b', line: '#e2e8f0', soft: '#f8fafc', pri: '#4f46e5' };
const ACCENT = { 'c-amber': '#f59e0b', 'c-sky': '#0ea5e9', 'c-violet': '#8b5cf6', 'c-pink': '#ec4899', 'c-green': '#10b981', 'c-slate': '#64748b' };

/**
 * spec: { title, subtitle, meta: [سطر], stats: [{label, value, unit, sub, color}], lines: [نص],
 *         charts: [{title, type:'bar'|'line', labels, series:[{label,data,color}], time?}],
 *         table: {title, head: [], rows: [[]], dim?: [صف ← بلا أهمية]}, notes: [نص], footer }
 * يعيد مصفوفة صفحات (canvas)
 */
export async function renderPages(spec, { font = 'Cairo' } = {}) {
  const fam = `'${font}', Cairo, system-ui, sans-serif`;
  try { await document.fonts?.load(`700 30px '${font}'`, 'طاقتي'); await document.fonts?.load(`400 30px '${font}'`, 'طاقتي'); } catch { /* خط النظام */ }
  const pages = [];
  let ctx, y;
  const newPage = () => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.direction = 'rtl'; ctx.textBaseline = 'alphabetic';
    pages.push(cv);
    y = M;
  };
  const ensure = (h) => { if (y + h > H - M - 40) newPage(); };
  const font_ = (px, bold) => { ctx.font = `${bold ? 700 : 400} ${px}px ${fam}`; };
  const text = (s, x, yy, { px = 24, bold = false, color = C.ink, align = 'right' } = {}) => {
    font_(px, bold); ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(String(s ?? ''), x, yy);
  };
  // تقسيم سطر طويل على العرض المتاح (بالكلمات)
  const wrap = (s, width, px, bold) => {
    font_(px, bold);
    const out = [];
    let cur = '';
    for (const w of String(s).split(/\s+/)) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > width && cur) { out.push(cur); cur = w; } else cur = t;
    }
    if (cur) out.push(cur);
    return out;
  };
  const rrect = (x, yy, w, h, r, fill, stroke) => {
    ctx.beginPath(); ctx.roundRect(x, yy, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
  };
  // العنوان لا يبقى وحده أسفل الصفحة: يُضمن له مع أول ما بعده
  const section = (title, next = 0) => { ensure(72 + next); y += 20; text(title, W - M, y + 30, { px: 30, bold: true }); y += 52; };

  newPage();
  // الرأس
  rrect(M, y, W - 2 * M, 150, 24, C.pri);
  text('طاقتي', W - M - 32, y + 58, { px: 26, bold: true, color: '#c7d2fe' });
  text(spec.title, W - M - 32, y + 108, { px: 40, bold: true, color: '#fff' });
  if (spec.subtitle) text(spec.subtitle, M + 32, y + 108, { px: 24, color: '#e0e7ff', align: 'left' });
  y += 182;
  for (const m of spec.meta || []) { text(m, W - M, y, { px: 22, color: C.mute }); y += 34; }

  // الأرقام الأهم: ثلاثة أعمدة
  const stats = (spec.stats || []).filter(Boolean);
  if (stats.length) {
    y += 10;
    const cols = 3, gap = 20, cw = (W - 2 * M - gap * (cols - 1)) / cols, ch = 150;
    for (let i = 0; i < stats.length; i += cols) {
      ensure(ch + gap);
      stats.slice(i, i + cols).forEach((s, j) => {
        const x = W - M - (j + 1) * cw - j * gap;
        rrect(x, y, cw, ch, 18, C.soft, C.line);
        ctx.fillStyle = ACCENT[s.color] || C.pri; ctx.fillRect(x + cw - 8, y + 18, 6, ch - 36);
        text(s.label, x + cw - 28, y + 42, { px: 21, color: C.mute });
        text(s.value ?? '—', x + cw - 28, y + 92, { px: 38, bold: true });
        if (s.unit) text(s.unit, x + cw - 28, y + 128, { px: 19, color: C.mute });
        if (s.sub) text(s.sub, x + 24, y + 128, { px: 19, color: C.mute, align: 'left' });
      });
      y += ch + gap;
    }
  }

  // الخلاصة بجمل
  if (spec.lines?.length) {
    section('الخلاصة', 50);
    for (const l of spec.lines) {
      const ls = wrap(l, W - 2 * M - 40, 24);
      ensure(ls.length * 40 + 8);
      ctx.fillStyle = C.pri; ctx.beginPath(); ctx.arc(W - M - 8, y + 18, 6, 0, Math.PI * 2); ctx.fill();
      ls.forEach((t) => { text(t, W - M - 30, y + 26, { px: 24 }); y += 40; });
      y += 6;
    }
  }

  // الرسوم: Chart.js على لوح أبيض مستقل بألوان فاتحة، لا لقطة من الشاشة (قد تكون داكنة)
  for (const c of spec.charts || []) {
    const img = await chartImage(c, fam);
    if (!img) continue;
    section(c.title, img.height + 10);
    ctx.drawImage(img, M, y);
    y += img.height + 10;
  }

  // الجدول
  if (spec.table?.rows?.length) {
    const t = spec.table, n = t.head.length, cw = (W - 2 * M) / n, rh = 46;
    section(t.title || 'التفاصيل', rh * 3);
    const head = () => {
      rrect(M, y, W - 2 * M, rh, 10, '#eef2ff');
      t.head.forEach((h, i) => text(h, W - M - i * cw - 14, y + 31, { px: 20, bold: true, color: C.mute }));
      y += rh;
    };
    head();
    t.rows.forEach((r, ri) => {
      if (y + rh > H - M - 40) { newPage(); head(); }
      if (ri % 2) { ctx.fillStyle = C.soft; ctx.fillRect(M, y, W - 2 * M, rh); }
      r.forEach((v, i) => text(v ?? '—', W - M - i * cw - 14, y + 31, { px: 21, bold: i === 0, color: t.dim?.[ri] && i > 0 ? C.mute : C.ink }));
      y += rh;
    });
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, y); ctx.lineTo(W - M, y); ctx.stroke();
    y += 10;
  }

  // ملاحظات
  for (const nte of spec.notes || []) {
    const ls = wrap(nte, W - 2 * M, 20);
    ensure(ls.length * 32 + 6);
    y += 6;
    ls.forEach((t) => { text(t, W - M, y + 22, { px: 20, color: C.mute }); y += 32; });
  }

  // تذييل كل صفحة
  pages.forEach((cv, i) => {
    ctx = cv.getContext('2d'); ctx.direction = 'rtl';
    ctx.strokeStyle = C.line; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(M, H - M - 20); ctx.lineTo(W - M, H - M - 20); ctx.stroke();
    text(spec.footer || 'طاقتي', W - M, H - M + 12, { px: 19, color: C.mute });
    text(`صفحة ${i + 1} من ${pages.length}`, M, H - M + 12, { px: 19, color: C.mute, align: 'left' });
  });
  return pages;
}

async function chartImage(c, fam) {
  if (!c?.labels?.length || !c.series?.some((s) => s.data.some((v) => v != null && (typeof v !== 'object' || v.y != null)))) return null;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-99999px;top:0;width:1096px;height:480px;';
  const cv = document.createElement('canvas');
  cv.width = 1096; cv.height = 480;
  host.appendChild(cv);
  document.body.appendChild(host);
  const tick = { color: '#475569', font: { family: fam, size: 18 } };
  const chart = new Chart(cv, {
    type: c.type || 'bar',
    data: {
      labels: c.time ? undefined : c.labels,
      datasets: c.series.map((s) => ({ label: s.label, data: s.data, backgroundColor: s.color, borderColor: s.color, borderWidth: c.type === 'line' ? 3 : 0,
        pointRadius: 0, borderRadius: 6, maxBarThickness: 34, fill: false, spanGaps: false })),
    },
    options: {
      responsive: false, animation: false, devicePixelRatio: 1,
      plugins: { legend: { display: c.series.length > 1, labels: { ...tick, usePointStyle: true, boxWidth: 12 } }, tooltip: { enabled: false } },
      scales: {
        x: { ...(c.time ? { type: 'linear', min: c.min, max: c.max } : {}), ticks: { ...tick, maxTicksLimit: 8, maxRotation: 0, ...(c.tick ? { callback: c.tick } : {}) }, grid: { display: false } },
        y: { beginAtZero: true, ...(c.yMax != null ? { max: c.yMax } : {}), ticks: tick, grid: { color: '#e2e8f0' } },
      },
    },
  });
  chart.draw();
  const out = document.createElement('canvas');
  out.width = 1096; out.height = 480;
  const o = out.getContext('2d');
  o.fillStyle = '#fff'; o.fillRect(0, 0, out.width, out.height);
  o.drawImage(cv, 0, 0);
  chart.destroy();
  host.remove();
  return out;
}

// ---------- كاتب PDF صغير: كل صفحة صورة JPEG بحجم A4 ----------
const enc = new TextEncoder();
function jpegBytes(cv, q = 0.86) {
  const b64 = cv.toDataURL('image/jpeg', q).split(',')[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function pagesToPdf(pages, { title = 'طاقتي' } = {}) {
  const chunks = [];
  let len = 0;
  const offsets = [];
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  // 1 كتالوج، 2 الصفحات، 3 المعلومات، ثم لكل صفحة: صفحة، محتوى، صورة
  const pageIds = pages.map((_, i) => 4 + i * 3);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${n} >>`);
  // عنوان المستند بترميز UTF-16BE حتى يظهر بالعربية في عارض PDF
  const hex = ['FEFF', ...[...title].map((ch) => ch.codePointAt(0) > 0xffff ? '' : ch.charCodeAt(0).toString(16).padStart(4, '0'))].join('').toUpperCase();
  obj(3, `<< /Title <${hex}> /Producer (Taqati) >>`);
  pages.forEach((cv, i) => {
    const id = pageIds[i];
    const jpg = jpegBytes(cv);
    const content = enc.encode(`q ${PT_W} 0 0 ${PT_H} 0 0 cm /Im0 Do Q`);
    obj(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT_W} ${PT_H}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`);
    obj(id + 1, `<< /Length ${content.length} >>`, content);
    obj(id + 2, `<< /Type /XObject /Subtype /Image /Width ${cv.width} /Height ${cv.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });
  const total = 4 + n * 3;
  const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

export async function buildPdf(spec, opts = {}) {
  const pages = await renderPages(spec, opts);
  return pagesToPdf(pages, { title: spec.title });
}
