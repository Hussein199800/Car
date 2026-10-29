// أدوات الواجهة المشتركة: الثيمات، الإشعارات المنبثقة، الألواح السفلية، الصوت، بطاقة المشاركة
import { state } from './store.js';
import { icon } from './icons.js';
import { vibrate, setStatusBar } from './native.js';
import { stripTashkeel } from './text.js';

export const THEMES = {
  oasis: { name: 'الواحة الهادئة', hint: 'أخضر ميرمي هادئ', bg: '#F5F7F5', card: '#FFFFFF', primary: '#1F5E43', secondary: '#D4A373', text: '#18241E', dark: false },
  midnight: { name: 'السكينة الليلية', hint: 'وضع داكن مريح', bg: '#0E161E', card: '#17222D', primary: '#4DB6AC', secondary: '#E6C280', text: '#EDF2F7', dark: true },
  dawn: { name: 'رمال الفجر', hint: 'قراءة دافئة', bg: '#FAF6F0', card: '#FFFFFF', primary: '#8A5A36', secondary: '#C99E7A', text: '#2B2118', dark: false },
  royal: { name: 'الروضة الملكية', hint: 'بنفسجي هادئ', bg: '#F6F5FA', card: '#FFFFFF', primary: '#5E548E', secondary: '#9F86C0', text: '#231942', dark: false },
};

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export function applyTheme() {
  const t = THEMES[state.settings.theme] || THEMES.oasis;
  const root = document.documentElement;
  root.setAttribute('data-theme', state.settings.theme);
  root.setAttribute('data-mode', t.dark ? 'dark' : 'light');
  const vars = {
    '--bg': t.bg, '--card': t.card, '--primary': t.primary, '--secondary': t.secondary, '--text': t.text,
    '--muted': rgba(t.text, t.dark ? 0.62 : 0.58),
    '--faint': rgba(t.text, t.dark ? 0.38 : 0.34),
    '--line': rgba(t.text, t.dark ? 0.1 : 0.08),
    '--primary-soft': rgba(t.primary, t.dark ? 0.16 : 0.09),
    '--primary-mid': rgba(t.primary, t.dark ? 0.3 : 0.18),
    '--secondary-soft': rgba(t.secondary, t.dark ? 0.16 : 0.16),
    '--glass': rgba(t.card, 0.86),
    '--on-primary': t.dark ? '#0E161E' : '#FFFFFF',
    '--shadow': t.dark ? '0 1px 2px rgba(0,0,0,.3), 0 10px 30px rgba(0,0,0,.25)' : `0 1px 2px ${rgba(t.text, 0.04)}, 0 10px 28px ${rgba(t.text, 0.06)}`,
    '--reader-size': `${state.settings.fontSize}px`,
  };
  for (const k of Object.keys(vars)) root.style.setProperty(k, vars[k]);
  const meta = document.querySelector('meta[name=theme-color]');
  if (meta) meta.setAttribute('content', t.bg);
  setStatusBar(t.bg, t.dark);
}

/** نص الذكر حسب إعداد التشكيل */
export const dhikrText = (t) => (state.settings.tashkeel ? t : stripTashkeel(t));

