import './styles.css';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import {
  Chart, LineController, LineElement, PointElement, BarController, BarElement,
  LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { WatchPowerApi, ApiError, errorAr } from './api.js';
import { normalize, rowsToSamples, fmt, latinDigits, LOC, countAr, DAY } from './model.js';
import { trTitle, trValue, trUnit, isEmptyVal } from './i18n.js';
import {
  store, today, addDays, dayKey, recordSample, localDay, summarize, cachedSummary, cacheSummary, toCsv, shareFile,
} from './data.js';
import { demoPoints, demoHistory } from './demo.js';
import { icons } from './icons.js';
import { isNative, secure, migrateSession, monitor, deviceTools, APPS, updater } from './native.js';
import { fetchLatest, isNewer } from './update.js';
import { analyze } from './advisor.js';
import { settingInfo, optionAr, hintRange } from './settings-info.js';
import { viewCalc, bindCalc, defaultsCalc } from './calc.js';
import { TIP_SECTIONS, smartTips, tipOfDay } from './tips.js';

Chart.register(LineController, LineElement, PointElement, BarController, BarElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);
Chart.defaults.font.family = 'Cairo, system-ui, sans-serif';

const VERSION = '3.5.1';

// ================= الحالة =================
const DEFAULT_PREFS = {
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
  bgMonitor: true,
  alertTemp: true,
  tempBat: 50,
  tempInv: 75,
  fontScale: 1,
};

const state = {
  session: null, // تُحمّل من التخزين المشفّر في boot()
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
  calc: { ...defaultsCalc(), ...store.get('calc', {}) },
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
  document.documentElement.style.setProperty('--fs', String(state.prefs.fontScale || 1));
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
  Object.assign(state, { session: null, demo: false, devices: [], model: null, fields: null, tab: 'home', page: null });
  state.rep = { ...state.rep, day: null, week: null, month: null, cmpData: null, adv: null };
  api = new WatchPowerApi();
  renderLogin();
}

// ================= الهيكل والتنقل =================
// خمسة تبويبات، والوظائف المتقاربة مجمّعة داخلها
const TABS = [
  ['home', 'الرئيسية', icons.flash],
  ['reports', 'التقارير', icons.chart],
  ['calc', 'الحاسبة', icons.calc],
  ['alerts', 'التنبيهات', icons.bell],
  ['more', 'المزيد', icons.gear],
];
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
    if (card) navigate(state.tab, card.dataset.page.includes(':') ? card.dataset.page.split(':')[1] : card.dataset.page);
  });
  loadCache();
  navigate(state.tab, state.page);
  startPolling();
  if (quiet) return;
  takeOverFromBackground().then(() => { refresh(); syncMonitor(); });
  autoCheckUpdate();
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
  bar.innerHTML = (state.page
    ? `<button class="icon-btn" id="backBtn" aria-label="رجوع">${icons.arrowBack}</button>
       <div class="page-title">${esc(title)}</div>
       <span class="dot ${c.cls}" title="${esc(c.text)}"></span>`
    : `<div class="dev"><span class="dot ${c.cls}"></span><div>
         <div class="dev-name">${esc(device()?.alias || 'جهازي')}</div>
         <div class="dev-sub">${esc(c.text)}</div></div></div>
       <button class="icon-btn ${state.loading ? 'spin' : ''}" id="refreshBtn" aria-label="تحديث">${icons.refresh}</button>`);
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
    return `<div class="banner off">${icons.offline}<span><b>الإنفرتر غير متصل بالخادم</b>آخر قراءة وصلت ${esc(fmt.dateTime(m.ts))} (${esc(fmt.ago(m.age))}). القيم المعروضة قديمة وقد يكون الإنفرتر مطفأً أو مفصولاً.</span></div>`;
  }
  if (state.netError && m) {
    return `<div class="banner warn">${icons.offline}<span><b>تعذّر الاتصال بالخادم</b>تُعرض آخر بيانات محفوظة على الهاتف (جُلبت ${esc(fmt.ago(Date.now() - state.fetchedAt))}).</span></div>`;
  }
  if (m && !m.ts) return `<div class="banner warn">${icons.info}<span>الجهاز لا يرسل وقت القراءة، لذا لا يمكن التأكد من أن البيانات حيّة.</span></div>`;
  return '';
}

const PAGE_TITLES = {
  load: 'الحمل', battery: 'البطارية', solar: 'الألواح الشمسية', grid: 'كهرباء الشبكة', all: 'كل القراءات',
  day: 'التقرير اليومي', week: 'التقرير الأسبوعي', month: 'التقرير الشهري', compare: 'مقارنة الأداء',
  rules: 'شروط التنبيه', advisor: 'مستشار الطاقة', device: 'الإنفرتر', update: 'التحديثات', edit: 'إعدادات الإنفرتر', setup: 'ربط الجهاز والحساب',
  tips: 'النصائح', smart: 'نصائح لجهازك الآن', ...Object.fromEntries(TIP_SECTIONS.map((t) => [t.id, t.title])),
  custom: 'المظهر والمصطلحات', monitor: 'المراقبة والبطارية', account: 'الحساب', about: 'حول التطبيق',
};

function render() {
  charts.splice(0).forEach((c) => c.destroy());
  renderHeader();
  const v = $('#view');
  if (!v) return;
  const views = { home: viewHome, reports: viewReports, calc: () => viewCalc(calcHelpers()), alerts: viewAlerts, more: viewMore };
  // التحديث الدوري يعيد رسم الصفحة نفسها: نحافظ على الأقسام التي فتحها المستخدم بدل طيّها كل 30 ثانية
  const key = state.tab + '/' + (state.page || '');
  const opened = v.dataset.key === key ? [...v.querySelectorAll('details')].map((d) => d.open) : null;
  v.innerHTML = `<div class="${state.animate ? 'page-anim' : ''}">${views[state.tab]()}</div>`;
  v.dataset.key = key;
  if (opened) v.querySelectorAll('details').forEach((d, i) => { if (i < opened.length) d.open = opened[i]; });
  state.animate = false;
  AFTER[leaf() || state.tab]?.();
}
const AFTER = {};

// الحاسبة في ملف مستقل، فنمرّر لها ما تحتاجه من أدوات الواجهة
const calcHelpers = () => ({
  state, esc, icons, fmt, $, toast, render, confirm: confirmDialog,
  sysV: () => state.model?.ratedV || state.calc.sysV || nominalV(state.model),
});
AFTER.calc = () => bindCalc(calcHelpers());

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

