import './styles.css';
import './theme.css';
import { timePoints, replayAt } from './timeline.js';
import { viewSimulation, bindSimulation } from './simulate.js';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import {
  Chart, LineController, LineElement, PointElement, BarController, BarElement,
  LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { WatchPowerApi, ApiError, errorAr } from './api.js';
import { normalize, rowsToSamples, fmt, latinDigits, LOC, countAr, DAY, parseTs, setClock12, revalidate, gridPresent } from './model.js';
import { trTitle, trValue, trUnit, isEmptyVal, warnAr } from './i18n.js';
import {
  store, SUMMARY_V, today, addDays, dayKey, shiftToDay, recordSample, localDay, summarize, cachedSummary, cacheSummary, toCsv, shareFile,
} from './data.js';
import { demoPoints, demoHistory } from './demo.js';
import { icons } from './icons.js';
import { isNative, secure, migrateSession, monitor, deviceTools, APPS, updater, control } from './native.js';
import { fetchLatest, isNewer } from './update.js';
import { INFO, infoBtn } from './info.js';
import { fetchWeather, fetchRadiation, searchPlace, sceneStory, SKY_AR } from './weather.js';
import { scene3d } from './scene3d.js';
import { scenePhoto, photoFor, batLook, photoIsDark } from './scenePhoto.js';
import { sceneClassic } from './sceneClassic.js';
import { analyze, capacityKwh } from './advisor.js';
import { findField, isOutputPriority, isChargerPriority, orderOf, matchItem, changeAndVerify, addLog, SYRIA_OFFSET_MIN, DAY_NAMES, DAY_SHORT, localDay as sLocalDay, weekday, dateOf, hm, toMin, activeSlot, nextSwitch, overlap } from './control.js';
import { costOf, costText, fmtMoney } from './money.js';
import { buildPdf } from './pdf.js';
import { analyzeTwoWeeks, rememberForecast, accuracy, gridMeter } from './forecast.js';
import { CATS, catOf, levelOf, toEvents, migrateLog, addEvents } from './log.js';
import { trendDates, change } from './trend.js';
import { settingInfo, optionAr, hintRange } from './settings-info.js';
import { viewCalc, bindCalc, defaultsCalc } from './calc.js';
import { TIP_SECTIONS, smartTips, tipOfDay } from './tips.js';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);
// خط أحمر متقطع على رسم القدرة عند لحظة إعادة المشاهدة
Chart.register({ id: 'replayCursor', afterDraw(chart) {
  if (chart.canvas.id !== 'cPower' || !state.replay) return;
  const x = chart.scales.x.getPixelForValue(state.replay.at);
  if (x < chart.chartArea.left || x > chart.chartArea.right) return;
  const c = chart.ctx; c.save(); c.strokeStyle = '#ef4444'; c.setLineDash([4, 4]); c.beginPath();
  c.moveTo(x, chart.chartArea.top); c.lineTo(x, chart.chartArea.bottom); c.stroke(); c.restore();
} });
Chart.defaults.font.family = 'Cairo, system-ui, sans-serif';

const VERSION = '4.0.2';

// ================= الحالة =================
const DEFAULT_PREFS = {
  staleMin: 15,
  batteryAh: null,
  pvKwp: null,
  price: null,
  currency: '',
  loc: null,
  cutoffSoc: 20,
  // ساعات انقطاع الشبكة التي يُحسب لها احتياطي البطارية المقترح
  reserveHours: 6,
  theme: 'auto',
  // شكل المشهد في الرئيسية: صور واقعية، أو رسم ثلاثي الأبعاد، أو الكلاسيكي
  sceneStyle: 'photo',
  // صيغة الوقت 12 ساعة (ص/م) أو 24 ساعة، ونوع الخط
  clock12: true,
  fontFamily: 'Cairo',
  notify: true,
  lowSoc: 30,
  overloadPct: 80,
  alertGrid: true,
  alertFull: true,
  alertOffline: true,
  bgMonitor: true,
  alertTemp: true,
  tempBat: 50,
  tempInv: 75,
  fontScale: 1,
};

// سجل الأحداث الموحّد؛ أول تشغيل بعد التحديث يدمج سجلّي «التنبيهات» و«الأعطال» القديمين مرة واحدة
function loadLog() {
  const saved = store.get('log', null);
  if (Array.isArray(saved)) return saved;
  const log = migrateLog(store.get('alerts', []), store.get('faults', []));
  if (store.set('log', log)) { store.del('alerts'); store.del('faults'); }
  return log;
}

const state = {
  session: null, // تُحمّل من التخزين المشفّر في boot()
  demo: store.get('demo', false),
  devices: store.get('devices', []),
  devSn: store.get('devSn', null),
  prefs: { ...DEFAULT_PREFS, ...store.get('prefs', {}) },
  log: loadLog(),
  flags: store.get('flags', {}),
  tab: 'home',
  page: null,
  model: null,
  fetchedAt: null,
  fromCache: false,
  netError: null,
  loading: false,
  fails: 0,
  rep: { dayDate: today(), day: null, week: null, month: null, weekOff: 0, monthOff: 0 },
  fields: null,
  fieldsError: null,
  calc: { ...defaultsCalc(), ...store.get('calc', {}) },
};

let api = new WatchPowerApi(state.session || {});
let pollTimer = null;
let validityTimer = null;
const charts = [];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const device = () => state.devices.find((d) => d.sn === state.devSn) || state.devices[0];
const sn = () => device()?.sn || 'none';
const savePrefs = () => store.set('prefs', state.prefs);
const numAr = (n, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : Number(n).toFixed(d));

// ================= أدوات واجهة =================
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function confirmDialog(title, body) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'modal';
    el.innerHTML = `<div class="sheet"><h3>${esc(title)}</h3><p>${body}</p>
      <div class="row-btns"><button class="btn ghost" data-v="0">إلغاء</button><button class="btn primary" data-v="1">تأكيد</button></div></div>`;
    el.addEventListener('click', (e) => {
      const v = e.target.closest('[data-v]')?.dataset.v;
      if (v !== undefined || e.target === el) { el.remove(); resolve(v === '1'); }
    });
    document.body.appendChild(el);
  });
}

// ===== الأجهزة اللوحية بنفس تناسق الهاتف =====
// نكبّر الواجهة كلها بنسبة واحدة بدل مدّها: العمودي = تصميم الهاتف نفسه بعرض منطقي ~560،
// والأفقي = عمودان كل منهما بعرض شاشة هاتف تقريباً. فتبقى النسب بين الخط والبطاقات والمشهد كما في الهاتف.
let lastFit = '';
function fitScreen() {
  const w = window.innerWidth, h = window.innerHeight;
  const tablet = Math.min(w, h) >= 600;
  const portrait = h >= w;
  const z = tablet ? Math.max(1, Math.min(portrait ? 1.7 : 1.6, w / (portrait ? 560 : 1040))) : 1;
  const logical = w / z;
  const key = `${z.toFixed(3)}|${portrait}|${tablet}`;
  if (key === lastFit) return false;
  lastFit = key;
  const root = document.documentElement;
  root.style.zoom = z > 1 ? z.toFixed(3) : '';
  root.classList.toggle('tablet', tablet);
  // العمودان فقط حين يتسع العرض فعلاً، وليس على لوحي عمودي (يبقى بتصميم الهاتف)
  root.classList.toggle('wide', logical >= 720 && !(tablet && portrait));
  root.classList.toggle('wider', logical >= 1100 && !(tablet && portrait));
  return true;
}

// الخطوط المضمّنة في التطبيق (تعمل بلا إنترنت)
const FONTS = [['Cairo', 'القاهرة'], ['Tajawal', 'تجوّل'], ['IBM Plex Sans Arabic', 'بلكس'], ['Almarai', 'المراعي']];

function applyTheme() {
  const t = state.prefs.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--fs', String(state.prefs.fontScale || 1));
  const font = FONTS.find((f) => f[0] === state.prefs.fontFamily)?.[0] || 'Cairo';
  document.documentElement.style.setProperty('--font', `'${font}'`);
  Chart.defaults.font.family = `'${font}', Cairo, system-ui, sans-serif`;
  setClock12(state.prefs.clock12 !== false);
  Chart.defaults.color = dark ? '#9aa7c7' : '#5b6785';
  Chart.defaults.locale = LOC;
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
    StatusBar.setBackgroundColor({ color: dark ? '#070d1d' : '#eef1f8' }).catch(() => {});
  }
}

// بطاقات ملونة على شكل شبكة (للصفحات الرئيسية لكل تبويب)
function gridCards(items, cls = '') {
  return `<div class="gcards ${cls}">${items.map((it) => `
    <button class="gcard ${it.color}" data-page="${it.page}">
      <span class="g-deco">${it.icon}</span>
      <span class="g-ic">${it.icon}</span>
      ${it.badge ? `<span class="g-badge">${esc(it.badge)}</span>` : ''}
      <span class="g-val">${esc(it.value ?? '')}</span>
      <b>${esc(it.title)}${infoBtn(it.info)}</b>
      <small>${esc(it.sub ?? '')}</small>
    </button>`).join('')}</div>`;
}

// بطاقات قائمة بأيقونة ملونة وسهم
function listCards(items) {
  return `<div class="lcards">${items.map((it) => `
    <button class="lcard" data-page="${it.page}">
      <span class="l-ic ${it.color}">${it.icon}</span>
      <span class="l-txt"><b>${esc(it.title)}</b><small>${esc(it.sub ?? '')}</small></span>
      ${it.badge ? `<span class="l-badge">${esc(it.badge)}</span>` : ''}
      <span class="l-go">${icons.chevL}</span>
    </button>`).join('')}</div>`;
}

const kv = (rows) => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
const val = (v, unit = '') => (v === null || v === undefined || v === '' ? '<span class="na">غير متوفر</span>' : `<bdi>${esc(v)}</bdi>${unit ? ` <small>${esc(unit)}</small>` : ''}`);

function stat(label, value, unit, color = '', extra = '', info = '') {
  return `<div class="stat ${color}"><small>${esc(label)}${infoBtn(info)}</small><b><bdi>${esc(value ?? '—')}</bdi></b>${unit ? `<span>${esc(unit)}</span>` : ''}${extra}</div>`;
}

// عنوان بطاقة مع زر ⓘ اختياري
const cardH = (title, info = '', side = '') => `<div class="card-h"><h2>${esc(title)}${infoBtn(info)}</h2>${side}</div>`;

// ورقة الشرح: تنزلق من الأسفل وتُغلق بالضغط خارجها أو على «تم»
function openInfo(key) {
  const it = INFO[key];
  if (!it) return;
  tap();
  const extra = INFO_EXTRA[key]?.() || [];
  const el = document.createElement('div');
  el.className = 'isheet';
  el.innerHTML = (`<div class="isheet-b" role="dialog" aria-modal="true" aria-label="${esc(it[0])}"><i class="grab"></i>
    <h3>${esc(it[0])}</h3>${[...it[1], ...extra].map((t) => `<p>${esc(t)}</p>`).join('')}
    <button class="btn primary wide" data-close>تم</button></div>`);
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', (e) => { if (e.target === el || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  el.querySelector('[data-close]').focus();
}
// معلومات تُضاف للشرح حسب جهاز المستخدم
const INFO_EXTRA = {
  totalWh: () => (state.plant?.install ? [`سُجّلت منظومتك على خادم WatchPower في ${fmt.day(String(state.plant.install).slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}.`] : []),
  stale: () => (state.collector?.datFetch ? [`وحدتك ترفع قراءة كل ${countAr(Math.round(state.collector.datFetch / 60) || 1, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'])}.`] : []),
};

// اهتزاز خفيف عند اللمس (إن سمح الهاتف) كتغذية راجعة فورية
const tap = () => { try { navigator.vibrate?.(8); } catch { /* تجاهل */ } };

// ================= تسجيل الدخول =================
function renderLogin(msg = '') {
  stopPolling();
  state.screen = 'login';
  document.getElementById('app').innerHTML = `
  <div class="login">
    <div class="login-hero">
      <div class="logo">${icons.sun}</div>
      <h1>طاقتي</h1>
      <p>راقب منظومة الطاقة الشمسية لحظة بلحظة</p>
    </div>
    <form class="card login-card" id="loginForm" autocomplete="on">
      <label>اسم المستخدم في تطبيق WatchPower
        <input name="usr" required autocomplete="username" autocapitalize="none" spellcheck="false" dir="ltr" value="${esc(store.get('lastUsr', ''))}">
      </label>
      <label>كلمة المرور
        <span class="pwd-wrap"><input name="pwd" type="password" required autocomplete="current-password" dir="ltr">
        <button type="button" class="pwd-eye" id="pwdEye" aria-label="إظهار كلمة المرور">${icons.eye}</button></span>
      </label>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <button class="btn primary big" type="submit">تسجيل الدخول</button>
      <button class="btn ghost" type="button" id="demoBtn">تجربة التطبيق ببيانات تجريبية</button>
      <p class="hint">يُستخدم نفس حساب تطبيق WatchPower. لا تُحفظ كلمة المرور على الهاتف، بل بصمتها المشفّرة فقط.</p>
      <p class="hint">«طاقتي» تطبيق مستقل، وغير تابع لشركة WatchPower أو الشركات المصنّعة للأجهزة.</p>
    </form>
    <div class="login-links">
      <button class="btn ghost" type="button" data-guide="register">${icons.user} إنشاء حساب جديد</button>
      <button class="btn ghost" type="button" data-guide="wifi">${icons.wifi} إعداد وحدة الواي فاي</button>
    </div>
    <p class="foot">تطوير: حسين محمد علي الطويل · لا تنسونا من صالح دعائكم</p>
  </div>`;

  document.querySelectorAll('[data-guide]').forEach((b) => { b.onclick = () => renderGuideStandalone(b.dataset.guide); });
  $('#pwdEye').onclick = () => {
    const i = $('[name=pwd]');
    const show = i.type === 'password';
    i.type = show ? 'text' : 'password';
    $('#pwdEye').setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
    $('#pwdEye').classList.toggle('on', show);
  };
  $('#demoBtn').onclick = () => {
    state.demo = true;
    store.set('demo', true);
    state.devices = [DEMO_DEVICE];
    state.devSn = 'DEMO';
    startApp();
  };

  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'جارٍ الدخول…';
    try {
      api = new WatchPowerApi();
      await finishLogin(await api.login(f.get('usr'), f.get('pwd')), null, (t) => { btn.textContent = t; });
    } catch (err) {
      renderLogin(err.message || 'حدث خطأ غير متوقع');
    }
  };
}

// بعد نجاح الدخول (بكلمة المرور أو من النسخة الاحتياطية): حفظ الجلسة واكتشاف الأجهزة
async function finishLogin(session, preferredSn, status) {
  state.session = session;
  await secure.set('session', state.session);
  store.set('lastUsr', state.session.usr);
  state.demo = false;
  store.set('demo', false);
  status?.('جارٍ البحث عن الأجهزة…');
  state.devices = await api.listDevices();
  store.set('devices', state.devices);
  if (!state.devices.length) throw new ApiError('لم يُعثر على أي جهاز في هذا الحساب');
  state.devSn = state.devices.some((d) => d.sn === preferredSn) ? preferredSn : state.devices[0].sn;
  store.set('devSn', state.devSn);
  startApp();
}

// حالة التنبيهات تخص جهازاً بعينه: تُصفّر عند تبديل الجهاز أو الخروج حتى لا تنتقل
// «انقطعت الكهرباء» أو «غير متصل» من جهاز لآخر فتولّد تنبيهات عودة وهمية
function resetAlertState() {
  state.flags = {};
  store.set('flags', state.flags);
  state.fetchCount = 0;
}

function logout() {
  stopPolling();
  resetAlertState();
  state.lastTs = {};
  ['devices', 'devSn', 'demo'].forEach(store.del);
  secure.del('session');
  monitor.configure({ enabled: false }).catch(() => {});
  // لا يبقى عامل في الخلفية يرسل أوامر بجلسة خرج منها المستخدم
  control.configure({ mode: 'manual' }).catch(() => {});
  monitor.widget({ clear: true }).catch(() => {});
  state.widgetTs = null;
  state.ctl = null;
  Object.assign(state, { session: null, demo: false, devices: [], model: null, fields: null, tab: 'home', page: null, plant: undefined, collector: undefined });
  state.rep = { ...state.rep, day: null, week: null, month: null, adv: null };
  api = new WatchPowerApi();
  renderLogin();
}

// ================= الهيكل والتنقل =================
// أربعة تبويبات للاستخدام اليومي، والأدوات الأخرى داخل «المزيد»
// خمسة تبويبات ثابتة بترتيب عربي (من اليمين): الرئيسية، التقارير، الحاسبة، التنبيهات، المزيد
const TABS = [
  ['home', 'الرئيسية', icons.home],
  ['reports', 'التقارير', icons.chart],
  ['calc', 'الحاسبة', icons.calc],
  ['alerts', 'التنبيهات', icons.bell],
  ['more', 'المزيد', icons.dots],
];
const TAB_TITLES = { home: 'الرئيسية', reports: 'التقارير', calc: 'الحاسبة', alerts: 'التنبيهات', more: 'المزيد' };
// الصفحة الحالية مسار مثل «tips/lithium»، والرجوع يحذف آخر جزء منه
const leaf = () => (state.page ? state.page.split('/').pop() : null);

// quiet: إعادة بناء الهيكل فقط (مثل تغيير المصطلحات) دون معاملتها كفتح جديد للتطبيق
function startApp(quiet = false) {
  document.getElementById('app').innerHTML = `
    <header class="topbar" id="topbar"></header>
    <main id="view"></main>
    <nav class="tabbar">${TABS.map(([id, label, ic]) => `
      <button data-tab="${id}">${ic}<span>${label}</span>${id === 'alerts' ? '<i class="badge" id="alertBadge"></i>' : ''}</button>`).join('')}
    </nav>`;
  $('.tabbar').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) navigate(b.dataset.tab, null);
  };
  $('#view').addEventListener('click', (e) => {
    const card = e.target.closest('[data-page]');
    if (!card) return;
    // «tab:page» تفتح صفحة في تبويب آخر، مثل ملاحظات الجهاز من صفحة النصائح
    const [t, p] = card.dataset.page.includes(':') ? card.dataset.page.split(':') : [state.tab, card.dataset.page];
    navigate(t, p);
  });
  loadCache();
  navigate(state.tab, state.page);
  startPolling();
  if (quiet) return;
  takeOverFromBackground().then(() => { refresh(); syncMonitor(); });
  autoCheckUpdate();
  // أول تثبيت: جولة تعريفية. بعد كل تحديث: «ما الجديد» مرة واحدة
  if (!store.get('tourSeen', false)) openTour();
  else if (store.get('seenVersion', null) !== VERSION) openWhatsNew();
}

// ================= الجولة التعريفية و«ما الجديد» =================
// أمثلة توضيحية للمشهد (ليست بيانات جهازك): كل حالة تُظهر شكلاً مختلفاً للتدفق
const TOUR_CASES = [
  { sky: 'clear', title: 'الألواح تغذّي البيت وتشحن البطارية', m: { pvW: 3600, outW: 450, batW: 3100, soc: 68, gridOn: true, gridV: 230, mode: 'Battery Mode' } },
  { sky: 'clear', title: 'البطارية ممتلئة: الألواح تغذّي البيت فقط', m: { pvW: 520, outW: 520, batW: 0, soc: 100, gridOn: true, gridV: 230, mode: 'Battery Mode' } },
  { sky: 'night', title: 'ليلاً: البطارية تغذّي البيت', m: { pvW: 0, outW: 480, batW: -510, soc: 62, gridOn: true, gridV: 230, mode: 'Battery Mode' } },
  { sky: 'night', title: 'الكهرباء تغذّي البيت وتشحن البطارية', m: { pvW: 0, outW: 650, batW: 1200, soc: 35, gridOn: true, gridV: 228, mode: 'Line Mode' } },
];
const TOUR = [
  { t: 'أهلاً بك في طاقتي', p: ['تابع منظومتك الشمسية لحظة بلحظة: الألواح والبطارية والكهرباء والبيت في مشهد واحد.', 'هذه جولة قصيرة في التطبيق. يمكنك تخطيها والعودة إليها من «المزيد».'], scene: 0 },
  { t: 'الرئيسية', p: ['المشهد يتغيّر مع حالة منظومتك، وأسهم ملوّنة تسري باتجاه الطاقة: أصفر من الألواح، بنفسجي من الشبكة، أخضر شحن البطارية، برتقالي سحب منها، أزرق إلى البيت.', 'اضغط أي قيمة أو عنصر لتفتح تفاصيله.'], cycle: true },
  { t: 'التقارير', ic: 'chart', p: ['مؤشر الاستقلالية عن الكهرباء في الأعلى.', 'تقارير يومية وأسبوعية وشهرية وسنوية، و«ملاحظات على منظومتك» بتوصيات من قراءاتك.'] },
  { t: 'التنبيهات', ic: 'bell', p: ['انقطاع الكهرباء وعودتها، انخفاض البطارية، الحمل الزائد، والأعطال، حتى والتطبيق مغلق.', 'واختر شروط التنبيه بنفسك، واطّلع على سجل أعطال الإنفرتر من الخادم.'] },
  { t: 'المزيد', ic: 'gear', p: ['الإعدادات: سعة البطارية، قدرة الألواح، موقعك للطقس، المظهر وحجم الخط.', 'حاسبة الأحمال والتوفير بالمال، النصائح، وإعدادات الإنفرتر عن بُعد.'] },
  { t: 'ⓘ بجانب كل رقم', ic: 'info', p: ['اضغطها لتعرف من أين جاء الرقم، وكيف حُسب، وإلى متى يبقى محفوظاً.', 'جاهز؟ لنبدأ.'] },
];

function tourScene(c) {
  const m = { stale: false, ...c.m };
  const parts = sceneParts(m, true, /line/i.test(m.mode));
  const body = sceneBody(m, true, /line/i.test(m.mode), c.sky, parts, null);
  return `<div class="scene flow-card ${body.cls} sky-${c.sky} ${m.pvW > 5 ? 'pv-on' : ''} ${m.soc >= 98 ? 'bat-full' : ''} ${parts.flows.bat.on ? (parts.flows.bat.reverse ? 'bat-dis' : 'bat-chg') : ''}">
    ${body.html}</div>`;
}

function openTour() {
  let i = 0, ci = 0, timer = null;
  const el = document.createElement('div');
  el.className = 'tour';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  const close = () => { clearInterval(timer); store.set('tourSeen', true); store.set('seenVersion', VERSION); el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  const draw = () => {
    clearInterval(timer);
    const s = TOUR[i];
    const c = TOUR_CASES[s.cycle ? ci : s.scene ?? 0];
    el.innerHTML = `<div class="tour-b">
      <button class="tour-skip" data-t="skip">${i === TOUR.length - 1 ? '' : 'تخطي'}</button>
      <div class="tour-art">${s.ic ? `<div class="tour-ic">${icons[s.ic]}</div>` : tourScene(c)}${s.cycle ? `<p class="tour-case">${esc(c.title)}</p><div class="tour-cases">${TOUR_CASES.map((_, k) => `<i class="${k === ci ? 'on' : ''}"></i>`).join('')}</div><p class="tour-note">مثال توضيحي</p>` : ''}</div>
      <h2>${esc(s.t)}</h2>${s.p.map((x) => `<p>${esc(x)}</p>`).join('')}
      <div class="tour-dots">${TOUR.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('')}</div>
      <div class="tour-nav">${i ? '<button class="btn ghost" data-t="prev">السابق</button>' : '<span></span>'}<button class="btn primary" data-t="next">${i === TOUR.length - 1 ? 'ابدأ' : 'التالي'}</button></div>
    </div>`;
    // الحالات تتبدّل تلقائياً كل 3 ثوانٍ في شاشة الرئيسية
    if (s.cycle) timer = setInterval(() => { ci = (ci + 1) % TOUR_CASES.length; draw(); }, 3000);
  };
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-t]')?.dataset.t;
    if (!a) return;
    if (a === 'skip') close();
    if (a === 'prev') { i = Math.max(0, i - 1); draw(); }
    if (a === 'next') { if (i === TOUR.length - 1) close(); else { i++; ci = 0; draw(); } }
  });
  draw();
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
}

// ما الجديد في هذا الإصدار: يظهر مرة واحدة بعد التحديث
const WHATS_NEW = [
  'تصميم جديد كلياً: عاجي وأخضر عميق نهاراً، وزجاج فحمي بتوهج خفيف ليلاً، مع شريط تنقل عائم بخمسة تبويبات.',
  'الرئيسية: الألواح والاستهلاك وشحن البطارية أو تفريغها بنظرة واحدة تحت المشهد. المشاهد الثلاثة كما هي.',
  'التقارير كلها في مكان واحد: يوم (بأي تاريخ) وأسبوع وشهر وسنة وفترة تختارها، مع رسم تفاعلي ومقارنة وCSV وPDF.',
  'الحاسبة صارت تبويباً، والتنبيهات مجمّعة حسب اليوم، و«المزيد» يعرض الإنفرتر وحالته واختصارات سريعة.',
];
function openWhatsNew() {
  store.set('seenVersion', VERSION);
  const el = document.createElement('div');
  el.className = 'isheet';
  el.innerHTML = `<div class="isheet-b" role="dialog" aria-modal="true" aria-label="ما الجديد"><i class="grab"></i>
    <h3>ما الجديد في الإصدار ${VERSION}</h3><ul class="wn">${WHATS_NEW.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <div class="tour-nav"><button class="btn ghost" data-tour>جولة في التطبيق</button><button class="btn primary" data-close>تم</button></div></div>`;
  const close = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('[data-close]')) close();
    if (e.target.closest('[data-tour]')) { close(); openTour(); }
  });
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
}

function navigate(tab, page) {
  // الحاسبة صارت تبويباً: الروابط القديمة «more:calc» تفتحه
  if (tab === 'more' && page === 'calc') { tab = 'calc'; page = null; }
  if (!TAB_TITLES[tab]) tab = 'home';
  state.tab = tab;
  state.page = page;
  state.animate = true;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}

function back() {
  // قبل تسجيل الدخول: زر الرجوع في دليل الربط يعيد لشاشة الدخول بدل إغلاق التطبيق
  if (!state.session && !state.demo) {
    if (state.screen === 'guide') renderLogin();
    else CapApp.minimizeApp().catch(() => {});
    return;
  }
  if (state.page) navigate(state.tab, state.page.includes('/') ? state.page.slice(0, state.page.lastIndexOf('/')) : null);
  else if (state.tab !== 'home') navigate('home', null);
  else CapApp.minimizeApp().catch(() => {});
}

function connState() {
  const m = state.model;
  if (state.demo) return { cls: 'demo', text: 'وضع تجريبي' };
  if (!m) return state.netError ? { cls: 'off', text: state.netError } : { cls: '', text: 'جارٍ التحميل…' };
  if (m.stale) return { cls: 'off', text: `الإنفرتر غير متصل · آخر قراءة ${fmt.ago(m.age)}` };
  if (state.netError) return { cls: 'warn', text: 'لا يوجد اتصال · بيانات محفوظة' };
  return { cls: 'on', text: m.ts ? `آخر قراءة ${fmt.time(m.ts)} · ${fmt.ago(m.age)}` : 'متصل' };
}

function renderHeader() {
  const bar = $('#topbar');
  if (!bar) return;
  const c = connState();
  const title = state.page ? PAGE_TITLES[leaf()] || '' : null;
  const multi = state.devices.length > 1;
  bar.innerHTML = (state.page
    ? `<button class="icon-btn" id="backBtn" aria-label="رجوع">${icons.arrowBack}</button>
       <div class="page-title">${esc(title)}</div>
       <span class="dot ${c.cls}" title="${esc(c.text)}"></span>`
    : `<div class="brand">${icons.logo}<span>طاقتي</span></div>
       <${multi ? 'button class="dev dev-pick" id="devPick" aria-label="اختيار الجهاز"' : 'div class="dev"'}><span class="dot ${c.cls}"></span><div>
         <div class="dev-name">${esc(device()?.alias || 'جهازي')}${multi ? ' <span class="dev-caret">▾</span>' : ''}</div>
         <div class="dev-sub">${esc(c.text)}</div></div></${multi ? 'button' : 'div'}>
       <button class="icon-btn ${state.loading ? 'spin' : ''}" id="refreshBtn" aria-label="تحديث">${icons.refresh}</button>`);
  const bb = $('#backBtn');
  if (bb) bb.onclick = back;
  const dp = $('#devPick');
  if (dp) dp.onclick = pickDevice;
  const rb = $('#refreshBtn');
  if (rb) rb.onclick = () => refresh(true);
  const unread = state.log.filter((e) => e.read === false).length;
  const badge = $('#alertBadge');
  if (badge) { badge.textContent = unread > 99 ? '99+' : unread || ''; badge.style.display = unread ? '' : 'none'; }
}

