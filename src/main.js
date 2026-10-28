import './styles.css';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import {
  Chart, LineController, LineElement, PointElement, BarController, BarElement,
  LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { WatchPowerApi, ApiError } from './api.js';
import { normalize, rowsToSamples, fmt } from './model.js';
import { trTitle, trValue, trUnit, isEmptyVal } from './i18n.js';
import {
  store, today, addDays, dayKey, recordSample, localDay, summarize, cachedSummary, cacheSummary, toCsv, shareFile,
} from './data.js';
import { demoPoints, demoHistory } from './demo.js';
import { icons } from './icons.js';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);
Chart.defaults.font.family = 'Cairo, system-ui, sans-serif';

const VERSION = '2.0.0';

// ================= الحالة =================
const DEFAULT_PREFS = {
  pollSec: 30,
  staleMin: 15,
  batteryAh: null,
  cutoffSoc: 20,
  theme: 'auto',
  notify: true,
  lowSoc: 30,
  overloadPct: 80,
  alertGrid: true,
  alertFull: true,
  alertOffline: true,
};

const state = {
  session: store.get('session', null),
  demo: store.get('demo', false),
  devices: store.get('devices', []),
  devSn: store.get('devSn', null),
  prefs: { ...DEFAULT_PREFS, ...store.get('prefs', {}) },
  alerts: store.get('alerts', []),
  faults: store.get('faults', []),
  flags: store.get('flags', {}),
  tab: 'home',
  page: null,
  model: null,
  fetchedAt: null,
  fromCache: false,
  netError: null,
  loading: false,
  fails: 0,
  rep: { dayDate: today(), day: null, week: null, month: null, weekOff: 0, monthOff: 0, cmp: 'week', cmpData: null },
  fields: null,
  fieldsError: null,
};

let api = new WatchPowerApi(state.session || {});
let pollTimer = null;
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

function applyTheme() {
  const t = state.prefs.theme;
  const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  Chart.defaults.color = dark ? '#9aa7c7' : '#5b6785';
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
      <b>${esc(it.title)}</b>
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

function stat(label, value, unit, color = '') {
  return `<div class="stat ${color}"><small>${esc(label)}</small><b><bdi>${esc(value ?? '—')}</bdi></b>${unit ? `<span>${esc(unit)}</span>` : ''}</div>`;
}

// ================= تسجيل الدخول =================
function renderLogin(msg = '') {
  stopPolling();
  document.getElementById('app').innerHTML = `
  <div class="login">
    <div class="login-hero">
      <div class="logo">${icons.sun}</div>
      <h1>طاقتي</h1>
      <p>راقب منظومة الطاقة الشمسية لحظة بلحظة</p>
    </div>
    <form class="card login-card" id="loginForm" autocomplete="on">
      <label>اسم المستخدم في تطبيق WatchPower
        <input name="usr" required autocomplete="username" dir="ltr" value="${esc(state.session?.usr || '')}">
      </label>
      <label>كلمة المرور
        <input name="pwd" type="password" required autocomplete="current-password" dir="ltr">
      </label>
      ${msg ? `<div class="err">${esc(msg)}</div>` : ''}
      <button class="btn primary big" type="submit">تسجيل الدخول</button>
      <button class="btn ghost" type="button" id="demoBtn">تجربة التطبيق ببيانات تجريبية</button>
      <p class="hint">يُستخدم نفس حساب تطبيق WatchPower. لا تُحفظ كلمة المرور على الهاتف، بل بصمتها المشفّرة فقط.</p>
    </form>
    <p class="foot">تطوير: حسين محمد علي الطويل</p>
  </div>`;

  $('#demoBtn').onclick = () => {
    state.demo = true;
    store.set('demo', true);
    state.devices = [{ sn: 'DEMO', pn: 'W0000000000000', alias: 'جهاز تجريبي', devcode: 0, devaddr: 1 }];
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
      state.session = await api.login(f.get('usr'), f.get('pwd'));
      store.set('session', state.session);
      state.demo = false;
      store.set('demo', false);
      btn.textContent = 'جارٍ البحث عن الأجهزة…';
      state.devices = await api.listDevices();
      store.set('devices', state.devices);
      if (!state.devices.length) throw new ApiError('لم يُعثر على أي جهاز في هذا الحساب');
      state.devSn = state.devices[0].sn;
      store.set('devSn', state.devSn);
      startApp();
    } catch (err) {
      renderLogin(err.message || 'حدث خطأ غير متوقع');
    }
  };
}

function logout() {
  stopPolling();
  ['session', 'devices', 'devSn', 'demo'].forEach(store.del);
  Object.assign(state, { session: null, demo: false, devices: [], model: null, fields: null, tab: 'home', page: null });
  state.rep = { ...state.rep, day: null, week: null, month: null, cmpData: null };
  api = new WatchPowerApi();
  renderLogin();
}

// ================= الهيكل والتنقل =================
const TABS = [
  ['home', 'الرئيسية', icons.flash],
  ['reports', 'التقارير', icons.chart],
  ['alerts', 'التنبيهات', icons.bell],
  ['inverter', 'الرافع', icons.inverter],
  ['more', 'المزيد', icons.gear],
];

function startApp() {
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
    if (card) navigate(state.tab, card.dataset.page);
  });
  loadCache();
  navigate(state.tab, state.page);
  refresh();
  startPolling();
}

function navigate(tab, page) {
  state.tab = tab;
  state.page = page;
  state.animate = true;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
  window.scrollTo(0, 0);
}

function back() {
  if (state.page) navigate(state.tab, null);
  else if (state.tab !== 'home') navigate('home', null);
  else CapApp.minimizeApp().catch(() => {});
}

function connState() {
  const m = state.model;
  if (state.demo) return { cls: 'demo', text: 'وضع تجريبي' };
  if (!m) return state.netError ? { cls: 'off', text: state.netError } : { cls: '', text: 'جارٍ التحميل…' };
  if (m.stale) return { cls: 'off', text: `الرافع غير متصل · آخر قراءة ${fmt.ago(m.age)}` };
  if (state.netError) return { cls: 'warn', text: 'لا يوجد اتصال · بيانات محفوظة' };
  return { cls: 'on', text: m.ts ? `آخر قراءة ${fmt.time(m.ts)} · ${fmt.ago(m.age)}` : 'متصل' };
}

function renderHeader() {
  const bar = $('#topbar');
  if (!bar) return;
  const c = connState();
  const title = state.page ? PAGE_TITLES[state.page] || '' : null;
  bar.innerHTML = state.page
    ? `<button class="icon-btn" id="backBtn" aria-label="رجوع">${icons.arrowBack}</button>
       <div class="page-title">${esc(title)}</div>
       <span class="dot ${c.cls}" title="${esc(c.text)}"></span>`
    : `<div class="dev"><span class="dot ${c.cls}"></span><div>
         <div class="dev-name">${esc(device()?.alias || 'جهازي')}</div>
         <div class="dev-sub">${esc(c.text)}</div></div></div>
       <button class="icon-btn ${state.loading ? 'spin' : ''}" id="refreshBtn" aria-label="تحديث">${icons.refresh}</button>`;
  const bb = $('#backBtn');
  if (bb) bb.onclick = back;
  const rb = $('#refreshBtn');
  if (rb) rb.onclick = () => refresh(true);
  const unread = state.alerts.filter((a) => !a.read).length;
  const badge = $('#alertBadge');
  if (badge) { badge.textContent = unread > 99 ? '99+' : unread || ''; badge.style.display = unread ? '' : 'none'; }
}

// شريط الحالة: يوضّح متى تكون البيانات غير حيّة
function banner() {
  const m = state.model;
  if (state.demo) return `<div class="banner demo">${icons.info}<span>وضع تجريبي — هذه البيانات للعرض فقط وليست من جهازك.</span></div>`;
  if (m?.stale) {
    return `<div class="banner off">${icons.offline}<span><b>الرافع غير متصل بالخادم</b>آخر قراءة وصلت ${esc(fmt.dateTime(m.ts))} (${esc(fmt.ago(m.age))}). القيم المعروضة قديمة وقد يكون الرافع مطفأً أو مفصولاً.</span></div>`;
  }
  if (state.netError && m) {
    return `<div class="banner warn">${icons.offline}<span><b>تعذّر الاتصال بالخادم</b>تُعرض آخر بيانات محفوظة على الهاتف (جُلبت ${esc(fmt.ago(Date.now() - state.fetchedAt))}).</span></div>`;
  }
  if (m && !m.ts) return `<div class="banner warn">${icons.info}<span>الجهاز لا يرسل وقت القراءة، لذا لا يمكن التأكد من أن البيانات حيّة.</span></div>`;
  return '';
}

const PAGE_TITLES = {
  load: 'الحمل', battery: 'البطارية', solar: 'الألواح الشمسية', grid: 'الكهرباء الوطنية', all: 'كل القراءات',
  day: 'التقرير اليومي', week: 'التقرير الأسبوعي', month: 'التقرير الشهري', compare: 'مقارنة الأداء', export: 'تصدير البيانات',
  log: 'سجل التنبيهات', faults: 'سجل الأعطال والانقطاعات', rules: 'شروط التنبيه',
  status: 'الحالة التشغيلية', info: 'معلومات الجهاز', rated: 'القيم المقنّنة', config: 'الإعدادات الحالية', edit: 'تعديل الإعدادات',
  theme: 'المظهر', batcfg: 'البطارية والحسابات', conn: 'الاتصال والتحديث', account: 'الجهاز والحساب', about: 'حول التطبيق',
};

