// بوصلة القبلة التفاعلية
import { icon } from '../icons.js';
import { num, esc } from '../text.js';
import { qiblaBearing, distanceToKaaba } from '../prayer.js';
import { location } from '../services.js';
import { fullHead } from './common.js';
import { vibrate } from '../native.js';

export const full = true;
export const tab = 'settings';

let handler = null;
let aligned = false;

export function render() {
  const loc = location();
  const q = qiblaBearing(loc.lat, loc.lng);
  const dist = Math.round(distanceToKaaba(loc.lat, loc.lng));
  const ticks = Array.from({ length: 72 }, (_, i) => `<line x1="150" y1="14" x2="150" y2="${i % 6 ? 22 : 30}" transform="rotate(${i * 5} 150 150)" class="${i % 18 ? '' : 'major'}"/>`).join('');
  const dirs = [['ش', 0], ['ق', 90], ['ج', 180], ['غ', 270]].map(([l, a]) => `<text x="150" y="52" transform="rotate(${a} 150 150)" class="${a === 0 ? 'north' : ''}">${l}</text>`).join('');
  return `${fullHead('بوصلة القبلة', esc(loc.name))}
    <div class="qibla">
      <div class="q-readout"><b data-heading>${num(Math.round(q))}°</b><small>اتجاه القبلة من الشمال</small></div>
      <div class="q-dial-wrap">
        <span class="q-pointer"></span>
        <svg class="q-dial" data-dial viewBox="0 0 300 300" aria-hidden="true">
          <circle cx="150" cy="150" r="146" class="q-face"/>
          <g class="q-ticks">${ticks}</g>
          <g class="q-dirs">${dirs}</g>
          <g transform="rotate(${q} 150 150)">
            <line x1="150" y1="150" x2="150" y2="64" class="q-needle"/>
            <g transform="translate(150 50)"><circle r="22" class="q-kaaba-bg"/><g transform="translate(-12 -12)">${icon('kaaba', 'q-kaaba')}</g></g>
          </g>
          <circle cx="150" cy="150" r="7" class="q-hub"/>
        </svg>
      </div>
      <p class="q-status" data-status>ضع الهاتف بشكل مسطّح، ثم أدره حتى تصل الكعبة إلى المؤشر في الأعلى.</p>
      <div class="q-info card">
        <div><b>${num(Math.round(q))}°</b><small>زاوية القبلة</small></div>
        <div><b>${num(dist.toLocaleString('en-US'))}</b><small>كم إلى مكة</small></div>
      </div>
      <button class="btn btn-soft" data-act="q-start" data-start hidden>${icon('compass')} تفعيل البوصلة</button>
      <p class="muted small center">${icon('info')} أبعد الهاتف عن المعادن والمغناطيس، وحرّكه على شكل رقم ٨ لمعايرة الحساس إن كانت القراءة غير مستقرة.</p>
    </div>`;
}

function listen(root, q) {
  const dial = root.querySelector('[data-dial]');
  const status = root.querySelector('[data-status]');
  const head = root.querySelector('[data-heading]');
  let got = false;
  handler = (e) => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
    else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h === null) return;
    got = true;
    const screen = (window.screen && window.screen.orientation && window.screen.orientation.angle) || window.orientation || 0;
    h = (h + screen + 360) % 360;
    dial.style.transform = `rotate(${-h}deg)`;
    const diff = Math.abs(((q - h + 540) % 360) - 180);
    head.textContent = `${num(Math.round(h))}°`;
    const ok = diff < 5;
    if (ok && !aligned) vibrate(true);
    aligned = ok;
    root.querySelector('.qibla').classList.toggle('aligned', ok);
    status.textContent = ok ? 'أنت الآن باتجاه القبلة ✓' : `أدر الهاتف ${(q - h + 360) % 360 < 180 ? 'يميناً' : 'يساراً'} ${num(Math.round(diff))}°`;
  };
  window.addEventListener('deviceorientationabsolute', handler, true);
  window.addEventListener('deviceorientation', handler, true);
  setTimeout(() => {
    if (!got) status.textContent = 'لم يُعثر على حساس البوصلة في هذا الجهاز. استخدم زاوية القبلة الظاهرة مع بوصلة أو اتجاه الشمال.';
  }, 2500);
}

export function mount(root) {
  const loc = location();
  const q = qiblaBearing(loc.lat, loc.lng);
  aligned = false;
  const DOE = window.DeviceOrientationEvent;
  if (DOE && typeof DOE.requestPermission === 'function') {
    const b = root.querySelector('[data-start]');
    b.hidden = false;
    b.addEventListener('click', () => DOE.requestPermission().then((r) => { if (r === 'granted') { b.hidden = true; listen(root, q); } }));
  } else listen(root, q);
}

export function unmount() {
  if (!handler) return;
  window.removeEventListener('deviceorientationabsolute', handler, true);
  window.removeEventListener('deviceorientation', handler, true);
  handler = null;
}