// عند وجود أكثر من جهاز في الحساب: الضغط على اسم الجهاز يفتح قائمة للتبديل
function pickDevice() {
  const el = document.createElement('div');
  el.className = 'modal';
  el.innerHTML = `<div class="sheet"><h3>اختر الجهاز</h3><div class="dev-list">${state.devices.map((x) => `
    <button class="btn ${x.sn === device()?.sn ? 'primary' : 'ghost'} wide" data-sn="${esc(x.sn)}">${esc(x.alias)}</button>`).join('')}</div></div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sn]');
    if (b || e.target === el) { el.remove(); if (b) switchDevice(b.dataset.sn); }
  });
  document.body.appendChild(el);
}

function switchDevice(snv) {
  if (snv === device()?.sn) return;
  state.devSn = snv;
  store.set('devSn', snv);
  state.model = null;
  state.fields = null;
  state.plant = undefined;
  state.collector = undefined;
  state.ctl = null; // حقول التحكم ووضعه ونتائجه تخص الجهاز السابق
  state.widgetTs = null;
  monitor.widget({ clear: true }).catch(() => {});
  resetAlertState();
  state.rep = { ...state.rep, day: null, week: null, month: null, adv: null, year: null, srv: null };
  loadCache();
  refresh();
  render();
  syncMonitor();
}

// شريط الحالة: يوضّح متى تكون البيانات غير حيّة
function banner() {
  const m = state.model;
  if (state.demo) return `<div class="banner demo">${icons.info}<span>وضع تجريبي — هذه البيانات للعرض فقط وليست من جهازك.</span></div>`;
  if (m?.stale && !m.ts) return `<div class="banner off">لا يوجد وقت صالح للقراءة؛ الحركة والتقديرات الحية متوقفة.</div>`;
  if (m?.stale) {
    return `<div class="banner off">${icons.offline}<span><b>الإنفرتر غير متصل بالخادم</b>آخر قراءة وصلت ${esc(fmt.dateTime(m.ts))} (${esc(fmt.ago(m.age))}). القيم المعروضة قديمة وقد يكون الإنفرتر مطفأً أو مفصولاً.</span></div>`;
  }
  if (state.netError && m) {
    return `<div class="banner warn">${icons.offline}<span><b>تعذّر الاتصال بالخادم</b>تُعرض آخر بيانات محفوظة على الهاتف (جُلبت ${esc(fmt.ago(Date.now() - state.fetchedAt))}).</span></div>`;
  }
  if (m && !m.ts) return `<div class="banner warn">${icons.info}<span>الجهاز لا يرسل وقت القراءة، لذا لا يمكن التأكد من أن البيانات حيّة.</span></div>`;
  return '';
}

const PAGE_TITLES = {
  load: 'الحمل', battery: 'البطارية', solar: 'الألواح الشمسية', grid: 'كهرباء الشبكة',
  day: 'التقرير اليومي', week: 'التقرير الأسبوعي', month: 'التقرير الشهري', year: 'التقرير السنوي', srvlog: 'سجل الإنفرتر في الخادم', 
  period: 'تقرير لفترة', rules: 'شروط التنبيه', advisor: 'ملاحظات على منظومتك', device: 'الإنفرتر', update: 'التحديثات', edit: 'إعدادات الإنفرتر', power: 'أولوية مصدر الطاقة', forecast: 'تقدير الأسبوعين القادمين', gridmeter: 'كهرباء الشبكة', setup: 'ربط الجهاز والحساب',
  tips: 'النصائح', ...Object.fromEntries(TIP_SECTIONS.map((t) => [t.id, t.title])),
  settings: 'الإعدادات', calc: 'حاسبة الأحمال', about: 'حول التطبيق',
};

function render() {
  state.model = revalidate(state.model, state.prefs.staleMin);
  if (replayTimer) { clearInterval(replayTimer); replayTimer = null; }
  charts.splice(0).forEach((c) => c.destroy());
  renderHeader();
  const v = $('#view');
  if (!v) return;
  const views = { home: viewHome, reports: viewReports, calc: () => viewCalc(calcHelpers()), alerts: viewAlerts, more: viewMore };
  // التحديث الدوري يعيد رسم الصفحة نفسها: نحافظ على الأقسام التي فتحها المستخدم بدل طيّها كل 30 ثانية
  const key = state.tab + '/' + (state.page || '');
  const opened = v.dataset.key === key ? [...v.querySelectorAll('details')].map((d) => d.open) : null;
  // عنوان كبير لكل تبويب (بأسلوب العناوين العريضة)، والصفحات الفرعية تكتفي بعنوان الشريط العلوي
  const big = state.page ? '' : `<h1 class="big-title">${TAB_TITLES[state.tab]}</h1>`;
  v.innerHTML = `<div class="${state.animate ? 'page-anim' : ''}">${big}${views[state.tab]()}</div>`;
  v.dataset.key = key;
  if (opened) v.querySelectorAll('details').forEach((d, i) => { if (i < opened.length) d.open = opened[i]; });
  state.animate = false;
  AFTER[leaf() || state.tab]?.();
}
const AFTER = {};

// الحاسبة في ملف مستقل، فنمرّر لها ما تحتاجه من أدوات الواجهة
const calcHelpers = () => ({
  state, esc, icons, fmt, $, toast, render, confirm: confirmDialog, infoBtn, savePrefs,
  // متوسط إنتاج الألواح اليومي من آخر 7 أيام مكتملة (إن كانت قد حُمّلت)
  avgPv: () => (state.rep.adv?.sums ? analyze(state.rep.adv.sums, { todayKey: today(), prefs: state.prefs }).avgPv : null),
  // اختيار المستخدم في الحاسبة أولاً، ثم جهد الجهاز المقنّن
  sysV: () => state.calc.sysVPick || state.model?.ratedV || state.calc.sysV || nominalV(state.model),
});
AFTER.calc = () => {
  bindCalc(calcHelpers());
  bindSimulation(calcHelpers());
  // التوفير الشهري يحتاج متوسط آخر 7 أيام: نحمّله في الخلفية مرة واحدة
  if (state.calc.tab === 'save' && state.prefs.price && !state.rep.adv) loadAdvisor();
};

// ================= جلب البيانات =================
// ===== فرق التوقيت بين الخادم والهاتف =====
// بعض الخوادم ترسل وقت القراءة بتوقيت مختلف عن توقيت الهاتف. عندما نرى قراءة جديدة
// تصل أثناء المتابعة نعرف أن عمرها الحقيقي دقائق قليلة، فنستنتج الفرق مقرّباً لربع ساعة.
const Q = 15 * 60000;
const tzOffset = () => store.get('tz.' + sn(), 0);
function learnOffset(ts) {
  if (!ts) return;
  const key = 'tz.' + sn();
  const prev = state.lastTs?.[sn()];
  const raw = Date.now() - ts;
  const guess = Math.round(raw / Q) * Q;
  const adopt = (v) => { store.set(key, v); store.del('tzp.' + sn()); };
  // قراءة من المستقبل مستحيلة، فهذا فرق توقيت مؤكد
  if (raw < -Q) adopt(guess);
  // قراءة أحدث وصلت للتو: عمرها الحقيقي صغير، والباقي فرق توقيت.
  // قد ترفع وحدة الواي فاي قراءات مخزّنة متأخرة، لذا لا نعتمد فرقاً جديداً إلا إذا تكرّر مرتين
  else if (prev && ts > prev) {
    const v = Math.abs(guess) >= 2 * Q ? guess : 0;
    const wholeHour = Math.abs(raw - Math.round(raw / 36e5) * 36e5) <= 7 * 60000;
    if (v === tzOffset()) store.del('tzp.' + sn());
    // الصفر يُعتمد فوراً، فأي فرق خاطئ يُصحَّح تلقائياً مع القراءة المنتظمة التالية
    else if (v === 0 || (wholeHour && v % 36e5 === 0) || store.get('tzp.' + sn(), null) === v) adopt(v);
    else store.set('tzp.' + sn(), v);
  }
  state.lastTs = { ...(state.lastTs || {}), [sn()]: ts };
}

function loadCache() {
  const c = store.get('last.' + sn(), null);
  if (c && !state.model) {
    state.model = normalize(c.points, state.prefs.staleMin, tzOffset());
    state.fetchedAt = c.at;
    state.fromCache = true;
  }
}

// أداة الشاشة الرئيسية: تُحدَّث مع كل قراءة جديدة (والفحص في الخلفية يحدّثها والتطبيق مغلق)
function pushWidget(m) {
  if (state.demo || !m || `${m.ts}:${m.stale}` === state.widgetTs) return;
  state.widgetTs = `${m.ts}:${m.stale}`;
  // وقت مجهول يبقى 0 (لا «الآن»): الأداة تكتب «وقت القراءة غير معروف» وتعدّ القراءة غير حية
  monitor.widget({ soc: m.soc, batW: m.batW, loadW: m.outW, pvW: m.pvW, stale: !!m.stale || !m.ts, at: m.ts || 0 }).catch(() => {});
}

async function refresh(manual = false) {
  const d = device();
  if (!d || state.loading) return;
  state.loading = true;
  renderHeader();
  try {
    const points = state.demo ? demoPoints(Date.now(), state.demoSky) : await api.lastData(d);
    // تبديل الجهاز أو الخروج أثناء الطلب: نتجاهل الرد حتى لا تظهر قراءة جهاز باسم جهاز آخر
    // ولا يُستنتج منها فرق توقيت خاطئ، ثم نجلب الجهاز الحالي فوراً
    if (sn() !== d.sn) { state.switched = true; return; }
    if (!points.length) throw new ApiError('الجهاز لم يرسل أي بيانات بعد');
    let model = normalize(points, state.prefs.staleMin, tzOffset());
    if (!state.demo) {
      learnOffset(model.rawTs);
      model = normalize(points, state.prefs.staleMin, tzOffset());
    }
    state.model = model;
    state.fetchedAt = Date.now();
    state.fetchCount = (state.fetchCount || 0) + 1;
    state.fromCache = false;
    state.netError = null;
    state.fails = 0;
    if (!state.demo) {
      store.set('last.' + d.sn, { points, at: state.fetchedAt });
      // نحفظ الجلسة فقط إذا تجدّد الرمز حتى لا نكتب في التخزين المشفّر كل 30 ثانية
      if (api.session.token !== state.session?.token) {
        state.session = api.session;
        secure.set('session', state.session).catch(() => {});
      }
      recordSample(d.sn, state.model);
    }
    checkAlerts(state.model);
    pushWidget(state.model);
    if (manual) toast(state.model.stale ? 'تم التحديث — الإنفرتر ما زال غير متصل' : 'تم التحديث', state.model.stale ? 'bad' : 'ok');
  } catch (err) {
    if (sn() !== d.sn) { state.switched = true; return; }
    state.fails++;
    state.netError = err.message;
    // القراءة تفقد صلاحيتها مع الوقت حتى لو فشل الاتصال، لكن لا ننبّه «الإنفرتر غير متصل»:
    // الذي انقطع قد يكون إنترنت الهاتف لا الإنفرتر. التنبيه يأتي من أول اتصال ناجح بلا قراءة جديدة
    state.model = revalidate(state.model, state.prefs.staleMin);
    if (state.model) pushWidget(state.model);
    if (state.fails === 3) logEvent('conn', 'warn', 'تعذّر الاتصال بالخادم', err.message);
    if (manual) toast(err.message, 'bad');
  } finally {
    state.loading = false;
    if (state.switched) {
      state.switched = false;
      if (device() && (state.session || state.demo)) refresh(manual);
      return;
    }
    if (state.model) state.model = revalidate(state.model, state.prefs.staleMin);
    // نعيد الرسم فقط للصفحات التي تعرض القراءة الحية حتى لا تُفقد حالة الصفحات الأخرى
    if (state.tab === 'home' || (state.tab === 'reports' && state.page === 'advisor')) render();
    else renderHeader();
    if (state.tab === 'calc' && !state.page) bindSimulation(calcHelpers());
  }
}

// وحدة الواي فاي ترفع قراءة جديدة كل بضع دقائق، فلا فائدة من سؤال الخادم أكثر من مرة في الدقيقة.
// في المتصفح فقط يمكن للاختبارات تقصير المدة عبر devPollSec
const pollMs = () => (isNative ? 60 : Math.max(5, store.get('devPollSec', 60))) * 1000;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refresh(), pollMs());
  validityTimer = setInterval(() => {
    const was = state.model?.stale;
    state.model = revalidate(state.model, state.prefs.staleMin);
    if (!state.model || was === state.model.stale) return;
    pushWidget(state.model);
    // نعيد رسم صفحات القراءة الحية فقط، حتى لا تُغلق لوحة المفاتيح في صفحة يكتب فيها المستخدم
    if (state.tab === 'home' || (state.tab === 'reports' && state.page === 'advisor')) render();
    else {
      renderHeader();
      if (state.tab === 'calc' && !state.page) bindSimulation(calcHelpers());
    }
  }, 1000);
}
function stopPolling() { if (validityTimer) clearInterval(validityTimer); validityTimer = null; if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

// ================= المراقبة في الخلفية (تطبيق الهاتف فقط) =================
// التطبيق المفتوح يراقب بنفسه كل بضع ثوانٍ. عند إغلاقه نسلّم حالة التنبيهات للفحص الأصلي (Kotlin)
// ليكمل من حيث توقفنا دون تكرار، وعند العودة نستلم ما حدث في غيابنا.
function monitorConfig() {
  const d = device();
  const p = state.prefs;
  return {
    enabled: !!(p.bgMonitor && state.session && d && !state.demo),
    sn: d?.sn || '', device: d ? { pn: d.pn, sn: d.sn, devcode: String(d.devcode), devaddr: String(d.devaddr ?? 1) } : null,
    staleMin: p.staleMin, tzOffsetMs: tzOffset(), lowSoc: p.lowSoc, overloadPct: p.overloadPct,
    alertGrid: p.alertGrid, alertOffline: p.alertOffline, alertFull: p.alertFull, notify: p.notify,
    alertTemp: p.alertTemp, tempBat: p.tempBat, tempInv: p.tempInv,
  };
}
const syncMonitor = () => (isNative ? monitor.configure(monitorConfig(), state.flags).catch(() => {}) : Promise.resolve());

async function takeOverFromBackground() {
  if (!isNative || state.demo) return;
  try {
    const r = await monitor.takeOver();
    // رسائل الخادم في الخلفية تصل برموزها الإنجليزية (ERR_...)، فنترجمها بنفس جدول الواجهة
    const faults = (r.faults || []).map((f) => (f.kind === 'comm' ? { ...f, body: errorAr(f.body) } : f));
    // Kotlin يرسل التنبيه والحدث منفصلين، فيوحّدهما toEvents حتى لا يظهر الحدث مرتين
    const fresh = toEvents(r.alerts || [], faults);
    if (fresh.length) {
      state.log = addEvents(state.log, fresh);
      store.set('log', state.log);
    }
    if (r.flags && Object.keys(r.flags).length) state.flags = { ...state.flags, ...r.flags };
    store.set('flags', state.flags);
    // قد يكون الفحص في الخلفية جدّد رمز الدخول
    const s = await secure.get('session');
    if (s) { state.session = s; api = new WatchPowerApi(s); }
  } catch { /* تجاهل */ }
}

// ================= التنبيهات والأعطال =================
async function notify(title, body) {
  if (!state.prefs.notify || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2e9), title, body }] });
  } catch { /* تجاهل */ }
}

// كل حدث يُسجَّل مرة واحدة. alert: يرسل إشعاراً ويبقى «غير مقروء» حتى يُفتح تبويب التنبيهات،
// وإن أوقف المستخدم تنبيه هذا النوع يُسجَّل الحدث مقروءاً بلا إشعار
function logEvent(cat, level, title, body, alert = false) {
  state.log = addEvents(state.log, [{ cat, level, title, body, sn: sn(), at: Date.now(), read: !alert }]);
  store.set('log', state.log);
  if (alert) notify(title, body);
}

// يُطلق التنبيه مرة واحدة عند تجاوز الحد، ويُعاد تسليحه عند العودة للوضع الطبيعي
function edge(key, active, onRaise, onClear) {
  const was = state.flags[key];
  if (active && !was) onRaise?.();
  if (!active && was) onClear?.();
  state.flags[key] = !!active;
  store.set('flags', state.flags);
}

function checkAlerts(m) {
  if (state.demo) return;
  const p = state.prefs;
  // لا نُعلن الانقطاع من أول قراءة في الجلسة: قد يكون فرق توقيت لم يُكتشف بعد
  const first = state.fetchCount <= 1 || store.get('tzp.' + sn(), null) !== null;
  if (m.stale && state.flags.offline !== true) {
    if (first) state.flags.offline = 'silent';
    else {
      state.flags.offline = true;
      logEvent('conn', 'bad', 'الإنفرتر غير متصل', `لم تصل قراءات جديدة منذ ${fmt.ago(m.age).replace('قبل ', '')}. قد يكون الإنفرتر مطفأً أو مفصولاً.`, p.alertOffline);
    }
  } else if (!m.stale && state.flags.offline) {
    if (state.flags.offline === true) {
      logEvent('conn', 'ok', 'عاد اتصال الإنفرتر', `وصلت قراءة جديدة ${fmt.dateTime(m.ts)}`, p.alertOffline);
    }
    state.flags.offline = false;
  }
  store.set('flags', state.flags);
  if (m.stale) return; // لا نبني تنبيهات على قيم قديمة

  const fault = m.fault || (/fault/i.test(m.mode || '') ? trValue(m.mode) : null);
  if (fault !== (state.flags.faultCode || null)) {
    if (fault) {
      logEvent('fault', 'bad', 'عطل في الإنفرتر', `أبلغ الجهاز عن عطل: ${fault}`, true);
    } else if (state.flags.faultCode) logEvent('fault', 'ok', 'زال العطل', `العطل السابق: ${state.flags.faultCode}`);
    state.flags.faultCode = fault;
  }
  if (m.warning && m.warning !== state.flags.warnCode) logEvent('fault', 'warn', 'تحذير من الإنفرتر', `الرمز: ${m.warning}`);
  state.flags.warnCode = m.warning;

  // هامش رجوع (hysteresis): التنبيه لا يُعاد تسليحه إلا بعد ابتعاد واضح عن الحد،
  // حتى لا تتكرر الإشعارات مع تذبذب القراءة حول الحد نفسه
  const hold = (key, on, stillOn) => (state.flags[key] === true ? stillOn : on);
  if (m.soc !== null) {
    edge('lowSoc', hold('lowSoc', m.soc <= p.lowSoc && (m.batW ?? 0) <= 0, m.soc < p.lowSoc + 5),
      () => logEvent('bat', 'bad', 'البطارية منخفضة', `نسبة الشحن ${m.soc}% — يُنصح بتقليل الأحمال.${eta(m).known ? ' ' + eta(m).text : ''}`, true));
    if (p.alertFull) edge('full', hold('full', m.soc >= 100, m.soc >= 95), () => logEvent('bat', 'ok', 'البطارية ممتلئة', 'وصل الشحن إلى 100% — وقت مناسب لتشغيل الأحمال الكبيرة', true));
  }
  if (m.loadPct !== null) {
    edge('overload', hold('overload', m.loadPct >= p.overloadPct, m.loadPct >= p.overloadPct - 10), () => {
      logEvent('fault', 'bad', 'حمل زائد', `الحمل وصل إلى ${m.loadPct}% (${fmt.w(m.outW)})`, true);
    });
  }
  // الحرارة: فقط إن كان الجهاز يرسلها، مع هامش رجوع 5 درجات
  if (p.alertTemp) {
    if (m.batTemp !== null) edge('hotBat', hold('hotBat', m.batTemp >= p.tempBat, m.batTemp > p.tempBat - 5), () => {
      logEvent('fault', 'bad', 'حرارة البطارية مرتفعة', `${numAr(m.batTemp)}° — الحد ${p.tempBat}°. خفّف الحمل وتأكد من تهوية مكان البطارية.`, true);
    });
    if (m.invTemp !== null) edge('hotInv', hold('hotInv', m.invTemp >= p.tempInv, m.invTemp > p.tempInv - 5), () => {
      logEvent('fault', 'bad', 'حرارة الإنفرتر مرتفعة', `${numAr(m.invTemp)}° — الحد ${p.tempInv}°. خفّف الحمل وتأكد أن فتحات التهوية والمراوح تعمل.`, true);
    });
  }
  if (p.alertGrid && m.gridV !== null) {
    edge('gridOff', !m.gridOn, () => {
      logEvent('grid', 'warn', 'انقطعت كهرباء الشبكة', `المنظومة تعمل على البطارية${m.soc !== null ? ` (${fmt.pct(m.soc)})` : ''}`, true);
    }, () => {
      logEvent('grid', 'ok', 'عادت كهرباء الشبكة', `الجهد ${numAr(m.gridV)} فولت`, true);
    });
  }
  store.set('flags', state.flags);
}

// ================= حسابات البطارية =================
// الجهد الاسمي من الجهاز نفسه، أو تقديره من جهد البطارية لأنظمة 12/24/48 فولت
function nominalV(m) {
  if (m?.ratedV) return m.ratedV;
  if (m?.batV) return m.batV > 36 ? 48 : m.batV > 18 ? 24 : 12;
  return 48;
}

// ===== ميزات الخادم الاختيارية =====
// undefined = لم تُجرَّب بعد، true = يتيحها الخادم لهذا الحساب، false = رفضها فتُخفى الميزة.
// «لا توجد بيانات» (ERR_NO_RECORD) ليس رفضاً، وخطأ الشبكة لا يحكم على الميزة.
// الرفض الصريح (لا صلاحية / غير مدعوم) يخفي الميزة فوراً، وأي خطأ آخر من الخادم يُحسب، فتُخفى بعد 3 مرات متتالية
// حتى لا يُخفي خلل مؤقت في الخادم ميزة تعمل.
const cap = (k) => { const v = store.get(`cap.${k}.${sn()}`, undefined); return v === true ? true : v === false || v >= 3 ? false : undefined; };
const isRefusal = (e) => /صلاحية|لا يدعم|NO_AUTH|UNSUPPORT|PERMISSION|ACTION/i.test(`${e.desc || ''} ${e.message || ''}`);
async function optional(k, fn) {
  if (cap(k) === false) return null;
  const key = `cap.${k}.${sn()}`;
  try {
    const r = await fn();
    store.set(key, true);
    return r;
  } catch (e) {
    if (e.code !== undefined && e.code !== 12) {
      const prev = store.get(key, 0);
      store.set(key, isRefusal(e) ? false : (typeof prev === 'number' ? prev : 0) + 1);
    }
    throw e;
  }
}
// معلومات تتغير نادراً تُحفظ يوماً كاملاً
const cachedDay = (key) => { const c = store.get(`${key}.${sn()}`, null); return c && Date.now() - c.at < 864e5 ? c.v : undefined; };
const cacheDay = (key, v) => store.set(`${key}.${sn()}`, { at: Date.now(), v });

// قدرة الألواح المركّبة: ما أدخله المستخدم، وإلا ما سجّله المركّب على الخادم
const pvKwp = () => state.prefs.pvKwp || (state.plant?.nominalPower > 0 ? Number(state.plant.nominalPower) : null);

async function loadPlantInfo() {
  if (state.plant !== undefined) return;
  if (state.demo) { state.plant = { install: '2024-03-01 00:00:00', nominalPower: 5.5 }; return; }
  const c = cachedDay('plant');
  if (c !== undefined) { state.plant = c; return; }
  const pid = device()?.pid;
  state.plant = null;
  if (!pid) return;
  try {
    const p = await optional('plant', () => api.plantInfo(pid));
    state.plant = p ? { install: p.install || null, nominalPower: Number(p.nominalPower) || null, lat: Number(p.address?.lat) || null, lon: Number(p.address?.lon) || null } : null;
    cacheDay('plant', state.plant);
    if (['solar', 'device'].includes(leaf())) render();
  } catch { /* تبقى الميزة مخفية */ }
}

async function loadCollector(force = false) {
  if (state.demo) { state.collector = { datFetch: 300, status: 0 }; return; }
  const c = force ? undefined : cachedDay('wifi');
  if (c !== undefined) { state.collector = c; return; }
  const pn = device()?.pn;
  if (!pn) return;
  try {
    state.collector = await optional('wifi', () => api.collectorInfo(pn));
    cacheDay('wifi', state.collector);
    if (leaf() === 'device') render();
  } catch { /* تبقى الميزة مخفية */ }
}

function eta(m) {
  const p = state.prefs;
  if (!p.batteryAh) return { known: false, text: 'أدخل سعة البطارية لحساب المدة', sub: '' };
  if (m.stale || m.soc === null || m.batW === null) return { known: false, text: 'غير متاح حالياً', sub: '' };
  const nominal = nominalV(m);
  const wh = p.batteryAh * nominal;
  if (m.batW < -10) {
    const usable = Math.max(0, (m.soc - p.cutoffSoc) / 100) * wh;
    return { known: true, hours: usable / -m.batW, text: 'تكفي لمدة ' + fmt.hours(usable / -m.batW), sub: `حتى ${p.cutoffSoc}% بمعدل السحب الحالي` };
  }
  if (m.batW > 10) {
    const hrs = (Math.max(0, 100 - m.soc) / 100) * wh / m.batW;
    return { known: true, hours: hrs, text: 'يكتمل الشحن خلال ' + fmt.hours(hrs), sub: `نحو الساعة ${fmt.time(Date.now() + hrs * 36e5)} بمعدل الشحن الحالي` };
  }
  return { known: true, text: m.soc >= 99 ? 'البطارية ممتلئة' : 'البطارية مستقرة', sub: '' };
}

// سطر الحالة: الاتصال · الوضع · ما تفعله البطارية · متى تكتمل أو إلى متى تكفي (بساعة فعلية)
function statusBar(m, modeText, modeCls, e, live) {
  const parts = [`<span class="sb-conn"><i></i>${live ? 'متصل' : 'غير متصل'}</span>`];
  if (live) parts.push(`<span>${esc(modeText)}</span>`);
  if (live && m.batW > 10) parts.push(`<span class="sb-chg">تشحن <bdi>${fmt.wShort(m.batW)}</bdi></span>`);
  else if (live && m.batW < -10) parts.push(`<span class="sb-dis">تُفرّغ <bdi>${fmt.wShort(-m.batW)}</bdi></span>`);
  else if (live && (m.soc ?? 0) >= 99) parts.push('<span class="sb-chg">ممتلئة</span>');
  if (live && e.known && e.hours > 0 && e.hours < 72) parts.push(`<span>${m.batW > 10 ? 'تكتمل' : 'تكفي حتى'} <bdi>${fmt.time(Date.now() + e.hours * 36e5)}</bdi></span>`);
  return `<div class="status-bar ${modeCls}">${parts.join('<b class="sb-sep">·</b>')}</div>`;
}

const batState = (m) => (m.stale ? 'لا توجد قراءة حيّة' : m.batW > 10 ? `تشحن بقدرة ${fmt.w(m.batW)}` : m.batW < -10 ? `تُفرّغ بقدرة ${fmt.w(-m.batW)}` : 'في وضع الراحة');

// ================= الرئيسية =================
// خط تدفق بأسهم تتحرك باتجاه الطاقة الفعلي، وسرعتها تزيد مع القدرة.
// reverse يعني أن الطاقة تسير عكس اتجاه رسم الخط (مثل خروجها من البطارية عند التفريغ).
function flowLine(id, d, on, watts, reverse, kind = id) {
  const track = `<path class="wire" d="${d}"/>`;
  if (!on) return track;
  const dur = Math.max(0.7, 2.6 - Math.log10(Math.abs(watts || 50) + 1) * 0.5).toFixed(2);
  const keys = reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear" rotate="auto-reverse"' : 'rotate="auto"';
  // نبضات ضوء تسري على السلك باتجاه الطاقة
  // أسهم (›) تسري باتجاه الطاقة، بلون نوع التدفق: ألواح، شبكة، شحن، تفريغ، البيت
  const arrows = [0, 1, 2].map((i) => `
    <path class="arrow a-${id} k-${kind}" d="M-4 -4 L1 0 L-4 4">
      <animateMotion dur="${dur}s" begin="${(-i * dur / 3).toFixed(2)}s" repeatCount="indefinite" ${keys}><mpath href="#fp-${id}"/></animateMotion>
    </path>`).join('');
  return `${track}<path id="fp-${id}" class="flow-line f-${id} k-${kind}" d="${d}"/>${arrows}`;
}

// اتجاه البطارية مكتوباً تحت النسبة حتى يكون واضحاً بلا حاجة لمتابعة الحركة
function batTag(m, live) {
  if (!live || m.batW === null) return '<small>البطارية</small>';
  if (m.batW > 10) return `<small class="bt chg">↓ تشحن ${fmt.wShort(m.batW)}</small>`;
  if (m.batW < -10) return `<small class="bt dis">↑ تُفرّغ ${fmt.wShort(-m.batW)}</small>`;
  return '<small>مستقرة</small>';
}
function viewHome() {
  const m = state.model;
  if (!m) {
    return state.netError
      ? `<div class="empty">${icons.offline.replace('<svg', '<svg class="empty-ic"')}<b>تعذّر جلب بيانات الإنفرتر</b><p>${esc(state.netError)}</p><button class="btn primary" id="retryBtn">إعادة المحاولة</button></div>`
      : '<div class="empty"><div class="spinner"></div>جارٍ جلب بيانات الإنفرتر…</div>';
  }
  const pages = { load: pageLoad, battery: pageBattery, solar: pageSolar, grid: pageGrid, device: pageDevice };
  if (state.page && pages[state.page]) return banner() + pages[state.page](m);

  const isBat = /battery/i.test(m.mode || '') || (m.batW ?? 0) < -10;
  const isLine = /line|bypass/i.test(m.mode || '');
  const live = !m.stale;
  const modeText = m.stale ? 'غير متصل' : m.mode ? trValue(m.mode) : isLine ? 'وضع كهرباء الشبكة' : isBat ? 'وضع البطارية' : '—';
  const modeCls = m.stale ? 'm-off' : /fault/i.test(m.mode || '') ? 'm-fault' : isBat ? 'm-bat' : isLine ? 'm-line' : '';
  const soc = Math.max(0, Math.min(100, m.soc ?? 0));
  const C = 2 * Math.PI * 52;
  const e = eta(m);

  return `
  ${banner()}
  ${urgentTip(m)}
  <div class="home-grid"><div class="col-a">
  ${statusBar(m, modeText, modeCls, e, live)}
  ${scene(m, live, isLine)}
  ${(() => {
    // بنظرة واحدة: من أين تأتي الكهرباء، وكم يسحب البيت، وهل البطارية تشحن أم تُفرّغ
    const bw = live ? m.batW : null;
    const tile = (page, cls, ic, label, v, unit) => `<button class="kpi ${cls} ${live ? '' : 'stale'}" data-page="${page}"><span class="k-ic">${ic}</span><small>${label}</small><b><bdi>${v}</bdi></b><span class="k-u">${unit}</span></button>`;
    const kw = (w) => (w == null ? '—' : Math.abs(w) >= 1000 ? numAr(Math.abs(w) / 1000, 1) : String(Math.round(Math.abs(w))));
    const ku = (w) => (w != null && Math.abs(w) >= 1000 ? 'كيلوواط' : 'واط');
    return `<div class="kpis">
      ${tile('solar', 'k-solar', icons.sun, 'الألواح', kw(m.pvW), ku(m.pvW))}
      ${tile('load', 'k-load', icons.home, 'الاستهلاك', kw(m.outW), ku(m.outW))}
      ${tile('battery', bw > 10 ? 'k-chg' : bw < -10 ? 'k-dis' : 'k-bat', icons.battery, bw > 10 ? 'شحن البطارية' : bw < -10 ? 'تفريغ البطارية' : 'البطارية', bw == null || Math.abs(bw) <= 10 ? (live ? 'مستقرة' : '—') : kw(bw), bw == null || Math.abs(bw) <= 10 ? '' : ku(bw))}
    </div>`;
  })()}
  </div>
  <section class="card battery-card hg-bat ${live ? '' : 'stale'}" data-page="battery">
    <div class="ring gauge">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/>
        <circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:${(soc / 100) * C} ${C};stroke:${soc < 25 ? 'var(--bad)' : soc < 50 ? 'var(--warn)' : 'var(--bat)'}"/></svg>
      <div class="ring-txt">${icons.battery}<b>${m.soc ?? '—'}%</b><small>الشحن</small></div>
    </div>
    <div class="bat-info">
      <div class="bat-state ${live && m.batW > 10 ? 'chg' : live && m.batW < -10 ? 'dis' : ''}">${esc(batState(m))}</div>
      <div class="bat-eta">${e.known ? esc(e.text) + infoBtn('eta') : `<button class="link" data-goto="more:settings">${esc(e.text)}</button>`}</div>
      <div class="bat-sub"><bdi>${fmt.v(m.batV)}</bdi>${e.sub ? ' · ' + esc(e.sub) : ''}</div>
    </div>
  </section>
  <div class="col-b">
  <h3 class="sec-h">التفاصيل</h3>
  ${gridCards([
    ...[
      { page: 'grid', title: 'كهرباء الشبكة', info: 'gridHours', icon: icons.grid, color: 'c-violet', value: m.gridV === null ? '—' : m.gridOn ? `${numAr(m.gridV, 1)} فولت` : 'مقطوعة', sub: m.gridOn ? (isLine ? 'تغذّي الحمل الآن' : 'متوفرة كاحتياط') : 'لا يوجد تيار' },
    ].map((c) => (live ? c : { ...c, sub: 'آخر قيمة مسجّلة' })),
    // البطارية ظاهرة في المخطط والحلقة، فمكانها هنا للإنفرتر نفسه
    { page: 'device', title: 'الإنفرتر', icon: icons.inverter, color: m.stale ? 'c-slate' : m.fault ? 'c-pink' : 'c-green',
      value: m.stale ? 'غير متصل' : m.fault ? 'يوجد عطل' : 'يعمل', sub: m.stale ? fmt.ago(m.age) : m.mode ? trValue(m.mode) : 'الحالة والإعدادات' },
  ], live ? '' : 'stale')}
  </div></div>`;
}

// ================= المشهد: البيت والألواح والبطارية والشبكة مع الطقس الحقيقي =================
// السماء من الطقس الفعلي لموقع المنظومة، والخطوط تتحرك باتجاه الطاقة الحقيقي، وتحتها جملة تشرح ما يحدث الآن.
function currentSky(m) {
  const w = state.weather;
  if (w && Date.now() - w.at < 2 * 36e5) return w.sky;
  // بلا طقس: ليل أو نهار من الساعة والإنتاج فقط
  const h = new Date().getHours();
  return h < 6 || h >= 18 ? 'night' : (m?.pvW ?? 0) > 50 ? 'clear' : 'partly';
}

// حالة الخطوط والتسميات من القراءة: نفس المنطق للرئيسية ولشاشات التعريف
function sceneParts(m, live, isLine) {
  const pv = live && (m.pvW ?? 0) > 5;
  return {
    soc: Math.max(0, Math.min(100, m.soc ?? 0)),
    flows: {
      solar: { on: pv, w: m.pvW, reverse: false, kind: 'sun' },
      grid: { on: live && isLine && m.gridOn, w: 300, reverse: false, kind: 'grid' },
      load: { on: live && (m.outW ?? 0) > 5, w: m.outW, reverse: false, kind: 'load' },
      // المسار مرسوم من الإنفرتر إلى البطارية، فالتفريغ يسير عكسه وبلون مختلف عن الشحن
      bat: { on: live && Math.abs(m.batW ?? 0) > 10, w: m.batW, reverse: (m.batW ?? 0) < 0, kind: (m.batW ?? 0) < 0 ? 'dis' : 'chg' },
    },
    labels: {
      solar: { value: fmt.wShort(m.pvW), dim: !pv },
      grid: { title: live && isLine && m.gridOn ? 'الشبكة تغذّي' : 'الشبكة', value: m.gridOn ? numAr(m.gridV) + ' فولت' : 'مقطوعة', dim: !(m.gridOn && live) },
      bat: { value: `${m.soc ?? '—'}%`, tag: batTag(m, live), dim: !live },
      load: { value: fmt.wShort(m.outW), dim: !((m.outW ?? 0) > 5 && live) },
    },
  };
}

const SKY_FX = `<div class="sky-fx" aria-hidden="true">
      <i class="sun"></i><i class="moon"></i><i class="stars"></i>
      <i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>
      <i class="rain"></i><i class="flash"></i><i class="fog"></i>
    </div>`;
const sceneStyle = () => (['photo', '3d', 'classic'].includes(state.prefs.sceneStyle) ? state.prefs.sceneStyle : 'photo');

// يرسم جسم المشهد بالشكل المختار، ويعيد صنف البطاقة الإضافي
function sceneBody(m, live, isLine, sky, parts, sunset) {
  const style = sceneStyle();
  if (style === 'photo') {
    const gridFeeds = live && isLine && m.gridOn;
    const img = photoFor({ live, sky, gridFeeds, sunset });
    const pvLow = (m.pvW ?? 0) < 50;
    const bat = batLook({ soc: m.soc, batW: m.batW, live, low: state.prefs.lowSoc, gridCharging: gridFeeds && pvLow });
    const led = !live ? 'off' : m.fault ? 'bad' : 'ok';
    return { cls: `st-photo ph-${img} ${photoIsDark(img) ? 'ph-dark' : ''}`, html: scenePhoto({ img, ...parts, flowLine, bat, led }) };
  }
  const look = batLook({ soc: m.soc, batW: m.batW, live, low: state.prefs.lowSoc, gridCharging: live && isLine && m.gridOn && (m.pvW ?? 0) < 50 });
  if (style === 'classic') return { cls: 'st-classic', html: SKY_FX + sceneClassic({ ...parts, flowLine, bat: look }) };
  return { cls: 'st-3d', html: SKY_FX + scene3d({ ...parts, flowLine, bat: look }) };
}

const FLOW_NAMES = { sun: 'من الألواح', grid: 'من الشبكة', chg: 'شحن البطارية', dis: 'من البطارية', load: 'إلى البيت' };
function flowLegend(flows) {
  const on = ['solar', 'grid', 'bat', 'load'].filter((k) => flows[k].on).map((k) => flows[k].kind);
  if (!on.length) return '<div class="flow-legend"><span class="fl-none">لا تمر طاقة الآن</span></div>';
  return `<div class="flow-legend">${on.map((k) => `<span class="fl k-${k}"><i></i>${FLOW_NAMES[k]}</span>`).join('')}</div>`;
}

function scene(m, live, isLine) {
  const sky = currentSky(m);
  const pv = live && (m.pvW ?? 0) > 5;
  const w = state.weather && Date.now() - state.weather.at < 2 * 36e5 ? state.weather : null;
  const story = sceneStory(m, w, { kwp: pvKwp(), lowSoc: state.prefs.lowSoc });
  const loc = weatherLoc();
  const parts = sceneParts(m, live, isLine);
  const full = (m.soc ?? 0) >= 98;
  const body = sceneBody(m, live, isLine, sky, parts, w?.sunset);
  // الطقس في صف الشرائح تحت المشهد، فلا يزاحم القيم فوق الصورة
  const wxNote = w ? '' : loc ? '<span class="tchip"><small>جارٍ جلب الطقس…</small></span>' : '<button class="tchip link" data-goto="more:settings">حدّد موقع منظومتك لعرض الطقس</button>';
  // درجات الحرارة: الجو من الطقس، والإنفرتر والبطارية إن كان الجهاز يرسلها
  const temps = [
    wxNote,
    w?.temp != null ? `<span class="tchip" title="حرارة الجو">${icons.thermo}<b><bdi>${w.temp}°</bdi></b><small>الجو · ${esc(SKY_AR[w.sky] || '')}${loc?.name ? ' · ' + esc(loc.name) : ''}</small></span>` : '',
    w?.sunrise && w?.sunset ? `<span class="tchip sun-t" title="الشروق والغروب">${icons.sun}<b><bdi>${fmt.hm(w.sunrise)}</bdi></b><small>إلى</small><b><bdi>${fmt.hm(w.sunset)}</bdi></b></span>` : '',
    m.invTemp != null ? `<span class="tchip ${m.invTemp >= state.prefs.tempInv ? 'hot' : ''}">${icons.inverter}<b><bdi>${numAr(m.invTemp)}°</bdi></b><small>الإنفرتر</small></span>` : '',
    m.batTemp != null ? `<span class="tchip ${m.batTemp >= state.prefs.tempBat ? 'hot' : ''}">${icons.battery}<b><bdi>${numAr(m.batTemp)}°</bdi></b><small>البطارية</small></span>` : '',
  ].join('');
  return `
  <section class="card flow-card scene ${body.cls} sky-${sky} ${live ? '' : 'stale'} ${pv ? 'pv-on' : ''} ${full ? 'bat-full' : ''} ${parts.flows.bat.on ? (parts.flows.bat.reverse ? 'bat-dis' : 'bat-chg') : ''}">
    ${body.html}
  </section>
  ${flowLegend(parts.flows)}
  ${temps ? `<div class="tchips">${temps}</div>` : ''}
  ${story ? `<section class="story ${story.level}"><b>${esc(story.title)}</b><p>${esc(story.text)}</p></section>` : ''}
  ${state.demo ? `<div class="chips-sel demo-sky">${[['', 'الآن'], ['clear', 'مشمس'], ['partly', 'غائم جزئياً'], ['rain', 'ماطر'], ['night', 'ليل']].map(([k, l]) => `<button data-demo-sky="${k}" class="${(state.demoSky || '') === k ? 'on' : ''}">${l}</button>`).join('')}</div>` : ''}`;
}

// موقع الطقس: ما سجّله المركّب على الخادم، وإلا ما اختاره المستخدم من الإعدادات
const weatherLoc = () => state.prefs.loc || (state.plant?.lat && state.plant?.lon ? { lat: state.plant.lat, lon: state.plant.lon, name: '' } : null);

async function loadWeather(force = false) {
  if (state.demo) return;
  const loc = weatherLoc();
  if (!loc) return;
  const key = `${(+loc.lat).toFixed(2)},${(+loc.lon).toFixed(2)}`;
  const c = store.get('wx', null);
  if (!force && c && c.key === key && Date.now() - c.w.at < 30 * 60000) { state.weather = c.w; return; }
  if (state.wxLoading) return;
  state.wxLoading = true;
  try {
    state.weather = await fetchWeather(loc.lat, loc.lon);
    store.set('wx', { key, w: state.weather });
    if (state.tab === 'home' && !state.page) render();
  } catch { /* يبقى المشهد بلا طقس حتى المحاولة التالية */ }
  state.wxLoading = false;
}

// طقس الوضع التجريبي: يتبع السيناريو المختار حتى يمكن رؤية كل الحالات
function demoWeather(sky) {
  const night = sky === 'night';
  return { temp: night ? 9 : sky === 'rain' ? 13 : 24, code: { clear: 0, partly: 2, rain: 63, night: 0 }[sky] ?? 0, cloud: { clear: 5, partly: 45, rain: 95, night: 10 }[sky] ?? 0,
    isDay: !night, rad: { clear: 820, partly: 520, rain: 90, night: 0 }[sky] ?? 0, sunrise: '06:31', sunset: '16:58', sky, at: Date.now() };
}

// ملاحظة عاجلة واحدة من النصائح المخصّصة تظهر في الرئيسية حتى لا تفوت المستخدم
function urgentTip(m) {
  if (!m || m.stale || state.demo) return '';
  const t = smartTips(m, state.prefs).find((x) => x.level === 'bad' || x.level === 'warn');
  return t ? `<button class="banner warn tip-banner" data-goto="reports:advisor">${icons.bulb}<span><b>${esc(t.title)}</b>${esc(t.body)}</span></button>` : '';
}
AFTER.home = () => {
  bindGoto();
  loadPlantInfo().then(() => loadWeather());
  document.querySelectorAll('[data-demo-sky]').forEach((b) => {
    b.onclick = () => { state.demoSky = b.dataset.demoSky || null; state.weather = state.demoSky ? demoWeather(state.demoSky) : null; refresh(); };
  });
  const r = $('#retryBtn');
  if (r) r.onclick = () => { r.disabled = true; r.textContent = 'جارٍ المحاولة…'; refresh(true); };
};

function bindGoto() {
  document.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); const [t, p] = b.dataset.goto.split(':'); navigate(t, p || null); };
  });
}

function hero(icon, color, label, value, sub, info = '') {
  return `<section class="hero ${color}"><span class="g-deco">${icon}</span><div class="h-ic">${icon}</div>
    <small>${esc(label)}${infoBtn(info)}</small><b><bdi>${esc(value)}</bdi></b>${sub ? `<span>${esc(sub)}</span>` : ''}</section>`;
}

function miniChart(id, title) {
  return `<section class="card"><div class="card-h"><h2>${esc(title)}</h2><small class="muted">من قراءات اليوم المحفوظة</small></div><div class="chart-box sm"><canvas id="${id}"></canvas></div></section>`;
}

function drawToday(id, field, color, label, opts) {
  const s = state.demo ? rowsToSamples(demoHistory(today())) : localDay(sn(), today());
  const el = document.getElementById(id);
  if (!el) return;
  if (s.length < 3) {
    el.parentElement.innerHTML = '<p class="hint center">سيظهر الرسم بعد تجميع عدة قراءات اليوم (يُسجّل التطبيق كل قراءة جديدة تصله).</p>';
    return;
  }
  lineChart(id, s.map((x) => x.ts), [{ label, data: s.map((x) => x[field]), color }], opts);
}

function pageLoad(m) {
  const pf = m.outW !== null && m.outVA ? (m.outW / m.outVA).toFixed(2) : null;
  const rated = m.ratedW;
  const pct = Math.max(0, Math.min(100, m.loadPct ?? 0));
  return `
  ${hero(icons.home, 'c-sky', 'الحمل الحالي', fmt.w(m.outW), m.stale ? 'آخر قيمة مسجّلة' : trValue(m.loadStatus || ''), 'loadNow')}
  <section class="card">
    ${cardH('نسبة الحمل من قدرة الإنفرتر', '', `<b>${m.loadPct ?? '—'}%</b>`)}
    <div class="bar"><i class="${pct >= state.prefs.overloadPct ? 'hot' : pct >= 50 ? 'warm' : ''}" style="width:${pct}%"></i></div>
    <div class="bar-legend"><span>0</span><span>${rated ? `القدرة القصوى ${rated} واط` : ''}</span></div>
    ${!m.stale && rated && m.outW !== null ? `<p class="hint">المتبقي المتاح للتشغيل: <b>${fmt.w(Math.max(0, rated - m.outW))}</b>${infoBtn('loadLeft')}</p>` : ''}
  </section>
  <div class="stats">
    ${stat('القدرة الفعلية', numAr(m.outW), 'واط', 'c-sky')}
    ${stat('القدرة الظاهرية', numAr(m.outVA), 'فولت أمبير', 'c-violet', '', 'apparent')}
    ${stat('جهد الخرج', numAr(m.outV, 1), 'فولت', 'c-green')}
    ${stat('تردد الخرج', numAr(m.outHz, 1), 'هرتز', 'c-amber')}
    ${pf ? stat('معامل القدرة', pf, 'محسوب', 'c-pink', '', 'apparent') : ''}
    ${stat('حالة الحمل', m.loadStatus ? trValue(m.loadStatus) : '—', '', 'c-slate')}
  </div>
  ${miniChart('cLoadToday', 'الحمل خلال اليوم')}`;
}
AFTER.load = () => drawToday('cLoadToday', 'outW', '#38bdf8', 'واط', { y: { beginAtZero: true } });

function pageBattery(m) {
  const e = eta(m);
  const cfg = m.raw.filter((r) => /battery/i.test(r.title) && r.group === 'config');
  return `
  ${hero(icons.battery, 'c-green', 'نسبة الشحن', m.soc !== null ? m.soc + '%' : '—', batState(m), 'soc')}
  <section class="card">
    ${cardH('المدة المتوقعة', 'eta')}
    <div class="big-line">${e.known ? esc(e.text) : `<button class="link" data-goto="more:settings">${esc(e.text)}</button>`}</div>
    ${state.prefs.batteryAh ? `<p class="hint">${e.sub ? esc(e.sub) + ' · ' : ''}بطارية ${state.prefs.batteryAh} أمبير ساعة على ${nominalV(m)} فولت</p>` : ''}
  </section>
  <div class="stats">
    ${stat('الجهد', numAr(m.batV, 1), 'فولت', 'c-green')}
    ${stat('القدرة', m.batW === null ? '—' : numAr(Math.abs(m.batW)), m.batW > 0 ? 'واط شحن' : m.batW < 0 ? 'واط تفريغ' : 'واط', 'c-amber', '', 'batPower')}
    ${stat('تيار الشحن', numAr(m.chgA), 'أمبير', 'c-sky')}
    ${stat('تيار التفريغ', numAr(m.disA), 'أمبير', 'c-pink')}
    ${m.batTemp !== null ? stat('حرارة البطارية', numAr(m.batTemp), '°م', 'c-violet') : ''}
  </div>
  ${cfg.length ? `<section class="card"><div class="card-h"><h2>إعدادات البطارية في الإنفرتر</h2></div>${kv(cfg.map((r) => [r.ar, val(r.valAr, trUnit(r.unit))]))}</section>` : ''}
  ${miniChart('cSocToday', 'نسبة الشحن خلال اليوم')}`;
}
AFTER.battery = () => { bindGoto(); drawToday('cSocToday', 'soc', '#34d399', '%', { y: { min: 0, max: 100 } }); };

function pageSolar(m) {
  const pv2 = m.pv2V !== null || m.pv2W !== null;
  const kwp = pvKwp();
  return `
  ${hero(icons.panel, 'c-amber', 'إنتاج الألواح الآن', fmt.w(m.pvW), m.pvW > 5 && !m.stale ? (kwp ? `${Math.round((m.pvW / (kwp * 1000)) * 100)}% من قدرة ألواحك` : 'الألواح تنتج الآن') : m.stale ? 'آخر قيمة مسجّلة — لا تقدير حي' : 'لا يوجد إنتاج حالياً', kwp && m.pvW > 5 && !m.stale ? 'pvShare' : 'solarNow')}
  <div class="stats">
    ${stat('إنتاج اليوم', m.todayWh !== null ? fmt.kwh(m.todayWh / 1000) : '—', 'كيلوواط ساعة', 'c-amber', '', 'todayWh')}
    ${stat('الإنتاج الكلي', m.totalWh !== null ? fmt.kwh(m.totalWh / 1000) : '—', state.plant?.install ? `كيلوواط ساعة · منذ ${String(state.plant.install).slice(0, 4)}` : 'كيلوواط ساعة', 'c-green', '', 'totalWh')}
    ${kwp && m.todayWh !== null ? stat('إنتاج كل كيلوواط ألواح', (m.todayWh / 1000 / kwp).toFixed(2), 'ك.و.س اليوم', 'c-sky', '', 'yieldKwp') : ''}
  </div>
  ${kwp ? '' : '<button class="link pad" data-goto="more:settings">أدخل قدرة ألواحك المركّبة لمقارنة إنتاج أيامك</button>'}
  <section class="card"><div class="card-h"><h2>المدخل الأول (PV1)</h2></div>
    ${kv([['الجهد', val(numAr(m.pv1V, 1), 'فولت')], ['التيار', val(m.pv1A === null ? null : numAr(m.pv1A, 1), 'أمبير')], ['القدرة', val(m.pv1W === null ? null : numAr(m.pv1W), 'واط')]])}
  </section>
  ${pv2 ? `<section class="card"><div class="card-h"><h2>المدخل الثاني (PV2)</h2></div>
    ${kv([['الجهد', val(m.pv2V === null ? null : numAr(m.pv2V, 1), 'فولت')], ['التيار', val(m.pv2A === null ? null : numAr(m.pv2A, 1), 'أمبير')], ['القدرة', val(m.pv2W === null ? null : numAr(m.pv2W), 'واط')]])}
  </section>` : ''}
  ${m.feedW !== null ? `<section class="card">${kv([['القدرة المُصدَّرة للشبكة', val(numAr(m.feedW), 'واط')]])}</section>` : ''}
  ${miniChart('cPvToday', 'إنتاج الألواح خلال اليوم')}`;
}
AFTER.solar = () => { bindGoto(); loadPlantInfo(); drawToday('cPvToday', 'pvW', '#fbbf24', 'واط', { y: { beginAtZero: true } }); };

function pageGrid(m) {
  const cfg = m.raw.filter((r) => /input range|charger source/i.test(r.title));
  const sum = summarize(today(), state.demo ? rowsToSamples(demoHistory(today())) : localDay(sn(), today()), 'local');
  return `
  ${hero(icons.grid, 'c-violet', 'حالة كهرباء الشبكة', m.gridV === null ? '—' : m.gridOn ? 'متوفرة' : 'مقطوعة', m.gridOn ? `${numAr(m.gridV, 1)} فولت · ${numAr(m.gridHz, 1)} هرتز` : '')}
  <div class="stats">
    ${stat('الجهد', numAr(m.gridV, 1), 'فولت', 'c-violet')}
    ${stat('التردد', numAr(m.gridHz, 1), 'هرتز', 'c-sky')}
    ${sum.coveredH > 0.5 ? stat('ساعات توفرها اليوم', numAr(sum.gridH, 1), `من ${numAr(sum.coveredH, 1)} ساعة مسجّلة`, 'c-green') : ''}
  </div>
  ${cfg.length ? `<section class="card">${kv(cfg.map((r) => [r.ar, val(r.valAr, trUnit(r.unit))]))}</section>` : ''}
  ${miniChart('cGridToday', 'جهد كهرباء الشبكة خلال اليوم')}`;
}
AFTER.grid = () => drawToday('cGridToday', 'gridV', '#a78bfa', 'فولت', { y: { beginAtZero: true } });

// ================= الرسوم =================
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function lineChart(id, labels, series, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  charts.push(new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((d) => ({
        label: d.label, data: timePoints(labels, d.data), borderColor: d.color, borderWidth: opts.smooth ? 2.5 : 2, pointRadius: opts.smooth ? 0 : 1.5, pointHoverRadius: 5, tension: opts.smooth ? 0.35 : 0, fill: true, spanGaps: false,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: c } = ctx.chart;
          if (!chartArea) return 'transparent';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, d.color + '55');
          g.addColorStop(1, d.color + '00');
          return g;
        },
      })),
    },
    options: chartOpts(series.length > 1, { ...opts, time: true }),
  }));
}

function barChart(id, labels, series, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  charts.push(new Chart(el, {
    type: 'bar',
    data: { labels, datasets: series.map((d) => ({ label: d.label, data: d.data, backgroundColor: d.color, borderRadius: 6, maxBarThickness: 22 })) },
    options: chartOpts(series.length > 1, opts),
  }));
}

function chartOpts(legend, opts) {
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 500 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, labels: { boxWidth: 10, usePointStyle: true } },
      // عند اللمس: الوقت (أو اليوم) والقيمة والوحدة
      tooltip: { callbacks: { ...(opts.time ? { title: items => fmt.time(items[0]?.parsed.x) } : {}), ...(opts.unit ? { label: (it) => ` ${it.dataset.label}: ${it.parsed.y == null ? '—' : it.parsed.y.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${opts.unit}` } : {}) }, rtl: true, backgroundColor: '#0f1a33ee', titleColor: '#fff', bodyColor: '#e2e8f0', padding: 10 },
    },
    scales: {
      x: { ...(opts.time ? { type: 'linear' } : {}), ticks: { ...(opts.time ? { callback: v => fmt.time(v) } : {}), maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } },
      y: { grid: { color: css('--line') }, ...opts.y },
    },
  };
}

// ================= التقارير =================
// عدد الملاحظات المهمة الآن (تحذير أو خطر) من قراءة حيّة فقط
const urgentCount = () => (state.model && !state.model.stale ? smartTips(state.model, state.prefs).filter((t) => t.level === 'bad' || t.level === 'warn').length : 0);

// مؤشر الاستقلالية في رأس تبويب التقارير: من تحليل آخر 7 أيام نفسه، ويفتح الملاحظات عند الضغط
function independenceCard() {
  const a = state.rep.adv;
  const head = (extra) => `<div class="card-h"><h2>${icons.sun} مؤشر الاستقلالية عن الكهرباء${infoBtn('independence')}</h2>${extra}</div>`;
  if (!a || a.loading) return `<section class="card adv-ind">${head('')}<div class="bar"><i id="advProg" style="width:${a?.pct || 0}%"></i></div><p class="hint center">جارٍ حساب آخر 7 أيام…</p></section>`;
  const m = state.model;
  const r = analyze(a.sums, { todayKey: today(), prefs: state.prefs, ratedW: m?.ratedW || null, volts: m?.ratedV || nominalV(m), model: m });
  const ind = r.independence;
  return `<button class="card adv-ind" data-page="advisor" aria-label="مؤشر الاستقلالية، اضغط لعرض الملاحظات">
    ${head(`<small class="muted">${r.days ? 'آخر ' + countAr(r.days, DAY) + ' مكتملة' : ''}</small>`)}
    ${ind == null ? '<p class="hint">يحتاج المؤشر إلى وضع التشغيل (شبكة/بطارية) في سجل الجهاز ليوم كامل على الأقل.</p>' : `
    <div class="adv-big"><b>${Math.round(ind)}%</b><span>من استهلاك بيتك جاء من الألواح والبطارية</span></div>
    <div class="bar"><i style="width:${Math.round(ind)}%"></i></div>
    <div class="adv-days">${r.independenceDays.map((d) => `<span title="${Math.round(d.v)}%"><i style="height:${Math.max(4, Math.round(d.v))}%"></i><small>${Number(d.date.slice(8))}</small></span>`).join('')}</div>`}
  </button>`;
}

function viewReports() {
  const pages = { period: pagePeriod, day: pageDay, week: () => pageRange('week'), month: () => pageRange('month'), year: pageYear, advisor: pageAdvisor, forecast: pageForecast, gridmeter: pageGridMeter };
  if (state.page && pages[state.page]) return pages[state.page]();
  const urgent = urgentCount();
  return `
  ${reportsHero()}
  <h3 class="sec-h">تحليلات${infoBtn('report')}</h3>
  ${listCards([
    { page: 'advisor', title: 'ملاحظات على منظومتك', sub: 'ما يحتاج انتباهك الآن، واستخدام البطارية وتوصيات آخر 7 أيام', icon: icons.bulb, color: urgent ? 'c-pink' : 'c-green', badge: urgent ? `${urgent} مهم` : '' },
    { page: 'gridmeter', title: 'كهرباء الشبكة', sub: 'ما سحبته من الشبكة يومياً وأسبوعياً وشهرياً وكلفته (تقدير)', icon: icons.grid, color: 'c-violet' },
    { page: 'forecast', title: 'تقدير الأسبوعين القادمين', sub: 'مقارنة آخر أسبوعين، والعجز المتوقع، واقتراح احتياطي البطارية', icon: icons.chart, color: 'c-sky' },
  ].filter(Boolean))}`;
}

// ================= واجهة التقارير: يوم / أسبوع / شهر برقم رئيسي ورسم تفاعلي ومقارنة =================
const HERO_KINDS = [['day', 'يوم'], ['week', 'أسبوع'], ['month', 'شهر'], ['year', 'سنة'], ['period', 'فترة']];
// هل نوع التقرير هذا معروض الآن (صفحة مستقلة أو داخل واجهة التقارير)؟
const repShowing = (k) => leaf() === k || (state.tab === 'reports' && !state.page && (state.rep.heroKind || 'day') === k);
function heroDates(kind) {
  if (kind === 'day') { const d = state.rep.heroDate || today(); return { cur: [d], prev: [addDays(d, -1)] }; }
  const n = kind === 'week' ? 7 : 30;
  const cur = Array.from({ length: n }, (_, i) => today(i - n + 1));
  const prev = Array.from({ length: n }, (_, i) => today(i - 2 * n + 1));
  return { cur, prev };
}
async function loadHero(kind) {
  const token = Symbol('hero');
  const { cur, prev } = heroDates(kind);
  serverHistFails = 0;
  const date = kind === 'day' ? cur[0] : null;
  state.rep.hero = { kind, date, loading: true, token, pct: 0 };
  render();
  const all = await loadSummaries([...cur, ...prev], (done, total) => {
    if (state.rep.hero?.token !== token) return;
    state.rep.hero.pct = (done / total) * 100;
    const p = $('#heroProg');
    if (p) p.style.width = state.rep.hero.pct + '%';
  });
  let samples = null;
  if (kind === 'day') { try { samples = (await daySamples(date)).samples; } catch { samples = []; } }
  if (state.rep.hero?.token !== token) return;
  state.rep.hero = { kind, date, cur: all.slice(0, cur.length), prev: all.slice(cur.length), samples, at: Date.now() };
  if (state.tab === 'reports' && !state.page) render();
}

function reportsHero() {
  const kind = state.rep.heroKind || 'day';
  const h = state.rep.hero;
  const seg = `<div class="seg hero-seg">${HERO_KINDS.map(([k, l]) => `<button data-hk="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  // السنة والفترة المخصّصة: تُعرض هنا مباشرة، فلا حاجة لصفحات منفصلة
  if (kind === 'year') return seg + pageYear();
  if (kind === 'period') return seg + pagePeriod();
  const hd = state.rep.heroDate || today();
  const dayNav = kind === 'day' ? `<section class="day-nav card hero-day">
    <button class="icon-btn" data-hd="-1" aria-label="اليوم السابق">${icons.chevR}</button>
    <label class="day-label"><b>${esc(dateLabel(hd))}</b><input type="date" id="heroDate" value="${hd}" max="${today()}" aria-label="اختيار اليوم"></label>
    <button class="icon-btn" data-hd="1" aria-label="اليوم التالي" ${hd >= today() ? 'disabled' : ''}>${icons.chevL}</button>
  </section>` : '';
  if (!h || h.kind !== kind || h.loading || (kind === 'day' && h.date !== hd)) {
    return seg + dayNav + `<section class="card rep-hero"><p class="hint center">جارٍ تجميع القراءات…</p><div class="bar"><i id="heroProg" style="width:${h?.pct || 0}%"></i></div></section>`;
  }
  const t = totals(h.cur), p = totals(h.prev);
  const prevName = { day: hd === today() ? 'أمس' : 'اليوم السابق', week: 'الأسبوع السابق', month: 'الـ30 يوماً السابقة' }[kind];
  const isToday = kind === 'day' && hd === today();
  // اليوم لم يكتمل: لا نسبة تغيّر مضللة مقابل يوم كامل
  const chg = (k, better) => { const c = p.days && !isToday ? change(t[k], p[k], better) : null; return c ? `<em class="trend ${c.cls}">${c.text}</em>` : ''; };
  const cover = t.load > 0 ? Math.min(100, (t.pv / t.load) * 100) : null;
  // الحلقة الأولى تفتح «ملاحظات على منظومتك» (التفاصيل والتوصيات)
  const ring = (v, cls, label, sub, page = '') => {
    const C = 2 * Math.PI * 44;
    const tag = page ? 'button' : 'div';
    return `<${tag} class="card ring-card ${cls}"${page ? ` data-page="${page}"` : ''}><b class="rc-t">${label}</b><small>${sub}</small><div class="rc">
      <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="ring-bg"/><circle cx="50" cy="50" r="44" class="ring-fg" style="stroke-dasharray:${v == null ? 0 : (v / 100) * C} ${C}"/></svg>
      <span><bdi>${v == null ? '—' : Math.round(v) + '%'}</bdi></span></div></${tag}>`;
  };
  const row = (label, k, better, unit = 'ك.و.س') => `<div class="cmp-r"><span>${label}</span><b><bdi>${t[k] == null ? '—' : fmt.kwh(t[k])}</bdi> <small>${unit}</small></b><small class="muted">${prevName}: <bdi>${p[k] == null || !p.days ? '—' : fmt.kwh(p[k])}</bdi></small>${chg(k, better)}</div>`;
  const gc = t.grid != null ? costOf(t.grid, state.prefs) : null;
  return seg + dayNav + `
  <section class="card rep-hero">
    <small class="rh-l">إنتاج الألواح · ${isToday ? 'حتى الآن' : kind === 'day' ? 'اليوم كاملاً' : kind === 'week' ? 'آخر 7 أيام' : 'آخر 30 يوماً'}</small>
    <div class="rh-big"><b><bdi>${fmt.kwh(t.pv)}</bdi></b><span>كيلوواط ساعة</span>${chg('pv', 'up')}</div>
    <div class="chart-box hero-chart"><canvas id="cHero"></canvas></div>
    <small class="hint">المس الرسم لترى ${kind === 'day' ? 'الوقت' : 'اليوم'} والقيمة.</small>
  </section>
  <div class="ring-row">${ring(t.independence, 'r-green', 'الاستقلالية', 'من الاستهلاك بعيداً عن الشبكة', 'advisor')}${ring(cover, 'r-amber', 'تغطية الألواح', 'الإنتاج مقابل الاستهلاك')}</div>
  <section class="card cmp-card"><div class="card-h"><h2>مقارنة بـ${prevName}</h2></div>
    ${row('الإنتاج', 'pv', 'up')}${row('الاستهلاك', 'load', 'down')}${row('سحب الشبكة (تقدير)', 'grid', 'down')}
    ${gc ? `<div class="cmp-r"><span>كلفة الشبكة</span><b><bdi>${esc(costText(gc))}</bdi></b></div>` : ''}
    ${isToday ? '<p class="hint">اليوم لم ينتهِ بعد، فالمقارنة مع أمس كاملاً للاطلاع فقط.</p>' : ''}
  </section>
  <button class="lcard rep-more" data-page="${kind}">${kind === 'day' ? 'كل رسوم اليوم: البطارية والجهد وإعادة المشاهدة' : kind === 'week' ? 'التقرير الأسبوعي المفصّل: كل يوم والتغيّر' : 'التقرير الشهري المفصّل: مجموع الشهر وأفضل يوم'}<span class="l-go">${icons.chevL}</span></button>
  <div class="rep-actions"><button class="btn soft" id="heroCsv">${icons.download} تصدير CSV</button><button class="btn primary" id="heroPdf">${icons.download} مشاركة PDF</button></div>`;
}

AFTER.reports = () => {
  bindGoto();
  document.querySelectorAll('[data-hk]').forEach((b) => { b.onclick = () => { state.rep.heroKind = b.dataset.hk; render(); }; });
  const kind = state.rep.heroKind || 'day';
  if (kind === 'year') { AFTER.year(); return; }
  if (kind === 'period') { AFTER.period(); return; }
  const moveDay = (d) => { if (!d || d > today()) return; state.rep.heroDate = d; loadHero('day'); };
  document.querySelectorAll('[data-hd]').forEach((b) => { b.onclick = () => moveDay(addDays(state.rep.heroDate || today(), Number(b.dataset.hd))); });
  const hdIn = $('#heroDate');
  if (hdIn) hdIn.onchange = () => moveDay(hdIn.value);
  const more = $('.rep-more');
  if (more && kind === 'day') more.addEventListener('click', () => { state.rep.dayDate = state.rep.heroDate || today(); state.rep.day = null; }, true);
  const h = state.rep.hero;
  const hd = state.rep.heroDate || today();
  if (!h || (!h.loading && (h.kind !== kind || (kind === 'day' && h.date !== hd) || Date.now() - h.at > 10 * 60000))) { loadHero(kind); return; }
  if (!h || h.loading) return;
  if (h.loading) return;
  if (kind === 'day' && h.samples?.length) {
    const tt = h.samples.map((x) => x.ts);
    lineChart('cHero', tt, [
      { label: 'الألواح', data: h.samples.map((x) => x.pvW), color: '#f5a524' },
      { label: 'الحمل', data: h.samples.map((x) => x.outW), color: '#4aa8ff' },
    ], { y: { beginAtZero: true }, unit: 'واط', smooth: true });
  } else if (kind !== 'day') {
    barChart('cHero', h.cur.map((x) => dayName(x.date)), [
      { label: 'الإنتاج', data: h.cur.map((x) => (x.count > 1 ? +(x.pvKwh ?? 0).toFixed(2) : null)), color: '#f5a524' },
      { label: 'الاستهلاك', data: h.cur.map((x) => (x.count > 1 ? +(x.loadKwh ?? 0).toFixed(2) : null)), color: '#4aa8ff' },
    ], { y: { beginAtZero: true }, unit: 'ك.و.س' });
  }
  const name = `${kind}-${h.cur[0].date}`;
  $('#heroCsv').onclick = () => exportSummaries(name, h.cur);
  const title = { day: 'تقرير اليوم', week: 'تقرير آخر 7 أيام', month: 'تقرير آخر 30 يوماً' }[kind];
  $('#heroPdf').onclick = () => sharePdf(name, kind === 'day' && h.samples?.length
    ? dayPdfSpec(h.date, { sum: h.cur[0], samples: h.samples, source: h.cur[0].source })
    : sumsPdfSpec(title, `${fmt.day(h.cur[0].date, { day: 'numeric', month: 'long' })} — ${fmt.day(h.cur[h.cur.length - 1].date, { day: 'numeric', month: 'long', year: 'numeric' })}`, h.cur));
};

// ================= التقرير السنوي (من عدّادات الخادم مباشرة، بلا تحميل قراءات الأيام) =================
const MONTHS = ['كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران', 'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'];
// مبلغ بعملة المستخدم: [القيمة، الرمز] لبطاقة الإحصاء (الرمز يذكر التحويل إن أُدخل سعر الصرف)
const moneyStat = (kwh) => { const c = costOf(kwh, state.prefs); return c ? [fmtMoney(c.v, c.code), c.sym + (c.alt ? ` · ≈ ${fmtMoney(c.alt.v, c.alt.code)} ${c.alt.sym}` : '')] : null; };

async function loadYear() {
  const y = state.rep.yearY || new Date().getFullYear();
  const d = device();
  state.rep.year = { loading: true, y };
  render();
  let res;
  try {
    if (state.demo) {
      const season = [0.55, 0.65, 0.8, 0.9, 1, 1.05, 1.05, 1, 0.9, 0.75, 0.6, 0.5];
      const now = new Date();
      res = { months: season.map((f, i) => ({ month: i + 1, kwh: y < now.getFullYear() || i < now.getMonth() ? Math.round(f * 30 * 22 * 10) / 10 : i === now.getMonth() ? Math.round(f * now.getDate() * 22 * 10) / 10 : 0 })), total: 9140 };
    } else {
      const months = await optional('year', () => api.energyYear(d, y));
      const total = await api.energyTotal(d).catch(() => null);
      res = { months: months || [], total };
    }
    if (device() !== d || (state.rep.yearY || new Date().getFullYear()) !== y) return;
    state.rep.year = { y, ...res };
  } catch (e) {
    if (device() !== d) return;
    state.rep.year = { y, error: cap('year') === false ? 'خادم WatchPower لا يتيح التقرير السنوي لحسابك.' : e.message };
  }
  if (repShowing('year')) render();
}

function pageYear() {
  const r = state.rep.year;
  const y = state.rep.yearY || new Date().getFullYear();
  const nav = `<section class="day-nav card">
    <button class="icon-btn" data-yoff="-1" aria-label="السنة السابقة">${icons.chevR}</button>
    <div class="day-label"><b>${y}</b></div>
    <button class="icon-btn" data-yoff="1" aria-label="السنة التالية" ${y >= new Date().getFullYear() ? 'disabled' : ''}>${icons.chevL}</button>
  </section>`;
  if (!r || r.loading) return nav + '<div class="empty"><div class="spinner"></div>جارٍ تحميل إنتاج السنة…</div>';
  if (r.error) return nav + `<div class="empty bad">${esc(r.error)}</div>`;
  const used = r.months.filter((x) => x.kwh > 0);
  const sum = r.months.reduce((a, x) => a + (x.kwh || 0), 0);
  const best = used.reduce((b, x) => (!b || x.kwh > b.kwh ? x : b), null);
  const price = state.prefs.price;
  if (!used.length) return nav + '<div class="empty">لا يوجد إنتاج مسجّل في هذه السنة.</div>';
  return nav + `
  <div class="stats">
    ${stat('إنتاج السنة', fmt.kwh(sum), 'كيلوواط ساعة', 'c-amber', '', 'year')}
    ${stat('أفضل شهر', best ? MONTHS[best.month - 1] : '—', best ? `${fmt.kwh(best.kwh)} ك.و.س` : '', 'c-green')}
    ${stat('متوسط الشهر', fmt.kwh(sum / used.length), 'ك.و.س', 'c-sky')}
    ${r.total != null ? stat('منذ أول قراءة', fmt.kwh(r.total), 'كيلوواط ساعة', 'c-violet', '', 'year') : ''}
    ${price ? stat('توفير السنة', ...moneyStat(sum), 'c-green', '', 'savings') : ''}
  </div>
  ${price ? '' : '<button class="link pad" data-goto="more:calc">احسب توفيرك بالمال من الحاسبة</button>'}
  <section class="card">${cardH('الإنتاج الشهري', '', '<small class="muted">كيلوواط ساعة</small>')}<div class="chart-box"><canvas id="cYear"></canvas></div></section>`;
}
AFTER.year = () => {
  bindGoto();
  $('.day-nav').onclick = (e) => {
    const b = e.target.closest('[data-yoff]');
    if (!b || b.disabled) return;
    state.rep.yearY = (state.rep.yearY || new Date().getFullYear()) + Number(b.dataset.yoff);
    loadYear();
  };
  const r = state.rep.year;
  const y = state.rep.yearY || new Date().getFullYear();
  if (!r || (r.y !== y && !r.loading)) { loadYear(); return; }
  if (r.loading || r.error) return;
  barChart('cYear', r.months.map((x) => MONTHS[x.month - 1]), [{ label: 'الإنتاج', data: r.months.map((x) => +(x.kwh || 0).toFixed(1)), color: '#f59e0b' }], { y: { beginAtZero: true } });
};

// جلب قراءات يوم: من سجل الخادم أولاً، ثم من القراءات المحفوظة محلياً.
// بعد 3 إخفاقات متتالية نتوقف عن سؤال الخادم حتى نهاية التحميل الحالي (يُصفَّر مع كل تقرير جديد)
let serverHistFails = 0;
// d: الجهاز الذي بدأ له التحميل، حتى لا تختلط بيانات جهازين إذا بُدّل الجهاز أثناء التحميل
async function daySamples(date, d = device()) {
  if (state.demo) return { samples: rowsToSamples(demoHistory(date)), source: 'demo' };
  let err;
  if (serverHistFails < 3) {
    try {
      const off = store.get('tz.' + d.sn, 0);
      const s = shiftToDay(rowsToSamples(await api.dayHistory(d, date)), off, date);
      serverHistFails = 0;
      // فرق التوقيت ينقل قراءات طرف اليوم لليوم المجاور: نكمل من يوم الخادم المجاور (اختياري)
      if (s.length && Math.abs(off) >= 60000) {
        try {
          const nb = shiftToDay(rowsToSamples(await api.dayHistory(d, addDays(date, off > 0 ? -1 : 1))), off, date);
          const seen = new Set(s.map((x) => x.ts));
          nb.forEach((x) => { if (!seen.has(x.ts)) s.push(x); });
          s.sort((x, y) => x.ts - y.ts);
        } catch { /* اليوم المجاور غير متاح: يبقى ما لدينا */ }
      }
      if (s.length) return { samples: s, source: 'server' };
    } catch (e) {
      err = e;
      serverHistFails++;
    }
  }
  const local = localDay(d.sn, date);
  if (local.length) return { samples: local, source: 'local' };
  if (err && err.code === undefined) throw err;
  return { samples: [], source: 'none' };
}

const SRC = { server: 'سجل خادم WatchPower', local: 'قراءات محفوظة على الهاتف', demo: 'بيانات تجريبية', none: 'لا توجد بيانات' };
const dayName = (date) => fmt.day(date, { weekday: 'short', day: 'numeric', month: 'numeric' });
const dateLabel = (date) => (date === today() ? 'اليوم' : date === today(-1) ? 'أمس' : fmt.day(date, { weekday: 'long', day: 'numeric', month: 'long' }));
const READINGS = ['قراءة واحدة', 'قراءتان', 'قراءات', 'قراءة'];

async function loadDay() {
  const date = state.rep.dayDate;
  const d = device();
  const current = () => date === state.rep.dayDate && device() === d;
  serverHistFails = 0;
  state.rep.day = { loading: true };
  render();
  try {
    const { samples, source } = await daySamples(date, d);
    const sum = summarize(date, samples, source);
    cacheSummary(d.sn, sum);
    if (current()) state.rep.day = { samples, sum, source };
  } catch (e) {
    // لا نعرض خطأ يوم أو جهاز آخر إذا تغيّر الاختيار أثناء التحميل
    if (current()) state.rep.day = { error: e.message };
  }
  if (state.page === 'day') render();
}

// Replay uses recorded steps; gaps stay empty and event times remain exact.
let replayTimer = null;
function replayMarkup(samples) {
  const date = state.rep.dayDate;
  if (state.replay?.date !== date) state.replay = { date, at: samples[0].ts };
  const start = new Date(date + 'T00:00:00').getTime();
  const end = new Date(new Date(start).setDate(new Date(start).getDate() + 1)).getTime() - 1;
  return `<section class="card" id="replay"><h2>إعادة مشاهدة اليوم</h2>
    <p class="hint">قراءات مسجّلة، دون استيفاء بين القيم. الفجوات الأكبر من 20 دقيقة فارغة. أوقات التنبيهات هي أوقات رصدها في السجل.</p>
    <label>وقت المشاهدة <output id="replayTime"></output><input aria-label="وقت إعادة المشاهدة" id="replaySlider" type="range" min="${start}" max="${end}" step="1" value="${state.replay.at}" style="width:100%;direction:ltr"></label>
    <button class="btn ghost" id="replayPlay">تشغيل / إيقاف</button><div id="replayScene"></div><div id="replayEvents"></div></section>`;
}
function bindReplay(samples) {
  const slider = $('#replaySlider'); if (!slider) return;
  const start = Number(slider.min), end = Number(slider.max);
  const events = state.log.filter(e => e.sn === sn() && e.at >= start && e.at <= end).sort((a,b) => a.at-b.at);
  $('#replayEvents').innerHTML = events.length ? '<h3>التنبيهات المسجلة — اضغط للانتقال إلى لحظتها</h3>' + events.map((e,i) => `<button class="link pad" data-replay-event="${i}">${esc(fmt.time(e.at))} · ${esc(e.title)}</button>`).join('') : '<p class="hint">لا توجد تنبيهات محلية مرتبطة بهذا الجهاز في اليوم المختار.</p>';
  const update = () => {
    const at = Number(slider.value); state.replay.at = at;
    const sample = replayAt(samples, at);
    $('#replayTime').textContent = fmt.time(at);
    const host = $('#replayScene');
    if (!sample) host.innerHTML = '<p class="empty" data-replay-gap>فجوة بيانات — لا توجد قراءة قابلة للعرض في هذه اللحظة.</p>';
    else {
      const m = { ...sample, gridOn: gridPresent(sample.gridV, sample.gridRatedV), stale: false };
      const isLine = /line|bypass/i.test(m.mode || '');
      const parts = sceneParts(m, true, isLine);
      // بالشكل الذي اختاره المستخدم؛ السماء من ساعة القراءة وإنتاجها (لا طقس محفوظ لتلك اللحظة)
      const h = new Date(sample.ts).getHours();
      const sky = (m.pvW ?? 0) > 50 ? 'clear' : h < 6 || h >= 18 ? 'night' : 'cloudy';
      const body = sceneBody(m, true, isLine, sky, parts, null);
      host.innerHTML = `<p class="hint">القراءة المعروضة سُجلت ${esc(fmt.dateTime(sample.ts))} · عرض بخطوات مسجّلة</p><div class="flow-card scene replay-scene ${body.cls} sky-${sky} ${parts.flows.bat.on ? (parts.flows.bat.reverse ? 'bat-dis' : 'bat-chg') : ''}">${body.html}</div>${flowLegend(parts.flows)}`;
    }
    document.querySelectorAll('[data-replay-event]').forEach(b => b.setAttribute('aria-current', String(events[Number(b.dataset.replayEvent)].at === at)));
    charts.forEach(c => { if (c.canvas.id === 'cPower') c.draw(); });
  };
  slider.oninput = update;
  document.querySelectorAll('[data-replay-event]').forEach(b => b.onclick = () => { slider.value = events[Number(b.dataset.replayEvent)].at; update(); });
  $('#replayPlay').onclick = () => {
    if (replayTimer) { clearInterval(replayTimer); replayTimer = null; return; }
    replayTimer = setInterval(() => {
      if (!document.contains(slider)) { clearInterval(replayTimer); replayTimer = null; return; }
      slider.value = Math.min(end, Number(slider.value) + 60000); update();
      if (Number(slider.value) >= end) { clearInterval(replayTimer); replayTimer = null; }
    }, 250);
  };
  update();
}

function pageDay() {
  const r = state.rep.day;
  const nav = `<section class="day-nav card">
    <button class="icon-btn" data-day="-1" aria-label="اليوم السابق">${icons.chevR}</button>
    <label class="day-label"><b>${esc(dateLabel(state.rep.dayDate))}</b><small>${state.rep.dayDate}</small><input type="date" id="dayPick" value="${state.rep.dayDate}" max="${today()}"></label>
    <button class="icon-btn" data-day="1" aria-label="اليوم التالي" ${state.rep.dayDate >= today() ? 'disabled' : ''}>${icons.chevL}</button>
  </section>`;
  if (!r || r.loading) return nav + '<div class="empty"><div class="spinner"></div>جارٍ تحميل بيانات اليوم…</div>';
  if (r.error) return nav + `<div class="empty bad">${esc(r.error)}</div>`;
  if (!r.samples.length) return nav + '<div class="empty">لا توجد بيانات مسجّلة لهذا اليوم.</div>';
  const s = r.sum;
  return nav + replayMarkup(r.samples) + `
  <div class="stats">
    ${stat('إنتاج الألواح', fmt.kwh(s.pvKwh), 'كيلوواط ساعة', 'c-amber', '', 'todayWh')}
    ${stat('استهلاك المنزل', fmt.kwh(s.loadKwh), 'كيلوواط ساعة', 'c-sky')}
    ${stat('أدنى نسبة للبطارية', s.socMin === null ? '—' : `${s.socMin}%`, s.socMinAt ? 'الساعة ' + fmt.time(s.socMinAt) : '', 'c-pink', '', 'socMinMax')}
    ${stat('أعلى نسبة للبطارية', s.socMax === null ? '—' : `${s.socMax}%`, s.fullAt ? 'امتلأت ' + fmt.time(s.fullAt) : s.socMaxAt ? 'الساعة ' + fmt.time(s.socMaxAt) : '', 'c-green', '', 'socMinMax')}
    ${stat('شحن من الألواح', fmt.kwh(s.solarChgKwh), 'كيلوواط ساعة', 'c-amber', '', 'chargeSplit')}
    ${stat('شحن من الكهرباء', fmt.kwh(s.gridChgKwh), 'كيلوواط ساعة', 'c-violet', '', 'chargeSplit')}
    ${stat('تفريغ البطارية', fmt.kwh(s.disKwh), 'كيلوواط ساعة', 'c-slate')}
    ${stat('الاستقلالية عن الكهرباء', s.independence == null ? '—' : Math.round(s.independence) + '%', s.independence == null ? 'وضع التشغيل غير متوفر' : 'من استهلاك البيت', 'c-sky', '', 'independence')}
    ${stat('ذروة الحمل', fmt.w(s.peakW), '', 'c-pink')}
    ${stat('توفر الكهرباء', numAr(s.gridH, 1), 'ساعة', 'c-violet', '', 'gridHours')}
    ${stat('العمل على البطارية', numAr(s.batH, 1), 'ساعة', 'c-slate')}
    ${pvKwp() && s.pvKwh != null ? stat('إنتاج كل كيلوواط ألواح', (s.pvKwh / pvKwp()).toFixed(2), 'ك.و.س', 'c-amber', '', 'yieldKwp') : ''}
    ${state.prefs.price && s.pvKwh != null ? stat('التوفير', ...moneyStat(s.pvKwh), 'c-green', '', 'savings') : ''}
  </div>
  <p class="hint">${SRC[r.source]} · ${countAr(r.samples.length, READINGS)} · ${numAr(s.coveredH, 1)} ساعة مغطّاة${infoBtn('report')}</p>
  <section class="card"><div class="card-h"><h2>القدرة خلال اليوم</h2></div><div class="chart-box"><canvas id="cPower"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>نسبة شحن البطارية</h2></div><div class="chart-box sm"><canvas id="cSoc"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد البطارية</h2></div><div class="chart-box sm"><canvas id="cBatV"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد كهرباء الشبكة</h2></div><div class="chart-box sm"><canvas id="cGrid"></canvas></div></section>
  ${pdfBtn('pdfDay')}
  <button class="btn ghost wide" id="expDay">${icons.download} تصدير قراءات هذا اليوم (CSV)</button>`;
}
AFTER.day = () => {
  $('.day-nav').onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    state.rep.dayDate = addDays(state.rep.dayDate, Number(b.dataset.day));
    loadDay();
  };
  $('#dayPick').onchange = (e) => { if (e.target.value) { state.rep.dayDate = e.target.value; loadDay(); } };
  const r = state.rep.day;
  if (!r) { loadDay(); return; }
  if (!r.samples?.length) return;
  bindReplay(r.samples);
  const t = r.samples.map((x) => x.ts);
  lineChart('cPower', t, [
    { label: 'الألواح (واط)', data: r.samples.map((x) => x.pvW), color: '#f59e0b' },
    { label: 'الحمل (واط)', data: r.samples.map((x) => x.outW), color: '#0ea5e9' },
  ], { y: { beginAtZero: true } });
  lineChart('cSoc', t, [{ label: '%', data: r.samples.map((x) => x.soc), color: '#10b981' }], { y: { min: 0, max: 100 } });
  lineChart('cBatV', t, [{ label: 'فولت', data: r.samples.map((x) => x.batV), color: '#8b5cf6' }]);
  lineChart('cGrid', t, [{ label: 'فولت', data: r.samples.map((x) => x.gridV), color: '#ec4899' }], { y: { beginAtZero: true } });
  $('#expDay').onclick = () => exportSamples(state.rep.dayDate, r.samples);
  $('#pdfDay').onclick = () => sharePdf(state.rep.dayDate, dayPdfSpec(state.rep.dayDate, r));
};

function rangeDates(kind, off) {
  if (kind === 'week') {
    const end = today(-7 * off);
    return Array.from({ length: 7 }, (_, i) => addDays(end, i - 6));
  }
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - off);
  const out = [];
  const m = d.getMonth();
  while (d.getMonth() === m && dayKey(d.getTime()) <= today()) { out.push(dayKey(d.getTime())); d.setDate(d.getDate() + 1); }
  return out;
}

// تحميل ملخصات عدة أيام مع حفظ الأيام المكتملة لتسريع المرات القادمة
async function loadSummaries(dates, onProgress) {
  const sums = [];
  const dev = device();
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    let s = d < today() ? cachedSummary(dev.sn, d) : null;
    if (!s) {
      try {
        const { samples, source } = await daySamples(d, dev);
        s = summarize(d, samples, source);
        cacheSummary(dev.sn, s);
      } catch (e) {
        s = { date: d, count: 0, error: e.message };
      }
    }
    sums.push(s);
    onProgress?.(i + 1, dates.length);
  }
  return sums;
}

function totals(sums) {
  const ok = sums.filter((s) => s.count > 1);
  const add = (k) => ok.reduce((a, s) => a + (s[k] || 0), 0);
  const pv = add('pvKwh');
  const load = add('loadKwh');
  // المتوسط اليومي من الأيام المكتملة فقط؛ اليوم الجاري أو يوم ناقص البيانات يخفض المتوسط خطأً
  const full = ok.filter((s) => s.date < today() && s.coveredH >= 18);
  const base = full.length ? full : ok;
  const avgOf = (k) => (base.length ? base.reduce((a, s) => a + (s[k] || 0), 0) / base.length : null);
  const best = ok.reduce((b, s) => (s.pvKwh != null && (!b || s.pvKwh > b.pvKwh) ? s : b), null);
  // الاستقلالية للفترة: موزونة بالاستهلاك، ومن الأيام التي عُرف فيها وضع التشغيل فقط
  const ind = ok.filter((s) => s.independence != null && s.loadKwh > 0);
  const indLoad = ind.reduce((a, s) => a + s.loadKwh, 0);
  const independence = indLoad > 0 ? ind.reduce((a, s) => a + s.independence * s.loadKwh, 0) / indLoad : null;
  // سحب الشبكة من الأيام التي يُعرف فيها فقط (تقدير)، مع عدد الأيام الناقصة
  const g = ok.filter((s) => s.gridKwh != null);
  const socs = ok.filter((s) => s.socMin != null);
  return { days: ok.length, pv, load, avgPv: avgOf('pvKwh'), avgLoad: avgOf('loadKwh'), gridH: add('gridH'), batH: add('batH'), best,
    solarChg: add('solarChgKwh'), gridChg: add('gridChgKwh'), independence,
    grid: g.length ? g.reduce((a, s) => a + s.gridKwh, 0) : null, gridDays: g.length,
    gridPartial: g.filter((s) => s.gridBasis === 'partial' && s.date < today()).length,
    socMin: socs.length ? socs.reduce((m, s) => (s.socMin < m.socMin ? s : m)) : null };
}

async function loadRange(kind) {
  const off = kind === 'week' ? state.rep.weekOff : state.rep.monthOff;
  const dates = rangeDates(kind, off);
  // أيام الفترة السابقة المقابلة لحساب نسبة التغيّر (الأيام الماضية محفوظة غالباً فتُقرأ فوراً)
  const td = trendDates(kind, dates, today());
  const token = Symbol(kind);
  serverHistFails = 0;
  state.rep[kind] = { loading: true, done: 0, total: dates.length + td.prev.length, token };
  render();
  const all = await loadSummaries([...dates, ...td.prev], (done, total) => {
    if (state.rep[kind]?.token !== token) return;
    state.rep[kind].done = done;
    const p = $('#rangeProg');
    if (p) { p.style.width = (done / total) * 100 + '%'; $('#rangeTxt').textContent = `${done} من ${countAr(total, DAY)}`; }
  });
  if (state.rep[kind]?.token !== token) return;
  const sums = all.slice(0, dates.length);
  const trend = { cur: totals(sums.filter((s) => td.cur.includes(s.date))), prev: totals(all.slice(dates.length)) };
  state.rep[kind] = { dates, sums, trend };
  if (state.page === kind) render();
}

function rangeTitle(kind, off) {
  const dates = rangeDates(kind, off);
  if (kind === 'month') return fmt.day(dates[0], { month: 'long', year: 'numeric' });
  if (off === 0) return 'آخر 7 أيام';
  return `${dayName(dates[0])} — ${dayName(dates[6])}`;
}

function pageRange(kind) {
  const off = kind === 'week' ? state.rep.weekOff : state.rep.monthOff;
  const r = state.rep[kind];
  const nav = `<section class="day-nav card">
    <button class="icon-btn" data-off="1" aria-label="السابق">${icons.chevR}</button>
    <div class="day-label"><b>${esc(rangeTitle(kind, off))}</b></div>
    <button class="icon-btn" data-off="-1" aria-label="التالي" ${off === 0 ? 'disabled' : ''}>${icons.chevL}</button>
  </section>`;
  if (!r || r.loading) {
    return nav + `<div class="card"><p class="center">جارٍ تجميع بيانات الأيام…</p><div class="bar"><i id="rangeProg" style="width:${r ? (r.done / r.total) * 100 : 0}%"></i></div><p class="hint center" id="rangeTxt"></p>
      <p class="hint center">أول تحميل قد يستغرق وقتاً، والأيام المكتملة تُحفظ لتظهر فوراً لاحقاً.</p></div>`;
  }
  const t = totals(r.sums);
  if (!t.days) return nav + '<div class="empty">لا توجد بيانات لهذه الفترة.</div>';
  const srcs = [...new Set(r.sums.filter((s) => s.count).map((s) => SRC[s.source]))].join('، ');
  // نسبة التغيّر تظهر فقط إذا كان في الفترتين أيام مكتملة فيها بيانات
  const tr = r.trend?.cur.days && r.trend?.prev.days ? r.trend : null;
  const trendTag = (k, better) => { const c = tr && change(tr.cur[k], tr.prev[k], better); return c ? `<em class="trend ${c.cls}">${c.text}</em>` : ''; };
  const prevName = kind === 'week' ? 'الأسبوع السابق' : 'الشهر السابق';
  return nav + `
  <div class="stats">
    ${stat('إجمالي الإنتاج', fmt.kwh(t.pv), 'كيلوواط ساعة', 'c-amber', trendTag('pv', 'up'))}
    ${stat('إجمالي الاستهلاك', fmt.kwh(t.load), 'كيلوواط ساعة', 'c-sky', trendTag('load', 'down'))}
    ${stat('متوسط الإنتاج اليومي', fmt.kwh(t.avgPv), 'ك.و.س / يوم', 'c-green')}
    ${stat('أفضل يوم إنتاج', t.best ? dayName(t.best.date) : '—', t.best ? `${fmt.kwh(t.best.pvKwh)} ك.و.س` : '', 'c-violet')}
    ${stat('توفر الكهرباء', numAr(t.gridH, 0), 'ساعة', 'c-pink', trendTag('gridH', 'up'))}
    ${stat('العمل على البطارية', numAr(t.batH, 0), 'ساعة', 'c-slate', trendTag('batH', 'down'))}
    ${stat('شحن من الألواح', fmt.kwh(t.solarChg), 'كيلوواط ساعة', 'c-amber')}
    ${stat('شحن من الكهرباء', fmt.kwh(t.gridChg), 'كيلوواط ساعة', 'c-violet')}
    ${stat('الاستقلالية عن الكهرباء', t.independence == null ? '—' : Math.round(t.independence) + '%', 'من استهلاك البيت', 'c-sky')}
  </div>
  <p class="hint">أيام فيها بيانات: ${t.days} من ${r.sums.length} · المصدر: ${esc(srcs)}</p>
  ${tr ? `<p class="hint">النسب ▲▼ مقارنة بنفس عدد الأيام المكتملة من ${prevName} (${countAr(tr.cur.days, DAY)} مقابل ${countAr(tr.prev.days, DAY)})، واليوم الجاري لا يدخل فيها.</p>` : ''}
  <section class="card"><div class="card-h"><h2>الإنتاج والاستهلاك اليومي</h2><small class="muted">كيلوواط ساعة</small></div><div class="chart-box"><canvas id="cRange"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>تفاصيل الأيام</h2></div>
    <div class="table"><div class="tr th"><span>اليوم</span><span>الإنتاج</span><span>الاستهلاك</span><span>البطارية</span></div>
    ${r.sums.slice().reverse().map((s) => `<button class="tr" data-dayopen="${s.date}"><span>${esc(dayName(s.date))}</span><span>${s.count > 1 ? fmt.kwh(s.pvKwh) : '—'}</span><span>${s.count > 1 ? fmt.kwh(s.loadKwh) : '—'}</span><span>${s.socMin != null ? `${s.socMin}–${s.socMax}%` : '—'}</span></button>`).join('')}
    </div></section>
  ${pdfBtn('pdfRange')}
  <button class="btn ghost wide" id="expRange">${icons.download} تصدير ملخص الفترة (CSV)</button>`;
}

function bindRange(kind) {
  $('.day-nav').onclick = (e) => {
    const b = e.target.closest('[data-off]');
    if (!b || b.disabled) return;
    const k = kind === 'week' ? 'weekOff' : 'monthOff';
    state.rep[k] = Math.max(0, state.rep[k] + Number(b.dataset.off));
    loadRange(kind);
  };
  const r = state.rep[kind];
  if (!r) { loadRange(kind); return; }
  if (r.loading || !r.sums) return;
  barChart('cRange', r.sums.map((s) => dayName(s.date)), [
    { label: 'الإنتاج', data: r.sums.map((s) => (s.count > 1 ? +(s.pvKwh ?? 0).toFixed(2) : null)), color: '#f59e0b' },
    { label: 'الاستهلاك', data: r.sums.map((s) => (s.count > 1 ? +(s.loadKwh ?? 0).toFixed(2) : null)), color: '#0ea5e9' },
  ], { y: { beginAtZero: true } });
  document.querySelectorAll('[data-dayopen]').forEach((b) => {
    b.onclick = () => { state.rep.dayDate = b.dataset.dayopen; state.rep.day = null; navigate('reports', 'day'); };
  });
  $('#expRange').onclick = () => exportSummaries(`${kind}-${r.dates[0]}`, r.sums);
  $('#pdfRange').onclick = () => sharePdf(`${kind}-${r.dates[0]}`, sumsPdfSpec(kind === 'week' ? 'التقرير الأسبوعي' : 'التقرير الشهري', `${fmt.day(r.dates[0], { day: 'numeric', month: 'long' })} — ${fmt.day(r.dates[r.dates.length - 1], { day: 'numeric', month: 'long', year: 'numeric' })}`, r.sums));
}
AFTER.week = () => bindRange('week');
AFTER.month = () => bindRange('month');

// ================= تقرير لفترة يختارها المستخدم (من تاريخ إلى تاريخ) =================
const PERIOD_MAX = 92;
const PRESETS = [
  ['7', 'آخر 7 أيام', () => [today(-6), today()]],
  ['30', 'آخر 30 يوماً', () => [today(-29), today()]],
  ['m', 'هذا الشهر', () => [today().slice(0, 8) + '01', today()]],
  ['pm', 'الشهر الماضي', () => { const d = new Date(today().slice(0, 8) + '01T12:00:00'); d.setDate(0); const e = dayKey(d.getTime()); return [e.slice(0, 8) + '01', e]; }],
];
function periodRange() {
  const p = store.get('repPeriod', null);
  let [from, to] = p && p.from && p.to ? [p.from, p.to] : PRESETS[0][2]();
  if (to > today()) to = today();
  if (from > to) from = to;
  return { from, to };
}
function periodDates(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < PERIOD_MAX; d = addDays(d, 1)) out.push(d);
  return out;
}
// 92 يوماً حداً أعلى: كل يوم جديد يُحمَّل من الخادم، والأيام المكتملة تُحفظ فتظهر فوراً لاحقاً
async function loadPeriod() {
  const { from, to } = periodRange();
  const dates = periodDates(from, to);
  const token = Symbol('per');
  serverHistFails = 0;
  state.rep.per = { loading: true, token, done: 0, total: dates.length, from, to };
  render();
  const sums = await loadSummaries(dates, (done, total) => {
    if (state.rep.per?.token !== token) return;
    state.rep.per.done = done;
    const p = $('#perProg');
    if (p) { p.style.width = (done / total) * 100 + '%'; $('#perTxt').textContent = `${done} من ${countAr(total, DAY)}`; }
  });
  if (state.rep.per?.token !== token) return;
  state.rep.per = { from, to, dates, sums, at: Date.now() };
  if (repShowing('period')) render();
}

function pagePeriod() {
  const { from, to } = periodRange();
  const r = state.rep.per;
  const n = periodDates(from, to).length;
  const preset = PRESETS.find(([, , f]) => { const [a, b] = f(); return a === from && b === to; })?.[0];
  const head = `<section class="card per-pick">
    <div class="seg per-presets">${PRESETS.map(([k, l]) => `<button class="${preset === k ? 'on' : ''}" data-preset="${k}">${l}</button>`).join('')}</div>
    <div class="per-dates"><label>من<input type="date" id="perFrom" value="${from}" max="${today()}"></label><label>إلى<input type="date" id="perTo" value="${to}" max="${today()}"></label></div>
    <small class="hint">${countAr(n, DAY)}${n >= PERIOD_MAX ? ` (الحد الأعلى ${PERIOD_MAX} يوماً)` : ''}</small>
  </section>`;
  if (!r || r.loading || r.from !== from || r.to !== to) {
    return head + `<div class="card"><p class="center">جارٍ تجميع بيانات الأيام…</p><div class="bar"><i id="perProg" style="width:${r?.total ? (r.done / r.total) * 100 : 0}%"></i></div><p class="hint center" id="perTxt"></p>
      <p class="hint center">الأيام المكتملة تُحفظ في الهاتف، فتظهر فوراً في المرة القادمة.</p></div>`;
  }
  const t = totals(r.sums);
  if (!t.days) return head + '<div class="empty">لا توجد بيانات لهذه الفترة.</div>';
  const p = state.prefs;
  const gridCost = t.grid != null ? costOf(t.grid, p) : null;
  const saved = costOf(t.pv, p);
  const cover = t.load > 0 && t.grid != null ? Math.max(0, Math.min(100, (1 - t.grid / t.load) * 100)) : null;
  const gridDay = r.sums.filter((s) => s.gridKwh != null).reduce((b, s) => (!b || s.gridKwh > b.gridKwh ? s : b), null);
  const lowDay = t.socMin;
  // جمل قصيرة بلغة عادية: ما يهم المستخدم من الأرقام
  const lines = [
    `أنتجت الألواح <b><bdi>${fmt.kwh(t.pv)}</bdi> ك.و.س</b> واستهلك البيت <b><bdi>${fmt.kwh(t.load)}</bdi> ك.و.س</b>.`,
    t.grid != null ? `سُحب من الشبكة نحو <b><bdi>${fmt.kwh(t.grid)}</bdi> ك.و.س</b>${gridCost ? ` بكلفة <b><bdi>${esc(costText(gridCost))}</bdi></b>` : ''}${cover != null ? `، فغطّت منظومتك نحو <b><bdi>${Math.round(cover)}%</bdi></b> من الاستهلاك` : ''}.` : 'لا يمكن حساب سحب الشبكة لهذه الفترة (وضع التشغيل غير معروف).',
    gridDay && gridDay.gridKwh > 0.05 ? `أكثر يوم سحباً من الشبكة: ${esc(dayName(gridDay.date))} (<bdi>${fmt.kwh(gridDay.gridKwh)}</bdi> ك.و.س).` : null,
    t.best ? `أفضل يوم إنتاج: ${esc(dayName(t.best.date))} (<bdi>${fmt.kwh(t.best.pvKwh)}</bdi> ك.و.س).` : null,
    lowDay ? `أدنى نسبة للبطارية: <bdi>${lowDay.socMin}%</bdi> يوم ${esc(dayName(lowDay.date))}${lowDay.socMinAt ? ` الساعة ${esc(fmt.time(lowDay.socMinAt))}` : ''}.` : null,
  ].filter(Boolean);
  const missing = r.sums.length - t.days;
  return head + `
  <div class="stats per-key">
    ${stat('الإنتاج', fmt.kwh(t.pv), 'ك.و.س', 'c-amber')}
    ${stat('الاستهلاك', fmt.kwh(t.load), 'ك.و.س', 'c-sky')}
    ${stat('سحب الشبكة (تقدير)', t.grid == null ? '—' : fmt.kwh(t.grid), 'ك.و.س', 'c-violet', t.gridPartial ? `<em class="trend">${countAr(t.gridPartial, DAY)} ناقصة</em>` : '', 'gridEst')}
    ${gridCost ? stat('كلفة الشبكة', fmtMoney(gridCost.v, gridCost.code), gridCost.sym, 'c-pink', gridCost.alt ? `<em class="alt-cur">≈ <bdi>${fmtMoney(gridCost.alt.v, gridCost.alt.code)}</bdi> ${esc(gridCost.alt.sym)}</em>` : '') : ''}
    ${saved ? stat('توفير الألواح', fmtMoney(saved.v, saved.code), saved.sym, 'c-green', '', 'savings') : ''}
    ${stat('الاستقلالية عن الشبكة', t.independence == null ? '—' : Math.round(t.independence) + '%', 'من الاستهلاك', 'c-slate')}
  </div>
  ${p.price ? '' : '<button class="link pad" data-goto="more:calc">أدخل سعر الكيلوواط (دولار أو ليرة) لتظهر الكلفة والتوفير</button>'}
  <section class="card per-sum"><div class="card-h"><h2>الخلاصة</h2></div><ul class="wn">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>
    <p class="hint">أيام فيها بيانات: ${t.days} من ${r.sums.length}${missing ? ' — مجموع الفترة أقل من الحقيقي بقدر الأيام الناقصة' : ''}. سحب الشبكة تقدير لأن الجهاز لا يرسل عدّاد استيراد.</p></section>
  <section class="card"><div class="card-h"><h2>يوماً بيوم</h2><small class="muted">كيلوواط ساعة</small></div><div class="chart-box"><canvas id="cPer"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>التفاصيل</h2></div>
    <div class="table per-t"><div class="tr th"><span>اليوم</span><span>الإنتاج</span><span>الاستهلاك</span><span>الشبكة</span><span>البطارية</span></div>
    ${r.sums.slice().reverse().map((s) => `<button class="tr" data-dayopen="${s.date}"><span>${esc(fmt.day(s.date, { weekday: 'short', day: 'numeric', month: 'numeric' }).replace('،', ''))}</span><span>${s.count > 1 ? fmt.kwh(s.pvKwh) : '—'}</span><span>${s.count > 1 ? fmt.kwh(s.loadKwh) : '—'}</span><span class="${s.gridBasis === 'partial' ? 'muted' : ''}">${s.gridKwh != null ? fmt.kwh(s.gridKwh) : '—'}</span><span>${s.socMin != null ? `${s.socMin}–${s.socMax}%` : '—'}</span></button>`).join('')}
    </div><p class="hint">اضغط يوماً لفتح تقريره. الأرقام الباهتة في عمود الشبكة أيام ناقصة التغطية.</p></section>
  ${pdfBtn('pdfPer')}
  <button class="btn ghost wide" id="expPer">${icons.download} تصدير الفترة (CSV)</button>`;
}

AFTER.period = () => {
  bindGoto();
  const set = (from, to) => {
    if (!from || !to) return;
    if (to > today()) to = today();
    if (from > to) [from, to] = [to, from];
    const dates = periodDates(from, to);
    if (dates[dates.length - 1] !== to) { to = dates[dates.length - 1]; toast(`الحد الأعلى ${PERIOD_MAX} يوماً؛ عُدّلت النهاية`, 'warn'); }
    store.set('repPeriod', { from, to });
    loadPeriod();
  };
  document.querySelectorAll('[data-preset]').forEach((b) => { b.onclick = () => set(...PRESETS.find((x) => x[0] === b.dataset.preset)[2]()); });
  const f = $('#perFrom'), t = $('#perTo');
  if (f) f.onchange = () => set(f.value, t.value);
  if (t) t.onchange = () => set(f.value, t.value);
  const { from, to } = periodRange();
  const r = state.rep.per;
  if (!r || (!r.loading && (r.from !== from || r.to !== to || Date.now() - r.at > 30 * 60000))) { loadPeriod(); return; }
  if (r.loading || !r.sums) return;
  barChart('cPer', r.sums.map((s) => dayName(s.date)), [
    { label: 'الإنتاج', data: r.sums.map((s) => (s.count > 1 ? +(s.pvKwh ?? 0).toFixed(2) : null)), color: '#f59e0b' },
    { label: 'الاستهلاك', data: r.sums.map((s) => (s.count > 1 ? +(s.loadKwh ?? 0).toFixed(2) : null)), color: '#0ea5e9' },
    { label: 'الشبكة', data: r.sums.map((s) => (s.gridKwh != null ? +s.gridKwh.toFixed(2) : null)), color: '#8b5cf6' },
  ], { y: { beginAtZero: true } });
  document.querySelectorAll('[data-dayopen]').forEach((b) => {
    b.onclick = () => { state.rep.dayDate = b.dataset.dayopen; state.rep.day = null; navigate('reports', 'day'); };
  });
  $('#expPer').onclick = () => exportSummaries(`${from}_${to}`, r.sums);
  $('#pdfPer').onclick = () => sharePdf(`${from}_${to}`, sumsPdfSpec('تقرير الفترة', `${fmt.day(from, { day: 'numeric', month: 'long' })} — ${fmt.day(to, { day: 'numeric', month: 'long', year: 'numeric' })}`, r.sums));
};

// ================= مستشار الطاقة =================
// يحلل آخر 7 أيام كاملة + اليوم من السجل الفعلي، ولا يعرض إلا ما يمكن حسابه من القراءات
async function loadAdvisor() {
  const dates = Array.from({ length: 8 }, (_, i) => today(i - 7));
  const token = Symbol('adv');
  serverHistFails = 0;
  state.rep.adv = { loading: true, token, done: 0 };
  render();
  const sums = await loadSummaries(dates, (done, total) => {
    if (state.rep.adv?.token !== token) return;
    state.rep.adv.pct = (done / total) * 100;
    const p = $('#advProg');
    if (p) p.style.width = state.rep.adv.pct + '%';
  });
  if (state.rep.adv?.token !== token) return;
  state.rep.adv = { sums, at: Date.now() };
  if ((state.tab === 'reports' && (!state.page || leaf() === 'advisor')) || (state.tab === 'calc' && !state.page && state.calc.tab === 'save')) render();
}

// «ملاحظات على منظومتك»: ما يحتاج انتباهك الآن من القراءة الحيّة، ثم تحليل آخر 7 أيام من السجل
function pageAdvisor() {
  const m = state.model;
  const live = smartTips(m, state.prefs);
  const now = `${state.demo ? banner() : ''}<h3 class="sec-h">الآن</h3>
    ${live.length ? smartList(live) : '<div class="empty">لا توجد بيانات من الجهاز بعد.</div>'}
    <h3 class="sec-h">آخر 7 أيام</h3>`;
  const a = state.rep.adv;
  if (!a || a.loading) return now + `<div class="card"><p class="center">جارٍ تحليل آخر 7 أيام…</p><div class="bar"><i id="advProg" style="width:${a?.pct || 0}%"></i></div>
    <p class="hint center">الأيام المكتملة تُحفظ، فيصبح التحليل أسرع في المرات القادمة.</p></div>`;
  const ctx = { todayKey: today(), prefs: state.prefs, ratedW: m?.ratedW || null, volts: m?.ratedV || nominalV(m), model: m };
  const r = analyze(a.sums, ctx);
  const b = r.battery;
  const lvl = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info' };
  return `${now}
  <section class="card"><div class="card-h"><h2>${icons.battery} استخدام البطارية</h2></div>
    ${kv([
      b.soh != null ? ['حالة الصحة (من البطارية)', val(b.soh + '%')] : null,
      ['متوسط عمق التفريغ اليومي', val(b.avgDod == null ? null : Math.round(b.avgDod) + '%')],
      ['أدنى نسبة في الفترة', val(b.lowest ? `${b.lowest.soc}% · ${fmt.day(b.lowest.date, { weekday: 'long' })}${b.lowest.at ? ' ' + fmt.time(b.lowest.at) : ''}` : null)],
      ['أيام امتلأت فيها إلى 100%', val(r.days ? `${b.fullDays} من ${r.days}` : null)],
      b.cyclesPerDay != null ? ['دورات كاملة مكافئة يومياً', val(b.cyclesPerDay.toFixed(2))] : null,
      r.avgNight != null ? ['الاستهلاك حين لا تنتج الألواح', val(fmt.kwh(r.avgNight), 'ك.و.س / يوم')] : null,
      r.usable != null ? ['ما تخزنه البطارية فعلياً', val(fmt.kwh(r.usable), 'ك.و.س')] : null,
    ])}
    ${b.cyclesPerDay == null ? '<p class="hint">أدخل سعة البطارية من «المزيد ← الإعدادات» لحساب الدورات وكفاية البطارية لليل.</p>' : ''}
    ${b.soh == null ? '<p class="hint">جهازك لا يرسل حالة صحة البطارية (SOH)، لذلك لا نعرض نسبة تدهور مقدّرة حتى لا تكون مضلّلة.</p>' : ''}
  </section>

  ${r.tips.length ? r.tips.map((t) => `<section class="card adv-tip ${lvl[t.level]}"><b>${esc(t.title)}</b><p>${esc(t.text)}</p></section>`).join('') : '<div class="empty">لا توجد أيام كاملة كافية للتحليل بعد. يلزم سجل يوم كامل على الأقل.</div>'}

  <p class="hint">كل الأرقام من سجل جهازك الفعلي أو محسوبة منه مباشرة، والملاحظات مبنية على قواعد ثابتة وليست ذكاءً اصطناعياً. هي إرشادات عامة، وتبقى مواصفات الشركة المصنعة لجهازك وبطاريتك هي المرجع.</p>
  <button class="btn ghost wide" id="advReload">${icons.refresh} إعادة التحليل</button>`;
}
AFTER.advisor = () => {
  if (!state.rep.adv || (!state.rep.adv.loading && Date.now() - state.rep.adv.at > 30 * 60000)) { loadAdvisor(); return; }
  const b = $('#advReload');
  if (b) b.onclick = loadAdvisor;
};

async function exportSamples(date, samples) {
  if (!samples.length) { toast('لا توجد قراءات لهذا اليوم', 'bad'); return; }
  await shareFile(`taqati-${date}.csv`, toCsv(
    ['الوقت', 'الوضع', 'الألواح (واط)', 'الحمل (واط)', 'البطارية (%)', 'جهد البطارية (فولت)', 'قدرة البطارية (واط)', 'جهد الكهرباء (فولت)'],
    samples.map((s) => [fmt.iso(s.ts), s.mode ? trValue(s.mode) : '', s.pvW, s.outW, s.soc, s.batV, s.batW, s.gridV]),
  ));
}

// ================= تقرير PDF للمشاركة =================
const pdfMeta = () => [`الجهاز: ${device()?.alias || device()?.sn || '—'}${state.demo ? ' (بيانات تجريبية)' : ''}`, `أُنشئ: ${fmt.dateTime(Date.now())}`];
const kwhS = (v) => (v == null ? '—' : fmt.kwh(v));

// ملخص أيام (فترة أو أسبوع أو شهر) → مواصفات PDF
function sumsPdfSpec(title, subtitle, sums) {
  const t = totals(sums);
  const p = state.prefs;
  const gc = t.grid != null ? costOf(t.grid, p) : null;
  const sv = costOf(t.pv, p);
  const cover = t.load > 0 && t.grid != null ? Math.max(0, Math.min(100, (1 - t.grid / t.load) * 100)) : null;
  const short = (d) => fmt.day(d, { day: 'numeric', month: 'numeric' });
  return {
    title, subtitle, meta: pdfMeta(),
    stats: [
      { label: 'الإنتاج', value: kwhS(t.pv), unit: 'ك.و.س', color: 'c-amber' },
      { label: 'الاستهلاك', value: kwhS(t.load), unit: 'ك.و.س', color: 'c-sky' },
      { label: 'سحب الشبكة (تقدير)', value: kwhS(t.grid), unit: 'ك.و.س', sub: t.gridPartial ? `${t.gridPartial} أيام ناقصة` : '', color: 'c-violet' },
      gc ? { label: 'كلفة الشبكة', value: fmtMoney(gc.v, gc.code), unit: gc.sym, sub: gc.alt ? `≈ ${fmtMoney(gc.alt.v, gc.alt.code)} ${gc.alt.sym}` : '', color: 'c-pink' } : null,
      sv ? { label: 'توفير الألواح', value: fmtMoney(sv.v, sv.code), unit: sv.sym, color: 'c-green' } : null,
      { label: 'الاستقلالية عن الشبكة', value: t.independence == null ? '—' : Math.round(t.independence) + '%', unit: 'من الاستهلاك', color: 'c-slate' },
      { label: 'متوسط الإنتاج اليومي', value: kwhS(t.avgPv), unit: 'ك.و.س / يوم', color: 'c-amber' },
      { label: 'شحن من الألواح', value: kwhS(t.solarChg), unit: 'ك.و.س', color: 'c-green' },
      { label: 'شحن من الشبكة', value: kwhS(t.gridChg), unit: 'ك.و.س', color: 'c-violet' },
    ],
    lines: [
      `أنتجت الألواح ${kwhS(t.pv)} ك.و.س واستهلك البيت ${kwhS(t.load)} ك.و.س.`,
      t.grid != null ? `سُحب من الشبكة نحو ${kwhS(t.grid)} ك.و.س${gc ? ` بكلفة ${costText(gc)}` : ''}${cover != null ? `، فغطّت المنظومة نحو ${Math.round(cover)}% من الاستهلاك` : ''}.` : null,
      t.best ? `أفضل يوم إنتاج: ${dayName(t.best.date)} (${kwhS(t.best.pvKwh)} ك.و.س).` : null,
      t.socMin ? `أدنى نسبة للبطارية: ${t.socMin.socMin}% يوم ${dayName(t.socMin.date)}${t.socMin.socMinAt ? ` الساعة ${fmt.time(t.socMin.socMinAt)}` : ''}.` : null,
    ].filter(Boolean),
    charts: [{ title: 'يوماً بيوم (كيلوواط ساعة)', type: 'bar', labels: sums.map((x) => short(x.date)), series: [
      { label: 'الإنتاج', data: sums.map((x) => (x.count > 1 ? +(x.pvKwh ?? 0).toFixed(2) : null)), color: '#f59e0b' },
      { label: 'الاستهلاك', data: sums.map((x) => (x.count > 1 ? +(x.loadKwh ?? 0).toFixed(2) : null)), color: '#0ea5e9' },
      { label: 'الشبكة', data: sums.map((x) => (x.gridKwh != null ? +x.gridKwh.toFixed(2) : null)), color: '#8b5cf6' },
    ] }],
    table: { title: 'التفاصيل (كيلوواط ساعة)', head: ['اليوم', 'الإنتاج', 'الاستهلاك', 'الشبكة', 'البطارية'],
      rows: sums.map((x) => [dayName(x.date), x.count > 1 ? fmt.kwh(x.pvKwh) : '—', x.count > 1 ? fmt.kwh(x.loadKwh) : '—', x.gridKwh != null ? fmt.kwh(x.gridKwh) : '—', x.socMin != null ? `${x.socMin}–${x.socMax}%` : '—']),
      dim: sums.map((x) => x.gridBasis === 'partial') },
    notes: [`أيام فيها بيانات: ${t.days} من ${sums.length}. سحب الشبكة تقدير لأن الجهاز لا يرسل عدّاد استيراد؛ الأرقام الباهتة أيام ناقصة القراءات.`],
    footer: 'طاقتي — تقرير منظومة الطاقة الشمسية',
  };
}

function dayPdfSpec(date, r) {
  const s = r.sum;
  const sv = costOf(s.pvKwh, state.prefs);
  const t = r.samples.map((x) => x.ts);
  const pts = (k) => r.samples.map((x) => ({ x: x.ts, y: x[k] ?? null }));
  const line = (title, series) => ({ title, type: 'line', time: true, labels: t, min: t[0], max: t[t.length - 1], tick: (v) => fmt.time(v), series });
  return {
    title: 'التقرير اليومي', subtitle: fmt.day(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), meta: pdfMeta(),
    stats: [
      { label: 'إنتاج الألواح', value: kwhS(s.pvKwh), unit: 'ك.و.س', color: 'c-amber' },
      { label: 'استهلاك المنزل', value: kwhS(s.loadKwh), unit: 'ك.و.س', color: 'c-sky' },
      { label: 'سحب الشبكة (تقدير)', value: kwhS(s.gridKwh), unit: 'ك.و.س', sub: s.gridBasis === 'partial' ? 'جزئي' : '', color: 'c-violet' },
      { label: 'أدنى نسبة للبطارية', value: s.socMin == null ? '—' : `${s.socMin}%`, unit: s.socMinAt ? 'الساعة ' + fmt.time(s.socMinAt) : '', color: 'c-pink' },
      { label: 'أعلى نسبة للبطارية', value: s.socMax == null ? '—' : `${s.socMax}%`, unit: s.fullAt ? 'امتلأت ' + fmt.time(s.fullAt) : '', color: 'c-green' },
      { label: 'ذروة الحمل', value: fmt.w(s.peakW), color: 'c-pink' },
      { label: 'شحن من الألواح', value: kwhS(s.solarChgKwh), unit: 'ك.و.س', color: 'c-amber' },
      { label: 'شحن من الشبكة', value: kwhS(s.gridChgKwh), unit: 'ك.و.س', color: 'c-violet' },
      sv ? { label: 'التوفير', value: fmtMoney(sv.v, sv.code), unit: sv.sym, color: 'c-green' } : { label: 'توفر الكهرباء', value: numAr(s.gridH, 1), unit: 'ساعة', color: 'c-violet' },
    ],
    charts: [
      line('القدرة خلال اليوم (واط)', [{ label: 'الألواح', data: pts('pvW'), color: '#f59e0b' }, { label: 'الحمل', data: pts('outW'), color: '#0ea5e9' }]),
      { ...line('نسبة شحن البطارية (%)', [{ label: '%', data: pts('soc'), color: '#10b981' }]), yMax: 100 },
    ],
    notes: [`المصدر: ${SRC[r.source] || ''} · ${r.samples.length} قراءة. سحب الشبكة تقدير لأن الجهاز لا يرسل عدّاد استيراد.`],
    footer: 'طاقتي — تقرير منظومة الطاقة الشمسية',
  };
}

let pdfBusy = false;
async function sharePdf(name, spec) {
  if (pdfBusy) return;
  pdfBusy = true;
  toast('جارٍ تجهيز ملف PDF…');
  try {
    const bytes = await buildPdf(spec, { font: state.prefs.fontFamily || 'Cairo' });
    await shareFile(`taqati-${name}.pdf`, bytes, { mime: 'application/pdf', dialog: 'مشاركة تقرير PDF' });
  } catch (e) {
    // إلغاء نافذة المشاركة ليس خطأً
    if (!/cancel/i.test(e?.message || '')) toast(`تعذّر إنشاء PDF: ${e.message || e}`, 'bad');
  } finally { pdfBusy = false; }
}
const pdfBtn = (id) => `<button class="btn primary wide" id="${id}">${icons.download} مشاركة التقرير PDF</button>`;

async function exportSummaries(name, sums) {
  await shareFile(`taqati-${name}.csv`, toCsv(
    ['التاريخ', 'الإنتاج (ك.و.س)', 'الاستهلاك (ك.و.س)', 'أدنى شحن %', 'أعلى شحن %', 'ذروة الحمل (واط)', 'ساعات الكهرباء', 'ساعات البطارية', 'شحن من الألواح (ك.و.س)', 'شحن من الكهرباء (ك.و.س)', 'سحب الشبكة تقديراً (ك.و.س)', 'رقم الشبكة', `كلفة الشبكة (${costOf(1, state.prefs)?.sym || '—'})`, 'الاستقلالية %', 'عدد القراءات', 'المصدر'],
    sums.map((s) => [s.date, s.pvKwh?.toFixed(2) ?? '', s.loadKwh?.toFixed(2) ?? '', s.socMin ?? '', s.socMax ?? '', s.peakW ?? '', s.gridH?.toFixed(1) ?? '', s.batH?.toFixed(1) ?? '',
      s.solarChgKwh?.toFixed(2) ?? '', s.gridChgKwh?.toFixed(2) ?? '', s.gridKwh?.toFixed(2) ?? '', { estimated: 'تقديري', partial: 'تقديري جزئي' }[s.gridBasis] || '',
      s.gridKwh != null && costOf(s.gridKwh, state.prefs) ? costOf(s.gridKwh, state.prefs).v.toFixed(2) : '',
      s.independence == null ? '' : Math.round(s.independence), s.count, SRC[s.source] || '']),
  ));
}

// ================= تبويب التنبيهات: سجل واحد بفلاتر =================
function viewAlerts() {
  if (state.page === 'rules') return pageRules();
  if (state.page === 'srvlog') return pageSrvLog();
  const counts = state.log.reduce((o, e) => { const c = catOf(e); o[c] = (o[c] || 0) + 1; return o; }, {});
  if (state.logFilter && !counts[state.logFilter]) state.logFilter = null;
  const filter = state.logFilter || 'all';
  const list = filter === 'all' ? state.log : state.log.filter((e) => catOf(e) === filter);
  const chips = [['all', 'الكل', state.log.length], ...Object.entries(CATS).filter(([k]) => counts[k]).map(([k, label]) => [k, label, counts[k]])];
  const html = `
  ${listCards([
    { page: 'rules', title: 'شروط التنبيه', sub: `البطارية ${state.prefs.lowSoc}% · الحمل ${state.prefs.overloadPct}% · ${state.prefs.bgMonitor && Capacitor.isNativePlatform() ? 'المراقبة في الخلفية مفعّلة' : 'المراقبة في الخلفية متوقفة'}`, icon: icons.sliders, color: 'c-violet' },
    cap('warn') === false ? null : { page: 'srvlog', title: 'سجل الإنفرتر في الخادم', sub: 'أعطال وتحذيرات آخر 90 يوماً، حتى وهاتفك مطفأ', icon: icons.warn, color: 'c-pink' },
  ].filter(Boolean))}
  <h3 class="sec-h">سجل التطبيق${infoBtn('log')}</h3>
  ${state.log.length ? `<div class="chips-sel log-filter">${chips.map(([k, label, n]) => `<button data-filter="${k}" class="${filter === k ? 'on' : ''}">${label} <b>${n}</b></button>`).join('')}</div>
  <div class="row-end"><button class="link" id="clearList">مسح السجل</button></div>` : ''}
  ${eventList(list, 'لا توجد أحداث بعد. ستظهر هنا عند انقطاع الكهرباء أو انخفاض البطارية أو انقطاع الإنفرتر أو أي عطل.')}`;
  // تُعلَّم مقروءة بعد بناء الصفحة حتى يظهر الجديد مميّزاً هذه المرة
  if (state.log.some((e) => e.read === false)) { state.log.forEach((e) => { e.read = true; }); store.set('log', state.log); }
  return html;
}
AFTER.alerts = () => {
  document.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { state.logFilter = b.dataset.filter === 'all' ? null : b.dataset.filter; render(); }; });
  const c = $('#clearList');
  if (c) c.onclick = async () => {
    if (!(await confirmDialog('مسح السجل', 'هل تريد حذف كل الأحداث من السجل؟'))) return;
    state.log = [];
    store.set('log', []);
    render();
  };
  setTimeout(renderHeader, 0);
};

// ===== سجل الإنفرتر في الخادم =====
async function loadSrvLog() {
  const d = device();
  state.rep.srv = { loading: true };
  render();
  const ymd = (t) => fmt.iso(t).slice(0, 10) + ' 00:00:00';
  try {
    const list = state.demo
      ? [{ desc: 'Battery voltage low', code: '04', level: 1, handle: true, gts: fmt.iso(Date.now() - 2 * 864e5) }, { desc: 'Over load', code: '07', level: 2, handle: true, gts: fmt.iso(Date.now() - 9 * 864e5) }]
      : await optional('warn', () => api.warnings(d, ymd(Date.now() - 90 * 864e5), ymd(Date.now() + 864e5)));
    if (device() !== d) return;
    state.rep.srv = { list: (list || []).sort((a, b) => String(b.gts).localeCompare(String(a.gts))), at: Date.now() };
  } catch (e) {
    if (device() !== d) return;
    state.rep.srv = { error: cap('warn') === false ? 'خادم WatchPower لا يتيح هذا السجل لحسابك.' : e.message };
  }
  if (leaf() === 'srvlog') render();
}

function pageSrvLog() {
  const r = state.rep.srv;
  if (!r || r.loading) return '<div class="empty"><div class="spinner"></div>جارٍ جلب السجل من الخادم…</div>';
  if (r.error) return `<div class="empty bad">${esc(r.error)}</div><button class="btn ghost wide" id="srvRetry">${icons.refresh} إعادة المحاولة</button>`;
  return `<p class="hint">${r.list.length ? countAr(r.list.length, ['حدث واحد', 'حدثان', 'أحداث', 'حدثاً']) + ' في آخر 90 يوماً' : ''}${infoBtn('srvlog')}</p>
  ${r.list.length ? `<ul class="alerts">${r.list.map((w) => {
    const t = warnAr(w.desc);
    const lvl = Number(w.level) >= 2 ? 'bad' : 'warn';
    return `<li class="alert ${lvl}"><div class="a-ic">${icons.warn}</div><div>
      <b>${esc(t.title)}</b>${t.tip ? `<p>${esc(t.tip)}</p>` : ''}
      <p class="orig"><bdi>${esc([w.code ? 'الرمز ' + w.code : '', w.desc].filter(Boolean).join(' · '))}</bdi></p>
      <time>${esc(parseTs(w.gts) ? fmt.dateTime(parseTs(w.gts)) : String(w.gts || ''))}${w.handle === true ? ' · انتهى' : ''}</time></div></li>`;
  }).join('')}</ul>` : '<div class="empty">لا أعطال ولا تحذيرات في آخر 90 يوماً. ممتاز.</div>'}
  <button class="btn ghost wide" id="srvRetry">${icons.refresh} تحديث</button>`;
}
AFTER.srvlog = () => {
  if (!state.rep.srv || (!state.rep.srv.loading && state.rep.srv.at && Date.now() - state.rep.srv.at > 10 * 60000)) { loadSrvLog(); return; }
  const b = $('#srvRetry');
  if (b) b.onclick = loadSrvLog;
};

const CAT_IC = { grid: icons.grid, conn: icons.offline, bat: icons.battery, fault: icons.warn, set: icons.wrench };

function eventList(list, empty) {
  if (!list.length) return `<div class="empty">${esc(empty)}</div>`;
  // مجمّعة حسب اليوم على خط زمني: الأيقونة واللون والنص تميّز الانقطاع والعودة والتحذير
  const groups = [];
  for (const e of list) {
    const k = dayKey(e.at);
    if (groups[groups.length - 1]?.k !== k) groups.push({ k, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const label = (k) => (k === today() ? 'اليوم' : k === today(-1) ? 'أمس' : fmt.day(k, { weekday: 'long', day: 'numeric', month: 'long' }));
  return `<div class="timeline">${groups.map((g) => `
    <div class="tl-day"><span>${esc(label(g.k))}</span></div>
    <ul class="alerts">${g.items.map((e) => {
      const level = levelOf(e);
      const cat = catOf(e);
      const ic = level === 'ok' && cat !== 'grid' ? icons.check : CAT_IC[cat] || icons.info;
      const kind = cat === 'grid' ? (level === 'ok' ? 'back' : 'cut') : level;
      return `
      <li class="alert ${level} k-${kind} ${e.read === false ? 'new' : ''}">
        <div class="a-ic">${ic}</div>
        <div class="a-txt"><b>${esc(e.title)}</b>${e.body ? `<p>${esc(e.body)}</p>` : ''}</div>
        <time>${esc(fmt.time(e.at))}</time>
      </li>`;
    }).join('')}</ul>`).join('')}</div>`;
}

function toggle(key, label, sub = '') {
  return `<label class="sw-row"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><input type="checkbox" class="sw" data-pref="${key}" ${state.prefs[key] ? 'checked' : ''}></label>`;
}
// حقل نصي بلوحة أرقام: يقبل الأرقام العربية ٠-٩ والفاصلة، لأن حقل type=number يرفضها فيُمسح ما كتبه المستخدم
function numField(key, label, unit, min, max, placeholder = '', info = '') {
  return `<label class="num-row"><span>${esc(label)}${infoBtn(info)}</span><span class="num-in"><input type="text" inputmode="decimal" autocomplete="off" data-pref="${key}" data-min="${min}" data-max="${max}" value="${state.prefs[key] ?? ''}" placeholder="${esc(placeholder)}"><small>${esc(unit)}</small><i class="saved" aria-hidden="true"></i></span></label>`;
}

function pageRules() {
  // إعدادات الحرارة تظهر فقط لما يرسله الجهاز فعلاً؛ أغلب الأجهزة لا ترسل الحرارة أبداً
  const m = state.model;
  const temps = m?.temps || [];
  return `
  <section class="card"><div class="form">
    ${toggle('notify', 'إشعارات على الهاتف', 'تظهر في شريط الإشعارات')}
    ${isNative ? toggle('bgMonitor', 'المراقبة والتطبيق مغلق', 'فحص كل 15 دقيقة تقريباً حتى بعد إغلاق التطبيق') : ''}
    ${numField('lowSoc', 'انخفاض البطارية إلى', '%', 5, 90)}
    ${numField('overloadPct', 'تجاوز الحمل نسبة', '%', 30, 120)}
    ${toggle('alertOffline', 'انقطاع اتصال الإنفرتر وعودته')}
    ${toggle('alertGrid', 'انقطاع كهرباء الشبكة وعودتها')}
    ${toggle('alertFull', 'اكتمال شحن البطارية')}
    ${temps.length ? toggle('alertTemp', 'ارتفاع الحرارة', 'يرسل جهازك: ' + temps.map((t) => t.ar).join('، ')) : ''}
    ${m?.batTemp != null ? numField('tempBat', 'حد حرارة البطارية', '°م', 30, 80) : ''}
    ${m?.invTemp != null ? numField('tempInv', 'حد حرارة الإنفرتر', '°م', 40, 110) : ''}
  </div></section>
  ${m && !temps.length ? '<p class="hint">جهازك لا يرسل قراءات الحرارة، لذلك أُخفيت إعدادات تنبيه الحرارة.</p>' : ''}
  <button class="btn ghost wide" id="testNotif">${icons.bell} إرسال إشعار تجريبي</button>
  <p class="hint">والتطبيق مفتوح يُفحص الإنفرتر كل دقيقة. ${isNative
    ? (state.prefs.bgMonitor
      ? 'وبعد إغلاقه يتولى نظام أندرويد الفحص كل 15 دقيقة تقريباً (أقل مدة يسمح بها النظام)، وقد يتأخر الفحص عند تفعيل توفير البطارية الشديد. لأفضل نتيجة اجعل «طاقتي» غير مقيّد في إعدادات البطارية بالهاتف.'
      : 'المراقبة بعد الإغلاق متوقفة، فلن تصل التنبيهات حتى تفتح التطبيق.')
    : 'المراقبة بعد إغلاق التطبيق متاحة في تطبيق الهاتف فقط.'}</p>
  <p class="hint">كل الأحداث تُسجّل في سجل التنبيهات حتى لو أوقفت إشعارها.</p>`;
}
AFTER.rules = () => {
  bindPrefs($('#view'));
  $('#testNotif').onclick = async () => {
    if (!Capacitor.isNativePlatform()) { toast('الإشعارات تعمل في تطبيق الهاتف فقط', 'bad'); return; }
    const r = await LocalNotifications.requestPermissions().catch(() => ({}));
    if (r.display !== 'granted') { toast('الإشعارات غير مسموحة من إعدادات الهاتف', 'bad'); return; }
    await LocalNotifications.schedule({ notifications: [{ id: 1, title: 'طاقتي', body: 'الإشعارات تعمل بشكل صحيح ✓' }] });
    toast('تم إرسال الإشعار', 'ok');
  };
};

function bindPrefs(root) {
  root.querySelectorAll('[data-pref]').forEach((el) => {
    // live: حفظ أثناء الكتابة، فلا نعيد كتابة الحقل (حتى لا تُمسح «4.» قبل أن تكتمل «4.4»)
    el.onchange = async (ev, live = false) => {
      const k = el.dataset.pref;
      if (el.type === 'checkbox') state.prefs[k] = el.checked;
      else if (el.tagName === 'SELECT') state.prefs[k] = el.value;
      else if (el.value.trim() === '' && DEFAULT_PREFS[k] === null) state.prefs[k] = null;
      else {
        const v = parseFloat(latinDigits(el.value));
        const min = Number(el.dataset.min), max = Number(el.dataset.max);
        if (!Number.isFinite(v)) { el.value = state.prefs[k] ?? ''; toast('أدخل رقماً', 'bad'); return; }
        const clamped = Math.min(max, Math.max(min, v));
        if (clamped !== v) toast(`القيمة المسموحة بين ${min} و${max}`, 'bad');
        state.prefs[k] = clamped;
        if (!live) el.value = clamped;
      }
      savePrefs();
      if (k === 'notify' && el.checked && Capacitor.isNativePlatform()) {
        const r = await LocalNotifications.requestPermissions().catch(() => ({}));
        if (r.display !== 'granted') toast('لم يُسمح بالإشعارات من إعدادات الهاتف', 'bad');
      }
      syncMonitor();
      if (k === 'staleMin' && state.model) state.model = normalize(state.model.raw.map((r) => ({ title: r.title, val: r.val, unit: r.unit })), state.prefs.staleMin, tzOffset());
      if (k === 'theme') { applyTheme(); render(); }
      // علامة «محفوظ» بجانب الحقل نفسه بدل رسالة عامة
      const ok = el.parentElement?.querySelector('.saved');
      if (ok) { ok.classList.remove('on'); void ok.offsetWidth; ok.classList.add('on'); } else toast('تم الحفظ', 'ok');
    };
    // الحقول الرقمية تُحفظ أثناء الكتابة بعد توقف قصير، دون انتظار مغادرة الحقل
    if (el.dataset.min !== undefined) {
      let t;
      // نحفظ أثناء الكتابة فقط إذا كانت القيمة ضمن المسموح، حتى لا نصحّح رقماً لم يكتمل بعد (مثل «2» قبل «200»)
      el.oninput = () => {
        clearTimeout(t);
        t = setTimeout(() => {
          const v = parseFloat(latinDigits(el.value));
          if (Number.isFinite(v) && v >= Number(el.dataset.min) && v <= Number(el.dataset.max) && v !== state.prefs[el.dataset.pref]) el.onchange(null, true);
        }, 900);
      };
      el.onkeydown = (e) => { if (e.key === 'Enter') el.blur(); };
    }
  });
}

// ================= صفحة الإنفرتر (الحالة + المعلومات + القيم المقنّنة + الإعدادات الحالية) =================
function pageDevice(m) {
  const d = device();
  const group = (g) => m.raw.filter((r) => r.group === g);
  const rows = (list) => list.map((r) => [r.ar, isEmptyVal(r.val) ? val(null) : val(r.valAr, trUnit(r.unit))]);
  const product = group('product').filter((r) => !/^timestamp$/i.test(r.title));
  const section = (title, body, open = false) => `<details class="card fold" ${open ? 'open' : ''}><summary><h2>${esc(title)}</h2>${icons.chevL}</summary>${body}</details>`;
  return `
  ${section('الحالة التشغيلية', kv([
    ['الاتصال', m.stale ? '<span class="tag bad">غير متصل</span>' : state.demo ? '<span class="tag">تجريبي</span>' : '<span class="tag ok">متصل</span>'],
    ['آخر قراءة', val(m.ts ? fmt.dateTime(m.ts) : null)],
    ['وضع التشغيل', val(m.mode ? trValue(m.mode) : null)],
    ['حالة الحمل', val(m.loadStatus ? trValue(m.loadStatus) : null)],
    ['عطل الإنفرتر', m.fault ? `<span class="tag bad">${esc(m.fault)}</span>` : '<span class="tag ok">لا يوجد</span>'],
    m.warning ? ['تحذير', `<span class="tag warn">${esc(m.warning)}</span>`] : null,
    ['جهد الناقل الداخلي', val(m.busV === null ? null : numAr(m.busV), 'فولت')],
    ...m.temps.map((t) => [t.ar, val(numAr(t.v), '°م')]),
  ]), true)}
  ${section('كل القراءات الحيّة', kv(group('live').map((r) => [r.ar, isEmptyVal(r.val) ? val(null) : val(r.valAr, trUnit(r.unit))])))}
  ${section('معلومات الجهاز', kv([['اسم الجهاز', val(d?.alias)], ['رقم الجهاز في الحساب', val(d?.sn)], ['رقم وحدة الواي فاي', val(d?.pn)], ...rows(product)]))}
  ${group('rated').length ? section('القيم المقنّنة', kv(rows(group('rated')))) : ''}
  ${group('config').length ? section('الإعدادات الحالية', kv(rows(group('config'))) + '<p class="hint">للعرض فقط. لتغييرها: «المزيد ← إعدادات الإنفرتر».</p>') : ''}
  ${wifiCard()}
  <button class="btn ghost wide" data-goto="more:edit">${icons.wrench} تعديل إعدادات الإنفرتر</button>`;
}

// وحدة الواي فاي: كل كم ترفع القراءات، وإعادة تشغيلها عن بُعد
function wifiCard() {
  const c = state.collector;
  const canRestart = cap('restart') !== false;
  if (!c && !canRestart) return '';
  const every = c?.datFetch ? countAr(Math.max(1, Math.round(c.datFetch / 60)), ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة']) : null;
  return `<section class="card">${cardH('وحدة الواي فاي', 'wifi')}
    ${kv([['الرقم', val(device()?.pn)], every ? ['ترفع قراءة كل', val(every)] : null])}
    ${canRestart ? `<button class="btn ghost wide" id="wifiRestart">${icons.refresh} إعادة تشغيل الوحدة</button>` : ''}
  </section>`;
}
AFTER.device = () => {
  bindGoto();
  loadCollector();
  loadPlantInfo();
  const b = $('#wifiRestart');
  if (!b) return;
  b.onclick = async () => {
    if (!(await confirmDialog('إعادة تشغيل وحدة الواي فاي', 'ستنقطع القراءات دقيقة أو اثنتين ثم تعود. الإنفرتر نفسه لا يتأثر ويبقى يعمل. هل تريد المتابعة؟'))) return;
    b.disabled = true;
    b.innerHTML = '<span class="spinner"></span> جارٍ الإرسال…';
    try {
      const ret = state.demo ? 0 : await optional('restart', () => api.restartCollector(device().pn));
      const msg = { 0: ['أُعيد تشغيل الوحدة. ستعود القراءات خلال دقيقة أو اثنتين', 'ok'], 1: ['أُرسل الأمر إلى الوحدة', 'ok'], 2: ['الوحدة لا ترد: يبدو أنها مفصولة عن الإنترنت. افصلها عن الإنفرتر وأعد وصلها بيدك', 'bad'] }[ret] || ['أُرسل الأمر', 'ok'];
      toast(msg[0], msg[1]);
      if (ret !== 2) logEvent('set', 'info', 'إعادة تشغيل وحدة الواي فاي', msg[0]);
    } catch (e) {
      toast(cap('restart') === false ? 'خادمك لا يتيح إعادة تشغيل الوحدة من التطبيق' : e.message, 'bad');
    }
    render();
  };
};

// ===== إعدادات الإنفرتر =====
// اسم عربي وشرح مبسّط لكل إعداد من settings-info.js، وما لا نعرفه يبقى باسمه الأصلي
const trS = (s) => settingInfo(s)?.ar || trTitle(s);
const unknownVal = (v) => v === null || v === undefined || /^\s*-*\s*$/.test(String(v));

// تجميع الإعدادات في أقسام مفهومة بدل قائمة طويلة واحدة
const SETTING_GROUPS = [
  ['الأولويات', /priority|input range|solar balance|power balance|grid.?tie|feed|dual output/],
  ['البطارية', /battery|bulk|float|charg|discharg|cut.?off|under voltage|soc|back to/],
  ['معادلة البطارية', /equali/],
  ['الحماية والتشغيل', /overload|temp|bypass|power saving|fault|output voltage|output frequency|parallel|pv ok/],
  ['الشاشة والإضاءة والصوت', /led|lcd|backlight|buzzer|beep|silence|alarm|display/],
];
const groupOfSetting = (name) => {
  const n = String(name).toLowerCase();
  if (/restore|factory|default setting/.test(n)) return 'متقدم';
  return (SETTING_GROUPS.find(([, re]) => re.test(n)) || ['متقدم'])[0];
};

function pageEdit() {
  if (state.demo) return '<div class="empty">تعديل الإعدادات متاح بعد تسجيل الدخول بحسابك الحقيقي.</div>';
  if (state.model?.stale) return `${banner()}<div class="empty bad">الإنفرتر غير متصل حالياً، ولن تصل إليه أي إعدادات حتى يعود الاتصال.</div>`;
  let body;
  if (state.fieldsError) body = `<div class="empty bad">${esc(state.fieldsError)}</div><button class="btn ghost wide" id="loadFields">إعادة المحاولة</button>`;
  else if (!state.fields) body = '<div class="empty"><div class="spinner"></div>جارٍ تحميل قائمة الإعدادات…</div>';
  else if (!state.fields.length) body = '<div class="empty">هذا الجهاز لا يدعم تعديل الإعدادات عن بُعد.</div>';
  else {
    const order = ['الأولويات', 'البطارية', 'الحماية والتشغيل', 'الشاشة والإضاءة والصوت', 'معادلة البطارية', 'متقدم'];
    const groups = {};
    state.fields.forEach((f, i) => (groups[groupOfSetting(f.name)] ||= []).push([f, i]));
    body = order.filter((g) => groups[g]).map((g) => `
      <h3 class="sec-h">${esc(g)}</h3>
      <ul class="fields card">${groups[g].map(([f, i]) => {
        const info = settingInfo(f.name);
        const action = (f.item || []).length === 1;
        return `<li class="field" data-i="${i}">
          <button class="field-h"><span class="fh-t"><b>${esc(trS(f.name))}${info?.risk ? ' <i class="risk">حساس</i>' : ''}${action ? ' <i class="act">إجراء</i>' : ''}</b>
            <small>${esc(info ? info.desc.split('\n')[0] : (trS(f.name) !== f.name ? f.name : ''))}</small></span>${icons.chevL}</button>
          <div class="field-b"></div>
        </li>`;
      }).join('')}</ul>`).join('');
  }
  return `<div class="banner warn">${icons.warn}<span><b>تنبيه</b>تغيير هذه الإعدادات يؤثر على عمل الإنفرتر مباشرة. اقرأ شرح كل إعداد قبل تغييره، وصوّر الإعدادات الحالية قبل أي تعديل.</span></div>${body}`;
}
AFTER.edit = () => {
  const load = async () => {
    try {
      state.fields = await api.ctrlFields(device());
      state.fieldsError = null;
      // مصدر احتياطي للقيم الحالية عندما ترفض بعض الأجهزة قراءة إعداد بمفرده
      api.parameters(device()).then((list) => {
        state.params = {};
        list.forEach((p) => { if (p.par) state.params['id:' + p.par] = p.val; if (p.name) state.params['n:' + String(p.name).trim().toLowerCase()] = p.val; });
      }).catch(() => { state.params = {}; });
    } catch (e) { state.fieldsError = e.message; }
    if (state.page === 'edit') render();
  };
  const lf = $('#loadFields');
  if (lf) lf.onclick = () => { state.fieldsError = null; render(); load(); };
  if (!state.fields && !state.fieldsError && !state.demo && !state.model?.stale) load();
  document.querySelectorAll('.fields').forEach((list) => {
    list.onclick = (e) => { const h = e.target.closest('.field-h'); if (h) openField(h.parentElement); };
  });
};

async function readCurrent(f) {
  try {
    const v = (await api.ctrlValue(device(), f.id)).val;
    if (!unknownVal(v)) return { val: v };
  } catch (e) {
    const fb = state.params?.['id:' + f.id] ?? state.params?.['n:' + String(f.name).trim().toLowerCase()];
    if (!unknownVal(fb)) return { val: fb };
    return { val: null, note: e.message };
  }
  const fb = state.params?.['id:' + f.id] ?? state.params?.['n:' + String(f.name).trim().toLowerCase()];
  return { val: unknownVal(fb) ? null : fb };
}

async function openField(li) {
  const open = li.classList.toggle('open');
  if (!open) return;
  const f = state.fields[Number(li.dataset.i)];
  const info = settingInfo(f.name);
  const items = f.item || [];
  const body = li.querySelector('.field-b');
  const descHtml = info ? `<p class="f-desc">${esc(info.desc).replace(/\n/g, '<br>')}</p>` : '';
  const riskHtml = info?.risk ? `<p class="f-risk">${icons.warn}<span>إعداد حساس: القيمة الخاطئة قد تؤثر على البطارية أو الأجهزة. تأكد من مواصفات جهازك قبل التغيير.</span></p>` : '';

  // إعداد بخيار واحد = زر إجراء (مثل استعادة إعدادات المصنع)، لا قيمة له لتُقرأ
  if (items.length === 1) {
    const it = items[0];
    body.innerHTML = `${descHtml}${riskHtml}<button class="btn ${info?.risk ? 'danger' : 'primary'} wide f-act">${esc(trS(f.name))} — ${esc(optionAr(it.val))}</button>`;
    body.querySelector('.f-act').onclick = async () => {
      if (!(await confirmDialog('تنفيذ إجراء', `سيتم تنفيذ <b>${esc(trS(f.name))}</b> على الإنفرتر الآن.${info?.risk ? '<br><b>هذا الإجراء لا يمكن التراجع عنه.</b>' : ''} هل أنت متأكد؟`))) return;
      if (info?.risk && !(await confirmDialog('تأكيد نهائي', 'تأكيد أخير: هل تريد فعلاً المتابعة؟'))) return;
      await sendSetting(li, f, it.key, trS(f.name));
    };
    return;
  }

  body.innerHTML = `${descHtml}<div class="spinner sm"></div>`;
  const cur = await readCurrent(f);
  const match = cur.val === null ? null : items.find((it) => String(it.key) === String(cur.val) || String(it.val).toLowerCase() === String(cur.val).toLowerCase());
  const curText = cur.val === null ? null : match ? optionAr(match.val) : `${cur.val} ${items.length ? '' : trUnit(f.unit || '')}`;
  const range = hintRange(f.hint);
  const curNum = Number(String(cur.val ?? '').replace(/[^0-9.\-]/g, ''));
  // نثق بالنطاق فقط إذا كانت القيمة الحالية داخله، لأن الخادم يرسل أحياناً نطاقاً خاطئاً
  const rangeOk = range && (cur.val === null || !Number.isFinite(curNum) || (curNum >= range[0] && curNum <= range[1]));
  const input = items.length
    ? `<select class="f-in">${match ? '' : '<option value="" selected disabled>اختر القيمة الجديدة</option>'}${items.map((it) => `<option value="${esc(it.key)}" ${it === match ? 'selected' : ''}>${esc(optionAr(it.val))}</option>`).join('')}</select>`
    : `<span class="num-in"><input class="f-in" dir="ltr" inputmode="decimal" value="${esc(cur.val ?? '')}" placeholder="${rangeOk ? esc(range.join(' – ')) : ''}"><small>${esc(trUnit(f.unit || ''))}</small></span>`;
  body.innerHTML = `${descHtml}${riskHtml}
    <div class="cur">القيمة الحالية: <b>${curText === null ? 'غير متاحة' : esc(curText)}</b></div>
    ${cur.val === null ? `<p class="hint">${esc(cur.note || 'الإنفرتر لم يرسل القيمة الحالية لهذا الإعداد')}. يمكنك مع ذلك اختيار قيمة جديدة وحفظها.</p>` : ''}
    ${rangeOk ? `<p class="hint">النطاق المسموح: <bdi dir="ltr">${range[0]} – ${range[1]} ${esc(trUnit(f.unit || ''))}</bdi></p>` : f.hint ? `<p class="hint">ملاحظة الجهاز: <bdi dir="ltr">${esc(f.hint)}</bdi></p>` : ''}
    <div class="f-row">${input}<button class="btn primary f-save">حفظ</button></div>`;
  body.querySelector('.f-save').onclick = async () => {
    const inp = body.querySelector('.f-in');
    // لوحة المفاتيح العربية تكتب «٥٤٫٥» فنحوّلها إلى 54.5 قبل الفحص والإرسال
    const v = items.length ? inp.value.trim() : latinDigits(inp.value.trim());
    if (!v) { toast(items.length ? 'اختر قيمة أولاً' : 'أدخل قيمة أولاً', 'bad'); return; }
    if (!items.length) {
      const n = Number(v);
      if (!Number.isFinite(n)) { toast('أدخل رقماً صحيحاً', 'bad'); return; }
      if (rangeOk && (n < range[0] || n > range[1])) { toast(`القيمة خارج النطاق المسموح (${range[0]} – ${range[1]})`, 'bad'); return; }
    }
    if (match && String(match.key) === v) { toast('هذه هي القيمة الحالية نفسها', ''); return; }
    const shown = items.length ? inp.options[inp.selectedIndex].text : `${v} ${trUnit(f.unit || '')}`;
    if (!(await confirmDialog('تأكيد التغيير', `سيتم تغيير <b>${esc(trS(f.name))}</b>${curText ? ` من <b>${esc(curText)}</b>` : ''} إلى <b>${esc(shown)}</b> على الإنفرتر مباشرة. هل أنت متأكد؟`))) return;
    await sendSetting(li, f, v, shown);
  };
}

async function sendSetting(li, f, val, shown) {
  // منع الإرسال المزدوج إذا ضُغط الزر مرة أخرى قبل وصول الرد
  if (li.dataset.sending) return;
  li.dataset.sending = '1';
  li.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    await api.setCtrl(device(), f.id, val);
    toast('تم إرسال الإعداد إلى الإنفرتر', 'ok');
    logEvent('set', 'info', 'تغيير إعداد', `${trS(f.name)} ← ${shown}`);
    li.classList.remove('open');
    setTimeout(() => openField(li), 1500);
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    delete li.dataset.sending;
    li.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

// ================= أولوية مصدر الطاقة: تحكم يدوي مع تحقق من الجهاز =================
// لا يُرسل شيء إلا بضغطة وتأكيد من المستخدم، ولا يُعرض «تم» إلا إذا أعاد الجهاز الوضع المطلوب.
const orderHtml = (label) => {
  const o = orderOf(label);
  return o ? `<span class="src-order">${o.order.map((x) => `<i>${x}</i>`).join('<b>←</b>')}</span>` : '<span class="src-order na">ترتيب المصادر لهذا الخيار غير معروف للتطبيق؛ راجع دليل جهازك</span>';
};

// قراءة حديثة من الجهاز للتحقق: لا نستخدم قيماً محفوظة سابقاً
async function readFresh(f) {
  try {
    const v = (await api.ctrlValue(device(), f.id)).val;
    if (!unknownVal(v)) return v;
  } catch (e) {
    if (e.code === undefined) throw e;
  }
  const list = await api.parameters(device());
  const p = list.find((x) => String(x.par) === String(f.id) || String(x.name || '').trim().toLowerCase() === String(f.name).trim().toLowerCase());
  if (!p || unknownVal(p.val)) throw new Error('الجهاز لم يُعد قيمة هذا الإعداد');
  return p.val;
}

async function loadPower(force = false) {
  const c = state.ctl || (state.ctl = {});
  if (c.loading || (!force && c.field)) return;
  c.loading = true; c.error = null;
  if (leaf() === 'power') render();
  const forSn = sn();
  const stale = () => state.ctl !== c || sn() !== forSn; // بُدّل الجهاز أو خرج المستخدم أثناء القراءة
  try {
    if (!state.fields) state.fields = await api.ctrlFields(device());
    if (stale()) return;
    c.field = findField(state.fields, isOutputPriority);
    c.chgField = findField(state.fields, isChargerPriority);
    if (!c.field) throw new Error('هذا الجهاز لا يتيح تغيير أولوية مصدر الخرج عن بُعد.');
    c.cur = matchItem(c.field.item, await readFresh(c.field));
    c.curAt = Date.now();
    c.chgCur = null;
    if (c.chgField) { try { c.chgCur = matchItem(c.chgField.item, await readFresh(c.chgField)); } catch { /* للعرض فقط */ } }
  } catch (e) { if (stale()) return; c.error = e.message; }
  if (stale()) return;
  c.loading = false;
  if (leaf() === 'power') render();
}

function pagePower() {
  if (state.demo) return '<div class="empty">التحكم بأولوية مصدر الطاقة متاح بعد تسجيل الدخول بحسابك الحقيقي.</div>';
  if (state.model?.stale) return `${banner()}<div class="empty bad">الإنفرتر غير متصل حالياً، فلا يمكن قراءة وضعه أو تغييره.</div>`;
  const c = state.ctl || {};
  const log = store.get('ctl.' + sn(), []);
  const logHtml = log.length ? `<h3 class="sec-h">سجل التحويلات</h3><ul class="ctl-log card">${log.slice(0, 20).map((e) => `
    <li class="${e.status}"><b>${esc(e.from || '؟')} ← ${esc(e.to)}</b><span>${{ simulated: 'تجربة — لم يُرسل أمر', confirmed: 'تأكّد من الجهاز', unconfirmed: 'لم يتأكد', rejected: 'مرفوض', error: 'لم يُرسل' }[e.status] || e.status}${e.error ? ' · ' + esc(e.error) : ''}</span><small>${esc(fmt.dateTime(e.at))} · يدوي</small></li>`).join('')}</ul>` : '';
  if (c.error) return `<div class="empty bad">${esc(c.error)}</div><button class="btn ghost wide" id="ctlRetry">إعادة المحاولة</button>${logHtml}`;
  if (!c.field || c.loading) return '<div class="empty"><div class="spinner"></div>جارٍ قراءة الوضع الحالي من الإنفرتر…</div>';
  const b = c.busy, r = c.result;
  const status = b
    ? `<div class="ctl-state wait"><div class="spinner sm"></div><div><b>المطلوب: ${esc(optionAr(b.val))}</b><small>أُرسل الأمر، وجارٍ التحقق بقراءة الوضع من الجهاز…</small></div></div>`
    : r ? `<div class="ctl-state ${r.status}">${r.status === 'confirmed' ? icons.check : icons.warn}<div><b>${{
      confirmed: `تأكّد التحويل إلى ${esc(optionAr(r.target.val))}`,
      unconfirmed: `أُرسل الأمر ولم يتأكد التحويل إلى ${esc(optionAr(r.target.val))}`,
      rejected: 'رُفض الأمر ولم يتغيّر الوضع',
      same: 'هذا هو الوضع الحالي أصلاً',
      error: 'لم يُرسل الأمر',
    }[r.status]}</b><small>${r.status === 'confirmed' ? 'الجهاز نفسه يعيد الآن الوضع المطلوب.' : r.status === 'unconfirmed' ? `الجهاز ما زال يعيد «${esc(r.after ? optionAr(r.after.val) : 'قيمة غير مقروءة')}». قد يتأخر التطبيق بضع دقائق؛ اضغط «إعادة القراءة» للتأكد.` : esc(r.error || '')}</small></div></div>` : '';
  return `
  <div class="banner warn">${icons.warn}<span><b>تغيير مباشر على الإنفرتر</b>لا يُرسل شيء إلا بعد تأكيدك، ولا يُعدّ التحويل ناجحاً حتى يعيد الجهاز الوضع الجديد.</span></div>
  <section class="card ctl-cur"><div class="card-h"><h2>الوضع المؤكد من الجهاز</h2><button class="link" id="ctlRead">إعادة القراءة</button></div>
    ${c.cur ? `<b class="ctl-name">${esc(optionAr(c.cur.val))}</b>${orderHtml(c.cur.val)}` : '<p class="note warn">' + icons.warn + '<span>الجهاز أعاد قيمة لا تطابق أي خيار معروف، فلن يُرسل أي تغيير حتى تُقرأ بوضوح.</span></p>'}
    <small class="hint">قُرئ من الجهاز ${esc(fmt.time(c.curAt))}</small>
    ${status}
  </section>
  <h3 class="sec-h">الأوضاع التي يدعمها جهازك</h3>
  <div class="ctl-opts">${c.field.item.map((it) => {
    const cur = c.cur && String(c.cur.key) === String(it.key);
    return `<div class="card ctl-opt ${cur ? 'on' : ''}"><div><b>${esc(optionAr(it.val))}</b>${orderHtml(it.val)}</div>
      ${cur ? '<span class="tag ok">الحالي</span>' : `<button class="btn primary" data-ctl="${esc(it.key)}" ${b || !c.cur ? 'disabled' : ''}>حوّل إليه</button>`}</div>`;
  }).join('')}</div>
  <p class="hint">الترتيب المعروض هو المتعارف عليه لهذه العائلة من الأجهزة. تأكد منه على جهازك مرة واحدة: حوّل، ثم راقب في الرئيسية من أين يتغذى البيت.</p>
  ${ctlSection(c)}
  <section class="card"><div class="card-h"><h2>شحن البطارية من الشبكة</h2></div>
    ${c.chgCur ? kv([['أولوية مصدر الشحن الآن', val(optionAr(c.chgCur.val))]]) : '<p class="hint">تعذّرت قراءة أولوية مصدر الشحن.</p>'}
    <p class="hint">إعداد مستقل لا يغيّره التطبيق هنا. عند جعل الشبكة أولاً قد تُشحن البطارية منها إن كان هذا الإعداد يسمح بذلك.</p>
    <button class="link" data-goto="more:edit">تغييره من «إعدادات الإنفرتر»</button></section>
  ${logHtml}`;
}

AFTER.power = () => {
  bindGoto();
  const c = state.ctl || (state.ctl = {});
  if (c.field) bindCtl(c);
  bindGoto();
  if (c.edit?.mode === 'smart' && !state.rep.fc && !state.demo) loadTwoWeeks();
  // حالة الجدولة والإدارة الذكية وسجلهما من أندرويد
  if (c.field && !c.nativeAt) { c.nativeAt = Date.now(); control.status().then((ns) => { if (state.ctl !== c) return; c.native = ns; if (leaf() === 'power') render(); }).catch(() => {}); }
  if (!state.demo && !state.model?.stale && !c.field && !c.error && !c.loading) loadPower();
  const retry = $('#ctlRetry') || $('#ctlRead');
  if (retry) retry.onclick = () => { c.result = null; loadPower(true); };
  document.querySelectorAll('[data-ctl]').forEach((btn) => {
    btn.onclick = async () => {
      if (c.busy) return;
      const it = c.field.item.find((x) => String(x.key) === btn.dataset.ctl);
      const o = orderOf(it.val);
      const chg = c.chgCur ? `<br>أولوية الشحن الحالية: <b>${esc(optionAr(c.chgCur.val))}</b> ولن تتغيّر.` : '';
      if (!(await confirmDialog('تأكيد التحويل', `سيتحوّل الإنفرتر من <b>${esc(optionAr(c.cur.val))}</b> إلى <b>${esc(optionAr(it.val))}</b>${o ? ` (${o.order.join(' ثم ')})` : ''}.${chg}<br>هل أنت متأكد؟`))) return;
      c.busy = it; c.result = null;
      render();
      // تحويل يدوي أثناء الجدولة أو الإدارة الذكية: يوقفهما مؤقتاً حتى لا يعكسا اختيارك فوراً
      if ((ctlCfg()?.mode || 'manual') !== 'manual') control.manualOverride().catch(() => {});
      const field = c.field;
      const res = await changeAndVerify({ read: () => readFresh(field), send: (key) => api.setCtrl(device(), field.id, key), items: field.item, key: it.key, delayMs: isNative ? 4000 : store.get('devCtlDelayMs', 4000) });
      if (state.ctl !== c) return; // بُدّل الجهاز أثناء التحقق
      c.busy = null; c.result = res;
      if (res.after) { c.cur = res.after; c.curAt = Date.now(); }
      if (res.status !== 'same') {
        const entry = { at: Date.now(), from: res.before ? optionAr(res.before.val) : null, to: optionAr(it.val), status: res.status, error: res.error || null, by: 'manual' };
        store.set('ctl.' + sn(), addLog(store.get('ctl.' + sn(), []), entry));
        logEvent('set', res.status === 'confirmed' ? 'info' : 'warn', 'أولوية مصدر الخرج', `${entry.from || '؟'} ← ${entry.to}: ${{ simulated: 'تجربة — لم يُرسل أمر', confirmed: 'تأكّد من الجهاز', unconfirmed: 'لم يتأكد', rejected: 'مرفوض', error: 'لم يُرسل' }[res.status]}`);
      }
      if (leaf() === 'power') render();
    };
  });
};

// ================= أنماط التحكم: يدوي، جدولة مرنة، إدارة ذكية =================
// الإعدادات تُحفظ لكل جهاز، وتُسلَّم لأندرويد الذي ينفّذها والتطبيق مغلق ويتحقق من كل تحويل.
const CTL_MODES = [['manual', 'يدوي'], ['schedule', 'جدولة'], ['smart', 'إدارة ذكية']];
const keyOfCode = (items, code) => items.find((it) => orderOf(it.val)?.code === code)?.key;

function ctlDefaults(items) {
  const grid = keyOfCode(items, 'USB') ?? items[0]?.key;
  const solar = keyOfCode(items, 'SBU') ?? items.find((it) => it.key !== grid)?.key;
  return { mode: 'manual', dryRun: true, gridKey: grid, solarKey: solar, defaultKey: solar, low: 45, target: 65, gapMin: 30,
    slots: [{ startMin: 17 * 60, endMin: 22 * 60, key: grid, days: [0, 1, 2, 3, 4, 5, 6] }] };
}
const ctlCfg = () => store.get('ctlcfg.' + sn(), null);
const itemLabel = (items, key) => optionAr(items.find((it) => String(it.key) === String(key))?.val ?? key);
const clock12 = (min) => fmt.time(new Date(2000, 0, 1, Math.floor(min / 60), min % 60).getTime());

function slotText(s, items) {
  const when = s.date ? `يوم ${fmt.day(s.date, { weekday: 'long', day: 'numeric', month: 'long' })}` : s.days.length === 7 ? 'كل يوم' : s.days.map((d) => DAY_NAMES[d]).join('، ');
  return `${when}: من ${clock12(s.startMin)} إلى ${clock12(s.endMin)}${s.endMin <= s.startMin ? ' (اليوم التالي)' : ''} ← ${itemLabel(items, s.key)}`;
}

function nativeCtlConfig(cfg) {
  const c = state.ctl, d = device();
  const items = c.field.item;
  return {
    ...cfg, dryRun: cfg.dryRun !== false, fieldId: c.field.id, utcOffsetMin: SYRIA_OFFSET_MIN,
    items: Object.fromEntries(items.map((it) => [String(it.key), String(it.val)])),
    gridLabel: String(items.find((it) => String(it.key) === String(cfg.gridKey))?.val ?? ''),
    solarLabel: String(items.find((it) => String(it.key) === String(cfg.solarKey))?.val ?? ''),
    staleMin: state.prefs.staleMin, tzOffsetMs: tzOffset(), notify: state.prefs.notify,
    device: { pn: d.pn, sn: d.sn, devcode: String(d.devcode), devaddr: String(d.devaddr ?? 1) },
  };
}

// الترتيب المقترح للإدارة الذكية من منظومتك نفسها: سعة البطارية، حد الفصل، واستهلاك الليل الفعلي
function smartSuggestion() {
  const m = state.model;
  const volts = m?.ratedV || nominalV(m);
  const cap = capacityKwh(state.prefs.batteryAh, volts);
  const cut = state.prefs.cutoffSoc ?? 20;
  const hours = state.prefs.reserveHours ?? 6;
  let nightKw = null, from = 'تقدير عام';
  const f = state.rep.fc;
  if (f?.sums) {
    const r = analyzeTwoWeeks(f.sums, today(), {});
    if (r.night?.kw) { nightKw = r.night.kw; from = 'من استهلاكك الفعلي ليلاً في الأسبوع الأخير'; }
  }
  if (!nightKw) nightKw = 0.5;
  if (!cap) return { ok: false, cut, hours };
  // حد التحويل = حد الفصل + ما يكفي ساعات الانقطاع بمعدل الليل، مقرّباً لـ5، بين (الفصل+15) و70
  const reserve = Math.min(70, Math.max(cut + 15, Math.round((cut + ((nightKw * hours) / cap) * 100) / 5) * 5));
  // العودة بعد 20% فوق الحد: شحن جزئي من الشبكة يكفي ويترك مكاناً لشمس الغد، ويلائم بطاريات الليثيوم
  const target = Math.min(90, reserve + 20);
  return { ok: true, cap, cut, hours, nightKw, from, low: reserve, target, gapMin: 30 };
}

function ctlSection(c) {
  const items = c.field.item;
  const stored = ctlCfg() || ctlDefaults(items);
  // أندرويد هو المرجع لما يُنفَّذ فعلاً: إعداد محفوظ هنا لا يُعرض «فعّالاً» إن لم يكن هو ما يعمل
  const act = c.native?.active;
  const offHere = act && stored.mode !== 'manual' && (act.mode === 'manual' || String(act.sn) !== String(sn()));
  const saved = offHere ? { ...stored, mode: 'manual' } : stored;
  const otherActive = act && act.mode !== 'manual' && act.sn && String(act.sn) !== String(sn()) ? act : null;
  const e = c.edit || (c.edit = JSON.parse(JSON.stringify(saved)));
  const opt = (sel) => items.map((it) => `<option value="${esc(it.key)}" ${String(it.key) === String(sel) ? 'selected' : ''}>${esc(optionAr(it.val))}</option>`).join('');
  const ns = c.native || {};
  const now = Date.now();
  // الحالة الحالية للنمط المحفوظ
  let status = '';
  if (saved.mode === 'schedule') {
    const n = nextSwitch(now, saved.slots, saved.defaultKey);
    const act = activeSlot(now, saved.slots);
    status = `<p class="ctl-now"><b>الجدولة فعّالة</b> · المطلوب الآن: ${esc(itemLabel(items, act?.key ?? saved.defaultKey))}${n ? ` · التحويل التالي ${esc(fmt.day(dateOf(sLocalDay(n.at)), { weekday: 'long' }))} ${esc(fmt.time(n.at))} ← ${esc(itemLabel(items, n.key))}` : ''} · بتوقيت سوريا</p>`;
  } else if (saved.mode === 'smart') {
    status = `<p class="ctl-now"><b>${saved.dryRun !== false ? 'الإدارة الذكية: تجربة دون أوامر' : 'الإدارة الذكية فعّالة'}</b> · إلى ${esc(itemLabel(items, saved.gridKey))} عند ${saved.low}% أو أقل، والعودة إلى ${esc(itemLabel(items, saved.solarKey))} عند ${saved.target}%${ns.state?.lastNote ? ` · آخر فحص: ${esc(ns.state.lastNote)}` : ''}</p>`;
  }
  const perms = saved.mode !== 'manual' && isNative ? `
    ${ns.exact === false ? `<p class="note warn">${icons.warn}<span>إذن «التنبيهات والتذكيرات» غير مفعّل، فقد يتأخر التحويل دقائق عن موعده.</span></p><button class="btn ghost wide" id="ctlExact">تفعيل التوقيت الدقيق</button>` : ''}
    ${ns.battery === false ? `<p class="note warn">${icons.warn}<span>قد يؤخّر توفير البطارية في هاتفك التحويل. اجعل «طاقتي» دون قيود.</span></p><button class="btn ghost wide" id="ctlBattery">إعدادات البطارية للتطبيقات</button>` : ''}` : '';
  const editSchedule = e.mode === 'schedule' ? `
    <h3 class="sec-h">قواعد الجدولة</h3>
    <div class="slots">${e.slots.map((s, i) => `
      <div class="slot card" data-slot="${i}">
        <div class="slot-row"><label>الوضع<select data-s="key">${opt(s.key)}</select></label>
          <button class="icon-btn slot-del" data-del="${i}" aria-label="حذف القاعدة">×</button></div>
        <div class="slot-row"><label>من<input type="time" data-s="start" value="${hm(s.startMin)}"></label><label>إلى<input type="time" data-s="end" value="${hm(s.endMin)}"></label></div>
        <div class="seg slot-kind"><button class="${s.date ? '' : 'on'}" data-kind="week">أيام الأسبوع</button><button class="${s.date ? 'on' : ''}" data-kind="date">تاريخ محدد</button></div>
        ${s.date ? `<label class="slot-date">التاريخ<input type="date" data-s="date" value="${esc(s.date)}" min="${dateOf(sLocalDay(now))}"></label>`
    : `<div class="days">${[6, 0, 1, 2, 3, 4, 5].map((d) => `<button class="${s.days.includes(d) ? 'on' : ''}" data-day="${d}" aria-label="${DAY_NAMES[d]}">${DAY_SHORT[d]}</button>`).join('')}</div>`}
        <small class="hint">${esc(slotText(s, items))}</small>
      </div>`).join('')}</div>
    <button class="btn ghost wide" id="slotAdd">+ إضافة قاعدة</button>
    <label class="num-row"><span>خارج القواعد يكون الجهاز على</span><select id="ctlDefault">${opt(e.defaultKey)}</select></label>
    <p class="hint">الأوقات بتوقيت سوريا. القاعدة التي نهايتها قبل بدايتها تعبر منتصف الليل. إن فات موعد (هاتف مطفأ أو بلا إنترنت) يُنفَّذ عند أول فرصة ما دامت فترته لم تنتهِ.</p>` : '';
  const editSmart = e.mode === 'smart' ? `
    <h3 class="sec-h">قواعد الإدارة الذكية</h3>
    <section class="card"><div class="form">
      <label class="num-row"><span>وضع الشبكة</span><select id="ctlGrid">${opt(e.gridKey)}</select></label>
      <label class="num-row"><span>وضع الألواح والبطارية</span><select id="ctlSolar">${opt(e.solarKey)}</select></label>
      ${['low', 'target', 'gapMin'].map((k) => `<label class="num-row"><span>${{ low: 'التحويل للشبكة عند نسبة البطارية', target: 'العودة عند بلوغ النسبة', gapMin: 'أقل مدة بين تحويلين' }[k]}</span><span class="num-in"><input type="text" inputmode="numeric" data-sm="${k}" value="${e[k]}"><small>${k === 'gapMin' ? 'دقيقة' : '%'}</small></span></label>`).join('')}
    </div>
    <p class="hint">يتحول إلى الشبكة إذا بلغت البطارية الحد والألواح لا تغطي الحمل والشبكة موجودة، ويعود عند بلوغ النسبة المستهدفة أو إذا غطّت الألواح الحمل في قراءتين متتاليتين. لا يتخذ قراراً على قراءة أقدم من ${state.prefs.staleMin} دقيقة، ولا يرسل شيئاً أثناء انقطاع الشبكة. يُفحص كل 15 دقيقة تقريباً.</p>
    </section>
    ${(() => {
      const g = smartSuggestion();
      if (!g.ok) return `<section class="card"><p class="hint">أدخل سعة البطارية في الإعدادات ليُحسب الترتيب المقترح لمنظومتك.</p><button class="link" data-goto="more:settings">فتح الإعدادات</button></section>`;
      const same = e.low === g.low && e.target === g.target && e.gapMin === g.gapMin;
      return `<section class="card sugg"><div class="card-h"><h2>الترتيب المقترح لمنظومتك</h2></div>
        ${kv([
          ['التحويل للشبكة عند', `<bdi>${g.low}%</bdi>`],
          ['العودة للألواح والبطارية عند', `<bdi>${g.target}%</bdi>`],
          ['بين تحويلين', `<bdi>${g.gapMin}</bdi> <small>دقيقة</small>`],
        ])}
        <ul class="wn">
          <li>بطاريتك <b><bdi>${fmt.kwh(g.cap)}</bdi> ك.و.س</b>، وحد الفصل في الإعدادات ${g.cut}%.</li>
          <li>استهلاك الليل نحو <b>${fmt.w(g.nightKw * 1000)}</b> (${esc(g.from)})، فـ${countAr(g.hours, ['ساعة', 'ساعتين', 'ساعات', 'ساعة'])} انقطاع تحتاج نحو <bdi>${Math.round((g.nightKw * g.hours / g.cap) * 100)}%</bdi> من البطارية. لذلك يبقى ${g.low}% احتياطياً للانقطاع، ولا ينزل التطبيق تحته ما دامت الشبكة موجودة.</li>
          <li>العودة عند ${g.target}% لا 100%: شحن جزئي من الشبكة يكفي المساء، ويترك مكاناً لشمس الغد، ويناسب بطاريات الليثيوم.</li>
          <li>الفرق 20% بين الحدين و30 دقيقة بين تحويلين يمنعان التبديل المتكرر.</li>
        </ul>
        <p class="hint">تقدير يُعاد حسابه كل يوم من قراءاتك. يمكنك تعديل ساعات الانقطاع من «تقدير الأسبوعين القادمين».</p>
        ${same ? '<span class="tag ok">مطبّق في الخانات أعلاه</span>' : '<button class="btn ghost wide" id="ctlSuggest">اعتمد هذا الترتيب</button>'}</section>`;
    })()}` : '';
  const logs = (ns.log || []).slice(0, 15);
  // سجل فحوص الإدارة الذكية: كل فحص بسببه وقراءته، حتى بلا قرار
  const checks = saved.mode === 'smart' ? (ns.checks || []) : [];
  const n0 = (v, u) => (v == null ? '—' : `<bdi>${Math.round(v)}${u}</bdi>`);
  const checksHtml = checks.length ? `<details class="card fold ctl-checks"><summary><h2>سجل الفحوص (${checks.length})</h2>${icons.chevL}</summary>
    <ul class="ctl-log">${checks.slice(0, 60).map((x) => `<li class="${esc(x.status)}"><b>${esc(x.reason || '')}</b>
      <span>${x.status === 'simulated' ? 'تجربة — كان سيحوّل إلى ' + esc(x.to || '') : x.status === 'none' ? (x.trial ? 'تجربة — لا قرار' : 'لا قرار') : { confirmed: 'تأكّد من الجهاز', unconfirmed: 'لم يتأكد', rejected: 'مرفوض' }[x.status] || esc(x.status)}${x.count > 1 ? ` · تكرر ${x.count} مرات حتى ${esc(fmt.time(x.lastAt))}` : ''}</span>
      <small>${esc(fmt.dateTime(x.at))} · البطارية ${n0(x.soc, '%')} · الألواح ${n0(x.pvW, ' واط')} · الحمل ${n0(x.loadW, ' واط')}</small></li>`).join('')}</ul></details>` : '';
  return `
  <h3 class="sec-h">نمط التحكم</h3>
  <div class="seg ctl-mode">${CTL_MODES.map(([k, l]) => `<button class="${e.mode === k ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>
  ${otherActive ? `<p class="note warn ctl-other">${icons.warn}<span>التحكم التلقائي يعمل الآن على جهاز آخر (<bdi>${esc(otherActive.sn)}</bdi>). يعمل التحكم على جهاز واحد فقط، وتفعيله هنا يوقفه هناك.</span></p>` : ''}
  ${offHere && !otherActive ? `<p class="note warn ctl-off">${icons.warn}<span>إعداد ${esc(CTL_MODES.find((m) => m[0] === stored.mode)?.[1] || '')} محفوظ لهذا الجهاز لكنه غير مفعّل في الهاتف. احفظه من جديد لتفعيله.</span></p>` : ''}
  ${status}${perms}
  ${e.mode === 'smart' ? `<section class="card"><label><input id="ctlDryRun" type="checkbox" ${e.dryRun !== false ? 'checked' : ''}> وضع تجربة: تسجيل القرارات وأسبابها دون إرسال أوامر</label><p class="hint">لا تُرسل أوامر في هذا الوضع حتى عند إغلاق التطبيق. يُحفظ كل فحص بوقته وسببه وقراءته (آخر 200 فحص، والفحوص المتطابقة المتتالية تُجمع في سطر مع عددها) في «سجل الفحوص» أدناه. إلغاء التجربة والحفظ يسمح بالتنفيذ الحقيقي، ويبدأ عدّ القراءات المتتالية من جديد.</p></section>` : ''}
  ${editSchedule}${editSmart}
  ${JSON.stringify({ ...e, tuned: undefined }) !== JSON.stringify(saved) ? `<button class="btn primary wide" id="ctlSave">${e.mode === 'manual' ? 'إيقاف التحكم التلقائي' : e.mode === 'smart' && e.dryRun !== false ? 'حفظ التجربة' : 'حفظ وتفعيل'}</button><button class="link pad" id="ctlCancel">تراجع عن التعديلات</button>` : ''}
  ${!isNative && saved.mode !== 'manual' ? '<p class="note warn">' + icons.warn + '<span>التنفيذ التلقائي يعمل في تطبيق أندرويد فقط.</span></p>' : ''}
  ${checksHtml}
  ${logs.length ? `<h3 class="sec-h">سجل قرارات الجدولة والإدارة الذكية</h3><ul class="ctl-log card">${logs.map((x) => `
    <li class="${esc(x.status)}"><b>${esc(x.from || '؟')} ← ${esc(x.to)}</b><span>${{ simulated: 'تجربة — لم يُرسل أمر', confirmed: 'تأكّد من الجهاز', unconfirmed: 'لم يتأكد', rejected: 'مرفوض', error: 'لم يُرسل' }[x.status] || esc(x.status)}${x.error ? ' · ' + esc(x.error) : ''}</span><small>${esc(fmt.dateTime(x.at))} · ${x.by === 'schedule' ? 'الجدولة' : 'الإدارة الذكية'} · ${esc(x.reason || '')}</small></li>`).join('')}</ul>` : ''}`;
}

function bindCtl(c) {
  const e = c.edit;
  if (!e) return;
  const items = c.field.item;
  // إعادة الرسم بعد انتهاء حدث الحقل (change يصل أحياناً أثناء blur فيُستبدل الحقل وهو يُزال)
  const redraw = () => setTimeout(() => { if (leaf() === 'power') render(); }, 0);
  document.querySelectorAll('[data-mode]').forEach((b) => {
    b.onclick = () => {
      e.mode = b.dataset.mode;
      if (e.mode === 'smart' && ctlCfg()?.mode !== 'smart' && !e.tuned) {
        const g = smartSuggestion();
        if (g.ok) Object.assign(e, { low: g.low, target: g.target, gapMin: g.gapMin });
      }
      redraw();
    };
  });
  const dr = $('#ctlDryRun');
  if (dr) dr.onchange = () => { e.dryRun = dr.checked; redraw(); };
  const sg = $('#ctlSuggest');
  if (sg) sg.onclick = () => { const g = smartSuggestion(); if (g.ok) Object.assign(e, { low: g.low, target: g.target, gapMin: g.gapMin }); redraw(); };
  document.querySelectorAll('[data-slot]').forEach((el) => {
    const s = e.slots[Number(el.dataset.slot)];
    el.querySelector('[data-s=key]').onchange = (ev) => { s.key = ev.target.value; redraw(); };
    el.querySelector('[data-s=start]').onchange = (ev) => { const v = toMin(ev.target.value); if (v != null) s.startMin = v; redraw(); };
    el.querySelector('[data-s=end]').onchange = (ev) => { const v = toMin(ev.target.value); if (v != null) s.endMin = v; redraw(); };
    const dt = el.querySelector('[data-s=date]');
    if (dt) dt.onchange = () => { if (dt.value) s.date = dt.value; redraw(); };
    el.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { if (b.dataset.kind === 'date') { s.date = s.date || dateOf(sLocalDay(Date.now())); } else { delete s.date; if (!s.days?.length) s.days = [0, 1, 2, 3, 4, 5, 6]; } redraw(); }; });
    el.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { const d = Number(b.dataset.day); s.days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort(); redraw(); }; });
  });
  document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { e.slots.splice(Number(b.dataset.del), 1); redraw(); }; });
  const add = $('#slotAdd');
  if (add) add.onclick = () => { e.slots.push({ startMin: 17 * 60, endMin: 19 * 60, key: e.gridKey ?? items[0].key, days: [0, 1, 2, 3, 4, 5, 6] }); redraw(); };
  const def = $('#ctlDefault');
  if (def) def.onchange = () => { e.defaultKey = def.value; redraw(); };
  const g = $('#ctlGrid'), so = $('#ctlSolar');
  if (g) g.onchange = () => { e.gridKey = g.value; redraw(); };
  if (so) so.onchange = () => { e.solarKey = so.value; redraw(); };
  document.querySelectorAll('[data-sm]').forEach((inp) => { inp.onchange = () => { const v = parseInt(latinDigits(inp.value), 10); if (Number.isFinite(v)) { e[inp.dataset.sm] = v; e.tuned = true; } redraw(); }; });
  const cancel = $('#ctlCancel');
  if (cancel) cancel.onclick = () => { c.edit = null; redraw(); };
  const ex = $('#ctlExact');
  if (ex) ex.onclick = () => control.openExactAlarmSettings();
  const bt = $('#ctlBattery');
  if (bt) bt.onclick = () => control.openBatterySettings();
  const save = $('#ctlSave');
  if (save) save.onclick = async () => {
    // نعرف أولاً ما يعمل في الهاتف الآن (قد يكون جهازاً آخر)
    if (!c.native?.active) { try { c.native = await control.status(); } catch { /* يُرفض الحفظ لاحقاً إن تعذّر */ } }
    let summary;
    if (e.mode === 'schedule') {
      if (!e.slots.length) return toast('أضف قاعدة واحدة على الأقل', 'bad');
      const bad = e.slots.findIndex((s) => s.startMin === s.endMin || (!s.date && !s.days.length));
      if (bad >= 0) return toast(`القاعدة ${bad + 1}: ${e.slots[bad].startMin === e.slots[bad].endMin ? 'البداية والنهاية متساويتان' : 'اختر يوماً واحداً على الأقل'}`, 'bad');
      const ov = overlap(e.slots);
      if (ov) return toast(`القاعدتان ${ov.a + 1} و${ov.b + 1} تتداخلان (${DAY_NAMES[weekday(ov.day)]} ${clock12(ov.m)})`, 'bad');
      summary = `<ul class="wn">${e.slots.map((s) => `<li>${esc(slotText(s, items))}</li>`).join('')}<li>خارج ذلك: ${esc(itemLabel(items, e.defaultKey))}</li></ul>بتوقيت سوريا. سيحوّل التطبيق الإنفرتر تلقائياً في هذه الأوقات ويتحقق من كل تحويل.`;
    } else if (e.mode === 'smart') {
      if (String(e.gridKey) === String(e.solarKey)) return toast('اختر وضعين مختلفين', 'bad');
      const cut = state.prefs.cutoffSoc ?? 20;
      if (e.low < cut + 5 || e.low > 90) return toast(`حد التحويل بين ${cut + 5}% و90%`, 'bad');
      if (e.target < e.low + 10 || e.target > 100) return toast('النسبة المستهدفة يجب أن تزيد 10% على الأقل عن حد التحويل', 'bad');
      if (e.gapMin < 15 || e.gapMin > 360) return toast('مدة الانتظار بين 15 و360 دقيقة', 'bad');
      summary = `${e.dryRun !== false ? 'تجربة دون أوامر: القرار المقترح' : 'يتحول تلقائياً'} إلى <b>${esc(itemLabel(items, e.gridKey))}</b> عند ${e.low}% أو أقل (والشبكة موجودة والألواح لا تغطي الحمل)، ويعود إلى <b>${esc(itemLabel(items, e.solarKey))}</b> عند ${e.target}%، وبين تحويلين ${e.gapMin} دقيقة على الأقل.`;
    } else summary = 'يتوقف التحويل التلقائي، وتبقى على الوضع الحالي حتى تغيّره بنفسك.';
    const act = c.native?.active;
    const other = e.mode !== 'manual' && act && act.mode !== 'manual' && act.sn && String(act.sn) !== String(sn()) ? act.sn : null;
    if (other) summary += `<br><b>سيتوقف التحكم التلقائي على الجهاز الآخر (<bdi>${esc(other)}</bdi>)</b>، لأن التحكم يعمل على جهاز واحد فقط.`;
    if (!(await confirmDialog(e.mode === 'manual' ? 'إيقاف التحكم التلقائي' : 'تفعيل ' + CTL_MODES.find((m) => m[0] === e.mode)[1], summary + (e.mode === 'manual' ? '' : '<br>التحويل اليدوي يوقف الجدولة حتى موعدها التالي، والإدارة الذكية ساعتين.')))) return;
    if (state.ctl !== c) return; // بُدّل الجهاز أثناء نافذة التأكيد
    const cfg = JSON.parse(JSON.stringify(e));
    delete cfg.tuned;
    const mySn = sn();
    // إيقاف جهاز لا يعمل عليه التحكم أصلاً لا يجوز أن يوقف جهازاً آخر
    const nativeCfg = cfg.mode === 'manual' && act && String(act.sn) !== String(mySn) && act.mode !== 'manual' ? null : nativeCtlConfig(cfg);
    save.disabled = true;
    let ns;
    try {
      ns = nativeCfg ? await control.configure(nativeCfg) : c.native;
    } catch (err) {
      // لا رسالة نجاح ولا حفظ: ما يُعرض يبقى مطابقاً لما ينفّذه الهاتف
      if (state.ctl === c) { save.disabled = false; }
      toast(`لم يُحفظ: ${err.message || 'رفض الهاتف الإعداد'}`, 'bad');
      return;
    }
    // التأكد من أن ما يعمل في الهاتف هو ما طلبناه
    const a = ns?.active;
    if (nativeCfg && a && (a.mode !== cfg.mode || (cfg.mode !== 'manual' && String(a.sn) !== String(mySn)))) {
      if (state.ctl === c) save.disabled = false;
      toast('لم يؤكد الهاتف الإعداد الجديد، فلم يُعتمد', 'bad');
      return;
    }
    store.set('ctlcfg.' + mySn, cfg);
    // الجهاز الآخر لم يعد فعّالاً: يُحفظ عنده يدوي حتى لا يظهر «فعّالاً» وهو ليس كذلك
    if (other) { const o = store.get('ctlcfg.' + other, null); if (o) store.set('ctlcfg.' + other, { ...o, mode: 'manual' }); }
    if (state.ctl !== c) return;
    c.native = ns;
    c.edit = null;
    logEvent('set', 'info', 'نمط التحكم', CTL_MODES.find((m) => m[0] === cfg.mode)[1]);
    toast(cfg.mode === 'manual' ? 'أُوقف التحكم التلقائي' : 'تم التفعيل وأكّده الهاتف', 'ok');
    redraw();
  };
}