function render() {
  charts.splice(0).forEach((c) => c.destroy());
  renderHeader();
  const v = $('#view');
  if (!v) return;
  const views = { home: viewHome, reports: viewReports, alerts: viewAlerts, inverter: viewInverter, more: viewMore };
  v.innerHTML = `<div class="${state.animate ? 'page-anim' : ''}">${views[state.tab]()}</div>`;
  state.animate = false;
  AFTER[state.page || state.tab]?.();
}
const AFTER = {};

// ================= جلب البيانات =================
function loadCache() {
  const c = store.get('last.' + sn(), null);
  if (c && !state.model) {
    state.model = normalize(c.points, state.prefs.staleMin);
    state.fetchedAt = c.at;
    state.fromCache = true;
  }
}

async function refresh(manual = false) {
  const d = device();
  if (!d || state.loading) return;
  state.loading = true;
  renderHeader();
  try {
    const points = state.demo ? demoPoints() : await api.lastData(d);
    if (!points.length) throw new ApiError('الجهاز لم يرسل أي بيانات بعد');
    state.model = normalize(points, state.prefs.staleMin);
    state.fetchedAt = Date.now();
    state.fromCache = false;
    state.netError = null;
    state.fails = 0;
    if (!state.demo) {
      store.set('last.' + d.sn, { points, at: state.fetchedAt });
      state.session = api.session;
      store.set('session', state.session);
      recordSample(d.sn, state.model);
    }
    checkAlerts(state.model);
    if (manual) toast(state.model.stale ? 'تم التحديث — الرافع ما زال غير متصل' : 'تم التحديث', state.model.stale ? 'bad' : 'ok');
  } catch (err) {
    state.fails++;
    state.netError = err.message;
    if (state.fails === 3) addFault('comm', 'تعذّر الاتصال بالخادم', err.message);
    if (manual) toast(err.message, 'bad');
  } finally {
    state.loading = false;
    if (state.model) state.model = { ...state.model, age: state.model.ts ? Date.now() - state.model.ts : null };
    // نعيد الرسم فقط للصفحات التي تعرض القراءة الحية حتى لا تُفقد حالة الصفحات الأخرى
    if (state.tab === 'home' || (state.tab === 'inverter' && ['status', 'info', 'rated', 'config', null].includes(state.page))) render();
    else renderHeader();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refresh(), Math.max(10, state.prefs.pollSec) * 1000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

// ================= التنبيهات والأعطال =================
async function notify(title, body) {
  if (!state.prefs.notify || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2e9), title, body }] });
  } catch { /* تجاهل */ }
}

function raise(title, body, kind = 'warn') {
  state.alerts.unshift({ title, body, kind, at: Date.now(), read: false });
  state.alerts = state.alerts.slice(0, 200);
  store.set('alerts', state.alerts);
  notify(title, body);
}

function addFault(kind, title, body) {
  state.faults.unshift({ kind, title, body, at: Date.now() });
  state.faults = state.faults.slice(0, 300);
  store.set('faults', state.faults);
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
  edge('offline', m.stale, () => {
    addFault('offline', 'انقطع اتصال الرافع', `آخر قراءة ${fmt.dateTime(m.ts)}`);
    if (p.alertOffline) raise('الرافع غير متصل', `لم تصل قراءات جديدة منذ ${fmt.ago(m.age).replace('قبل ', '')}. قد يكون الرافع مطفأً أو مفصولاً.`, 'bad');
  }, () => {
    addFault('online', 'عاد اتصال الرافع', `قراءة جديدة ${fmt.dateTime(m.ts)}`);
    if (p.alertOffline) raise('عاد اتصال الرافع', 'وصلت قراءات جديدة من الجهاز', 'ok');
  });
  if (m.stale) return; // لا نبني تنبيهات على قيم قديمة

  const fault = m.fault || (/fault/i.test(m.mode || '') ? trValue(m.mode) : null);
  if (fault !== (state.flags.faultCode || null)) {
    if (fault) {
      addFault('fault', 'عطل في الإنفرتر', `الرمز/الحالة: ${fault}`);
      raise('عطل في الإنفرتر', `أبلغ الجهاز عن عطل: ${fault}`, 'bad');
    } else if (state.flags.faultCode) addFault('online', 'زال العطل', `العطل السابق: ${state.flags.faultCode}`);
    state.flags.faultCode = fault;
  }
  if (m.warning && m.warning !== state.flags.warnCode) addFault('warn', 'تحذير من الإنفرتر', `الرمز: ${m.warning}`);
  state.flags.warnCode = m.warning;

  if (m.soc !== null) {
    edge('lowSoc', m.soc <= p.lowSoc && (m.batW ?? 0) <= 0,
      () => raise('البطارية منخفضة', `نسبة الشحن ${m.soc}% — يُنصح بتقليل الأحمال.${eta(m).known ? ' ' + eta(m).text : ''}`, 'bad'));
    if (p.alertFull) edge('full', m.soc >= 100, () => raise('البطارية ممتلئة', 'وصل الشحن إلى 100% — وقت مناسب لتشغيل الأحمال الكبيرة', 'ok'));
  }
  if (m.loadPct !== null) {
    edge('overload', m.loadPct >= p.overloadPct, () => {
      raise('حمل زائد', `الحمل وصل إلى ${m.loadPct}% (${fmt.w(m.outW)})`, 'bad');
      addFault('warn', 'حمل زائد', `${m.loadPct}% (${fmt.w(m.outW)})`);
    });
  }
  if (p.alertGrid && m.gridV !== null) {
    edge('gridOff', !m.gridOn, () => {
      raise('انقطعت الكهرباء الوطنية', `المنظومة تعمل على البطارية${m.soc !== null ? ` (${m.soc}%)` : ''}`, 'warn');
      addFault('grid', 'انقطاع الكهرباء الوطنية', `جهد الشبكة ${numAr(m.gridV)} فولت`);
    }, () => {
      raise('عادت الكهرباء الوطنية', `الجهد ${numAr(m.gridV)} فولت`, 'ok');
      addFault('online', 'عودة الكهرباء الوطنية', `جهد الشبكة ${numAr(m.gridV)} فولت`);
    });
  }
  store.set('flags', state.flags);
}

// ================= حسابات البطارية =================
function eta(m) {
  const p = state.prefs;
  if (!p.batteryAh) return { known: false, text: 'أدخل سعة البطارية لحساب المدة', sub: '' };
  if (m.stale || m.soc === null || m.batW === null) return { known: false, text: 'غير متاح حالياً', sub: '' };
  const nominal = m.ratedV || 48;
  const wh = p.batteryAh * nominal;
  if (m.batW < -10) {
    const usable = Math.max(0, (m.soc - p.cutoffSoc) / 100) * wh;
    return { known: true, text: 'تكفي لمدة ' + fmt.hours(usable / -m.batW), sub: `حتى ${p.cutoffSoc}% بمعدل السحب الحالي` };
  }
  if (m.batW > 10) {
    return { known: true, text: 'يكتمل الشحن خلال ' + fmt.hours((Math.max(0, 100 - m.soc) / 100) * wh / m.batW), sub: 'بمعدل الشحن الحالي' };
  }
  return { known: true, text: m.soc >= 99 ? 'البطارية ممتلئة' : 'البطارية مستقرة', sub: '' };
}

const batState = (m) => (m.stale ? 'لا توجد قراءة حيّة' : m.batW > 10 ? `تشحن بقدرة ${fmt.w(m.batW)}` : m.batW < -10 ? `تُفرّغ بقدرة ${fmt.w(-m.batW)}` : 'في وضع الراحة');

