// عناصر عرض مشتركة بين الشاشات
import { num, esc } from '../text.js';
import { icon } from '../icons.js';
import { hmInTz } from '../dates.js';
import { location as place } from '../services.js';

export const refresh = () => document.dispatchEvent(new Event('app:refresh'));
export const go = (hash) => { window.location.hash = hash; };

/** وقت بصيغة ١٢ ساعة (٥:٢٦ ص) في منطقة الموقع */
export function fmtTime(date, tz = place().tz) {
  const { h, min } = hmInTz(date, tz);
  const h12 = h % 12 || 12;
  return `${num(h12)}:${num(String(min).padStart(2, '0'))} ${h < 12 ? 'ص' : 'م'}`;
}

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const p = (v) => num(String(v).padStart(2, '0'));
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** حلقة تقدّم دائرية SVG */
export function ring(frac, size = 64, stroke = 5, cls = '') {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, frac)));
  return `<svg class="ring ${cls}" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"/>
    <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" fill="none"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
  </svg>`;
}

export const bar = (frac) => `<span class="bar"><i style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></span>`;
export const pct = (frac) => `${num(Math.round(frac * 100))}٪`;

/** اختيار عنصر يومي ثابت طوال اليوم */
export function daily(list, salt = 0) {
  const d = new Date();
  const start = new Date(d.getFullYear(), 0, 0);
  const doy = Math.floor((d - start) / 86400000);
  return list[(doy + salt) % list.length];
}

export const pageHead = (title, sub, extra = '') => `<header class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${extra}</header>`;

export const fullHead = (title, sub = '', extra = '') => `<header class="full-head">
  <button class="icon-btn" data-act="back" aria-label="رجوع">${icon('back')}</button>
  <div class="full-title"><b>${title}</b>${sub ? `<small>${sub}</small>` : ''}</div>${extra || '<span class="icon-btn-space"></span>'}
</header>`;

export const safe = esc;

export const actions = {
  back: () => { if (history.length > 1) history.back(); else go('#/home'); },
  go: (el) => go(el.dataset.to),
};