// ================= تحليل آخر أسبوعين وتقدير الأسبوعين القادمين =================
async function loadTwoWeeks() {
  const token = Symbol('fc');
  state.rep.fc = { loading: true, token, pct: 0 };
  render();
  const dates = Array.from({ length: 15 }, (_, i) => today(i - 14));
  serverHistFails = 0;
  const sums = await loadSummaries(dates, (done, total) => {
    if (state.rep.fc?.token !== token) return;
    state.rep.fc.pct = (done / total) * 100;
    const p = $('#fcProg');
    if (p) p.style.width = state.rep.fc.pct + '%';
  });
  if (state.rep.fc?.token !== token) return;
  // الإشعاع الشمسي المتوقع: اختياري، وبدونه يبقى التقدير من متوسط الأسبوع الأخير
  let rad = null, radError = null;
  const loc = state.demo ? null : weatherLoc();
  if (loc) {
    const key = `${(+loc.lat).toFixed(2)},${(+loc.lon).toFixed(2)}`;
    const cached = store.get('rad', null);
    if (cached && cached.key === key && Date.now() - cached.r.at < 6 * 36e5) rad = cached.r;
    else {
      try { rad = await fetchRadiation(loc.lat, loc.lon); store.set('rad', { key, r: rad }); } catch (e) { radError = e.message; rad = cached?.key === key ? cached.r : null; }
    }
  }
  if (state.rep.fc?.token !== token) return;
  state.rep.fc = { sums, rad, radError, hasLoc: !!loc, at: Date.now() };
  if ((state.tab === 'reports' && leaf() === 'forecast') || leaf() === 'power') render();
}