// ================= الرئيسية =================
function viewHome() {
  const m = state.model;
  if (!m) return `<div class="empty"><div class="spinner"></div>جارٍ جلب بيانات الرافع…${state.netError ? `<div class="err" style="margin-top:12px">${esc(state.netError)}</div>` : ''}</div>`;
  const pages = { load: pageLoad, battery: pageBattery, solar: pageSolar, grid: pageGrid, all: pageAll };
  if (state.page && pages[state.page]) return banner() + pages[state.page](m);

  const isBat = /battery/i.test(m.mode || '') || (m.batW ?? 0) < -10;
  const isLine = /line|bypass/i.test(m.mode || '');
  const live = !m.stale;
  const flow = (on, w) => (live && on ? `on" style="animation-duration:${Math.max(0.35, 2.4 - Math.log10(Math.abs(w || 50) + 1) * 0.55)}s` : '');
  const modeText = m.stale ? 'غير متصل' : m.mode ? trValue(m.mode) : isLine ? 'وضع الكهرباء الوطنية' : isBat ? 'وضع البطارية' : '—';
  const modeCls = m.stale ? 'm-off' : /fault/i.test(m.mode || '') ? 'm-fault' : isBat ? 'm-bat' : isLine ? 'm-line' : '';
  const soc = Math.max(0, Math.min(100, m.soc ?? 0));
  const C = 2 * Math.PI * 52;
  const e = eta(m);

  return `
  ${banner()}
  <div class="mode-pill ${modeCls}">${esc(modeText)}</div>
  <section class="card flow-card ${live ? '' : 'stale'}">
    <svg viewBox="0 0 360 380" class="flow-svg">
      <circle cx="180" cy="190" r="85" class="glow"/>
      <path class="wire" d="M180 124 L180 154"/><path class="flow f-solar ${flow((m.pvW ?? 0) > 5, m.pvW)}" d="M180 124 L180 154"/>
      <path class="wire" d="M78 190 L144 190"/><path class="flow f-grid ${flow(isLine && m.gridOn, 300)}" d="M78 190 L144 190"/>
      <path class="wire" d="M216 190 L282 190"/><path class="flow f-load ${flow((m.outW ?? 0) > 5, m.outW)}" d="M216 190 L282 190"/>
      <path class="wire" d="M180 226 L180 264"/><path class="flow f-bat ${flow(Math.abs(m.batW ?? 0) > 10, m.batW)} ${(m.batW ?? 0) < 0 ? 'rev' : ''}" d="M180 226 L180 264"/>
    </svg>
    <div class="node n-solar ${(m.pvW ?? 0) > 5 && live ? '' : 'dim'}"><b><bdi>${fmt.wShort(m.pvW)}</bdi></b><small>الألواح</small><div class="ic">${icons.panel}</div></div>
    <div class="node n-grid ${m.gridOn && live ? '' : 'dim'}"><div class="ic">${icons.grid}</div><b><bdi>${m.gridOn ? numAr(m.gridV) + 'V' : 'مقطوعة'}</bdi></b><small>الوطنية</small></div>
    <div class="node n-load ${(m.outW ?? 0) > 5 && live ? '' : 'dim'}"><div class="ic">${icons.home}</div><b><bdi>${fmt.wShort(m.outW)}</bdi></b><small>الحمل</small></div>
    <div class="node n-bat ${live ? '' : 'dim'}"><div class="ic">${icons.battery}</div><b><bdi>${m.soc ?? '—'}%</bdi></b><small>البطارية</small></div>
    <div class="node n-inv"><div class="ic">${icons.inverter}</div></div>
  </section>

  <section class="card battery-card ${live ? '' : 'stale'}">
    <div class="ring">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/>
        <circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:${(soc / 100) * C} ${C};stroke:${soc < 25 ? 'var(--bad)' : soc < 50 ? 'var(--warn)' : 'var(--bat)'}"/></svg>
      <div class="ring-txt"><b>${m.soc ?? '—'}%</b><small>الشحن</small></div>
    </div>
    <div class="bat-info">
      <div class="bat-state ${live && m.batW > 10 ? 'chg' : live && m.batW < -10 ? 'dis' : ''}">${esc(batState(m))}</div>
      <div class="bat-eta">${e.known ? esc(e.text) : `<button class="link" data-goto="more:batcfg">${esc(e.text)}</button>`}</div>
      <div class="bat-sub"><bdi>${fmt.v(m.batV)}</bdi>${e.sub ? ' · ' + esc(e.sub) : ''}</div>
    </div>
  </section>

  <h3 class="sec-h">التفاصيل</h3>
  ${gridCards([
    { page: 'load', title: 'الحمل', icon: icons.home, color: 'c-sky', value: fmt.w(m.outW), sub: m.loadPct !== null ? `${m.loadPct}% من قدرة الرافع` : 'استهلاك المنزل' },
    { page: 'battery', title: 'البطارية', icon: icons.battery, color: 'c-green', value: m.soc !== null ? m.soc + '%' : '—', sub: batState(m) },
    { page: 'solar', title: 'الألواح الشمسية', icon: icons.panel, color: 'c-amber', value: fmt.w(m.pvW), sub: m.todayWh !== null ? `إنتاج اليوم ${fmt.kwh(m.todayWh / 1000)} ك.و.س` : 'الإنتاج الحالي' },
    { page: 'grid', title: 'الكهرباء الوطنية', icon: icons.grid, color: 'c-violet', value: m.gridV === null ? '—' : m.gridOn ? `${numAr(m.gridV, 1)} فولت` : 'مقطوعة', sub: m.gridOn ? (isLine ? 'تغذّي الحمل الآن' : 'متوفرة كاحتياط') : 'لا يوجد تيار' },
  ].map((c) => (live ? c : { ...c, sub: 'آخر قيمة مسجّلة' })), live ? '' : 'stale')}
  ${listCards([{ page: 'all', title: 'كل القراءات', sub: `${m.raw.filter((r) => r.group === 'live').length} قراءة حيّة مترجمة`, icon: icons.list, color: 'c-slate' }])}`;
}
AFTER.home = () => bindGoto();

function bindGoto() {
  document.querySelectorAll('[data-goto]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); const [t, p] = b.dataset.goto.split(':'); navigate(t, p || null); };
  });
}

function hero(icon, color, label, value, sub) {
  return `<section class="hero ${color}"><span class="g-deco">${icon}</span><div class="h-ic">${icon}</div>
    <small>${esc(label)}</small><b><bdi>${esc(value)}</bdi></b>${sub ? `<span>${esc(sub)}</span>` : ''}</section>`;
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
  lineChart(id, s.map((x) => fmt.time(x.ts)), [{ label, data: s.map((x) => x[field]), color }], opts);
}

function pageLoad(m) {
  const pf = m.outW !== null && m.outVA ? (m.outW / m.outVA).toFixed(2) : null;
  const rated = m.ratedW;
  const pct = Math.max(0, Math.min(100, m.loadPct ?? 0));
  return `
  ${hero(icons.home, 'c-sky', 'الحمل الحالي', fmt.w(m.outW), m.stale ? 'آخر قيمة مسجّلة' : trValue(m.loadStatus || ''))}
  <section class="card">
    <div class="card-h"><h2>نسبة الحمل من قدرة الرافع</h2><b>${m.loadPct ?? '—'}%</b></div>
    <div class="bar"><i class="${pct >= state.prefs.overloadPct ? 'hot' : pct >= 50 ? 'warm' : ''}" style="width:${pct}%"></i></div>
    <div class="bar-legend"><span>0</span><span>${rated ? `القدرة القصوى ${rated} واط` : ''}</span></div>
    ${rated && m.outW !== null ? `<p class="hint">المتبقي المتاح للتشغيل: <b>${fmt.w(Math.max(0, rated - m.outW))}</b></p>` : ''}
  </section>
  <div class="stats">
    ${stat('القدرة الفعلية', numAr(m.outW), 'واط', 'c-sky')}
    ${stat('القدرة الظاهرية', numAr(m.outVA), 'فولت أمبير', 'c-violet')}
    ${stat('جهد الخرج', numAr(m.outV, 1), 'فولت', 'c-green')}
    ${stat('تردد الخرج', numAr(m.outHz, 1), 'هرتز', 'c-amber')}
    ${pf ? stat('معامل القدرة', pf, 'محسوب', 'c-pink') : ''}
    ${stat('حالة الحمل', m.loadStatus ? trValue(m.loadStatus) : '—', '', 'c-slate')}
  </div>
  ${miniChart('cLoadToday', 'الحمل خلال اليوم')}`;
}
AFTER.load = () => drawToday('cLoadToday', 'outW', '#38bdf8', 'واط', { y: { beginAtZero: true } });

function pageBattery(m) {
  const e = eta(m);
  const cfg = m.raw.filter((r) => /battery/i.test(r.title) && r.group === 'config');
  return `
  ${hero(icons.battery, 'c-green', 'نسبة الشحن', m.soc !== null ? m.soc + '%' : '—', batState(m))}
  <section class="card">
    <div class="card-h"><h2>المدة المتوقعة</h2></div>
    <div class="big-line">${e.known ? esc(e.text) : `<button class="link" data-goto="more:batcfg">${esc(e.text)}</button>`}</div>
    ${e.sub ? `<p class="hint">${esc(e.sub)}</p>` : ''}
    ${state.prefs.batteryAh ? `<p class="hint">مبنية على سعة ${state.prefs.batteryAh} أمبير ساعة وجهد ${m.ratedV || 48} فولت. التقدير تقريبي ويتغير مع الحمل.</p>` : ''}
  </section>
  <div class="stats">
    ${stat('الجهد', numAr(m.batV, 1), 'فولت', 'c-green')}
    ${stat('القدرة', m.batW === null ? '—' : numAr(Math.abs(m.batW)), m.batW > 0 ? 'واط شحن' : m.batW < 0 ? 'واط تفريغ' : 'واط', 'c-amber')}
    ${stat('تيار الشحن', numAr(m.chgA), 'أمبير', 'c-sky')}
    ${stat('تيار التفريغ', numAr(m.disA), 'أمبير', 'c-pink')}
  </div>
  ${cfg.length ? `<section class="card"><div class="card-h"><h2>إعدادات البطارية في الرافع</h2></div>${kv(cfg.map((r) => [r.ar, val(r.valAr, trUnit(r.unit))]))}</section>` : ''}
  ${miniChart('cSocToday', 'نسبة الشحن خلال اليوم')}`;
}
AFTER.battery = () => { bindGoto(); drawToday('cSocToday', 'soc', '#34d399', '%', { y: { min: 0, max: 100 } }); };

