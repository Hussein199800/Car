import { state, flush, today } from './store.js';
import { applyTheme, hasSheet, closeSheet } from './ui.js';
import { setDigits } from './text.js';
import { icon } from './icons.js';
import { App, isNative } from './native.js';
import { rescheduleNotifications } from './services.js';
import * as home from './views/home.js';
import * as library from './views/library.js';
import * as reader from './views/reader.js';
import * as tasbih from './views/tasbih.js';
import * as journal from './views/journal.js';
import * as settings from './views/settings.js';
import * as qibla from './views/qibla.js';
import * as names from './views/names.js';
import { actions as commonActions } from './views/common.js';
import { actions as dhikrActions } from './views/dhikr.js';

const TABS = [
  { id: 'home', label: 'الرئيسية', icon: 'home' },
  { id: 'library', label: 'الأذكار', icon: 'book' },
  { id: 'tasbih', label: 'المسبحة', icon: 'beads' },
  { id: 'journal', label: 'مفكرتي', icon: 'journal' },
  { id: 'settings', label: 'الإعدادات', icon: 'settings' },
];
const ROUTES = { home, library, read: reader, tasbih, journal, settings, qibla, names };
const ACTIONS = Object.assign({}, commonActions, dhikrActions, ...Object.values(ROUTES).map((v) => v.actions || {}));

const root = document.getElementById('app');
root.innerHTML = `<main id="view" class="view"></main>
  <nav class="tabbar" aria-label="التبويبات">${TABS.map((t) => `
    <a href="#/${t.id}" class="tab" data-tab="${t.id}">
      <span class="tab-ic">${icon(t.icon)}</span><span class="tab-label">${t.label}</span>
    </a>`).join('')}</nav>`;
const viewEl = document.getElementById('view');

let current = null;
let currentKey = '';

function parse() {
  const [name, param] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: ROUTES[name] ? name : 'home', param: param ? decodeURIComponent(param) : '' };
}

export function render(keepScroll = false) {
  const { name, param } = parse();
  const view = ROUTES[name];
  const key = `${name}/${param}`;
  const same = key === currentKey;
  const y = window.scrollY;
  if (current && current.unmount) current.unmount();
  current = view;
  currentKey = key;
  today();
  viewEl.innerHTML = view.render(param);
  viewEl.className = `view ${view.full ? 'is-full' : ''} ${same ? '' : 'enter'}`;
  document.body.classList.toggle('no-tabbar', !!view.full);
  const tab = view.tab || name;
  root.querySelectorAll('.tab').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  if (view.mount) view.mount(viewEl, param);
  window.scrollTo(0, same || keepScroll ? y : 0);
}

window.addEventListener('hashchange', () => render());
document.addEventListener('app:refresh', () => render(true));
document.addEventListener('app:theme', () => { applyTheme(); setDigits(state.settings.digits); render(true); });

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});

// زر الرجوع في أندرويد: يغلق اللوح المفتوح، ثم يرجع للصفحة السابقة، ثم للرئيسية، ثم يخرج
if (isNative) {
  App.addListener('backButton', () => {
    if (hasSheet()) { closeSheet(); return; }
    const { name } = parse();
    if (current && current.full) { history.back(); return; }
    if (name !== 'home') { location.hash = '#/home'; return; }
    App.exitApp();
  });
  App.addListener('resume', () => { render(true); rescheduleNotifications(); });
  App.addListener('pause', flush);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else render(true); });
window.addEventListener('pagehide', flush);

applyTheme();
setDigits(state.settings.digits);
if (!location.hash) history.replaceState(null, '', '#/home');
render();
rescheduleNotifications();

if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