const kwhU = (v) => (v == null ? '—' : `<bdi>${fmt.kwh(v)}</bdi> <small>ك.و.س</small>`);
const deltaTag = (d, goodUp) => (d == null ? '' : `<span class="dl ${Math.abs(d) < 3 ? '' : (d > 0) === goodUp ? 'up' : 'down'}"><bdi>${d > 0 ? '+' : ''}${Math.round(d)}%</bdi></span>`);

function pageForecast() {
  const f = state.rep.fc;
  const note = '<div class="banner info">' + icons.info + '<span><b>تقدير وليس توقعاً مؤكداً</b>مبني على قراءاتك الفعلية في آخر أسبوعين وتوقع الطقس إن توفر، ويُعاد حسابه كل يوم. لا يغيّر التطبيق أي إعداد بناءً عليه.</span></div>';
  if (!f || f.loading) return `${note}<div class="card"><p class="center">جارٍ تحليل آخر أسبوعين…</p><div class="bar"><i id="fcProg" style="width:${f?.pct || 0}%"></i></div><p class="hint center">الأيام المكتملة تُحفظ، فيصبح التحليل أسرع في المرات القادمة.</p></div>`;
  const m = state.model;
  const volts = m?.ratedV || nominalV(m);
  const cap = capacityKwh(state.prefs.batteryAh, volts);
  const radPast = f.rad ? Object.fromEntries(f.rad.days.filter((d) => d.date < today()).map((d) => [d.date, d.rad])) : null;
  const radFuture = f.rad ? f.rad.days.filter((d) => d.date >= today()) : null;
  const r = analyzeTwoWeeks(f.sums, today(), { radPast, radFuture, capKwh: cap, cutoffSoc: state.prefs.cutoffSoc ?? 20, reserveHours: state.prefs.reserveHours ?? 6 });
  // نحفظ تقدير اليوم لنقارنه غداً بما حدث فعلاً
  if (r.ok && !state.demo) store.set('fc.' + sn(), rememberForecast(store.get('fc.' + sn(), {}), r, today()));
  const acc = state.demo ? null : accuracy(store.get('fc.' + sn(), {}), f.sums, today());
  const row = (label, k, goodUp) => `<tr><th>${label}</th><td>${kwhU(r.prev[k])}</td><td>${kwhU(r.last[k])}</td><td>${r.comparable ? deltaTag(r.delta[k], goodUp) : ''}</td></tr>`;
  const cmp = `<section class="card"><div class="card-h"><h2>الأسبوع الأخير مقابل الذي قبله</h2></div>
    <table class="cmp"><thead><tr><th>المتوسط اليومي</th><th>قبل أسبوعين</th><th>الأسبوع الأخير</th><th>التغيّر</th></tr></thead><tbody>
      ${row('إنتاج الألواح', 'pvKwh', true)}${row('استهلاك البيت', 'loadKwh', false)}${row('شحن من الألواح', 'solarChgKwh', true)}${row('شحن من الشبكة', 'gridChgKwh', false)}${row('استيراد الشبكة (تقدير)', 'gridKwh', false)}
    </tbody></table>
    <p class="hint">من ${countAr(r.prev.n, DAY)} مكتملة ثم ${countAr(r.last.n, DAY)} مكتملة.${r.missing ? ` ${countAr(r.missing, DAY)} ناقصة البيانات لم تُحسب.` : ''}${r.comparable ? '' : ' لا تكفي الأيام المكتملة لمقارنة موثوقة (يلزم 4 في كل أسبوع).'}</p></section>`;
  if (!r.ok) return `${note}${cmp}<div class="empty">يلزم 3 أيام مكتملة على الأقل في الأسبوع الأخير لبناء تقدير. افتح التطبيق بعد يومين أو ثلاثة.</div>`;
  const how = r.method === 'weather'
    ? `الإنتاج: إنتاجك الفعلي لكل وحدة إشعاع شمسي في الأسبوعين × الإشعاع المتوقع من خدمة الطقس. الأيام بعد مدى التوقع من المتوسط وحده.`
    : `الإنتاج: متوسط الأسبوع الأخير (${f.hasLoc ? esc(f.radError || 'توقع الطقس غير متوفر الآن') : 'حدّد موقع منظومتك في الإعدادات ليدخل توقع الطقس في التقدير'}).`;
  const wk = (w, title) => `<div class="fc-week"><h3>${title}</h3>
    ${kv([['إنتاج الألواح يومياً', kwhU(w.pv)], ['استهلاك البيت يومياً', kwhU(w.load)], ['العجز اليومي المتوقع', w.deficit > 0.05 ? `${kwhU(w.deficit)} <small>(حتى ${fmt.kwh(w.deficitHi)})</small>` : '<span class="tag ok">لا عجز متوقع</span>'], ['أيام بتوقع طقس', `${w.weatherDays} من 7`]])}</div>`;
  const s = r.suggest;
  const sug = s ? `<section class="card"><div class="card-h"><h2>اقتراحات (للعرض فقط)</h2></div>
    ${kv([
      ['ساعات تغذية البيت من الشبكة يومياً', s.gridHours < 0.25 ? 'لا حاجة تقريباً' : `<bdi>${s.gridHours.toFixed(1)}</bdi> <small>ساعة (حتى ${s.gridHoursHi.toFixed(1)})</small>`],
      ['احتياطي البطارية المقترح', `<bdi>${s.reserveSoc}%</bdi> <small>يكفي ${countAr(s.reserveHours, ['ساعة', 'ساعتين', 'ساعات', 'ساعة'])} انقطاع بمعدل الليل</small>`],
      ['ما تعطيه البطارية فوق الاحتياطي', kwhU(s.usableKwh)],
      ['استهلاك الليل', `${kwhU(r.night.kwh)} <small>بمعدل ${fmt.w(r.night.kw * 1000)}</small>`],
    ])}
    <p class="hint">${s.gridHours >= 0.25 ? `نافذة من الساعة 5:00 م إلى 10:00 م تعطي 5 ساعات؛ ${s.gridHours <= 5 ? 'تكفي لتغطية العجز المتوقع' : s.gridHoursHi <= 5 ? 'تكفي' : `والعجز المتوقع يحتاج نحو ${s.gridHours.toFixed(1)}`}. ` : ''}لا يُطبَّق أي اقتراح تلقائياً. غيّر الوضع بنفسك من «أولوية مصدر الطاقة».</p>
    <div class="form">${numField('reserveHours', 'ساعات الانقطاع التي تريد الاحتياط لها', 'ساعة', 1, 24)}</div>
    <button class="btn ghost wide" data-goto="more:power">أولوية مصدر الطاقة</button></section>`
    : `<section class="card"><p class="hint">${cap ? 'لا تكفي بيانات الليل لاقتراح احتياطي.' : 'أدخل سعة البطارية (مثلاً 200 أمبير ساعة) في الإعدادات ليُحسب الاحتياطي وساعات الشبكة المقترحة.'}</p>${cap ? '' : '<button class="link" data-goto="more:settings">فتح الإعدادات</button>'}</section>`;
  const maxV = Math.max(...r.days.map((d) => Math.max(d.pv, d.load)), 1);
  const bars = `<section class="card"><div class="card-h"><h2>يوماً بيوم</h2></div><div class="fc-rows">${r.days.map((d) => `
    <div class="fc-r ${d.fromWeather ? '' : 'avg'}"><span class="fc-dt">${esc(fmt.day(d.date, { weekday: 'short' }))} <bdi>${esc(fmt.day(d.date, { day: 'numeric', month: 'numeric' }))}</bdi></span>
      <span class="fc-b"><i class="fpv" style="width:${(d.pv / maxV) * 100}%"></i><i class="fld" style="width:${(d.load / maxV) * 100}%"></i></span>
      <span class="fc-v">${d.deficit > 0.05 ? `<b>−<bdi>${fmt.kwh(d.deficit)}</bdi></b>` : '<small>لا عجز</small>'}</span></div>`).join('')}</div>
    <p class="hint"><span class="lg fpv"></span> إنتاج متوقع <span class="lg fld"></span> استهلاك متوقع · الرقم: العجز بالكيلوواط ساعة · الصفوف الباهتة من المتوسط لا من توقع الطقس.</p></section>`;
  const accHtml = acc ? `<section class="card"><div class="card-h"><h2>دقة تقدير أمس</h2></div>${kv([['الإنتاج: المقدّر ← الفعلي', `${kwhU(acc.pvF)} ← ${kwhU(acc.pvA)}`], ['الاستهلاك: المقدّر ← الفعلي', `${kwhU(acc.loadF)} ← ${kwhU(acc.loadA)}`]])}</section>` : '';
  return `${note}${cmp}
    <section class="card"><div class="card-h"><h2>الأسبوعان القادمان</h2></div><div class="fc-weeks">${wk(r.weeks[0], 'هذا الأسبوع')}${wk(r.weeks[1], 'الأسبوع التالي')}</div>
      <p class="hint">${how} الاستهلاك: متوسط الأسبوع الأخير${Math.abs(r.loadTrend - 1) >= 0.02 ? ` مع اتجاه ${r.loadTrend > 1 ? 'الزيادة' : 'النقص'} بين الأسبوعين (${Math.round((r.loadTrend - 1) * 100)}%)، بنصفه في الأسبوع الأول وكاملاً في الثاني` : ''}.</p></section>
    ${bars}${sug}${accHtml}`;
}
AFTER.forecast = () => {
  bindGoto();
  const f = state.rep.fc;
  if (!f || (!f.loading && Date.now() - f.at > 30 * 60000)) loadTwoWeeks();
  bindPrefs($('#view'));
  const inp = $('[data-pref=reserveHours]');
  if (inp) inp.addEventListener('change', () => setTimeout(() => { if (leaf() === 'forecast') render(); }, 50));
};