function pageSolar(m) {
  const pv2 = m.pv2V !== null || m.pv2W !== null;
  return `
  ${hero(icons.panel, 'c-amber', 'إنتاج الألواح الآن', fmt.w(m.pvW), m.pvW > 5 && !m.stale ? 'تشحن وتغذّي الحمل' : 'لا يوجد إنتاج حالياً')}
  <div class="stats">
    ${stat('إنتاج اليوم', m.todayWh !== null ? fmt.kwh(m.todayWh / 1000) : '—', 'كيلوواط ساعة', 'c-amber')}
    ${stat('الإنتاج الكلي', m.totalWh !== null ? fmt.kwh(m.totalWh / 1000) : '—', 'كيلوواط ساعة', 'c-green')}
  </div>
  <section class="card"><div class="card-h"><h2>المدخل الأول (PV1)</h2></div>
    ${kv([['الجهد', val(numAr(m.pv1V, 1), 'فولت')], ['التيار', val(m.pv1A === null ? null : numAr(m.pv1A, 1), 'أمبير')], ['القدرة', val(m.pv1W === null ? null : numAr(m.pv1W), 'واط')]])}
  </section>
  ${pv2 ? `<section class="card"><div class="card-h"><h2>المدخل الثاني (PV2)</h2></div>
    ${kv([['الجهد', val(m.pv2V === null ? null : numAr(m.pv2V, 1), 'فولت')], ['التيار', val(m.pv2A === null ? null : numAr(m.pv2A, 1), 'أمبير')], ['القدرة', val(m.pv2W === null ? null : numAr(m.pv2W), 'واط')]])}
  </section>` : ''}
  ${m.feedW !== null ? `<section class="card">${kv([['القدرة المُصدَّرة للشبكة', val(numAr(m.feedW), 'واط')]])}</section>` : ''}
  ${miniChart('cPvToday', 'إنتاج الألواح خلال اليوم')}`;
}
AFTER.solar = () => drawToday('cPvToday', 'pvW', '#fbbf24', 'واط', { y: { beginAtZero: true } });

function pageGrid(m) {
  const cfg = m.raw.filter((r) => /input range|charger source/i.test(r.title));
  const sum = summarize(today(), state.demo ? rowsToSamples(demoHistory(today())) : localDay(sn(), today()), 'local');
  return `
  ${hero(icons.grid, 'c-violet', 'حالة الكهرباء الوطنية', m.gridV === null ? '—' : m.gridOn ? 'متوفرة' : 'مقطوعة', m.gridOn ? `${numAr(m.gridV, 1)} فولت · ${numAr(m.gridHz, 1)} هرتز` : '')}
  <div class="stats">
    ${stat('الجهد', numAr(m.gridV, 1), 'فولت', 'c-violet')}
    ${stat('التردد', numAr(m.gridHz, 1), 'هرتز', 'c-sky')}
    ${sum.coveredH > 0.5 ? stat('ساعات توفرها اليوم', numAr(sum.gridH, 1), `من ${numAr(sum.coveredH, 1)} ساعة مسجّلة`, 'c-green') : ''}
  </div>
  ${cfg.length ? `<section class="card">${kv(cfg.map((r) => [r.ar, val(r.valAr, trUnit(r.unit))]))}</section>` : ''}
  ${miniChart('cGridToday', 'جهد الكهرباء الوطنية خلال اليوم')}`;
}
AFTER.grid = () => drawToday('cGridToday', 'gridV', '#a78bfa', 'فولت', { y: { beginAtZero: true } });

function pageAll(m) {
  const live = m.raw.filter((r) => r.group === 'live');
  return `<section class="card"><div class="card-h"><h2>القراءات الحيّة</h2><small class="muted">${m.ts ? esc(fmt.dateTime(m.ts)) : ''}</small></div>
    ${kv(live.map((r) => [r.ar, isEmptyVal(r.val) ? val(null) : val(r.valAr, trUnit(r.unit))]))}</section>
    <p class="hint center">المعلومات المقنّنة والإعدادات ومعلومات الجهاز موجودة في تبويب «الرافع».</p>`;
}

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
        label: d.label, data: d.data, borderColor: d.color, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true, spanGaps: true,
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
    options: chartOpts(series.length > 1, opts),
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
      tooltip: { rtl: true, backgroundColor: '#0f1a33ee', titleColor: '#fff', bodyColor: '#e2e8f0', padding: 10 },
    },
    scales: {
      x: { ticks: { maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } },
      y: { grid: { color: css('--line') }, ...opts.y },
    },
  };
}

// ================= التقارير =================
function viewReports() {
  const pages = { day: pageDay, week: () => pageRange('week'), month: () => pageRange('month'), compare: pageCompare, export: pageExport };
  if (state.page && pages[state.page]) return pages[state.page]();
  return `
  <section class="intro"><h2>التقارير والتحليلات</h2><p>إنتاج الألواح واستهلاك المنزل وحالة البطارية عبر الأيام.</p></section>
  ${listCards([
    { page: 'day', title: 'التقرير اليومي', sub: 'رسوم القدرة والبطارية والكهرباء ليوم محدد', icon: icons.calendar, color: 'c-amber' },
    { page: 'week', title: 'التقرير الأسبوعي', sub: 'الإنتاج والاستهلاك لكل يوم خلال أسبوع', icon: icons.week, color: 'c-sky' },
    { page: 'month', title: 'التقرير الشهري', sub: 'مجموع الشهر وأفضل يوم ومتوسط الإنتاج', icon: icons.month, color: 'c-green' },
    { page: 'compare', title: 'مقارنة الأداء', sub: 'هذا الأسبوع أو الشهر مقابل السابق', icon: icons.compare, color: 'c-violet' },
    { page: 'export', title: 'تصدير البيانات', sub: 'ملفات CSV تفتح في Excel ويمكن مشاركتها', icon: icons.download, color: 'c-pink' },
  ])}
  <p class="hint center">تُجلب البيانات من سجل خادم WatchPower، وعند تعذّره تُستخدم القراءات التي حفظها التطبيق على هاتفك.</p>`;
}

// جلب قراءات يوم: من سجل الخادم أولاً، ثم من القراءات المحفوظة محلياً
let serverHistFails = 0;
async function daySamples(date) {
  if (state.demo) return { samples: rowsToSamples(demoHistory(date)), source: 'demo' };
  let err;
  if (serverHistFails < 3) {
    try {
      const s = rowsToSamples(await api.dayHistory(device(), date));
      serverHistFails = 0;
      if (s.length) return { samples: s, source: 'server' };
    } catch (e) {
      err = e;
      serverHistFails++;
    }
  }
  const local = localDay(sn(), date);
  if (local.length) return { samples: local, source: 'local' };
  if (err && err.code === undefined) throw err;
  return { samples: [], source: 'none' };
}

const SRC = { server: 'سجل خادم WatchPower', local: 'قراءات محفوظة على الهاتف', demo: 'بيانات تجريبية', none: 'لا توجد بيانات' };
const dayName = (date) => new Date(date + 'T12:00:00').toLocaleDateString('ar', { weekday: 'short', day: 'numeric', month: 'numeric' });
const dateLabel = (date) => (date === today() ? 'اليوم' : date === today(-1) ? 'أمس' : new Date(date + 'T12:00:00').toLocaleDateString('ar', { weekday: 'long', day: 'numeric', month: 'long' }));