async function refresh(manual = false) {
  const d = device();
  if (!d || state.loading) return;
  state.loading = true;
  renderHeader();
  try {
    const points = state.demo ? demoPoints() : await api.lastData(d);
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
    if (manual) toast(state.model.stale ? 'تم التحديث — الإنفرتر ما زال غير متصل' : 'تم التحديث', state.model.stale ? 'bad' : 'ok');
  } catch (err) {
    if (sn() !== d.sn) { state.switched = true; return; }
    state.fails++;
    state.netError = err.message;
    if (state.fails === 3) addFault('comm', 'تعذّر الاتصال بالخادم', err.message);
    if (manual) toast(err.message, 'bad');
  } finally {
    state.loading = false;
    if (state.switched) {
      state.switched = false;
      if (device() && (state.session || state.demo)) refresh(manual);
      return;
    }
    if (state.model) state.model = { ...state.model, age: state.model.ts ? Date.now() - state.model.ts : null };
    // نعيد الرسم فقط للصفحات التي تعرض القراءة الحية حتى لا تُفقد حالة الصفحات الأخرى
    if (state.tab === 'home' || (state.tab === 'more' && ['tips', 'tips/smart'].includes(state.page))) render();
    else renderHeader();
  }
}

// وحدة الواي فاي ترفع قراءة جديدة كل بضع دقائق، فلا فائدة من سؤال الخادم أكثر من مرة في الدقيقة.
// في المتصفح فقط يمكن للاختبارات تقصير المدة عبر devPollSec
const pollMs = () => (isNative ? 60 : Math.max(5, store.get('devPollSec', 60))) * 1000;
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refresh(), pollMs());
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

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
    (r.alerts || []).forEach((a) => state.alerts.unshift({ ...a, read: false }));
    // رسائل الخادم في الخلفية تصل برموزها الإنجليزية (ERR_...)، فنترجمها بنفس جدول الواجهة
    (r.faults || []).forEach((f) => state.faults.unshift(f.kind === 'comm' ? { ...f, body: errorAr(f.body) } : f));
    state.alerts = state.alerts.slice(0, 200);
    state.faults = state.faults.slice(0, 300);
    if (r.flags && Object.keys(r.flags).length) state.flags = { ...state.flags, ...r.flags };
    store.set('alerts', state.alerts);
    store.set('faults', state.faults);
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
  // لا نُعلن الانقطاع من أول قراءة في الجلسة: قد يكون فرق توقيت لم يُكتشف بعد
  const first = state.fetchCount <= 1 || store.get('tzp.' + sn(), null) !== null;
  if (m.stale && state.flags.offline !== true) {
    if (first) state.flags.offline = 'silent';
    else {
      state.flags.offline = true;
      addFault('offline', 'انقطع اتصال الإنفرتر', `آخر قراءة ${fmt.dateTime(m.ts)}`);
      if (p.alertOffline) raise('الإنفرتر غير متصل', `لم تصل قراءات جديدة منذ ${fmt.ago(m.age).replace('قبل ', '')}. قد يكون الإنفرتر مطفأً أو مفصولاً.`, 'bad');
    }
  } else if (!m.stale && state.flags.offline) {
    if (state.flags.offline === true) {
      addFault('online', 'عاد اتصال الإنفرتر', `قراءة جديدة ${fmt.dateTime(m.ts)}`);
      if (p.alertOffline) raise('عاد اتصال الإنفرتر', 'وصلت قراءات جديدة من الجهاز', 'ok');
    }
    state.flags.offline = false;
  }
  store.set('flags', state.flags);
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

  // هامش رجوع (hysteresis): التنبيه لا يُعاد تسليحه إلا بعد ابتعاد واضح عن الحد،
  // حتى لا تتكرر الإشعارات مع تذبذب القراءة حول الحد نفسه
  const hold = (key, on, stillOn) => (state.flags[key] === true ? stillOn : on);
  if (m.soc !== null) {
    edge('lowSoc', hold('lowSoc', m.soc <= p.lowSoc && (m.batW ?? 0) <= 0, m.soc < p.lowSoc + 5),
      () => raise('البطارية منخفضة', `نسبة الشحن ${m.soc}% — يُنصح بتقليل الأحمال.${eta(m).known ? ' ' + eta(m).text : ''}`, 'bad'));
    if (p.alertFull) edge('full', hold('full', m.soc >= 100, m.soc >= 95), () => raise('البطارية ممتلئة', 'وصل الشحن إلى 100% — وقت مناسب لتشغيل الأحمال الكبيرة', 'ok'));
  }
  if (m.loadPct !== null) {
    edge('overload', hold('overload', m.loadPct >= p.overloadPct, m.loadPct >= p.overloadPct - 10), () => {
      raise('حمل زائد', `الحمل وصل إلى ${m.loadPct}% (${fmt.w(m.outW)})`, 'bad');
      addFault('warn', 'حمل زائد', `${m.loadPct}% (${fmt.w(m.outW)})`);
    });
  }
  // الحرارة: فقط إن كان الجهاز يرسلها، مع هامش رجوع 5 درجات
  if (p.alertTemp) {
    if (m.batTemp !== null) edge('hotBat', hold('hotBat', m.batTemp >= p.tempBat, m.batTemp > p.tempBat - 5), () => {
      raise('حرارة البطارية مرتفعة', `${numAr(m.batTemp)}° — الحد ${p.tempBat}°. خفّف الحمل وتأكد من تهوية مكان البطارية.`, 'bad');
      addFault('warn', 'حرارة البطارية مرتفعة', `${numAr(m.batTemp)}°`);
    });
    if (m.invTemp !== null) edge('hotInv', hold('hotInv', m.invTemp >= p.tempInv, m.invTemp > p.tempInv - 5), () => {
      raise('حرارة الإنفرتر مرتفعة', `${numAr(m.invTemp)}° — الحد ${p.tempInv}°. خفّف الحمل وتأكد أن فتحات التهوية والمراوح تعمل.`, 'bad');
      addFault('warn', 'حرارة الإنفرتر مرتفعة', `${numAr(m.invTemp)}°`);
    });
  }
  if (p.alertGrid && m.gridV !== null) {
    edge('gridOff', !m.gridOn, () => {
      raise('انقطعت كهرباء الشبكة', `المنظومة تعمل على البطارية${m.soc !== null ? ` (${fmt.pct(m.soc)})` : ''}`, 'warn');
      addFault('grid', 'انقطاع كهرباء الشبكة', `جهد الشبكة ${numAr(m.gridV)} فولت`);
    }, () => {
      raise('عادت كهرباء الشبكة', `الجهد ${numAr(m.gridV)} فولت`, 'ok');
      addFault('online', 'عودة كهرباء الشبكة', `جهد الشبكة ${numAr(m.gridV)} فولت`);
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

function eta(m) {
  const p = state.prefs;
  if (!p.batteryAh) return { known: false, text: 'أدخل سعة البطارية لحساب المدة', sub: '' };
  if (m.stale || m.soc === null || m.batW === null) return { known: false, text: 'غير متاح حالياً', sub: '' };
  const nominal = nominalV(m);
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
// خط تدفق بأسهم تتحرك باتجاه الطاقة الفعلي، وسرعتها تزيد مع القدرة.
// reverse يعني أن الطاقة تسير عكس اتجاه رسم الخط (مثل خروجها من البطارية عند التفريغ).
function flowLine(id, d, on, watts, reverse) {
  const track = `<path class="wire" d="${d}"/>`;
  if (!on) return track;
  const dur = Math.max(0.7, 2.6 - Math.log10(Math.abs(watts || 50) + 1) * 0.5).toFixed(2);
  const keys = reverse ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear" rotate="auto-reverse"' : 'rotate="auto"';
  const arrows = [0, 1, 2].map((i) => `
    <path class="arrow a-${id}" d="M-4.5 -5 L1.5 0 L-4.5 5">
      <animateMotion dur="${dur}s" begin="${(-i * dur / 3).toFixed(2)}s" repeatCount="indefinite" ${keys}><mpath href="#fp-${id}"/></animateMotion>
    </path>`).join('');
  return `${track}<path id="fp-${id}" class="flow-line f-${id}" d="${d}"/>${arrows}`;
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
  const pages = { load: pageLoad, battery: pageBattery, solar: pageSolar, grid: pageGrid, all: pageAll, device: pageDevice };
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
  <div class="mode-pill ${modeCls}">${esc(modeText)}</div>
  <section class="card flow-card ${live ? '' : 'stale'}">
    <svg viewBox="0 0 360 380" class="flow-svg" aria-hidden="true">
      <circle cx="180" cy="190" r="85" class="glow"/>
      ${flowLine('solar', 'M180 124 L180 154', live && (m.pvW ?? 0) > 5, m.pvW, false)}
      ${flowLine('grid', 'M78 190 L144 190', live && isLine && m.gridOn, 300, false)}
      ${flowLine('load', 'M216 190 L282 190', live && (m.outW ?? 0) > 5, m.outW, false)}
      ${flowLine('bat', 'M180 226 L180 264', live && Math.abs(m.batW ?? 0) > 10, m.batW, (m.batW ?? 0) < 0)}
    </svg>
    <button class="node n-solar ${(m.pvW ?? 0) > 5 && live ? '' : 'dim'}" data-page="solar" aria-label="تفاصيل الألواح"><b><bdi>${fmt.wShort(m.pvW)}</bdi></b><small>الألواح</small><span class="ic">${icons.panel}</span></button>
    <button class="node n-grid ${m.gridOn && live ? '' : 'dim'}" data-page="grid" aria-label="تفاصيل كهرباء الشبكة"><span class="ic">${icons.grid}</span><b><bdi>${m.gridOn ? numAr(m.gridV) + ' فولت' : 'مقطوعة'}</bdi></b><small>${live && isLine && m.gridOn ? 'تغذّي البيت' : 'الشبكة'}</small></button>
    <button class="node n-load ${(m.outW ?? 0) > 5 && live ? '' : 'dim'}" data-page="load" aria-label="تفاصيل الحمل"><span class="ic">${icons.home}</span><b><bdi>${fmt.wShort(m.outW)}</bdi></b><small>الحمل</small></button>
    <button class="node n-bat ${live ? '' : 'dim'}" data-page="battery" aria-label="تفاصيل البطارية"><span class="ic">${icons.battery}</span><b><bdi>${m.soc ?? '—'}%</bdi></b>${batTag(m, live)}</button>
    <button class="node n-inv" data-page="device" aria-label="تفاصيل الإنفرتر"><span class="ic">${icons.inverter}</span></button>
  </section>
  <p class="flow-hint">اضغط على أي عنصر في المخطط لعرض تفاصيله</p>

  <section class="card battery-card ${live ? '' : 'stale'}">
    <div class="ring">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/>
        <circle cx="60" cy="60" r="52" class="ring-fg" style="stroke-dasharray:${(soc / 100) * C} ${C};stroke:${soc < 25 ? 'var(--bad)' : soc < 50 ? 'var(--warn)' : 'var(--bat)'}"/></svg>
      <div class="ring-txt"><b>${m.soc ?? '—'}%</b><small>الشحن</small></div>
    </div>
    <div class="bat-info">
      <div class="bat-state ${live && m.batW > 10 ? 'chg' : live && m.batW < -10 ? 'dis' : ''}">${esc(batState(m))}</div>
      <div class="bat-eta">${e.known ? esc(e.text) : `<button class="link" data-goto="more:monitor">${esc(e.text)}</button>`}</div>
      <div class="bat-sub"><bdi>${fmt.v(m.batV)}</bdi>${e.sub ? ' · ' + esc(e.sub) : ''}</div>
    </div>
  </section>

  </div><div class="col-b">
  <h3 class="sec-h">التفاصيل</h3>
  ${gridCards([
    { page: 'load', title: 'الحمل', icon: icons.home, color: 'c-sky', value: fmt.w(m.outW), sub: m.loadPct !== null ? `${m.loadPct}% من قدرة الإنفرتر` : 'استهلاك المنزل' },
    { page: 'battery', title: 'البطارية', icon: icons.battery, color: 'c-green', value: m.soc !== null ? m.soc + '%' : '—', sub: batState(m) },
    { page: 'solar', title: 'الألواح الشمسية', icon: icons.panel, color: 'c-amber', value: fmt.w(m.pvW), sub: m.todayWh !== null ? `إنتاج اليوم ${fmt.kwh(m.todayWh / 1000)} ك.و.س` : 'الإنتاج الحالي' },
    { page: 'grid', title: 'كهرباء الشبكة', icon: icons.grid, color: 'c-violet', value: m.gridV === null ? '—' : m.gridOn ? `${numAr(m.gridV, 1)} فولت` : 'مقطوعة', sub: m.gridOn ? (isLine ? 'تغذّي الحمل الآن' : 'متوفرة كاحتياط') : 'لا يوجد تيار' },
  ].map((c) => (live ? c : { ...c, sub: 'آخر قيمة مسجّلة' })), live ? '' : 'stale')}
  ${listCards([
    { page: 'device', title: 'الإنفرتر', sub: m.stale ? 'غير متصل' : `${m.fault ? 'يوجد عطل' : 'يعمل'} · الحالة والمعلومات والإعدادات الحالية`, icon: icons.inverter, color: m.stale ? 'c-slate' : m.fault ? 'c-pink' : 'c-sky' },
    { page: 'all', title: 'كل القراءات', sub: `${countAr(m.raw.filter((r) => r.group === 'live').length, READINGS)} حيّة مترجمة`, icon: icons.list, color: 'c-slate' },
  ])}
  </div></div>`;
}

// ملاحظة عاجلة واحدة من النصائح المخصّصة تظهر في الرئيسية حتى لا تفوت المستخدم
function urgentTip(m) {
  if (!m || m.stale || state.demo) return '';
  const t = smartTips(m, state.prefs).find((x) => x.level === 'bad' || x.level === 'warn');
  return t ? `<button class="banner warn tip-banner" data-goto="more:tips/smart">${icons.bulb}<span><b>${esc(t.title)}</b>${esc(t.body)}</span></button>` : '';
}
AFTER.home = () => {
  bindGoto();
  const r = $('#retryBtn');
  if (r) r.onclick = () => { r.disabled = true; r.textContent = 'جارٍ المحاولة…'; refresh(true); };
};

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
    <div class="card-h"><h2>نسبة الحمل من قدرة الإنفرتر</h2><b>${m.loadPct ?? '—'}%</b></div>
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
    <div class="big-line">${e.known ? esc(e.text) : `<button class="link" data-goto="more:monitor">${esc(e.text)}</button>`}</div>
    ${e.sub ? `<p class="hint">${esc(e.sub)}</p>` : ''}
    ${state.prefs.batteryAh ? `<p class="hint">مبنية على سعة ${state.prefs.batteryAh} أمبير ساعة وجهد ${nominalV(m)} فولت. التقدير تقريبي ويتغير مع الحمل.</p>` : ''}
  </section>
  <div class="stats">
    ${stat('الجهد', numAr(m.batV, 1), 'فولت', 'c-green')}
    ${stat('القدرة', m.batW === null ? '—' : numAr(Math.abs(m.batW)), m.batW > 0 ? 'واط شحن' : m.batW < 0 ? 'واط تفريغ' : 'واط', 'c-amber')}
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
  return `
  ${hero(icons.panel, 'c-amber', 'إنتاج الألواح الآن', fmt.w(m.pvW), m.pvW > 5 && !m.stale ? 'الألواح تنتج الآن' : 'لا يوجد إنتاج حالياً')}
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

function pageAll(m) {
  const live = m.raw.filter((r) => r.group === 'live');
  return `<section class="card"><div class="card-h"><h2>القراءات الحيّة</h2><small class="muted">${m.ts ? esc(fmt.dateTime(m.ts)) : ''}</small></div>
    ${kv(live.map((r) => [r.ar, isEmptyVal(r.val) ? val(null) : val(r.valAr, trUnit(r.unit))]))}</section>
    <p class="hint center">المعلومات المقنّنة والإعدادات ومعلومات الجهاز موجودة في صفحة «الإنفرتر»: اضغط مربع الإنفرتر في المخطط بالرئيسية.</p>`;
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
  const pages = { day: pageDay, week: () => pageRange('week'), month: () => pageRange('month'), compare: pageCompare, advisor: pageAdvisor };
  if (state.page && pages[state.page]) return pages[state.page]();
  return `
  <section class="intro"><h2>التقارير والتحليلات</h2><p>إنتاج الألواح واستهلاك المنزل وحالة البطارية عبر الأيام.</p></section>
  ${listCards([
    { page: 'advisor', title: 'مستشار الطاقة', sub: 'استقلاليتك عن الكهرباء، استخدام البطارية، توصيات وأسئلة عن منظومتك', icon: icons.bulb, color: 'c-green' },
    { page: 'day', title: 'التقرير اليومي', sub: 'رسوم القدرة والبطارية والكهرباء ليوم محدد', icon: icons.calendar, color: 'c-amber' },
    { page: 'week', title: 'التقرير الأسبوعي', sub: 'الإنتاج والاستهلاك لكل يوم خلال أسبوع', icon: icons.week, color: 'c-sky' },
    { page: 'month', title: 'التقرير الشهري', sub: 'مجموع الشهر وأفضل يوم ومتوسط الإنتاج', icon: icons.month, color: 'c-green' },
    { page: 'compare', title: 'مقارنة الأداء', sub: 'هذا الأسبوع أو الشهر مقابل السابق', icon: icons.compare, color: 'c-violet' },
  ])}
  <p class="hint center">تُجلب البيانات من سجل خادم WatchPower، وعند تعذّره تُستخدم القراءات التي حفظها التطبيق على هاتفك.</p>`;
}

// جلب قراءات يوم: من سجل الخادم أولاً، ثم من القراءات المحفوظة محلياً.
// بعد 3 إخفاقات متتالية نتوقف عن سؤال الخادم حتى نهاية التحميل الحالي (يُصفَّر مع كل تقرير جديد)
let serverHistFails = 0;
// d: الجهاز الذي بدأ له التحميل، حتى لا تختلط بيانات جهازين إذا بُدّل الجهاز أثناء التحميل
async function daySamples(date, d = device()) {
  if (state.demo) return { samples: rowsToSamples(demoHistory(date)), source: 'demo' };
  let err;
  if (serverHistFails < 3) {
    try {
      const s = rowsToSamples(await api.dayHistory(d, date));
      serverHistFails = 0;
      // سجل الخادم بتوقيته هو؛ نطبّق فرق التوقيت المكتشف كما في القراءة الحية والسجل المحلي
      const off = store.get('tz.' + d.sn, 0);
      if (off) s.forEach((x) => { x.ts += off; });
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
    ${stat('أدنى نسبة للبطارية', s.socMin === null ? '—' : `${s.socMin}%`, s.socMinAt ? 'الساعة ' + fmt.time(s.socMinAt) : '', 'c-pink')}
    ${stat('أعلى نسبة للبطارية', s.socMax === null ? '—' : `${s.socMax}%`, s.socMaxAt ? 'الساعة ' + fmt.time(s.socMaxAt) : '', 'c-green')}
    ${stat('شحن من الألواح', fmt.kwh(s.solarChgKwh), 'كيلوواط ساعة', 'c-amber')}
    ${stat('شحن من الكهرباء', fmt.kwh(s.gridChgKwh), 'كيلوواط ساعة', 'c-violet')}
    ${stat('تفريغ البطارية', fmt.kwh(s.disKwh), 'كيلوواط ساعة', 'c-slate')}
    ${stat('الاستقلالية عن الكهرباء', s.independence == null ? '—' : Math.round(s.independence) + '%', s.independence == null ? 'وضع التشغيل غير متوفر' : 'من استهلاك البيت', 'c-sky')}
    ${stat('ذروة الحمل', fmt.w(s.peakW), '', 'c-pink')}
    ${stat('توفر الكهرباء', numAr(s.gridH, 1), 'ساعة', 'c-violet')}
    ${stat('العمل على البطارية', numAr(s.batH, 1), 'ساعة', 'c-slate')}
  </div>
  ${s.fullAt ? `<p class="hint">امتلأت البطارية الساعة ${esc(fmt.time(s.fullAt))}.</p>` : ''}
  <p class="hint">الشحن مقسوم حسب مصدره: الألواح بقدر إنتاجها، والباقي من كهرباء الشبكة في وضع الشبكة فقط. الاستقلالية = نسبة استهلاك البيت التي لم تأتِ من كهرباء الشبكة مباشرة أو عبر شحن البطارية.</p>
  <p class="hint">المصدر: ${SRC[r.source]} · ${countAr(r.samples.length, READINGS)} · ساعات مغطّاة ${numAr(s.coveredH, 1)}${s.pvFromMeter ? ' · الإنتاج من عدّاد الجهاز' : ' · الإنتاج محسوب من القدرة'}</p>
  <section class="card"><div class="card-h"><h2>القدرة خلال اليوم</h2></div><div class="chart-box"><canvas id="cPower"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>نسبة شحن البطارية</h2></div><div class="chart-box sm"><canvas id="cSoc"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد البطارية</h2></div><div class="chart-box sm"><canvas id="cBatV"></canvas></div></section>
  <section class="card"><div class="card-h"><h2>جهد كهرباء الشبكة</h2></div><div class="chart-box sm"><canvas id="cGrid"></canvas></div></section>
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
  return { days: ok.length, pv, load, avgPv: avgOf('pvKwh'), avgLoad: avgOf('loadKwh'), gridH: add('gridH'), batH: add('batH'), best,
    solarChg: add('solarChgKwh'), gridChg: add('gridChgKwh'), independence };
}

async function loadRange(kind) {
  const off = kind === 'week' ? state.rep.weekOff : state.rep.monthOff;
  const dates = rangeDates(kind, off);
  const token = Symbol(kind);
  serverHistFails = 0;
  state.rep[kind] = { loading: true, done: 0, total: dates.length, token };
  render();
  const sums = await loadSummaries(dates, (done, total) => {
    const p = $('#rangeProg');
    if (p && state.rep[kind]?.token === token) { p.style.width = (done / total) * 100 + '%'; $('#rangeTxt').textContent = `${done} من ${countAr(total, DAY)}`; }
  });
  if (state.rep[kind]?.token !== token) return;
  state.rep[kind] = { dates, sums };
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
  return nav + `
  <div class="stats">
    ${stat('إجمالي الإنتاج', fmt.kwh(t.pv), 'كيلوواط ساعة', 'c-amber')}
    ${stat('إجمالي الاستهلاك', fmt.kwh(t.load), 'كيلوواط ساعة', 'c-sky')}
    ${stat('متوسط الإنتاج اليومي', fmt.kwh(t.avgPv), 'ك.و.س / يوم', 'c-green')}
    ${stat('أفضل يوم إنتاج', t.best ? dayName(t.best.date) : '—', t.best ? `${fmt.kwh(t.best.pvKwh)} ك.و.س` : '', 'c-violet')}
    ${stat('توفر الكهرباء', numAr(t.gridH, 0), 'ساعة', 'c-pink')}
    ${stat('العمل على البطارية', numAr(t.batH, 0), 'ساعة', 'c-slate')}
    ${stat('شحن من الألواح', fmt.kwh(t.solarChg), 'كيلوواط ساعة', 'c-amber')}
    ${stat('شحن من الكهرباء', fmt.kwh(t.gridChg), 'كيلوواط ساعة', 'c-violet')}
    ${stat('الاستقلالية عن الكهرباء', t.independence == null ? '—' : Math.round(t.independence) + '%', 'من استهلاك البيت', 'c-sky')}
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
  serverHistFails = 0;
  render();
  // نقارن أياماً مكتملة فقط: اليوم الجاري ناقص فيظلم الفترة الحالية دائماً
  let curDates = rangeDates(kind, 0);
  let prevDates = rangeDates(kind, 1);
  if (kind === 'week') { curDates = rangeDates('week', 0).map((d) => addDays(d, -1)); prevDates = curDates.map((d) => addDays(d, -7)); }
  else {
    const done = curDates.filter((d) => d < today());
    if (done.length) curDates = done;
    // نفس عدد الأيام من الشهر السابق حتى تكون المقارنة عادلة
    prevDates = prevDates.slice(0, curDates.length);
  }
  const cur = await loadSummaries(curDates);
  const prev = await loadSummaries(prevDates);
  if (state.rep.cmpData?.loading !== true || state.rep.cmp !== kind) return;
  state.rep.cmpData = { kind, cur: totals(cur), prev: totals(prev), curN: cur.length };
  if (state.page === 'compare') render();
}

// ================= مستشار الطاقة =================
// يحلل آخر 7 أيام كاملة + اليوم من السجل الفعلي، ولا يعرض إلا ما يمكن حسابه من القراءات
async function loadAdvisor() {
  const dates = Array.from({ length: 8 }, (_, i) => today(i - 7));
  const token = Symbol('adv');
  serverHistFails = 0;
  state.rep.adv = { loading: true, token, done: 0 };
  render();
  const sums = await loadSummaries(dates, (done, total) => {
    const p = $('#advProg');
    if (p && state.rep.adv?.token === token) p.style.width = (done / total) * 100 + '%';
  });
  if (state.rep.adv?.token !== token) return;
  state.rep.adv = { sums, at: Date.now() };
  if (leaf() === 'advisor') render();
}

function pageAdvisor() {
  const a = state.rep.adv;
  if (!a || a.loading) return `<div class="card"><p class="center">جارٍ تحليل آخر 7 أيام…</p><div class="bar"><i id="advProg" style="width:0%"></i></div>
    <p class="hint center">الأيام المكتملة تُحفظ، فيصبح التحليل أسرع في المرات القادمة.</p></div>`;
  const m = state.model;
  const ctx = { todayKey: today(), prefs: state.prefs, ratedW: m?.ratedW || null, volts: m?.ratedV || nominalV(m), model: m };
  const r = analyze(a.sums, ctx);
  const b = r.battery;
  const ind = r.independence;
  const lvl = { ok: 'ok', warn: 'warn', bad: 'bad', info: 'info' };
  return `
  <section class="card adv-ind">
    <div class="card-h"><h2>${icons.sun} مؤشر الاستقلالية عن الكهرباء</h2><small class="muted">${r.days ? 'آخر ' + countAr(r.days, DAY) + ' مكتملة' : ''}</small></div>
    ${ind == null ? '<p class="hint">يحتاج المؤشر إلى وضع التشغيل (شبكة/بطارية) في سجل الجهاز ليوم كامل على الأقل.</p>' : `
    <div class="adv-big"><b>${Math.round(ind)}%</b><span>من استهلاك بيتك جاء من الألواح والبطارية</span></div>
    <div class="bar"><i style="width:${Math.round(ind)}%"></i></div>
    <div class="adv-days">${r.independenceDays.map((d) => `<span title="${Math.round(d.v)}%"><i style="height:${Math.max(4, Math.round(d.v))}%"></i><small>${Number(d.date.slice(8))}</small></span>`).join('')}</div>`}
  </section>

  <div class="stats">
    ${stat('متوسط الإنتاج', fmt.kwh(r.avgPv), 'ك.و.س / يوم', 'c-amber')}
    ${stat('متوسط الاستهلاك', fmt.kwh(r.avgLoad), 'ك.و.س / يوم', 'c-sky')}
    ${stat('شحن من الألواح', fmt.kwh(r.solarChg), 'ك.و.س في الفترة', 'c-green')}
    ${stat('شحن من الكهرباء', fmt.kwh(r.gridChg), 'ك.و.س في الفترة', 'c-violet')}
  </div>

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
    ${b.cyclesPerDay == null ? '<p class="hint">أدخل سعة البطارية من «المزيد ← المراقبة والبطارية» لحساب الدورات وكفاية البطارية لليل.</p>' : ''}
    ${b.soh == null ? '<p class="hint">جهازك لا يرسل حالة صحة البطارية (SOH)، لذلك لا نعرض نسبة تدهور مقدّرة حتى لا تكون مضلّلة.</p>' : ''}
  </section>

  <h3 class="sec-h">توصيات</h3>
  ${r.tips.length ? r.tips.map((t) => `<section class="card adv-tip ${lvl[t.level]}"><b>${esc(t.title)}</b><p>${esc(t.text)}</p></section>`).join('') : '<div class="empty">لا توجد أيام كاملة كافية للتحليل بعد. يحتاج المستشار إلى سجل يوم كامل على الأقل.</div>'}

  <p class="hint">كل الأرقام هنا من سجل جهازك الفعلي أو محسوبة منه مباشرة، والتوصيات مبنية على قواعد ثابتة وليست ذكاءً اصطناعياً.</p>
  <button class="btn ghost wide" id="advReload">${icons.refresh} إعادة التحليل</button>`;
}
AFTER.advisor = () => {
  if (!state.rep.adv || (!state.rep.adv.loading && Date.now() - state.rep.adv.at > 30 * 60000)) { loadAdvisor(); return; }
  const b = $('#advReload');
  if (b) b.onclick = loadAdvisor;
};

function pageCompare() {
  const k = state.rep.cmp;
  const r = state.rep.cmpData;
  const seg = `<div class="seg"><button data-cmp="week" class="${k === 'week' ? 'on' : ''}">أسبوعي</button><button data-cmp="month" class="${k === 'month' ? 'on' : ''}">شهري</button></div>`;
  if (!r || r.loading || r.kind !== k) return seg + '<div class="empty"><div class="spinner"></div>جارٍ تجميع البيانات للمقارنة…</div>';
  const [a, b] = k === 'week' ? ['آخر 7 أيام مكتملة', 'الأسبوع الذي قبله'] : ['هذا الشهر حتى أمس', 'نفس الفترة من الشهر السابق'];
  const row = (label, x, y, unit, better = 'up') => {
    const ch = x != null && y ? ((x - y) / y) * 100 : null;
    const good = ch === null || Math.abs(ch) < 1 ? '' : (ch > 0) === (better === 'up') ? 'good' : 'bad';
    return `<div class="cmp-row"><div class="cmp-l">${esc(label)}</div>
      <div class="cmp-v"><b>${x == null ? '—' : unit === 'ساعة' ? numAr(x, 0) : fmt.kwh(x)}</b><small>${esc(unit)}</small></div>
      <div class="cmp-v prev"><b>${y == null ? '—' : unit === 'ساعة' ? numAr(y, 0) : fmt.kwh(y)}</b><small>${esc(unit)}</small></div>
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

async function exportSamples(date, samples) {
  if (!samples.length) { toast('لا توجد قراءات لهذا اليوم', 'bad'); return; }
  await shareFile(`taqati-${date}.csv`, toCsv(
    ['الوقت', 'الوضع', 'الألواح (واط)', 'الحمل (واط)', 'البطارية (%)', 'جهد البطارية (فولت)', 'قدرة البطارية (واط)', 'جهد الكهرباء (فولت)'],
    samples.map((s) => [fmt.iso(s.ts), s.mode ? trValue(s.mode) : '', s.pvW, s.outW, s.soc, s.batV, s.batW, s.gridV]),
  ));
}

async function exportSummaries(name, sums) {
  await shareFile(`taqati-${name}.csv`, toCsv(
    ['التاريخ', 'الإنتاج (ك.و.س)', 'الاستهلاك (ك.و.س)', 'أدنى شحن %', 'أعلى شحن %', 'ذروة الحمل (واط)', 'ساعات الكهرباء', 'ساعات البطارية', 'شحن من الألواح (ك.و.س)', 'شحن من الكهرباء (ك.و.س)', 'الاستقلالية %', 'عدد القراءات', 'المصدر'],
    sums.map((s) => [s.date, s.pvKwh?.toFixed(2) ?? '', s.loadKwh?.toFixed(2) ?? '', s.socMin ?? '', s.socMax ?? '', s.peakW ?? '', s.gridH?.toFixed(1) ?? '', s.batH?.toFixed(1) ?? '',
      s.solarChgKwh?.toFixed(2) ?? '', s.gridChgKwh?.toFixed(2) ?? '', s.independence == null ? '' : Math.round(s.independence), s.count, SRC[s.source] || '']),
  ));
}

// ================= تبويب التنبيهات: سجل التنبيهات وسجل الأعطال في صفحة واحدة =================
function viewAlerts() {
  if (state.page === 'rules') return pageRules();
  const seg = state.alertSeg || 'alerts';
  const unread = state.alerts.filter((a) => !a.read).length;
  const list = seg === 'alerts' ? state.alerts : state.faults;
  const counts = state.faults.reduce((o, f) => ((o[f.kind] = (o[f.kind] || 0) + 1), o), {});
  const html = `
  ${listCards([{ page: 'rules', title: 'شروط التنبيه', sub: `البطارية ${state.prefs.lowSoc}% · الحمل ${state.prefs.overloadPct}% · ${state.prefs.bgMonitor && Capacitor.isNativePlatform() ? 'المراقبة في الخلفية مفعّلة' : 'المراقبة في الخلفية متوقفة'}`, icon: icons.sliders, color: 'c-violet' }])}
  <div class="seg"><button data-seg="alerts" class="${seg === 'alerts' ? 'on' : ''}">التنبيهات${unread ? ` (${unread})` : ''}</button><button data-seg="faults" class="${seg === 'faults' ? 'on' : ''}">الأعطال والانقطاعات</button></div>
  ${seg === 'faults' && state.faults.length ? `<div class="chips">
    <span class="chip">أعطال الإنفرتر: <b>${counts.fault || 0}</b></span><span class="chip">انقطاع الإنفرتر: <b>${counts.offline || 0}</b></span>
    <span class="chip">انقطاع الكهرباء: <b>${counts.grid || 0}</b></span><span class="chip">تعذّر الاتصال: <b>${counts.comm || 0}</b></span></div>` : ''}
  ${list.length ? '<div class="row-end"><button class="link" id="clearList">مسح السجل</button></div>' : ''}
  ${eventList(list, seg === 'alerts'
    ? 'لا توجد تنبيهات بعد. ستظهر هنا عند انقطاع الكهرباء أو انخفاض البطارية أو انقطاع الإنفرتر.'
    : 'لم يُسجّل أي عطل أو انقطاع حتى الآن.')}`;
  if (seg === 'alerts' && unread) { state.alerts.forEach((a) => { a.read = true; }); store.set('alerts', state.alerts); }
  return html;
}
AFTER.alerts = () => {
  document.querySelectorAll('[data-seg]').forEach((b) => { b.onclick = () => { state.alertSeg = b.dataset.seg; render(); }; });
  const c = $('#clearList');
  if (c) c.onclick = async () => {
    const faults = (state.alertSeg || 'alerts') === 'faults';
    if (!(await confirmDialog('مسح السجل', faults ? 'هل تريد حذف سجل الأعطال والانقطاعات؟' : 'هل تريد حذف كل التنبيهات؟'))) return;
    if (faults) { state.faults = []; store.set('faults', []); } else { state.alerts = []; store.set('alerts', []); }
    render();
  };
  setTimeout(renderHeader, 0);
};

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
    ${isNative ? toggle('bgMonitor', 'المراقبة والتطبيق مغلق', 'فحص كل 15 دقيقة تقريباً حتى بعد إغلاق التطبيق') : ''}
    ${numField('lowSoc', 'انخفاض البطارية إلى', '%', 5, 90)}
    ${numField('overloadPct', 'تجاوز الحمل نسبة', '%', 30, 120)}
    ${toggle('alertOffline', 'انقطاع اتصال الإنفرتر وعودته')}
    ${toggle('alertGrid', 'انقطاع كهرباء الشبكة وعودتها')}
    ${toggle('alertFull', 'اكتمال شحن البطارية')}
    ${toggle('alertTemp', 'ارتفاع الحرارة', state.model?.temps?.length ? 'يرسل جهازك: ' + state.model.temps.map((t) => t.ar).join('، ') : 'جهازك الحالي لا يرسل قراءات الحرارة، فلن يعمل هذا التنبيه')}
    ${numField('tempBat', 'حد حرارة البطارية', '°م', 30, 80)}
    ${numField('tempInv', 'حد حرارة الإنفرتر', '°م', 40, 110)}
  </div></section>
  <button class="btn ghost wide" id="testNotif">${icons.bell} إرسال إشعار تجريبي</button>
  <p class="hint">والتطبيق مفتوح يُفحص الإنفرتر كل دقيقة. ${isNative
    ? (state.prefs.bgMonitor
      ? 'وبعد إغلاقه يتولى نظام أندرويد الفحص كل 15 دقيقة تقريباً (أقل مدة يسمح بها النظام)، وقد يتأخر الفحص عند تفعيل توفير البطارية الشديد. لأفضل نتيجة اجعل «طاقتي» غير مقيّد في إعدادات البطارية بالهاتف.'
      : 'المراقبة بعد الإغلاق متوقفة، فلن تصل التنبيهات حتى تفتح التطبيق.')
    : 'المراقبة بعد إغلاق التطبيق متاحة في تطبيق الهاتف فقط.'}</p>
  <p class="hint">الأعطال والانقطاعات تُسجّل دائماً في «الأعطال والانقطاعات» حتى لو أوقفت إشعارها.</p>`;
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
      syncMonitor();
      if (k === 'staleMin' && state.model) state.model = normalize(state.model.raw.map((r) => ({ title: r.title, val: r.val, unit: r.unit })), state.prefs.staleMin, tzOffset());
      if (k === 'theme') { applyTheme(); render(); }
      toast('تم الحفظ', 'ok');
    };
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
  ${section('معلومات الجهاز', kv([['اسم الجهاز', val(d?.alias)], ['رقم الجهاز في الحساب', val(d?.sn)], ['رقم وحدة الواي فاي', val(d?.pn)], ...rows(product)]))}
  ${group('rated').length ? section('القيم المقنّنة', kv(rows(group('rated')))) : ''}
  ${group('config').length ? section('الإعدادات الحالية', kv(rows(group('config'))) + '<p class="hint">للعرض فقط. لتغييرها: «المزيد ← إعدادات الإنفرتر».</p>') : ''}
  <button class="btn ghost wide" data-goto="more:edit">${icons.wrench} تعديل إعدادات الإنفرتر</button>
  <p class="hint">يُعتبر الإنفرتر غير متصل إذا لم تصل منه قراءة جديدة منذ أكثر من ${countAr(state.prefs.staleMin, ['دقيقة', 'دقيقتين', 'دقائق', 'دقيقة'])}.</p>`;
}
AFTER.device = () => bindGoto();

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
    addFault('info', 'تغيير إعداد', `${trS(f.name)} ← ${shown}`);
    li.classList.remove('open');
    setTimeout(() => openField(li), 1500);
  } catch (e) {
    toast(e.message, 'bad');
  } finally {
    delete li.dataset.sending;
    li.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  }
}

// ================= تبويب النصائح =================
const LEVEL = { bad: ['bad', icons.warn], warn: ['warn', icons.warn], info: ['info', icons.info], ok: ['ok', icons.check] };

function smartList(list) {
  return `<ul class="alerts">${list.map((t) => `
    <li class="alert ${LEVEL[t.level][0]}"><div class="a-ic">${LEVEL[t.level][1]}</div>
      <div><b>${esc(t.title)}</b><p>${esc(t.body)}</p></div></li>`).join('')}</ul>`;
}

function viewTips() {
  if (state.page === 'tips/smart') {
    const list = smartTips(state.model, state.prefs);
    return `${state.demo ? banner() : ''}${list.length ? smartList(list) : '<div class="empty">لا توجد بيانات من الجهاز بعد.</div>'}
      <p class="hint">هذه النصائح مبنية على قراءات جهازك وإعداداته الحالية وتتحدّث تلقائياً. هي إرشادات عامة، وتبقى مواصفات الشركة المصنعة لجهازك وبطاريتك هي المرجع.</p>`;
  }
  const sec = TIP_SECTIONS.find((x) => 'tips/' + x.id === state.page);
  if (sec) {
    return `<section class="hero ${sec.color}"><span class="g-deco">${icons[sec.icon]}</span><div class="h-ic">${icons[sec.icon]}</div>
        <b class="hero-t">${esc(sec.title)}</b><span>${esc(sec.sub)} · ${countAr(sec.tips.length, ['نصيحة واحدة', 'نصيحتان', 'نصائح', 'نصيحة'])}</span></section>
      <div class="tips">${sec.tips.map(([title, body], i) => `
        <article class="tip ${sec.color}"><span class="tip-n">${i + 1}</span>
          <div><h3>${esc(title)}</h3><p>${esc(body).replace(/\n/g, '<br>')}</p></div></article>`).join('')}</div>`;
  }
  const smart = smartTips(state.model, state.prefs);
  const urgent = smart.filter((t) => t.level === 'bad' || t.level === 'warn').length;
  const tod = tipOfDay();
  return `
  <section class="intro"><h2>نصائح وإرشادات</h2><p>لتستفيد من منظومتك بأمان وتطيل عمر الإنفرتر والبطارية.</p></section>
  <section class="tod"><div class="tod-h">${icons.star}<span>نصيحة اليوم · ${esc(tod.section)}</span></div>
    <b>${esc(tod.title)}</b><p>${esc(tod.body).replace(/\n/g, '<br>')}</p></section>
  ${listCards([{ page: 'tips/smart', title: 'نصائح لجهازك الآن', sub: state.model ? `${smart.length} ملاحظة من قراءات جهازك وإعداداته` : 'تظهر بعد وصول بيانات الجهاز', icon: icons.bulb, color: urgent ? 'c-pink' : 'c-violet', badge: urgent ? `${urgent} مهم` : '' }])}
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
function viewMore() {
  if (state.page?.startsWith('tips')) return viewTips();
  const pages = { setup: () => setupGuide(true), edit: pageEdit, custom: pageCustom, monitor: pageMonitor, account: pageAccount, about: pageAbout, update: pageUpdate };
  if (state.page && pages[state.page]) return pages[state.page]();
  const themeName = { auto: 'تلقائي', dark: 'ليلي', light: 'نهاري' }[state.prefs.theme];
  const urgent = smartTips(state.model, state.prefs).filter((t) => t.level === 'bad' || t.level === 'warn').length;
  return `
  <section class="dev-card dev-top">
    <div class="dev-av">${icons.user}</div>
    <div><small>تطبيق طاقتي · من تطوير</small><b>حسين محمد علي الطويل</b></div>
    <button class="dev-more" data-page="about" aria-label="حول التطبيق">${icons.info}</button>
  </section>
  ${listCards([
    { page: 'edit', title: 'إعدادات الإنفرتر', sub: 'تغيير الأولويات وتيارات الشحن عن بُعد', icon: icons.wrench, color: 'c-pink' },
    { page: 'setup', title: 'ربط الجهاز والحساب', sub: 'إنشاء حساب، إعداد الواي فاي (Wi-Fi Config)، البلوتوث', icon: icons.wifi, color: 'c-sky' },
    { page: 'tips', title: 'النصائح', sub: 'نصائح لجهازك، واستخدام الإنفرتر وبطاريات الليثيوم والسلامة', icon: icons.bulb, color: 'c-amber', badge: urgent ? `${urgent} مهم` : '' },
    { page: 'monitor', title: 'المراقبة والبطارية', sub: `${state.prefs.batteryAh ? `البطارية ${state.prefs.batteryAh} أمبير ساعة` : 'أدخل سعة البطارية'}`, icon: icons.gauge, color: 'c-green' },
    { page: 'custom', title: 'المظهر والمصطلحات', sub: themeName, icon: icons.moon, color: 'c-violet' },
    { page: 'account', title: 'الحساب', sub: state.demo ? 'وضع تجريبي' : state.session?.usr || '', icon: icons.user, color: 'c-sky' },
    { page: 'update', title: 'التحقق من التحديثات', sub: updateAvailable() ? `يتوفر الإصدار ${state.update.version}` : 'الإصدار الحالي ' + VERSION, icon: icons.upgrade, color: 'c-amber', badge: updateAvailable() ? 'جديد' : '' },
    { page: 'about', title: 'حول التطبيق', sub: 'طاقتي · الإصدار ' + VERSION, icon: icons.info, color: 'c-slate' },
  ])}
  <button class="btn danger wide logout-btn" id="logoutBtn">${icons.logout} ${state.demo ? 'الخروج من الوضع التجريبي' : 'تسجيل الخروج'}</button>
  <p class="foot">طاقتي · الإصدار ${VERSION}</p>`;
}
AFTER.more = () => {
  $('#logoutBtn').onclick = async () => {
    if (await confirmDialog('تسجيل الخروج', state.demo ? 'هل تريد الخروج من الوضع التجريبي؟' : 'هل تريد تسجيل الخروج؟ ستبقى التقارير المحفوظة على الهاتف.')) logout();
  };
};

function pageCustom() {
  const sizes = [[0.9, 'صغير'], [1, 'عادي'], [1.1, 'كبير'], [1.2, 'أكبر']];
  return `<section class="card"><div class="card-h"><h2>المظهر</h2></div>${pageTheme()}</section>
  <section class="card"><div class="card-h"><h2>حجم الخط</h2></div>
    <div class="theme-opts">${sizes.map(([v, l]) => `<button class="theme-opt fs-opt ${Number(state.prefs.fontScale || 1) === v ? 'on' : ''}" data-fs="${v}"><b style="font-size:${Math.round(15 * v)}px">أ</b><b>${l}</b></button>`).join('')}</div>
    <p class="hint center">يغيّر حجم النصوص في كل التطبيق، وتتكيّف البطاقات معه.</p></section>`;
}
AFTER.custom = () => {
  AFTER.theme();
  document.querySelectorAll('[data-fs]').forEach((b) => {
    b.onclick = () => { state.prefs.fontScale = Number(b.dataset.fs); savePrefs(); applyTheme(); render(); };
  });
};

function pageMonitor() {
  return `<section class="card"><div class="card-h"><h2>البطارية</h2></div>${pageBatCfg()}</section>
    <section class="card"><div class="card-h"><h2>الاتصال والتحديث</h2></div>${pageConn()}</section>`;
}
AFTER.monitor = () => bindPrefs($('#view'));

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
  return `<div class="form">
      ${numField('batteryAh', 'سعة البطارية', 'أمبير ساعة', 10, 5000, 'مثال: 200')}
      ${numField('cutoffSoc', 'أدنى نسبة مسموح التفريغ إليها', '%', 0, 60)}
    </div>
    <p class="hint">تُستخدم السعة مع جهد البطارية المقنّن ${rated ? `(${rated} فولت من الإنفرتر)` : `(${nominalV(state.model)} فولت، مقدّر من جهد البطارية)`} لحساب المدة المتبقية للتفريغ أو الشحن. بدون السعة لا يعرض التطبيق أي تقدير حتى لا يكون مضلّلاً.</p>
    <p class="hint">إذا كانت لديك عدة بطاريات على التوازي فاجمع سعاتها (مثلاً بطاريتان 100 أمبير = 200).</p>`;
}

function pageConn() {
  return `<div class="form">
      ${numField('staleMin', 'اعتبار الإنفرتر غير متصل بعد', 'دقيقة', 5, 180)}
    </div>
    <p class="hint">يرسل الإنفرتر قراءة جديدة إلى الخادم كل بضع دقائق. إذا مرّت المدة أعلاه دون قراءة جديدة يُعرض الإنفرتر «غير متصل» وتتوقف الحسابات المبنية على القيم الحية.</p>
    <p class="hint">آخر بيانات تُحفظ على الهاتف وتظهر حتى بدون إنترنت، مع توضيح وقتها.</p>`;
}

function pageAccount() {
  const d = device();
  return `<section class="card">
    ${state.devices.length > 1 ? `<label class="num-row"><span>الجهاز المعروض</span><select id="devSel">${state.devices.map((x) => `<option value="${esc(x.sn)}" ${x.sn === d?.sn ? 'selected' : ''}>${esc(x.alias)}</option>`).join('')}</select></label>` : ''}
    ${kv([['الحساب', val(state.demo ? 'وضع تجريبي' : state.session?.usr)], ['الجهاز', val(d?.alias)], ['عدد الأجهزة', val(String(state.devices.length))], ['الخادم', val(state.demo ? '—' : state.session?.profile === 'shine' ? 'ShineMonitor' : 'DessMonitor')]])}
  </section>
  <p class="hint">لتسجيل الخروج ارجع إلى صفحة «المزيد» واضغط الزر الأحمر في آخرها.</p>`;
}
AFTER.account = () => {
  const sel = $('#devSel');
  if (sel) sel.onchange = () => {
    state.devSn = sel.value; store.set('devSn', sel.value);
    state.model = null; state.fields = null;
    resetAlertState();
    state.rep = { ...state.rep, day: null, week: null, month: null, cmpData: null, adv: null };
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
async function boot() {
  applyTheme();
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

// للاختبارات الآلية في المتصفح فقط
if (!isNative) window.__nav = navigate;

boot();