// ================= عدّاد كهرباء الشبكة (تقدير) =================
// الجهاز لا يرسل قدرة السحب من الشبكة ولا عدّاداً لها، فنحسبها من وضع الشبكة: حمل البيت + الشحن الزائد عن الألواح.
function allCachedSums() {
  const s = sn();
  return store.keys(`sum.${s}.`).map((k) => store.get(k, null)).filter((x) => x && x.v === SUMMARY_V);
}

async function loadGridMeter(days = 30) {
  const token = Symbol('gm');
  const prev = state.rep.gm;
  state.rep.gm = { loading: true, token, pct: 0, back: days };
  render();
  const dates = Array.from({ length: days + 1 }, (_, i) => today(i - days));
  serverHistFails = 0;
  const sums = await loadSummaries(dates, (done, total) => {
    if (state.rep.gm?.token !== token) return;
    state.rep.gm.pct = (done / total) * 100;
    const p = $('#gmProg');
    if (p) p.style.width = state.rep.gm.pct + '%';
  });
  if (state.rep.gm?.token !== token) return;
  // السجل الدائم = كل الأيام المحفوظة سابقاً + ما حُمّل الآن (اليوم الجاري لا يُحفظ)
  const by = new Map(allCachedSums().map((x) => [x.date, x]));
  sums.forEach((x) => { if (x && x.count > 1) by.set(x.date, x); });
  // هل توقف الخادم عن إعادة بيانات في أقدم أسبوع مطلوب؟ عندها لا فائدة من طلب أقدم
  const oldest = sums.slice(0, 7);
  state.rep.gm = { sums: [...by.values()], back: days, end: oldest.every((x) => !x || x.count <= 1), from: prev?.from || null, at: Date.now() };
  if (state.tab === 'reports' && leaf() === 'gridmeter') render();
}