async function loadDay() {
  const date = state.rep.dayDate;
  state.rep.day = { loading: true };
  render();
  try {
    const { samples, source } = await daySamples(date);
    const sum = summarize(date, samples, source);
    cacheSummary(sn(), sum);
    if (date === state.rep.dayDate) state.rep.day = { samples, sum, source };
  } catch (e) {
    state.rep.day = { error: e.message };
  }
  if (state.page === 'day') render();
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
  return nav + `
  <div class="stats">
    ${stat('إنتاج الألواح', fmt.kwh(s.pvKwh), 'كيلوواط ساعة', 'c-amber')}
    ${stat('استهلاك المنزل', fmt.kwh(s.loadKwh), 'كيلوواط ساعة', 'c-sky')}
    ${stat('البطارية أدنى / أعلى', s.socMin === null ? '—' : `${s.socMin}% / ${s.socMax}%`, 'نسبة الشحن', 'c-green')}
    ${stat('ذروة الحمل', fmt.w(s.peakW), '', 'c-pink')}
    ${stat('توفر الكهرباء', numAr(s.gridH, 1), 'ساعة', 'c-violet')}
    ${stat('العمل على البطارية', numAr(s.batH, 1), 'ساعة', 'c-slate')}
  </div>
  <p class="hint">المصدر: ${SRC[r.source]} · ${r.samples.length} قراءة · ساعات مغطّاة ${numAr(s.coveredH, 1)}${s.pvFromMeter ? ' · الإنتاج من عدّاد الجهاز' : ' · الإنتاج محسوب من القدرة'}</p>
  <section class="card"><div class="card-h"><h2>القدرة خلال اليوم</h2></div><div class="chart-box"><canvas id="cPower"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>نسبة شحن البطارية</h2></div><div class="chart-box sm"><canvas id="cSoc"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد البطارية</h2></div><div class="chart-box sm"><canvas id="cBatV"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد الكهرباء الوطنية</h2></div><div class="chart-box sm"><canvas id="cGrid"></canvas></div></section>
  <button class="btn ghost wide" id="expDay">${icons.download} تصدير قراءات هذا اليوم</button>`;
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
  const t = r.samples.map((x) => fmt.time(x.ts));
  lineChart('cPower', t, [
    { label: 'الألواح (واط)', data: r.samples.map((x) => x.pvW), color: '#f59e0b' },
    { label: 'الحمل (واط)', data: r.samples.map((x) => x.outW), color: '#0ea5e9' },
  ], { y: { beginAtZero: true } });
  lineChart('cSoc', t, [{ label: '%', data: r.samples.map((x) => x.soc), color: '#10b981' }], { y: { min: 0, max: 100 } });
  lineChart('cBatV', t, [{ label: 'فولت', data: r.samples.map((x) => x.batV), color: '#8b5cf6' }]);
  lineChart('cGrid', t, [{ label: 'فولت', data: r.samples.map((x) => x.gridV), color: '#ec4899' }], { y: { beginAtZero: true } });
  $('#expDay').onclick = () => exportSamples(state.rep.dayDate, r.samples);
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
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i];
    let s = d < today() ? cachedSummary(sn(), d) : null;
    if (!s) {
      try {
        const { samples, source } = await daySamples(d);
        s = summarize(d, samples, source);
        cacheSummary(sn(), s);
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
  const best = ok.reduce((b, s) => (s.pvKwh != null && (!b || s.pvKwh > b.pvKwh) ? s : b), null);
  return { days: ok.length, pv, load, avgPv: ok.length ? pv / ok.length : null, avgLoad: ok.length ? load / ok.length : null, gridH: add('gridH'), batH: add('batH'), best };
}

async function loadRange(kind) {
  const off = kind === 'week' ? state.rep.weekOff : state.rep.monthOff;
  const dates = rangeDates(kind, off);
  const token = Symbol(kind);
  state.rep[kind] = { loading: true, done: 0, total: dates.length, token };
  render();
  const sums = await loadSummaries(dates, (done, total) => {
    const p = $('#rangeProg');
    if (p && state.rep[kind]?.token === token) { p.style.width = (done / total) * 100 + '%'; $('#rangeTxt').textContent = `${done} من ${total} يوم`; }
  });
  if (state.rep[kind]?.token !== token) return;
  state.rep[kind] = { dates, sums };
  if (state.page === kind) render();
}

function rangeTitle(kind, off) {
  const dates = rangeDates(kind, off);
  if (kind === 'month') return new Date(dates[0] + 'T12:00:00').toLocaleDateString('ar', { month: 'long', year: 'numeric' });
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
  return nav + `
  <div class="stats">
    ${stat('إجمالي الإنتاج', fmt.kwh(t.pv), 'كيلوواط ساعة', 'c-amber')}
    ${stat('إجمالي الاستهلاك', fmt.kwh(t.load), 'كيلوواط ساعة', 'c-sky')}
    ${stat('متوسط الإنتاج اليومي', fmt.kwh(t.avgPv), 'ك.و.س / يوم', 'c-green')}
    ${stat('أفضل يوم إنتاج', t.best ? dayName(t.best.date) : '—', t.best ? `${fmt.kwh(t.best.pvKwh)} ك.و.س` : '', 'c-violet')}
    ${stat('توفر الكهرباء', numAr(t.gridH, 0), 'ساعة', 'c-pink')}
    ${stat('العمل على البطارية', numAr(t.batH, 0), 'ساعة', 'c-slate')}
  </div>
  <p class="hint">أيام فيها بيانات: ${t.days} من ${r.sums.length} · المصدر: ${esc(srcs)}</p>
  <section class="card"><div class="card-h"><h2>الإنتاج والاستهلاك اليومي</h2><small class="muted">كيلوواط ساعة</small></div><div class="chart-box"><canvas id="cRange"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>تفاصيل الأيام</h2></div>
    <div class="table"><div class="tr th"><span>اليوم</span><span>الإنتاج</span><span>الاستهلاك</span><span>البطارية</span></div>
    ${r.sums.slice().reverse().map((s) => `<button class="tr" data-dayopen="${s.date}"><span>${esc(dayName(s.date))}</span><span>${s.count > 1 ? fmt.kwh(s.pvKwh) : '—'}</span><span>${s.count > 1 ? fmt.kwh(s.loadKwh) : '—'}</span><span>${s.socMin != null ? `${s.socMin}–${s.socMax}%` : '—'}</span></button>`).join('')}
    </div></section>
  <button class="btn ghost wide" id="expRange">${icons.download} تصدير ملخص الفترة</button>`;
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
}
AFTER.week = () => bindRange('week');
AFTER.month = () => bindRange('month');

async function loadCompare() {
  const kind = state.rep.cmp;
  state.rep.cmpData = { loading: true };
  render();
  const cur = await loadSummaries(rangeDates(kind, 0));
  let prevDates = rangeDates(kind, 1);
  // نقارن الشهر الحالي بنفس عدد الأيام من الشهر السابق حتى تكون المقارنة عادلة
  if (kind === 'month') prevDates = prevDates.slice(0, cur.length);
  const prev = await loadSummaries(prevDates);
  state.rep.cmpData = { kind, cur: totals(cur), prev: totals(prev), curN: cur.length };
  if (state.page === 'compare') render();
}

function pageCompare() {
  const k = state.rep.cmp;
  const r = state.rep.cmpData;
  const seg = `<div class="seg"><button data-cmp="week" class="${k === 'week' ? 'on' : ''}">أسبوعي</button><button data-cmp="month" class="${k === 'month' ? 'on' : ''}">شهري</button></div>`;
  if (!r || r.loading || r.kind !== k) return seg + '<div class="empty"><div class="spinner"></div>جارٍ تجميع البيانات للمقارنة…</div>';
  const [a, b] = k === 'week' ? ['آخر 7 أيام', 'الأسبوع الذي قبله'] : ['هذا الشهر', `نفس الفترة من الشهر السابق`];
  const row = (label, x, y, unit, better = 'up') => {
    const ch = x != null && y ? ((x - y) / y) * 100 : null;
    const good = ch === null || Math.abs(ch) < 1 ? '' : (ch > 0) === (better === 'up') ? 'good' : 'bad';
    return `<div class="cmp-row"><div class="cmp-l">${esc(label)}</div>
      <div class="cmp-v"><b>${x == null ? '—' : fmt.kwh(x)}</b><small>${esc(unit)}</small></div>
      <div class="cmp-v prev"><b>${y == null ? '—' : fmt.kwh(y)}</b><small>${esc(unit)}</small></div>
      <div class="cmp-ch ${good}">${ch === null ? '—' : (Math.abs(ch) < 1 ? '' : ch > 0 ? '▲ ' : '▼ ') + Math.abs(ch).toFixed(0) + '%'}</div></div>`;
  };
  return seg + `
  <section class="card">
    <div class="cmp-row head"><div></div><div>${esc(a)}</div><div>${esc(b)}</div><div>التغيّر</div></div>
    ${row('الإنتاج', r.cur.pv, r.prev.pv, 'ك.و.س')}
    ${row('الاستهلاك', r.cur.load, r.prev.load, 'ك.و.س', 'down')}
    ${row('متوسط الإنتاج', r.cur.avgPv, r.prev.avgPv, 'ك.و.س/يوم')}
    ${row('توفر الكهرباء', r.cur.gridH, r.prev.gridH, 'ساعة')}
    ${row('العمل على البطارية', r.cur.batH, r.prev.batH, 'ساعة', 'down')}
  </section>
  <section class="card"><div class="card-h"><h2>مقارنة بيانية</h2></div><div class="chart-box sm"><canvas id="cCmp"></canvas></div></section>
  <p class="hint">أيام فيها بيانات: ${r.cur.days} مقابل ${r.prev.days}. إذا كانت أيام إحدى الفترتين أقل، فالمقارنة تقريبية.</p>`;
}
AFTER.compare = () => {
  document.querySelectorAll('[data-cmp]').forEach((b) => { b.onclick = () => { state.rep.cmp = b.dataset.cmp; loadCompare(); }; });
  const r = state.rep.cmpData;
  if (!r || r.kind !== state.rep.cmp) { if (!r?.loading) loadCompare(); return; }
  if (r.loading) return;
  barChart('cCmp', ['الإنتاج', 'الاستهلاك'], [
    { label: 'الحالية', data: [r.cur.pv, r.cur.load].map((x) => +x.toFixed(2)), color: '#6366f1' },
    { label: 'السابقة', data: [r.prev.pv, r.prev.load].map((x) => +x.toFixed(2)), color: '#94a3b8' },
  ], { y: { beginAtZero: true } });
};

function pageExport() {
  return `
  <section class="intro"><p>تُصدَّر الملفات بصيغة CSV (تفتح في Excel وGoogle Sheets) ويمكنك مشاركتها عبر واتساب أو البريد.</p></section>
  ${listCards([
    { page: 'x-today', title: 'قراءات اليوم', sub: 'كل القراءات المسجّلة اليوم', icon: icons.calendar, color: 'c-amber' },
    { page: 'x-month', title: 'ملخص آخر 30 يوماً', sub: 'الإنتاج والاستهلاك والبطارية لكل يوم', icon: icons.month, color: 'c-green' },
    { page: 'x-alerts', title: 'سجل التنبيهات', sub: `${state.alerts.length} تنبيه`, icon: icons.bell, color: 'c-sky' },
    { page: 'x-faults', title: 'سجل الأعطال والانقطاعات', sub: `${state.faults.length} حدث`, icon: icons.warn, color: 'c-pink' },
  ])}`;
}
AFTER.export = () => {
  // نعترض النقر هنا لأن هذه البطاقات تنفّذ إجراءً بدل فتح صفحة
  document.querySelectorAll('[data-page^="x-"]').forEach((b) => {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const what = b.dataset.page;
      b.classList.add('busy');
      try {
        if (what === 'x-today') { const { samples } = await daySamples(today()); await exportSamples(today(), samples); }
        if (what === 'x-month') { const dates = Array.from({ length: 30 }, (_, i) => today(i - 29)); await exportSummaries('30days-' + today(), await loadSummaries(dates)); }
        if (what === 'x-alerts') await shareFile(`taqati-alerts-${today()}.csv`, toCsv(['الوقت', 'التنبيه', 'التفاصيل'], state.alerts.map((a) => [fmt.dateTime(a.at), a.title, a.body])));
        if (what === 'x-faults') await shareFile(`taqati-faults-${today()}.csv`, toCsv(['الوقت', 'الحدث', 'التفاصيل'], state.faults.map((a) => [fmt.dateTime(a.at), a.title, a.body])));
      } catch (err) {
        toast('تعذّر التصدير: ' + err.message, 'bad');
      }
      b.classList.remove('busy');
    }, true);
  });
};