// ---------- إشعار منبثق ----------
let toastTimer;
export function toast(msg, ic = 'check') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `${icon(ic)}<span>${msg}</span>`;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- لوح سفلي ----------
const sheets = [];
export function openSheet(html, { onMount, onClose, cls = '' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-backdrop" data-close></div>
    <div class="sheet ${cls}" role="dialog" aria-modal="true">
      <div class="sheet-grip"></div>
      <button class="sheet-x icon-btn" data-close aria-label="إغلاق">${icon('x')}</button>
      <div class="sheet-body">${html}</div>
    </div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const entry = { wrap, onClose };
  sheets.push(entry);
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  if (onMount) onMount(wrap.querySelector('.sheet-body'), closeSheet);
  return closeSheet;
}

export function closeSheet() {
  const entry = sheets.pop();
  if (!entry) return false;
  entry.wrap.classList.remove('open');
  setTimeout(() => entry.wrap.remove(), 280);
  if (entry.onClose) entry.onClose();
  return true;
}
export const hasSheet = () => sheets.length > 0;

export function confirmSheet(title, body, okLabel = 'تأكيد', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    openSheet(`<h3 class="sheet-title">${title}</h3><p class="sheet-text">${body}</p>
      <div class="row-btns"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${okLabel}</button><button class="btn btn-ghost" data-close>إلغاء</button></div>`, {
      onMount: (el, close) => el.querySelector('[data-ok]').addEventListener('click', () => { answered = true; resolve(true); close(); }),
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- صوت النقر الهادئ (Web Audio) ----------
let ctx;
function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function tone(freq, start, dur, vol) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, a.currentTime + start);
  g.gain.setValueAtTime(0.0001, a.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, a.currentTime + start + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.02);
}

/** تغذية راجعة لكل نقرة: اهتزاز خفيف ونقرة صوتية ناعمة حسب الإعدادات */
export function tapFeedback(kind = 'tap') {
  const s = state.settings;
  if (s.haptic) vibrate(kind !== 'tap');
  if (!s.sound) return;
  try {
    if (kind === 'tap') tone(880, 0, 0.07, 0.05);
    else if (kind === 'item') { tone(660, 0, 0.12, 0.06); tone(990, 0.09, 0.16, 0.05); }
    else { tone(523, 0, 0.25, 0.06); tone(659, 0.14, 0.25, 0.06); tone(784, 0.28, 0.45, 0.06); }
  } catch (e) { /* الصوت غير متاح */ }
}

// ---------- بطاقة مشاركة كصورة ----------
function wrapLines(c, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const test = line ? `${line} ${w}` : w;
      if (c.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

export async function renderShareCard({ text, source, title }) {
  const t = THEMES[state.settings.theme] || THEMES.oasis;
  const W = 1080, H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H; cv.dir = 'rtl';
  const c = cv.getContext('2d');
  try { await Promise.all([document.fonts.load('700 48px Amiri'), document.fonts.load('500 30px "IBM Plex Sans Arabic"')]); } catch (e) { /* خط النظام */ }
  const g = c.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, t.dark ? '#14212C' : t.primary);
  g.addColorStop(1, t.dark ? '#0B1218' : rgba(t.primary, 0.82));
  c.fillStyle = t.dark ? '#0E161E' : '#ffffff';
  c.fillRect(0, 0, W, H);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  // زخرفة هادئة
  c.globalAlpha = 0.08;
  c.strokeStyle = '#ffffff';
  c.lineWidth = 2;
  for (let r = 120; r < 900; r += 70) { c.beginPath(); c.arc(W, 0, r, 0, Math.PI * 2); c.stroke(); }
  c.globalAlpha = 1;
  // بطاقة داخلية
  const pad = 80;
  c.fillStyle = 'rgba(255,255,255,0.08)';
  c.beginPath();
  if (c.roundRect) c.roundRect(pad, 170, W - pad * 2, H - 380, 48); else c.rect(pad, 170, W - pad * 2, H - 380);
  c.fill();
  c.direction = 'rtl';
  c.textAlign = 'center';
  c.fillStyle = t.secondary;
  c.font = '500 34px "IBM Plex Sans Arabic", sans-serif';
  c.fillText(title || 'ذكر', W / 2, 125);
  const body = dhikrText(text);
  let size = 58;
  let lines;
  for (; size >= 30; size -= 2) {
    c.font = `700 ${size}px Amiri, serif`;
    lines = wrapLines(c, body, W - pad * 2 - 100);
    if (lines.length * size * 1.75 < H - 480) break;
  }
  const lh = size * 1.75;
  let y = 170 + (H - 380) / 2 - ((lines.length - 1) * lh) / 2 + size / 3;
  c.fillStyle = '#ffffff';
  for (const l of lines) { c.fillText(l, W / 2, y); y += lh; }
  if (source) {
    c.font = '400 30px "IBM Plex Sans Arabic", sans-serif';
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillText(source, W / 2, H - 150);
  }
  c.font = '600 32px "IBM Plex Sans Arabic", sans-serif';
  c.fillStyle = t.secondary;
  c.fillText('سكينة · رفيقك الروحي', W / 2, H - 80);
  return cv.toDataURL('image/png');
}