function pageGridMeter() {
  const g = state.rep.gm;
  const note = '<div class="banner info">' + icons.info + '<span><b>تقدير محسوب، لا عدّاد من الجهاز</b>إنفرترك لا يرسل قدرة السحب من الشبكة. نحسبها حين يكون في وضع الشبكة: حمل البيت + ما شحن البطارية زيادةً عن الألواح، دون فواقد الإنفرتر. إن لم يرسل الجهاز وضع التشغيل يُستنتج من جهد الشبكة وتيار البطارية والألواح.</span></div>';
  if (!g || g.loading) return `${note}<div class="card"><p class="center">جارٍ جمع سجل الأيام…</p><div class="bar"><i id="gmProg" style="width:${g?.pct || 0}%"></i></div></div>`;
  const r = gridMeter(g.sums, today(), g.from);
  if (!r.start) return `${note}<div class="empty">لا توجد أيام يُعرف فيها وضع التشغيل بما يكفي لحساب استيراد الشبكة.</div>`;
  const all = gridMeter(g.sums, today());
  const cell = (t, title) => { const c = costOf(t.load + t.chg, state.prefs); return stat(title, fmt.kwh(t.load + t.chg), 'ك.و.س', 'c-violet', t.days ? `${countAr(t.days, DAY)}${t.partial ? ` · ${t.partial} ناقصة` : ''}${c ? ` · ${costText(c)}` : ''}` : 'لا بيانات'); };
  return `${note}
  <div class="stats">${cell(r.today, 'اليوم')}${cell(r.week, 'آخر 7 أيام')}${cell(r.month, 'آخر 30 يوماً')}${cell(r.all, g.from ? 'منذ التاريخ المختار' : 'منذ بدء السجل')}</div>
  <section class="card"><div class="card-h"><h2>التفصيل منذ ${esc(fmt.day(r.start, { day: 'numeric', month: 'long', year: 'numeric' }))}</h2></div>
    ${kv([
      ['تغذية البيت من الشبكة', kwhU(r.all.load)],
      ['شحن البطارية من الشبكة', kwhU(r.all.chg)],
      ['المجموع', kwhU(r.all.load + r.all.chg)],
      state.prefs.price ? ['الكلفة بسعرك', `<bdi>${esc(costText(costOf(r.all.load + r.all.chg, state.prefs)))}</bdi>`] : null,
      r.all.inferred ? ['أيام استُنتج فيها وضع الشبكة', `<bdi>${r.all.inferred}</bdi> <small>الجهاز لم يرسل وضع التشغيل</small>`] : null,
      ['ساعات القراءات المحسوبة', `<bdi>${Math.round(r.all.coveredH)}</bdi> <small>من ${r.all.days * 24} ساعة</small>`],
      r.all.partial ? ['أيام ناقصة التغطية', `<bdi>${r.all.partial}</bdi> <small>مجموعها أقل من الحقيقي</small>`] : null,
    ])}
    <p class="hint">بداية السجل المتاح: <b>${esc(fmt.day(all.start, { day: 'numeric', month: 'long', year: 'numeric' }))}</b>. فترات انقطاع القراءات لا تُحسب صفراً ولا تُقدَّر، بل تُستثنى.</p>
    <label class="num-row"><span>اعرض واجمع ابتداءً من</span><input type="date" id="gmFrom" min="${all.start}" max="${today()}" value="${g.from || all.start}"></label>
    ${g.from ? '<button class="link" id="gmAll">العودة لكل السجل</button>' : ''}
    ${state.prefs.price ? '' : '<button class="link" data-goto="more:calc">أدخل سعر الكيلوواط لتظهر الكلفة</button>'}
    ${g.end ? '<p class="hint">الخادم لا يحتفظ ببيانات أقدم من ذلك.</p>' : `<button class="btn ghost wide" id="gmMore">تحميل 30 يوماً أقدم</button>`}
  </section>
  <section class="card"><div class="card-h"><h2>يوماً بيوم</h2></div>
    <table class="cmp gm"><thead><tr><th>اليوم</th><th>البيت</th><th>الشحن</th><th>المجموع</th></tr></thead><tbody>
    ${r.perDay.slice().reverse().slice(0, 62).map((d) => `<tr class="${d.basis === 'partial' && d.date < today() ? 'part' : ''}"><th>${esc(fmt.day(d.date, { weekday: 'short', day: 'numeric', month: 'numeric' }))}</th><td><bdi>${fmt.kwh(d.load)}</bdi></td><td><bdi>${fmt.kwh(d.chg)}</bdi></td><td><b><bdi>${fmt.kwh(d.load + d.chg)}</bdi></b></td></tr>`).join('')}
    </tbody></table><p class="hint">بالكيلوواط ساعة. الصفوف الباهتة أيام ناقصة التغطية.</p></section>`;
}
AFTER.gridmeter = () => {
  const g = state.rep.gm;
  if (!g || (!g.loading && Date.now() - g.at > 30 * 60000)) loadGridMeter(g?.back || 30);
  const f = $('#gmFrom');
  if (f) f.onchange = () => { if (f.value) { state.rep.gm.from = f.value; render(); } };
  const a = $('#gmAll');
  if (a) a.onclick = () => { state.rep.gm.from = null; render(); };
  const more = $('#gmMore');
  if (more) more.onclick = () => loadGridMeter((state.rep.gm.back || 30) + 30);
  bindGoto();
};