async function exportSamples(date, samples) {
  if (!samples.length) { toast('لا توجد قراءات لهذا اليوم', 'bad'); return; }
  await shareFile(`taqati-${date}.csv`, toCsv(
    ['الوقت', 'الوضع', 'الألواح (واط)', 'الحمل (واط)', 'البطارية (%)', 'جهد البطارية (فولت)', 'قدرة البطارية (واط)', 'جهد الكهرباء (فولت)'],
    samples.map((s) => [new Date(s.ts).toLocaleString('ar'), s.mode ? trValue(s.mode) : '', s.pvW, s.outW, s.soc, s.batV, s.batW, s.gridV]),
  ));
}

async function exportSummaries(name, sums) {
  await shareFile(`taqati-${name}.csv`, toCsv(
    ['التاريخ', 'الإنتاج (ك.و.س)', 'الاستهلاك (ك.و.س)', 'أدنى شحن %', 'أعلى شحن %', 'ذروة الحمل (واط)', 'ساعات الكهرباء', 'ساعات البطارية', 'عدد القراءات', 'المصدر'],
    sums.map((s) => [s.date, s.pvKwh?.toFixed(2) ?? '', s.loadKwh?.toFixed(2) ?? '', s.socMin ?? '', s.socMax ?? '', s.peakW ?? '', s.gridH?.toFixed(1) ?? '', s.batH?.toFixed(1) ?? '', s.count, SRC[s.source] || '']),
  ));
}

// ================= تبويب التنبيهات =================
function viewAlerts() {
  const pages = { log: pageLog, faults: pageFaults, rules: pageRules };
  if (state.page && pages[state.page]) return pages[state.page]();
  const unread = state.alerts.filter((a) => !a.read).length;
  const last = state.alerts[0];
  return `
  <section class="intro"><h2>التنبيهات</h2><p>يراقب التطبيق الرافع ويخبرك فور حدوث أي تغيير مهم.</p></section>
  ${gridCards([
    { page: 'log', title: 'سجل التنبيهات', icon: icons.bell, color: 'c-sky', value: String(state.alerts.length), sub: last ? `آخرها: ${last.title}` : 'لا توجد تنبيهات بعد', badge: unread ? `${unread} جديد` : '' },
    { page: 'faults', title: 'الأعطال والانقطاعات', icon: icons.warn, color: 'c-pink', value: String(state.faults.length), sub: state.faults[0] ? state.faults[0].title : 'لم تُسجّل أحداث' },
    { page: 'rules', title: 'شروط التنبيه', icon: icons.sliders, color: 'c-violet', value: '', sub: `البطارية ${state.prefs.lowSoc}% · الحمل ${state.prefs.overloadPct}%` },
  ])}`;
}

const KIND_IC = { bad: icons.warn, warn: icons.warn, ok: icons.check, info: icons.info, fault: icons.warn, offline: icons.offline, online: icons.check, grid: icons.grid, comm: icons.offline };
const KIND_CLS = { fault: 'bad', offline: 'bad', comm: 'warn', grid: 'warn', online: 'ok', warn: 'warn' };

function eventList(list, empty) {
  if (!list.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<ul class="alerts">${list.map((a) => `
    <li class="alert ${KIND_CLS[a.kind] || a.kind} ${a.read === false ? 'new' : ''}">
      <div class="a-ic">${KIND_IC[a.kind] || icons.info}</div>
      <div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><time>${esc(fmt.dateTime(a.at))}</time></div>
    </li>`).join('')}</ul>`;
}

function pageLog() {
  const html = `<div class="row-end">${state.alerts.length ? '<button class="link" id="clearList">مسح السجل</button>' : ''}</div>${eventList(state.alerts, 'لا توجد تنبيهات بعد. ستظهر هنا عند انقطاع الكهرباء أو انخفاض البطارية أو انقطاع الرافع.')}`;
  state.alerts.forEach((a) => { a.read = true; });
  store.set('alerts', state.alerts);
  return html;
}
AFTER.log = () => {
  const c = $('#clearList');
  if (c) c.onclick = async () => { if (await confirmDialog('مسح السجل', 'هل تريد حذف كل التنبيهات؟')) { state.alerts = []; store.set('alerts', []); render(); } };
};

function pageFaults() {
  const counts = state.faults.reduce((o, f) => ((o[f.kind] = (o[f.kind] || 0) + 1), o), {});
  return `
  <div class="stats">
    ${stat('أعطال الإنفرتر', String(counts.fault || 0), 'حدث', 'c-pink')}
    ${stat('انقطاع الرافع', String(counts.offline || 0), 'مرة', 'c-slate')}
    ${stat('انقطاع الكهرباء', String(counts.grid || 0), 'مرة', 'c-violet')}
    ${stat('تعذّر الاتصال', String(counts.comm || 0), 'مرة', 'c-amber')}
  </div>
  <div class="row-end">${state.faults.length ? '<button class="link" id="clearList">مسح السجل</button>' : ''}</div>
  ${eventList(state.faults, 'لم يُسجّل أي عطل أو انقطاع حتى الآن.')}`;
}
AFTER.faults = () => {
  const c = $('#clearList');
  if (c) c.onclick = async () => { if (await confirmDialog('مسح السجل', 'هل تريد حذف سجل الأعطال؟')) { state.faults = []; store.set('faults', []); render(); } };
};

function toggle(key, label, sub = '') {
  return `<label class="sw-row"><span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span><input type="checkbox" class="sw" data-pref="${key}" ${state.prefs[key] ? 'checked' : ''}></label>`;
}
function numField(key, label, unit, min, max, placeholder = '') {
  return `<label class="num-row"><span>${esc(label)}</span><span class="num-in"><input type="number" inputmode="numeric" data-pref="${key}" value="${state.prefs[key] ?? ''}" min="${min}" max="${max}" placeholder="${esc(placeholder)}"><small>${esc(unit)}</small></span></label>`;
}

function pageRules() {
  return `
  <section class="card"><div class="form">
    ${toggle('notify', 'إشعارات على الهاتف', 'تظهر في شريط الإشعارات')}
    ${numField('lowSoc', 'انخفاض البطارية إلى', '%', 5, 90)}
    ${numField('overloadPct', 'تجاوز الحمل نسبة', '%', 30, 120)}
    ${toggle('alertOffline', 'انقطاع اتصال الرافع وعودته')}
    ${toggle('alertGrid', 'انقطاع الكهرباء الوطنية وعودتها')}
    ${toggle('alertFull', 'اكتمال شحن البطارية')}
  </div></section>
  <button class="btn ghost wide" id="testNotif">${icons.bell} إرسال إشعار تجريبي</button>
  <p class="hint">التنبيهات تعمل ما دام التطبيق مفتوحاً أو في الخلفية، ويُفحص الرافع كل ${state.prefs.pollSec} ثانية. إذا أُغلق التطبيق تماماً أو أوقفه نظام توفير البطارية فلن تصل التنبيهات حتى تفتحه.</p>
  <p class="hint">أعطال الإنفرتر تُسجّل دائماً في سجل الأعطال، وتصل كإشعار عند تفعيل الإشعارات.</p>`;
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
    el.onchange = async () => {
      const k = el.dataset.pref;
      if (el.type === 'checkbox') state.prefs[k] = el.checked;
      else if (el.tagName === 'SELECT') state.prefs[k] = el.value;
      else if (el.value === '' && DEFAULT_PREFS[k] === null) state.prefs[k] = null;
      else {
        const v = Number(el.value);
        const min = Number(el.min), max = Number(el.max);
        state.prefs[k] = Math.min(max, Math.max(min, Number.isFinite(v) ? v : DEFAULT_PREFS[k] ?? min));
        el.value = state.prefs[k];
      }
      savePrefs();
      if (k === 'notify' && el.checked && Capacitor.isNativePlatform()) {
        const r = await LocalNotifications.requestPermissions().catch(() => ({}));
        if (r.display !== 'granted') toast('لم يُسمح بالإشعارات من إعدادات الهاتف', 'bad');
      }
      if (k === 'pollSec') startPolling();
      if (k === 'staleMin' && state.model) state.model = normalize(state.model.raw.map((r) => ({ title: r.title, val: r.val, unit: r.unit })), state.prefs.staleMin);
      if (k === 'theme') { applyTheme(); render(); }
      toast('تم الحفظ', 'ok');
    };
  });
}

// ================= تبويب الرافع =================
function viewInverter() {
  const m = state.model;
  const pages = { status: pageStatus, info: pageInfo, rated: () => pageGroup('rated'), config: () => pageGroup('config'), edit: pageEdit };
  if (state.page && pages[state.page]) return (state.page === 'edit' ? '' : banner()) + pages[state.page](m);
  const fault = m?.fault;
  return `
  <section class="intro"><h2>${esc(device()?.alias || 'الرافع')}</h2><p>معلومات الإنفرتر وإعداداته.</p></section>
  ${gridCards([
    { page: 'status', title: 'الحالة التشغيلية', icon: icons.gauge, color: m?.stale ? 'c-slate' : fault ? 'c-pink' : 'c-green', value: !m ? '—' : m.stale ? 'غير متصل' : fault ? 'عطل' : 'يعمل', sub: m?.mode ? trValue(m.mode) : '' },
    { page: 'info', title: 'معلومات الجهاز', icon: icons.tag, color: 'c-sky', value: '', sub: 'الرقم التسلسلي والإصدارات' },
    { page: 'rated', title: 'القيم المقنّنة', icon: icons.bolt, color: 'c-amber', value: m?.ratedW ? `${m.ratedW} واط` : '', sub: 'قدرة وجهد الرافع الاسمية' },
    { page: 'config', title: 'الإعدادات الحالية', icon: icons.list, color: 'c-violet', value: '', sub: 'الأولويات والبطارية (للعرض)' },
  ])}
  ${listCards([{ page: 'edit', title: 'تعديل إعدادات الرافع', sub: 'تغيير الأولويات وتيارات الشحن عن بُعد', icon: icons.wrench, color: 'c-pink' }])}`;
}

function needModel(m) {
  return m ? '' : '<div class="empty">لا توجد بيانات بعد.</div>';
}

function pageStatus(m) {
  if (!m) return needModel(m);
  return `<section class="card">${kv([
    ['الاتصال', m.stale ? '<span class="tag bad">غير متصل</span>' : state.demo ? '<span class="tag">تجريبي</span>' : '<span class="tag ok">متصل</span>'],
    ['آخر قراءة', val(m.ts ? fmt.dateTime(m.ts) : null)],
    ['وضع التشغيل', val(m.mode ? trValue(m.mode) : null)],
    ['حالة الحمل', val(m.loadStatus ? trValue(m.loadStatus) : null)],
    ['عطل الإنفرتر', m.fault ? `<span class="tag bad">${esc(m.fault)}</span>` : '<span class="tag ok">لا يوجد</span>'],
    m.warning ? ['تحذير', `<span class="tag warn">${esc(m.warning)}</span>`] : null,
    ['جهد الناقل الداخلي', val(m.busV === null ? null : numAr(m.busV), 'فولت')],
    m.temp !== null ? ['الحرارة', val(numAr(m.temp), 'م°')] : null,
  ])}</section>
  <p class="hint">يُعتبر الرافع غير متصل إذا لم تصل منه قراءة جديدة منذ أكثر من ${state.prefs.staleMin} دقيقة (يمكن تغييرها من «المزيد ← الاتصال والتحديث»).</p>`;
}

function pageInfo(m) {
  const d = device();
  const product = m ? m.raw.filter((r) => r.group === 'product' && !/^timestamp$/i.test(r.title)) : [];
  return `<section class="card">${kv([
    ['اسم الجهاز', val(d?.alias)],
    ['الرقم التسلسلي للجهاز', val(d?.sn)],
    ['رقم وحدة الواي فاي', val(d?.pn)],
    ...product.map((r) => [r.ar, val(r.valAr, trUnit(r.unit))]),
  ])}</section>`;
}

function pageGroup(group) {
  const m = state.model;
  if (!m) return needModel(m);
  const rows = m.raw.filter((r) => r.group === group);
  if (!rows.length) return '<div class="empty">الجهاز لا يرسل هذه المعلومات.</div>';
  return `<section class="card">${kv(rows.map((r) => [r.ar, isEmptyVal(r.val) ? val(null) : val(r.valAr, trUnit(r.unit))]))}</section>
    ${group === 'config' ? '<p class="hint">هذه القيم للعرض كما يرسلها الرافع. لتغييرها استخدم «تعديل إعدادات الرافع».</p>' : ''}`;
}

const SETTING_AR = {
  'output source priority': 'أولوية مصدر الخرج', 'charger source priority': 'أولوية مصدر الشحن', 'ac input range': 'نطاق جهد الدخل',
  'battery type': 'نوع البطارية', 'max charging current': 'أقصى تيار شحن', 'max. charging current': 'أقصى تيار شحن',
  'max utility charging current': 'أقصى تيار شحن من الكهرباء', 'max. utility charging current': 'أقصى تيار شحن من الكهرباء',
  'max ac charging current': 'أقصى تيار شحن من الكهرباء', 'buzzer': 'صوت التنبيه', 'backlight': 'إضاءة الشاشة',
  'overload restart': 'إعادة التشغيل بعد الحمل الزائد', 'over temperature restart': 'إعادة التشغيل بعد ارتفاع الحرارة',
  'overload bypass': 'التمرير عند الحمل الزائد', 'lcd return to default display': 'عودة الشاشة للعرض الافتراضي',
  'record fault code': 'تسجيل رموز الأعطال', 'output voltage': 'جهد الخرج', 'output frequency': 'تردد الخرج',
  'bulk charging voltage': 'جهد الشحن السريع', 'floating charging voltage': 'جهد الشحن العائم',
  'battery cut-off voltage': 'جهد فصل البطارية', 'low dc cut-off voltage': 'جهد فصل البطارية',
  'back to grid voltage': 'جهد العودة للكهرباء', 'back to discharge voltage': 'جهد العودة للتفريغ',
  'battery equalization': 'معادلة البطارية', 'beeps while primary source interrupt': 'صفارة عند انقطاع المصدر الرئيسي',
};
const trS = (s) => SETTING_AR[String(s).trim().toLowerCase()] || trTitle(s);

function pageEdit() {
  if (state.demo) return '<div class="empty">تعديل الإعدادات متاح بعد تسجيل الدخول بحسابك الحقيقي.</div>';
  if (state.model?.stale) return `${banner()}<div class="empty bad">الرافع غير متصل حالياً، ولن تصل إليه أي إعدادات حتى يعود الاتصال.</div>`;
  let body;
  if (state.fieldsError) body = `<div class="empty bad">${esc(state.fieldsError)}</div><button class="btn ghost wide" id="loadFields">إعادة المحاولة</button>`;
  else if (!state.fields) body = '<div class="empty"><div class="spinner"></div>جارٍ تحميل قائمة الإعدادات…</div>';
  else if (!state.fields.length) body = '<div class="empty">هذا الجهاز لا يدعم تعديل الإعدادات عن بُعد.</div>';
  else {
    body = `<ul class="fields card">${state.fields.map((f, i) => `
        <li class="field" data-i="${i}">
          <button class="field-h"><span>${esc(trS(f.name))}</span>${icons.chevL}</button>
          <div class="field-b"></div>
        </li>`).join('')}</ul>`;
  }
  return `<div class="banner warn">${icons.warn}<span><b>تنبيه</b>تغيير هذه الإعدادات يؤثر على عمل الرافع مباشرة. غيّر فقط ما تعرف أثره.</span></div>${body}`;
}
AFTER.edit = () => {
  const load = async () => {
    try { state.fields = await api.ctrlFields(device()); state.fieldsError = null; } catch (e) { state.fieldsError = e.message; }
    if (state.page === 'edit') render();
  };
  const lf = $('#loadFields');
  if (lf) lf.onclick = () => { state.fieldsError = null; render(); load(); };
  if (!state.fields && !state.fieldsError && !state.demo && !state.model?.stale) load();
  const list = $('.fields');
  if (list) list.onclick = (e) => { const h = e.target.closest('.field-h'); if (h) openField(h.parentElement); };
};

async function openField(li) {
  const open = li.classList.toggle('open');
  if (!open) return;
  const f = state.fields[Number(li.dataset.i)];
  const body = li.querySelector('.field-b');
  body.innerHTML = '<div class="spinner sm"></div>';
  let cur = '';
  try {
    cur = (await api.ctrlValue(device(), f.id)).val ?? '';
  } catch (e) {
    body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    return;
  }
  const items = f.item || [];
  const match = items.find((it) => String(it.key) === String(cur) || String(it.val) === String(cur));
  const input = items.length
    ? `<select class="f-in">${items.map((it) => `<option value="${esc(it.key)}" ${it === match ? 'selected' : ''}>${esc(trValue(it.val))}</option>`).join('')}</select>`
    : `<span class="num-in"><input class="f-in" dir="ltr" inputmode="decimal" value="${esc(cur)}"><small>${esc(trUnit(f.unit || ''))}</small></span>`;
  body.innerHTML = `
    <div class="cur">القيمة الحالية: <b>${esc(match ? trValue(match.val) : cur || '—')} ${esc(!items.length ? trUnit(f.unit || '') : '')}</b></div>
    ${f.hint ? `<p class="hint">النطاق المسموح: <bdi dir="ltr">${esc(f.hint)}</bdi></p>` : ''}
    <div class="f-row">${input}<button class="btn primary f-save">حفظ</button></div>`;
  body.querySelector('.f-save').onclick = async () => {
    const inp = body.querySelector('.f-in');
    const v = inp.value.trim();
    if (!v) return;
    const shown = items.length ? inp.options[inp.selectedIndex].text : `${v} ${trUnit(f.unit || '')}`;
    if (!(await confirmDialog('تأكيد التغيير', `سيتم تغيير <b>${esc(trS(f.name))}</b> إلى <b>${esc(shown)}</b> على الرافع مباشرة. هل أنت متأكد؟`))) return;
    try {
      await api.setCtrl(device(), f.id, v);
      toast('تم إرسال الإعداد إلى الرافع', 'ok');
      addFault('info', 'تغيير إعداد', `${trS(f.name)} ← ${shown}`);
      li.classList.remove('open');
      setTimeout(() => openField(li), 1500);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

// ================= تبويب المزيد =================
function viewMore() {
  const pages = { theme: pageTheme, batcfg: pageBatCfg, conn: pageConn, account: pageAccount, about: pageAbout };
  if (state.page && pages[state.page]) return pages[state.page]();
  const themeName = { auto: 'تلقائي حسب الهاتف', dark: 'ليلي', light: 'نهاري' }[state.prefs.theme];
  return `
  ${listCards([
    { page: 'theme', title: 'المظهر', sub: themeName, icon: icons.moon, color: 'c-violet' },
    { page: 'batcfg', title: 'البطارية والحسابات', sub: state.prefs.batteryAh ? `السعة ${state.prefs.batteryAh} أمبير ساعة` : 'أدخل سعة البطارية لحساب المدة المتبقية', icon: icons.battery, color: 'c-green' },
    { page: 'conn', title: 'الاتصال والتحديث', sub: `تحديث كل ${state.prefs.pollSec} ثانية`, icon: icons.wifi, color: 'c-sky' },
    { page: 'account', title: 'الجهاز والحساب', sub: state.demo ? 'وضع تجريبي' : state.session?.usr || '', icon: icons.user, color: 'c-amber' },
    { page: 'about', title: 'حول التطبيق', sub: 'طاقتي · الإصدار ' + VERSION, icon: icons.info, color: 'c-pink' },
  ])}
  <p class="foot">تطوير: حسين محمد علي الطويل</p>`;
}

function pageTheme() {
  const opt = (v, label, ic) => `<button class="theme-opt ${state.prefs.theme === v ? 'on' : ''}" data-theme="${v}">${ic}<b>${label}</b></button>`;
  return `<div class="theme-opts">${opt('auto', 'تلقائي', icons.refresh)}${opt('light', 'نهاري', icons.sun)}${opt('dark', 'ليلي', icons.moon)}</div>
    <p class="hint center">«تلقائي» يتبع وضع هاتفك الليلي.</p>`;
}
AFTER.theme = () => {
  document.querySelectorAll('[data-theme]').forEach((b) => {
    b.onclick = () => { state.prefs.theme = b.dataset.theme; savePrefs(); applyTheme(); render(); };
  });
};

function pageBatCfg() {
  const rated = state.model?.ratedV;
  return `<section class="card"><div class="form">
      ${numField('batteryAh', 'سعة البطارية', 'أمبير ساعة', 10, 5000, 'مثال: 200')}
      ${numField('cutoffSoc', 'أدنى نسبة مسموح التفريغ إليها', '%', 0, 60)}
    </div></section>
    <p class="hint">تُستخدم السعة مع جهد البطارية المقنّن ${rated ? `(${rated} فولت من الرافع)` : '(48 فولت افتراضياً)'} لحساب المدة المتبقية للتفريغ أو الشحن. بدون السعة لا يعرض التطبيق أي تقدير حتى لا يكون مضلّلاً.</p>
    <p class="hint">إذا كانت لديك عدة بطاريات على التوازي فاجمع سعاتها (مثلاً بطاريتان 100 أمبير = 200).</p>`;
}
AFTER.batcfg = () => bindPrefs($('#view'));

function pageConn() {
  return `<section class="card"><div class="form">
      ${numField('pollSec', 'تحديث البيانات كل', 'ثانية', 10, 600)}
      ${numField('staleMin', 'اعتبار الرافع غير متصل بعد', 'دقيقة', 5, 180)}
    </div></section>
    <p class="hint">يرسل الرافع قراءة جديدة إلى الخادم كل بضع دقائق. إذا مرّت المدة أعلاه دون قراءة جديدة يُعرض الرافع «غير متصل» وتتوقف الحسابات المبنية على القيم الحية.</p>
    <p class="hint">آخر بيانات تُحفظ على الهاتف وتظهر حتى بدون إنترنت، مع توضيح وقتها.</p>`;
}
AFTER.conn = () => bindPrefs($('#view'));

function pageAccount() {
  const d = device();
  return `<section class="card">
    ${state.devices.length > 1 ? `<label class="num-row"><span>الجهاز المعروض</span><select id="devSel">${state.devices.map((x) => `<option value="${esc(x.sn)}" ${x.sn === d?.sn ? 'selected' : ''}>${esc(x.alias)}</option>`).join('')}</select></label>` : ''}
    ${kv([['الحساب', val(state.demo ? 'وضع تجريبي' : state.session?.usr)], ['الجهاز', val(d?.alias)], ['عدد الأجهزة', val(String(state.devices.length))], ['الخادم', val(state.demo ? '—' : state.session?.profile === 'shine' ? 'ShineMonitor' : 'DessMonitor')]])}
  </section>
  <button class="btn danger wide" id="logoutBtn">${icons.logout} ${state.demo ? 'الخروج من الوضع التجريبي' : 'تسجيل الخروج'}</button>`;
}
AFTER.account = () => {
  $('#logoutBtn').onclick = async () => { if (await confirmDialog('تسجيل الخروج', 'هل تريد تسجيل الخروج؟ ستبقى التقارير المحفوظة على الهاتف.')) logout(); };
  const sel = $('#devSel');
  if (sel) sel.onchange = () => {
    state.devSn = sel.value; store.set('devSn', sel.value);
    state.model = null; state.fields = null;
    state.rep = { ...state.rep, day: null, week: null, month: null, cmpData: null };
    loadCache(); refresh(); render();
  };
};

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
    <div><small>مطوّر التطبيق</small><b>حسين محمد علي الطويل</b></div>
  </section>
  <section class="card"><div class="card-h"><h2>ماذا يقدّم التطبيق؟</h2></div>
    <ul class="feat">
      <li>${icons.flash}<span>لوحة حيّة لتدفق الطاقة بين الألواح والبطارية والكهرباء والحمل</span></li>
      <li>${icons.chart}<span>تقارير يومية وأسبوعية وشهرية مع مقارنة الأداء وتصديرها</span></li>
      <li>${icons.bell}<span>تنبيهات لانقطاع الرافع والكهرباء وانخفاض البطارية والأعطال</span></li>
      <li>${icons.wrench}<span>عرض إعدادات الرافع وتعديلها عن بُعد بعد التأكيد</span></li>
      <li>${icons.offline}<span>حفظ آخر البيانات على الهاتف وعرضها بدون إنترنت</span></li>
    </ul>
  </section>
  <section class="card"><div class="card-h"><h2>الخصوصية</h2></div>
    <p class="hint">يتصل التطبيق مباشرة بخوادم WatchPower (DessMonitor) فقط. لا تُحفظ كلمة المرور، ولا تُرسل بياناتك إلى أي جهة أخرى. كل التقارير محفوظة على هاتفك.</p>
  </section>
  <p class="foot">صُنع بـ ${icons.heart} للطاقة النظيفة</p>`;
}

// ================= التشغيل =================
async function boot() {
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (state.prefs.theme === 'auto') { applyTheme(); if (state.session || state.demo) render(); } });
  if (Capacitor.isNativePlatform()) {
    CapApp.addListener('resume', () => { if (state.session || state.demo) refresh(); });
    CapApp.addListener('backButton', back);
    if (state.prefs.notify) LocalNotifications.requestPermissions().catch(() => {});
  }
  if (state.demo || (state.session?.token && state.devices.length)) startApp();
  else renderLogin();
}

boot();