// ================= تبويب النصائح =================
const LEVEL = { bad: ['bad', icons.warn], warn: ['warn', icons.warn], info: ['info', icons.info], ok: ['ok', icons.check] };

function smartList(list) {
  return `<ul class="alerts">${list.map((t) => `
    <li class="alert ${LEVEL[t.level][0]}"><div class="a-ic">${LEVEL[t.level][1]}</div>
      <div><b>${esc(t.title)}</b><p>${esc(t.body)}</p></div></li>`).join('')}</ul>`;
}

function viewTips() {
  const sec = TIP_SECTIONS.find((x) => 'tips/' + x.id === state.page);
  if (sec) {
    return `<section class="hero ${sec.color}"><span class="g-deco">${icons[sec.icon]}</span><div class="h-ic">${icons[sec.icon]}</div>
        <b class="hero-t">${esc(sec.title)}</b><span>${esc(sec.sub)} · ${countAr(sec.tips.length, ['نصيحة واحدة', 'نصيحتان', 'نصائح', 'نصيحة'])}</span></section>
      <div class="tips">${sec.tips.map(([title, body], i) => `
        <article class="tip ${sec.color}"><span class="tip-n">${i + 1}</span>
          <div><h3>${esc(title)}</h3><p>${esc(body).replace(/\n/g, '<br>')}</p></div></article>`).join('')}</div>`;
  }
  const tod = tipOfDay();
  return `
  <section class="intro"><h2>نصائح وإرشادات</h2><p>لتستفيد من منظومتك بأمان وتطيل عمر الإنفرتر والبطارية.</p></section>
  <section class="tod"><div class="tod-h">${icons.star}<span>نصيحة اليوم · ${esc(tod.section)}</span></div>
    <b>${esc(tod.title)}</b><p>${esc(tod.body).replace(/\n/g, '<br>')}</p></section>
  ${listCards([{ page: 'reports:advisor', title: 'ملاحظات على جهازك الآن', sub: 'نصائح من قراءات جهازك وإعداداته في «التقارير»', icon: icons.bulb, color: 'c-violet' }])}
  ${gridCards(TIP_SECTIONS.map((t) => ({ page: 'tips/' + t.id, title: t.title, sub: t.sub, icon: icons[t.icon], color: t.color, value: '', badge: countAr(t.tips.length, ['نصيحة واحدة', 'نصيحتان', 'نصائح', 'نصيحة']) })))}`;
}

// ================= ربط الجهاز والحساب =================
// التسجيل وإعداد وحدة الواي فاي يتمّان ببروتوكول خاص بالشركة المصنّعة غير منشور،
// فلا نقلّده بأزرار وهمية: نشرح الخطوات، ونفتح إعدادات الهاتف والتطبيق الرسمي مباشرة،
// ثم نتحقق هنا فعلياً من وصول القراءات بعد الربط.
function setupGuide(loggedIn) {
  const pn = loggedIn ? device()?.pn : '';
  const m = state.model;
  const status = !loggedIn || state.demo ? '' : !m
    ? '<p class="hint">لا توجد قراءات بعد.</p>'
    : m.stale
      ? `<div class="verdict bad">لم تصل قراءة جديدة منذ ${esc(fmt.ago(m.age).replace('قبل ', ''))}. إذا أنهيت الخطوات فانتظر 3–5 دقائق ثم اضغط «تحقّق الآن».</div>`
      : `<div class="verdict ok">✓ الوحدة متصلة وترسل القراءات — آخر قراءة ${esc(fmt.ago(m.age))}</div>`;
  const step = (n, title, body, btn = '') => `<li class="gstep"><span class="gn">${n}</span><div><b>${title}</b><p>${body}</p>${btn}</div></li>`;
  return `
  <section class="hero c-sky"><span class="g-deco">${icons.wifi}</span><div class="h-ic">${icons.wifi}</div>
    <b class="hero-t">ربط الجهاز والحساب</b><span>إنشاء حساب وربط وحدة الواي فاي بشبكة البيت</span></section>
  <div class="banner demo">${icons.info}<span><b>لماذا عبر تطبيق WatchPower؟</b>التسجيل وبرمجة وحدة الواي فاي يتمّان بنظام خاص بالشركة المصنّعة غير منشور. لذلك يرشدك «طاقتي» خطوة بخطوة ويفتح لك الشاشات المطلوبة، وبعد الربط يعمل بنفس الحساب.</span></div>

  <details class="card fold" ${loggedIn ? '' : state.guideOpen === 'register' ? 'open' : ''}><summary><h2>${icons.user} إنشاء حساب جديد</h2>${icons.chevL}</summary>
    <ol class="gsteps">
      ${step(1, 'جهّز رقم الوحدة (PN)', 'تجده على ملصق وحدة الواي فاي المركّبة في الإنفرتر، ويبدأ عادة بحرف W ويتكوّن من 14 خانة.')}
      ${step(2, 'سجّل من التطبيق الرسمي', 'في شاشة الدخول اضغط «Register» وأدخل اسم المستخدم وكلمة المرور ورقم PN.', `<button class="btn primary" data-open-app="wifi">${icons.user} فتح WatchPower للتسجيل</button>`)}
      ${step(3, 'ادخل بنفس الحساب هنا', 'ارجع إلى «طاقتي» وسجّل الدخول بنفس اسم المستخدم وكلمة المرور.')}
    </ol>
    <p class="hint">كل وحدة واي فاي تُسجَّل بحساب واحد فقط. إذا ظهر أن الرقم مسجّل مسبقاً فيجب حذفه من الحساب القديم أولاً، أو التواصل مع البائع.</p>
  </details>

  <details class="card fold" ${loggedIn || state.guideOpen === 'wifi' ? 'open' : ''}><summary><h2>${icons.wifi} ربط الوحدة بشبكة البيت (Wi-Fi Config)</h2>${icons.chevL}</summary>
    <ol class="gsteps">
      ${step(1, 'شغّل الإنفرتر وقرّب الهاتف منه', 'تحتاج الوحدة بضع دقائق بعد التشغيل حتى تظهر شبكتها.')}
      ${step(2, 'اتصل بشبكة الوحدة', `من إعدادات الواي فاي اختر الشبكة التي اسمها نفس رقم الوحدة${pn ? ` (<bdi dir="ltr">${esc(pn)}</bdi>)` : ''}. كلمة المرور الافتراضية غالباً <bdi dir="ltr">12345678</bdi> وقد تختلف حسب الطراز، فراجع الملصق.`,
        isNative ? `<button class="btn ghost" data-open="wifi-settings">${icons.wifi} فتح إعدادات الواي فاي</button>` : '')}
      ${step(3, 'أدخل شبكة بيتك في WatchPower', 'افتح WatchPower، واضغط «Wi-Fi Config» في شاشة الدخول، ثم اختر شبكة بيتك واكتب كلمة مرورها. أغلب هذه الوحدات تعمل على شبكات 2.4 GHz فقط.', `<button class="btn primary" data-open-app="wifi">${icons.wifi} فتح WatchPower</button>`)}
      ${step(4, 'أعد هاتفك لشبكة البيت وانتظر', 'تحتاج الوحدة 3–5 دقائق لتتصل بالإنترنت وترسل أول قراءة.')}
      ${loggedIn ? step(5, 'تحقّق من الربط', 'يتأكد «طاقتي» من وصول قراءات جديدة من جهازك.', `${status}<button class="btn ghost" id="checkLink">${icons.refresh} تحقّق الآن</button>`) : ''}
    </ol>
  </details>

  <details class="card fold"><summary><h2>${icons.bolt} أجهزة البلوتوث (BLE network)</h2>${icons.chevL}</summary>
    <p class="f-desc">بعض الإنفرترات تأتي بوحدة بلوتوث بدل الواي فاي. هذه الوحدات تتصل بالهاتف القريب فقط ولا ترسل بياناتها إلى الإنترنت، لذلك تُدار من تطبيق «WatchPower BLE» ولا يستطيع «طاقتي» قراءتها عن بُعد.</p>
    <div class="row-btns">
      ${isNative ? `<button class="btn ghost" data-open="bt-settings">${icons.bolt} إعدادات البلوتوث</button>` : ''}
      <button class="btn primary" data-open-app="ble">فتح WatchPower BLE</button>
    </div>
  </details>`;
}

async function bindGuide() {
  document.querySelectorAll('[data-open-app]').forEach((b) => {
    b.onclick = async () => {
      const r = await deviceTools.openApp(APPS[b.dataset.openApp]).catch(() => 'none');
      if (r === 'store' || r === 'web') toast('التطبيق غير مثبت، فُتحت صفحته في المتجر');
      if (r === 'none') toast('تعذّر فتح التطبيق أو المتجر', 'bad');
    };
  });
  const ws = $('[data-open="wifi-settings"]');
  if (ws) ws.onclick = async () => { if (!(await deviceTools.openWifiSettings().catch(() => false))) toast('افتح إعدادات الواي فاي من الهاتف يدوياً', 'bad'); };
  const bt = $('[data-open="bt-settings"]');
  if (bt) bt.onclick = async () => { if (!(await deviceTools.openBluetoothSettings().catch(() => false))) toast('افتح إعدادات البلوتوث من الهاتف يدوياً', 'bad'); };
  const ck = $('#checkLink');
  if (ck) ck.onclick = async () => { ck.disabled = true; await refresh(true); if (state.page === 'setup') render(); };
}
AFTER.setup = bindGuide;

// نفس الدليل من شاشة الدخول قبل تسجيل الدخول
function renderGuideStandalone(which) {
  state.guideOpen = which;
  state.screen = 'guide';
  document.getElementById('app').innerHTML = `
    <header class="topbar"><button class="icon-btn" id="guideBack" aria-label="رجوع">${icons.arrowBack}</button><div class="page-title">ربط الجهاز والحساب</div><span></span></header>
    <main id="view"><div class="page-anim">${setupGuide(false)}</div></main>`;
  $('#guideBack').onclick = () => renderLogin();
  bindGuide();
}

// ================= تبويب المزيد =================
// صورة الإنفرتر في «المزيد»: رسم أصلي بسيط بلونين يتكيّف مع المظهر
const INVERTER_SVG = `<svg class="inv-img" viewBox="0 0 160 130" aria-hidden="true">
  <defs><linearGradient id="invB" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#dfe3e8"/></linearGradient>
  <linearGradient id="invS" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#c9ced6"/><stop offset="1" stop-color="#9aa1ab"/></linearGradient></defs>
  <ellipse cx="80" cy="122" rx="56" ry="6" fill="#0003"/>
  <path d="M30 18 L118 10 L134 22 L134 104 L46 112 L30 100 Z" fill="url(#invS)"/>
  <path d="M30 18 L118 10 L118 96 L30 104 Z" fill="url(#invB)" stroke="#0000001a"/>
  <path d="M30 84 L118 78 L118 96 L30 104 Z" fill="#8e96a1" opacity=".55"/>
  <rect x="58" y="42" width="34" height="16" rx="4" fill="#1d2430" transform="skewY(-4)"/>
  <circle cx="68" cy="46" r="1.8" fill="#34d399"/><circle cx="75" cy="45.5" r="1.8" fill="#34d399"/><circle cx="82" cy="45" r="1.8" fill="#34d399"/>
  <path d="M71 30 l-3 6 h4 l-2 5 6-8 h-4 l2-3z" fill="#f2b632"/>
  <g fill="#2a313c"><rect x="44" y="104" width="7" height="8" rx="1.5"/><rect x="58" y="103" width="7" height="8" rx="1.5"/><rect x="72" y="102" width="7" height="8" rx="1.5"/><rect x="100" y="99" width="7" height="8" rx="1.5"/></g>
</svg>`;

function viewMore() {
  if (state.page?.startsWith('tips')) return viewTips();
  const pages = { setup: () => setupGuide(true), edit: pageEdit, power: pagePower, calc: () => viewCalc(calcHelpers()), settings: pageSettings, about: pageAbout, update: pageUpdate };
  if (state.page && pages[state.page]) return pages[state.page]();
  const themeName = { auto: 'تلقائي', dark: 'ليلي', light: 'نهاري' }[state.prefs.theme];
  const m = state.model;
  const st = !m ? ['', 'جارٍ القراءة'] : state.demo ? ['demo', 'وضع تجريبي'] : m.stale ? ['off', `غير متصل · ${fmt.ago(m.age)}`] : m.fault ? ['bad', 'يوجد عطل'] : ['on', 'متصل'];
  const temp = m && !m.stale && m.invTemp != null ? ` · <bdi>${Math.round(m.invTemp)}°</bdi>` : '';
  const group = (title, items) => `<h3 class="sec-h">${title}</h3>${listCards(items.filter(Boolean))}`;
  return `
  <button class="inv-hero" data-page="home:device" aria-label="تفاصيل الإنفرتر">
    ${INVERTER_SVG}
    <b>${esc(device()?.alias || 'الإنفرتر')}</b>
    <span class="inv-st ${st[0]}"><i></i>${st[1]}${temp}${m?.mode && !m.stale ? ` · ${esc(trValue(m.mode))}` : ''}</span>
  </button>
  <div class="shortcuts">
    ${[['power', 'أولوية الطاقة', icons.bolt, 'c-green'], ['edit', 'إعدادات الإنفرتر', icons.wrench, 'c-pink'], ['setup', 'ربط وواي فاي', icons.wifi, 'c-sky'], ['reports:period', 'تقرير ومشاركة', icons.download, 'c-amber']]
    .map(([pg, l, ic, c]) => `<button class="sc ${c}" data-page="${pg}"><span>${ic}</span><b>${l}</b></button>`).join('')}
  </div>
  ${group('الجهاز', [
    { page: 'power', title: 'أولوية مصدر الطاقة', sub: 'التبديل بين الألواح والبطارية والشبكة، والجدولة والإدارة الذكية', icon: icons.bolt, color: 'c-green' },
    { page: 'edit', title: 'إعدادات الإنفرتر', sub: 'تغيير الأولويات وتيارات الشحن عن بُعد', icon: icons.wrench, color: 'c-pink' },
    { page: 'setup', title: 'ربط الجهاز والحساب', sub: 'إنشاء حساب، إعداد الواي فاي (Wi-Fi Config)، البلوتوث', icon: icons.wifi, color: 'c-sky' },
  ])}
  ${group('المظهر والإعدادات', [
    { page: 'settings', title: 'الإعدادات', sub: `${themeName} · ${state.prefs.batteryAh ? `البطارية ${state.prefs.batteryAh} أمبير ساعة` : 'أدخل سعة البطارية'}`, icon: icons.gauge, color: 'c-violet' },
    { page: 'tips', title: 'النصائح', sub: 'استخدام الإنفرتر وبطاريات الليثيوم والتوفير والسلامة', icon: icons.bulb, color: 'c-amber' },
    { page: 'tour', title: 'جولة في التطبيق', sub: 'كيف تستخدم طاقتي، مع أمثلة لحالات المنظومة', icon: icons.star, color: 'c-sky' },
  ])}
  ${group('التحديث والدعم', [
    { page: 'update', title: 'التحقق من التحديثات', sub: updateAvailable() ? `يتوفر الإصدار ${state.update.version}` : 'الإصدار الحالي ' + VERSION, icon: icons.upgrade, color: 'c-amber', badge: updateAvailable() ? 'جديد' : '' },
    { page: 'about', title: 'تواصل مع المطوّر', sub: 'حسين محمد علي الطويل · حول التطبيق', icon: icons.user, color: 'c-slate' },
  ])}
  <button class="btn danger wide logout-btn" id="logoutBtn">${icons.logout} ${state.demo ? 'الخروج من الوضع التجريبي' : 'تسجيل الخروج'}</button>
  <p class="foot">طاقتي · الإصدار ${VERSION}</p>`;
}
AFTER.more = () => {
  // الجولة نافذة فوق الصفحة وليست صفحة مستقلة
  const t = $('[data-page="tour"]');
  if (t) t.addEventListener('click', (e) => { e.stopPropagation(); openTour(); }, true);
  $('#logoutBtn').onclick = async () => {
    if (await confirmDialog('تسجيل الخروج', state.demo ? 'هل تريد الخروج من الوضع التجريبي؟' : 'هل تريد تسجيل الخروج؟ ستبقى التقارير المحفوظة على الهاتف.')) logout();
  };
};

function pageCustom() {
  const sizes = [[0.8, 'أصغر'], [0.9, 'صغير'], [1, 'عادي'], [1.1, 'كبير'], [1.2, 'أكبر']];
  const cur = state.prefs.fontFamily || 'Cairo';
  const scenes = [['photo', 'صور واقعية', 'day'], ['3d', 'رسم ثلاثي الأبعاد', 'thumb-3d'], ['classic', 'الكلاسيكي', 'thumb-classic']];
  return `<section class="card"><div class="card-h"><h2>المظهر</h2></div>${pageTheme()}</section>
  <section class="card"><div class="card-h"><h2>شكل المشهد في الرئيسية</h2></div>
    <div class="scene-opts">${scenes.map(([v, l, img]) => `<button class="scene-opt ${sceneStyle() === v ? 'on' : ''}" data-scene-opt="${v}"><img src="scene/${img}.webp" alt="" loading="lazy"><b>${l}</b></button>`).join('')}</div>
    <p class="hint center">«صور واقعية» تتبدّل مع الطقس والليل وحالة البطارية.</p></section>
  <section class="card"><div class="card-h"><h2>حجم الخط</h2></div>
    <div class="theme-opts fs-opts">${sizes.map(([v, l]) => `<button class="theme-opt fs-opt ${Number(state.prefs.fontScale || 1) === v ? 'on' : ''}" data-fs="${v}"><b style="font-size:${Math.round(15 * v)}px">أ</b><b>${l}</b></button>`).join('')}</div>
    <p class="hint center">يغيّر حجم النصوص في كل التطبيق، وتتكيّف البطاقات معه.</p></section>
  <section class="card"><div class="card-h"><h2>نوع الخط</h2></div>
    <div class="font-opts">${FONTS.map(([f, l]) => `<button class="font-opt ${cur === f ? 'on' : ''}" data-font="${f}" style="font-family:'${f}'"><b>طاقتي 123</b><small>${l}</small></button>`).join('')}</div></section>
  <section class="card"><div class="card-h"><h2>صيغة الوقت</h2></div>
    <div class="seg clock-seg">${[[true, '12 ساعة · 5:30 م'], [false, '24 ساعة · 17:30']].map(([v, l]) => `<button class="${(state.prefs.clock12 !== false) === v ? 'on' : ''}" data-clock="${v ? 12 : 24}">${l}</button>`).join('')}</div></section>`;
}
AFTER.custom = () => {
  AFTER.theme();
  document.querySelectorAll('[data-scene-opt]').forEach((b) => {
    b.onclick = () => { state.prefs.sceneStyle = b.dataset.sceneOpt; savePrefs(); render(); toast('سيظهر المشهد الجديد في الرئيسية', 'ok'); };
  });
  document.querySelectorAll('[data-fs]').forEach((b) => {
    b.onclick = () => { state.prefs.fontScale = Number(b.dataset.fs); savePrefs(); applyTheme(); render(); };
  });
  document.querySelectorAll('[data-font]').forEach((b) => {
    b.onclick = () => { state.prefs.fontFamily = b.dataset.font; savePrefs(); applyTheme(); render(); };
  });
  document.querySelectorAll('[data-clock]').forEach((b) => {
    b.onclick = () => { state.prefs.clock12 = b.dataset.clock === '12'; savePrefs(); applyTheme(); render(); };
  });
};

// صفحة إعدادات واحدة: المظهر، البطارية، الاتصال، والحساب
function pageSettings() {
  const d = device();
  return `${pageCustom()}
    <section class="card"><div class="card-h"><h2>البطارية</h2></div>${pageBatCfg()}</section>
    <section class="card"><div class="card-h"><h2>الاتصال</h2></div>${pageConn()}</section>
    <section class="card" id="locCard">${pageLoc()}</section>
    <section class="card"><div class="card-h"><h2>الحساب</h2></div>
      ${kv([['الحساب', val(state.demo ? 'وضع تجريبي' : state.session?.usr)], ['الجهاز المعروض', val(d?.alias)], ['عدد الأجهزة', val(String(state.devices.length))], ['الخادم', val(state.demo ? '—' : state.session?.profile === 'shine' ? 'ShineMonitor' : 'DessMonitor')]])}
      ${state.devices.length > 1 ? '<p class="hint">للتبديل بين أجهزتك اضغط اسم الجهاز أعلى الرئيسية.</p>' : ''}</section>`;
}
AFTER.settings = () => {
  AFTER.custom();
  bindPrefs($('#view'));
  bindLoc();
  loadCollector();
  loadPlantInfo();
  // ملخص البطارية يتحدث فوراً مع كل تغيير في السعة أو أدنى نسبة
  const v = $('#view');
  if (v.dataset.batSum) return;
  v.dataset.batSum = '1';
  v.addEventListener('change', (e) => {
    if (leaf() !== 'settings' || !['batteryAh', 'cutoffSoc'].includes(e.target.dataset?.pref)) return;
    const box = document.createElement('div');
    box.innerHTML = pageBatCfg();
    const fresh = box.querySelector('#batSum');
    if (fresh) $('#batSum').innerHTML = fresh.innerHTML;
  });
};

function pageTheme() {
  const opt = (v, label, ic) => `<button class="theme-opt ${state.prefs.theme === v ? 'on' : ''}" data-theme-opt="${v}">${ic}<b>${label}</b></button>`;
  return `<div class="theme-opts">${opt('auto', 'تلقائي', icons.refresh)}${opt('light', 'نهاري', icons.sun)}${opt('dark', 'ليلي', icons.moon)}</div>
    <p class="hint center">«تلقائي» يتبع وضع هاتفك الليلي.</p>`;
}
AFTER.theme = () => {
  document.querySelectorAll('[data-theme-opt]').forEach((b) => {
    b.onclick = () => { state.prefs.theme = b.dataset.themeOpt; savePrefs(); applyTheme(); render(); };
  });
};

function pageBatCfg() {
  const rated = state.model?.ratedV;
  const v = rated || nominalV(state.model);
  const ah = state.prefs.batteryAh;
  return `<div class="form">
      ${numField('batteryAh', 'سعة البطارية', 'أمبير ساعة', 10, 5000, 'مثال: 200', 'batteryAh')}
      ${numField('cutoffSoc', 'أدنى نسبة مسموح التفريغ إليها', '%', 0, 60)}
      ${numField('pvKwp', 'قدرة الألواح المركّبة', 'كيلوواط', 0.1, 200, state.plant?.nominalPower ? String(state.plant.nominalPower) : 'مثال: 4.4', 'pvKwp')}
    </div>
    <p class="hint" id="batSum">${ah ? `بطاريتك تخزن قرابة <b>${fmt.kwh((ah * v) / 1000)} ك.و.س</b> على ${v} فولت${rated ? '' : ' (مقدّر من جهد البطارية)'}، منها <b>${fmt.kwh(((ah * v) / 1000) * (1 - (state.prefs.cutoffSoc ?? 20) / 100))}</b> قابلة للاستخدام.` : 'أدخل السعة ليحسب التطبيق مدة البطارية.'}</p>`;
}

// موقع المنظومة للطقس: بحث بالاسم (بالعربية) من خدمة Open-Meteo
function pageLoc() {
  const loc = state.prefs.loc;
  const srv = state.plant?.lat && state.plant?.lon;
  const r = state.locSearch;
  return `${cardH('موقع المنظومة للطقس')}
    <p class="hint">${loc ? `الموقع: <b>${esc(loc.name)}</b>${loc.area ? '، ' + esc(loc.area) : ''}` : srv ? 'يُستخدم الموقع المسجّل للمنظومة على خادم WatchPower.' : 'لم يُحدَّد موقع بعد. ابحث عن مدينتك ليظهر الطقس في الرئيسية.'}</p>
    <div class="loc-row"><input type="search" id="locQ" placeholder="اسم المدينة، مثلاً: إدلب" autocomplete="off" enterkeyhint="search" value="${esc(state.locQuery || '')}"><button class="btn primary" id="locGo">بحث</button></div>
    <div id="locRes">${locResults(r)}</div>
    ${loc ? '<button class="link pad" id="locClear">إزالة الموقع</button>' : ''}`;
}

// النتائج وحدها تُعاد رسمها، فيبقى ما كتبه المستخدم ولوحة المفاتيح مفتوحة
function locResults(r) {
  if (r?.loading) return '<div class="spinner sm"></div>';
  if (r?.error) return `<p class="note bad">${icons.warn}<span>${esc(r.error)}</span></p>`;
  if (!r?.list) return '';
  return r.list.length
    ? `<div class="loc-list">${r.list.map((x, i) => `<button class="loc-it" data-loc="${i}"><b>${esc(x.name)}</b><small>${esc(x.area)}</small></button>`).join('')}</div>`
    : '<p class="hint">لم يُعثر على مكان بهذا الاسم. جرّب الاسم بالإنجليزية أو اسم مدينة قريبة.</p>';
}

function bindLoc() {
  const card = $('#locCard');
  if (!card) return;
  // نكتب في البطاقة الظاهرة الآن، فقد تُعاد رسم الصفحة أثناء انتظار البحث
  const showRes = () => { const box = $('#locRes'); if (box) { box.innerHTML = locResults(state.locSearch); bindPick(); } };
  const go = async (quiet = false) => {
    const q = ($('#locQ')?.value || '').trim();
    state.locQuery = q;
    if (q.length < 2) { if (!quiet) toast('اكتب اسم المدينة', 'bad'); return; }
    const seq = (state.locSeq = (state.locSeq || 0) + 1);
    state.locSearch = { loading: true };
    showRes();
    let res;
    try { res = { list: await searchPlace(q) }; } catch (e) { res = { error: e.message }; }
    // نتيجة بحث أقدم وصلت متأخرة لا تُظهر فوق الأحدث
    if (seq !== state.locSeq) return;
    state.locSearch = res;
    showRes();
  };
  let t;
  $('#locGo').onclick = () => { clearTimeout(t); go(); };
  $('#locQ').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(t); go(); } };
  // البحث أثناء الكتابة بعد توقف قصير
  $('#locQ').oninput = () => { state.locQuery = $('#locQ').value; clearTimeout(t); t = setTimeout(() => go(true), 700); };
  bindPick();
  bindClear();
}

function bindPick() {
  const redraw = () => { const c = $('#locCard'); if (c) { c.innerHTML = pageLoc(); bindLoc(); } };
  $('#locCard')?.querySelectorAll('[data-loc]').forEach((b) => {
    b.onclick = () => {
      const x = state.locSearch.list[Number(b.dataset.loc)];
      state.prefs.loc = { name: x.name, area: x.area, lat: x.lat, lon: x.lon };
      savePrefs();
      state.locSearch = null;
      state.locQuery = '';
      state.weather = null;
      store.del('wx');
      toast(`الموقع: ${x.name}`, 'ok');
      redraw();
      loadWeather(true);
    };
  });
}

function bindClear() {
  const redraw = () => { const c = $('#locCard'); if (c) { c.innerHTML = pageLoc(); bindLoc(); } };
  const clr = $('#locClear');
  if (clr) clr.onclick = () => { state.prefs.loc = null; savePrefs(); state.weather = null; store.del('wx'); redraw(); };
}

function pageConn() {
  const c = state.collector;
  const rec = c?.datFetch ? Math.max(5, Math.ceil((c.datFetch * 3) / 60)) : null;
  return `<div class="form">
      ${numField('staleMin', 'اعتبار الإنفرتر غير متصل بعد', 'دقيقة', 5, 180, '', 'stale')}
    </div>
    ${rec && rec > state.prefs.staleMin ? `<p class="note warn">${icons.warn}<span>وحدتك ترفع قراءة كل ${Math.round(c.datFetch / 60)} دقائق، فالمدة الحالية قصيرة وقد تُظهر «غير متصل» خطأً. ننصح بـ ${rec} دقيقة.</span></p>` : ''}`;
}

function pageAbout() {
  return `
  <section class="about">
    <div class="logo">${icons.sun}</div>
    <h2>طاقتي</h2>
    <p class="muted">الإصدار ${VERSION}</p>
    <p>تطبيق عربي لمراقبة منظومات الطاقة الشمسية لحظة بلحظة، يعمل بنفس حساب تطبيق WatchPower.</p>
  </section>
  <section class="dev-card">
    <div class="dev-av">${icons.user}</div>
    <div><small>مطوّر التطبيق</small><b>حسين محمد علي الطويل</b>
      <p class="dua">اللهم اجعل هذا العمل خالصاً لوجهك الكريم، ونافعاً لكل من يستخدمه.<br>لا تنسونا من صالح دعائكم 🤲</p></div>
  </section>
  <section class="card"><div class="card-h"><h2>الخصوصية</h2></div>
    <p class="hint">«طاقتي» تطبيق مستقل غير تابع لشركة WatchPower أو الشركات المصنّعة للأجهزة، ويعتمد على خدمة WatchPower السحابية، لذا قد يتأثر إذا غيّرت الشركة خدمتها.</p>
    <p class="hint">يتصل التطبيق مباشرة بخوادم WatchPower (DessMonitor أو ShineMonitor) فقط. لا تُحفظ كلمة المرور كما كتبتها، بل بيانات الدخول مشفّرةً داخل الهاتف، ولا تُرسل بياناتك إلى أي جهة أخرى. كل التقارير محفوظة على هاتفك.</p>
  </section>
  <p class="foot">صُنع بـ ${icons.heart} للطاقة النظيفة</p>`;
}


// ================= التحديثات =================
// يتحقق التطبيق تلقائياً مرة كل 12 ساعة على الأكثر، ومن زر في «المزيد» متى شاء المستخدم
state.update = store.get('update', null);
state.upd = { checking: false, error: null, pct: null, phase: null };
const updateAvailable = () => !!state.update && isNewer(state.update.version, VERSION);

async function checkUpdate(manual = false) {
  if (state.upd.checking) return;
  state.upd.checking = true;
  state.upd.error = null;
  if (manual && leaf() === 'update') render();
  try {
    state.update = await fetchLatest();
    store.set('update', state.update);
    store.set('updateAt', Date.now());
  } catch (e) {
    state.upd.error = e.message;
  }
  state.upd.checking = false;
  if (state.tab === 'more' && (!state.page || leaf() === 'update')) render();
}

async function autoCheckUpdate() {
  if (Date.now() - store.get('updateAt', 0) < 12 * 36e5) return;
  await checkUpdate();
  // نُعلم بكل إصدار جديد مرة واحدة فقط
  if (updateAvailable() && store.get('updateSeen', '') !== state.update.version) {
    store.set('updateSeen', state.update.version);
    toast(`يتوفر إصدار جديد من طاقتي (${state.update.version}) — من «المزيد» ← التحقق من التحديثات`, 'ok');
  }
}

function pageUpdate() {
  const u = state.update, s = state.upd;
  const avail = updateAvailable();
  const mb = u?.size ? ` · ${(u.size / 1048576).toFixed(1)} ميغابايت` : '';
  let body;
  if (s.checking) body = '<div class="empty"><div class="spinner"></div>جارٍ التحقق من وجود إصدار جديد…</div>';
  else if (avail) {
    const busy = s.phase === 'download';
    body = `<section class="card upd-new"><div class="card-h"><h2>${icons.upgrade} الإصدار ${esc(u.version)} متوفر</h2></div>
      ${u.notes ? `<div class="upd-notes">${esc(u.notes).replace(/\n/g, '<br>')}</div>` : ''}
      <p class="hint">${u.at ? `نُشر ${esc(new Date(u.at).toLocaleDateString(LOC, { dateStyle: 'medium' }))}` : ''}${mb}</p>
      ${busy ? `<div class="bar"><i id="updProg" style="width:${Math.max(0, s.pct ?? 0)}%"></i></div><p class="hint center" id="updTxt">${s.pct >= 0 ? `جارٍ التحميل ${s.pct}%` : 'جارٍ التحميل…'}</p>`
        : `<button class="btn primary big wide" id="updGo">${icons.download} ${s.phase === 'ready' ? 'تثبيت التحديث' : 'تحميل وتثبيت التحديث'}</button>`}
      ${s.phase === 'permission' ? '<p class="hint">اسمح لـ«طاقتي» بتثبيت التطبيقات من الشاشة التي فُتحت، ثم ارجع واضغط «تثبيت التحديث».</p>' : ''}
    </section>`;
  } else {
    body = `<section class="card center"><div class="upd-ok">${icons.check}</div><h2>تطبيقك محدّث</h2>
      <p class="hint">${u ? `آخر إصدار منشور ${esc(u.version)}` : 'لم يُنشر أي إصدار بعد'}${store.get('updateAt', 0) ? ` · آخر تحقق ${esc(fmt.ago(Date.now() - store.get('updateAt', 0)))}` : ''}</p></section>`;
  }
  return `${kv([['الإصدار المثبّت', val(VERSION)], ['مصدر التحديثات', val('صفحة إصدارات طاقتي على GitHub')]])}
    ${s.error ? `<div class="empty bad">${esc(s.error)}</div>` : ''}
    ${body}
    ${s.checking || s.phase === 'download' ? '' : `<button class="btn ghost wide" id="updCheck">${icons.refresh} التحقق الآن</button>`}
    <p class="hint">يُحمَّل التحديث من صفحة إصدارات التطبيق فقط، ويتحقق التطبيق قبل التثبيت أنه «طاقتي» نفسه، وأحدث من نسختك، وموقّع بمفتاح المطوّر. يطلب أندرويد موافقتك في كل تثبيت، وتبقى بياناتك وإعداداتك كما هي.</p>`;
}
AFTER.update = () => {
  const c = $('#updCheck');
  if (c) c.onclick = () => checkUpdate(true);
  const go = $('#updGo');
  if (!go) return;
  // أندرويد قد يعيد تشغيل التطبيق بعد منح إذن التثبيت؛ نكمل من الملف المحمّل بدل تنزيله مجدداً
  if (!state.upd.phase) updater.ready().then((r) => { if (r && !state.upd.phase) { state.upd.phase = 'ready'; render(); } }).catch(() => {});
  go.onclick = async () => {
    const s = state.upd;
    s.error = null;
    try {
      if ((s.phase !== 'ready' && s.phase !== 'permission') || !(await updater.ready())) {
        s.phase = 'download'; s.pct = 0; render();
        const r = await updater.download(state.update.url, (pct) => {
          s.pct = pct;
          const bar = $('#updProg'), txt = $('#updTxt');
          if (bar && pct >= 0) bar.style.width = pct + '%';
          if (txt) txt.textContent = pct >= 0 ? `جارٍ التحميل ${pct}%` : 'جارٍ التحميل…';
        });
        if (r.web) { s.phase = null; render(); return; }
      }
      s.phase = 'ready';
      const r = await updater.install();
      s.phase = r.status === 'permission' ? 'permission' : 'ready';
    } catch (e) {
      s.phase = null;
      s.error = e.message || 'تعذّر تثبيت التحديث';
    }
    render();
  };
};

// ================= التشغيل =================
const DEMO_DEVICE = { sn: 'DEMO', pn: 'W0000000000000', alias: 'جهاز تجريبي', devcode: 0, devaddr: 1 };
async function boot() {
  // الوضع التجريبي محفوظ بعد إغلاق التطبيق، لكن جهازه لا يُحفظ: نعيده حتى لا تبقى الرئيسية على «جارٍ الجلب»
  if (state.demo && !state.devices.length) { state.devices = [DEMO_DEVICE]; state.devSn = 'DEMO'; }
  fitScreen();
  // تدوير الجهاز أو تغيير حجم النافذة: نعيد الحساب ونعيد الرسم إن تغيّر التخطيط
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (fitScreen() && (state.session || state.demo)) render(); }, 150); });
  applyTheme();
  // زر ⓘ في أي مكان يفتح شرحه، ويمنع فتح البطاقة التي يقع داخلها
  const onInfo = (e) => {
    const i = e.target.closest?.('[data-info]');
    if (!i) return false;
    e.preventDefault(); e.stopPropagation();
    openInfo(i.dataset.info);
    return true;
  };
  document.addEventListener('click', onInfo, true);
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && onInfo(e)) return; }, true);
  // تغذية راجعة لمسية لكل زر وبطاقة وتبويب
  document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('button, [data-page], [data-tab], .lcard')) tap(); }, { passive: true });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.prefs.theme === 'auto') { applyTheme(); if (state.session || state.demo) render(); } });
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('resume', async () => {
      if (!state.session && !state.demo) return;
      await takeOverFromBackground();
      renderHeader();
      refresh();
      startPolling();
    });
    // في الخلفية نوقف المراقبة من الواجهة ونسلّمها للفحص الأصلي حتى لا تتكرر التنبيهات
    CapApp.addListener('pause', () => {
      stopPolling();
      if (state.session && !state.demo) syncMonitor();
    });
    CapApp.addListener('backButton', back);
    if (state.prefs.notify) LocalNotifications.requestPermissions().catch(() => {});
  }
  await migrateSession();
  state.session = await secure.get('session').catch(() => null);
  api = new WatchPowerApi(state.session || {});
  if (state.demo || (state.session?.token && state.devices.length)) startApp();
  else renderLogin();
}

// أدوات للاختبارات في المتصفح فقط
if (!isNative) { window.__nav = navigate; window.__state = state; window.__render = render; window.__charts = charts; }

boot();
