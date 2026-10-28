import './styles.css';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend,
} from 'chart.js';
import { WatchPowerApi, ApiError } from './api.js';
import { normalize, demoPoints, demoHistory, historySeries, arTitle, arMode, fmt } from './model.js';
import { icons } from './icons.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Filler, Tooltip, Legend);
Chart.defaults.font.family = 'Cairo, system-ui, sans-serif';
Chart.defaults.color = '#9aa7c7';

// ---------------- الحالة والتخزين ----------------
const store = {
  get(k, d) {
    try { const v = localStorage.getItem('taqati.' + k); return v ? JSON.parse(v) : d; } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem('taqati.' + k, JSON.stringify(v)); } catch { /* تجاهل */ }
  },
  del(k) { try { localStorage.removeItem('taqati.' + k); } catch { /* تجاهل */ } },
};

const DEFAULT_PREFS = {
  pollSec: 30,
  batteryAh: 100,
  batteryNominalV: 48,
  cutoffSoc: 20,
  notify: true,
  lowSoc: 30,
  overloadPct: 80,
  alertGrid: true,
  alertFull: true,
};

const state = {
  session: store.get('session', null),
  demo: store.get('demo', false),
  devices: store.get('devices', []),
  devSn: store.get('devSn', null),
  prefs: { ...DEFAULT_PREFS, ...store.get('prefs', {}) },
  alerts: store.get('alerts', []),
  tab: 'home',
  model: null,
  updatedAt: null,
  error: null,
  loading: false,
  fails: 0,
  flags: store.get('flags', {}),
  histDate: today(),
  hist: null,
  histLoading: false,
  fields: null,
  fieldsError: null,
};

let api = new WatchPowerApi(state.session || {});
let pollTimer = null;
const charts = [];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const device = () => state.devices.find((d) => d.sn === state.devSn) || state.devices[0];

function today(offset = 0) {
  const d = new Date(Date.now() + offset * 864e5);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
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

// ---------------- تسجيل الدخول ----------------
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
      <label>اسم المستخدم في WatchPower
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
  </div>`;

  $('#demoBtn').onclick = () => {
    state.demo = true;
    store.set('demo', true);
    state.devices = [{ sn: 'DEMO', pn: 'W0000000000000', alias: 'Master 7KW (تجريبي)', devcode: 0, devaddr: 1, status: 0 }];
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
  ['session', 'devices', 'devSn', 'demo', 'samples'].forEach(store.del);
  state.session = null;
  state.demo = false;
  state.devices = [];
  state.model = null;
  state.hist = null;
  state.fields = null;
  api = new WatchPowerApi();
  renderLogin();
}

// ---------------- الهيكل العام ----------------
const TABS = [
  ['home', 'الرئيسية', icons.bolt],
  ['charts', 'السجل', icons.chart],
  ['alerts', 'التنبيهات', icons.bell],
  ['settings', 'الإعدادات', icons.gear],
];

function startApp() {
  document.getElementById('app').innerHTML = `
    <header class="topbar">
      <div class="dev">
        <span class="dot" id="onlineDot"></span>
        <div>
          <div class="dev-name" id="devName"></div>
          <div class="dev-sub" id="updated">—</div>
        </div>
      </div>
      <button class="icon-btn" id="refreshBtn" aria-label="تحديث">${icons.refresh}</button>
    </header>
    <main id="view"></main>
    <nav class="tabbar">${TABS.map(([id, label, ic]) => `
      <button data-tab="${id}" class="${state.tab === id ? 'on' : ''}">${ic}<span>${label}</span>${id === 'alerts' ? '<i class="badge" id="alertBadge"></i>' : ''}</button>`).join('')}
    </nav>`;
  $('.tabbar').onclick = (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  };
  $('#refreshBtn').onclick = () => { refresh(true); if (state.tab === 'charts') loadHistory(); };
  renderHeader();
  render();
  refresh();
  startPolling();
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  render();
  $('#view').scrollTop = 0;
  window.scrollTo(0, 0);
}

function renderHeader() {
  const d = device();
  $('#devName').textContent = d?.alias || 'جهازي';
  const up = state.updatedAt;
  $('#updated').textContent = state.error ? state.error : up ? `آخر تحديث ${up.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'جارٍ التحميل…';
  $('#onlineDot').className = 'dot ' + (state.error ? 'off' : up ? 'on' : '');
  $('#refreshBtn').classList.toggle('spin', state.loading);
  const unread = state.alerts.filter((a) => !a.read).length;
  const badge = $('#alertBadge');
  if (badge) { badge.textContent = unread || ''; badge.style.display = unread ? '' : 'none'; }
}

function render() {
  charts.splice(0).forEach((c) => c.destroy());
  const v = $('#view');
  if (!v) return;
  if (state.tab === 'home') v.innerHTML = viewHome();
  if (state.tab === 'charts') { v.innerHTML = viewCharts(); bindCharts(); }
  if (state.tab === 'alerts') { v.innerHTML = viewAlerts(); bindAlerts(); }
  if (state.tab === 'settings') { v.innerHTML = viewSettings(); bindSettings(); }
}

// ---------------- جلب البيانات ----------------
async function refresh(manual = false) {
  const d = device();
  if (!d || state.loading) return;
  state.loading = true;
  renderHeader();
  try {
    const points = state.demo ? demoPoints() : await api.lastData(d);
    if (!points.length) throw new ApiError('الجهاز لم يرسل بيانات بعد');
    state.model = normalize(points);
    state.updatedAt = new Date();
    state.error = null;
    state.fails = 0;
    if (!state.demo) { state.session = api.session; store.set('session', state.session); }
    checkAlerts(state.model);
    if (manual) toast('تم التحديث', 'ok');
  } catch (err) {
    state.fails++;
    state.error = err.message;
    if (state.fails === 3) raise('offline', 'انقطع الاتصال بالجهاز', 'تعذّر جلب البيانات 3 مرات متتالية: ' + err.message, 'warn');
    if (manual) toast(err.message, 'bad');
  } finally {
    state.loading = false;
    renderHeader();
    if (state.tab === 'home') updateHome();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => refresh(), Math.max(10, state.prefs.pollSec) * 1000);
}
function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }

// ---------------- الرئيسية ----------------
function flowLine(id, d) {
  return `<path class="wire" d="${d}"/><path class="flow" id="${id}" d="${d}"/>`;
}

function viewHome() {
  return `
  <section class="mode-pill" id="modePill">—</section>
  <section class="card flow-card">
    <svg viewBox="0 0 360 380" class="flow-svg">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#4f7cff" stop-opacity=".45"/><stop offset="1" stop-color="#4f7cff" stop-opacity="0"/></radialGradient>
      </defs>
      <circle cx="180" cy="190" r="85" fill="url(#glow)"/>
      ${flowLine('fSolar', 'M180 124 L180 154')}
      ${flowLine('fGrid', 'M78 190 L144 190')}
      ${flowLine('fLoad', 'M216 190 L282 190')}
      ${flowLine('fBat', 'M180 226 L180 264')}
    </svg>
    <div class="node n-solar" id="nSolar"><div class="ic">${icons.panel}</div><b>—</b><small>الألواح</small></div>
    <div class="node n-grid" id="nGrid"><div class="ic">${icons.grid}</div><b>—</b><small>الوطنية</small></div>
    <div class="node n-load" id="nLoad"><div class="ic">${icons.home}</div><b>—</b><small>المنزل</small></div>
    <div class="node n-bat" id="nBat"><div class="ic">${icons.battery}</div><b>—</b><small>البطارية</small></div>
    <div class="node n-inv"><div class="ic">${icons.inverter}</div></div>
  </section>

  <section class="card battery-card">
    <div class="ring" id="socRing">
      <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" class="ring-bg"/><circle cx="60" cy="60" r="52" class="ring-fg" id="socArc"/></svg>
      <div class="ring-txt"><b id="socTxt">—</b><small>الشحن</small></div>
    </div>
    <div class="bat-info">
      <div class="bat-state" id="batState">—</div>
      <div class="bat-eta" id="batEta">—</div>
      <div class="bat-sub" id="batSub">—</div>
    </div>
  </section>

  <section class="tiles">
    <div class="tile t-solar"><div class="t-ic">${icons.sun}</div><small>إنتاج الألواح</small><b id="tPv">—</b><span id="tPvSub"></span></div>
    <div class="tile t-load"><div class="t-ic">${icons.home}</div><small>الاستهلاك</small><b id="tLoad">—</b><span id="tLoadSub"></span></div>
    <div class="tile t-grid"><div class="t-ic">${icons.grid}</div><small>الكهرباء الوطنية</small><b id="tGrid">—</b><span id="tGridSub"></span></div>
    <div class="tile t-bat"><div class="t-ic">${icons.battery}</div><small>جهد البطارية</small><b id="tBat">—</b><span id="tBatSub"></span></div>
  </section>

  <section class="card">
    <div class="card-h"><h2>نسبة الحمل</h2><span id="loadPctTxt">—</span></div>
    <div class="bar"><i id="loadBar"></i></div>
    <div class="bar-legend"><span>0</span><span id="ratedTxt">القدرة القصوى 6500 واط</span></div>
  </section>

  <section class="card">
    <div class="card-h"><h2>كل القراءات</h2></div>
    <dl class="kv" id="allData"></dl>
  </section>`;
}

function setFlow(id, watts, reverse = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const active = Math.abs(watts) > 5;
  el.classList.toggle('on', active);
  el.classList.toggle('rev', reverse);
  // كلما زادت القدرة زادت سرعة الحركة
  const dur = active ? Math.max(0.35, 2.4 - Math.log10(Math.abs(watts) + 1) * 0.55) : 0;
  el.style.animationDuration = dur + 's';
}

function batteryEta(m) {
  const p = state.prefs;
  const wh = p.batteryAh * (p.batteryNominalV || 48);
  if (m.battery.w < -10) {
    const usable = Math.max(0, (m.battery.soc - p.cutoffSoc) / 100) * wh;
    return { text: 'تكفي لمدة ' + fmt.hours(usable / -m.battery.w), sub: `حتى ${p.cutoffSoc}% بمعدل السحب الحالي` };
  }
  if (m.battery.w > 10) {
    const need = Math.max(0, (100 - m.battery.soc) / 100) * wh;
    return { text: 'تكتمل خلال ' + fmt.hours(need / m.battery.w), sub: 'تقدير بمعدل الشحن الحالي' };
  }
  return { text: m.battery.soc >= 99 ? 'البطارية ممتلئة' : 'البطارية مستقرة', sub: '' };
}

function updateHome() {
  const m = state.model;
  if (!m || !$('#modePill')) return;
  const isBattery = /battery/i.test(m.mode);
  const isLine = /line|bypass/i.test(m.mode);
  const pill = $('#modePill');
  pill.textContent = arMode(m.mode);
  pill.className = 'mode-pill ' + (isBattery ? 'm-bat' : isLine ? 'm-line' : /fault/i.test(m.mode) ? 'm-fault' : '');

  const node = (id, val, dim) => {
    const n = document.getElementById(id);
    n.querySelector('b').textContent = val;
    n.classList.toggle('dim', dim);
  };
  node('nSolar', fmt.wShort(m.pv.w), m.pv.w <= 5);
  node('nGrid', m.grid.v ? `${m.grid.v.toFixed(0)}V` : 'مقطوعة', m.grid.v < 90);
  node('nLoad', fmt.wShort(m.load.w), m.load.w <= 5);
  node('nBat', `${m.battery.soc}%`, false);

  setFlow('fSolar', m.pv.w);
  setFlow('fGrid', isLine ? Math.max(m.grid.w, 50) : 0);
  setFlow('fLoad', m.load.w);
  // البطارية: الشحن يتجه نحوها (لأسفل)، والتفريغ يخرج منها (لأعلى)
  setFlow('fBat', m.battery.w, m.battery.w < 0);

  const soc = Math.max(0, Math.min(100, m.battery.soc));
  const C = 2 * Math.PI * 52;
  const arc = $('#socArc');
  arc.style.strokeDasharray = `${(soc / 100) * C} ${C}`;
  arc.style.stroke = soc < 25 ? '#f87171' : soc < 50 ? '#fbbf24' : '#34d399';
  $('#socTxt').textContent = soc + '%';
  $('#batState').textContent = m.battery.w > 10 ? `تشحن ${fmt.w(m.battery.w)}` : m.battery.w < -10 ? `تُفرّغ ${fmt.w(-m.battery.w)}` : 'في وضع الراحة';
  $('#batState').className = 'bat-state ' + (m.battery.w > 10 ? 'chg' : m.battery.w < -10 ? 'dis' : '');
  const eta = batteryEta(m);
  $('#batEta').textContent = eta.text;
  $('#batSub').textContent = `${m.battery.v.toFixed(1)} فولت · ${eta.sub}`;

  $('#tPv').textContent = fmt.w(m.pv.w);
  $('#tPvSub').textContent = m.pv.v ? `${m.pv.v.toFixed(0)} فولت` : 'لا يوجد إشعاع';
  $('#tLoad').textContent = fmt.w(m.load.w);
  $('#tLoadSub').textContent = `${m.load.v.toFixed(0)} فولت · ${m.load.va} VA`;
  $('#tGrid').textContent = m.grid.v >= 90 ? `${m.grid.v.toFixed(1)} فولت` : 'مقطوعة';
  $('#tGridSub').textContent = m.grid.v >= 90 ? `${m.grid.hz.toFixed(1)} هرتز${isLine ? ' · تغذّي الحمل' : ' · احتياط'}` : '';
  $('#tBat').textContent = `${m.battery.v.toFixed(1)} فولت`;
  $('#tBatSub').textContent = `شحن ${m.battery.chgA}A · تفريغ ${m.battery.disA}A`;

  const pct = Math.max(0, Math.min(100, m.load.pct));
  $('#loadPctTxt').textContent = pct + '%';
  const bar = $('#loadBar');
  bar.style.width = pct + '%';
  bar.className = pct >= state.prefs.overloadPct ? 'hot' : pct >= 50 ? 'warm' : '';

  $('#allData').innerHTML = m.raw.map((p) => `<dt>${esc(arTitle(p.title))}</dt><dd>${esc(p.val)} <small>${esc(p.unit || '')}</small></dd>`).join('');
}

// ---------------- السجل والرسوم ----------------
function viewCharts() {
  const s = state.hist;
  const label = state.histDate === today() ? 'اليوم' : state.histDate === today(-1) ? 'أمس' : state.histDate;
  let body;
  if (state.histLoading) body = '<div class="empty"><div class="spinner"></div>جارٍ تحميل سجل اليوم…</div>';
  else if (!s) body = '<div class="empty">اضغط تحديث لتحميل السجل</div>';
  else if (s.error) body = `<div class="empty bad">${esc(s.error)}</div>`;
  else if (!s.t.length) body = '<div class="empty">لا توجد بيانات مسجّلة لهذا اليوم</div>';
  else {
    const socs = s.soc.filter((x) => x != null);
    const maxLoad = Math.max(0, ...s.load.filter((x) => x != null));
    body = `
    <section class="tiles">
      <div class="tile t-solar"><small>إنتاج الألواح</small><b>${s.pvKwh.toFixed(2)}</b><span>كيلوواط ساعة</span></div>
      <div class="tile t-load"><small>الاستهلاك</small><b>${s.loadKwh.toFixed(2)}</b><span>كيلوواط ساعة</span></div>
      <div class="tile t-bat"><small>البطارية (أدنى / أعلى)</small><b>${socs.length ? Math.min(...socs) + '% / ' + Math.max(...socs) + '%' : '—'}</b><span>نسبة الشحن</span></div>
      <div class="tile t-grid"><small>ذروة الاستهلاك</small><b>${fmt.w(maxLoad)}</b><span>أعلى حمل خلال اليوم</span></div>
    </section>
    <section class="card"><div class="card-h"><h2>القدرة خلال اليوم</h2></div><div class="chart-box"><canvas id="cPower"></canvas></div></section>
    <section class="card"><div class="card-h"><h2>نسبة شحن البطارية</h2></div><div class="chart-box sm"><canvas id="cSoc"></canvas></div></section>
    <section class="card"><div class="card-h"><h2>جهد البطارية</h2></div><div class="chart-box sm"><canvas id="cBatV"></canvas></div></section>
    <section class="card"><div class="card-h"><h2>جهد الكهرباء الوطنية</h2></div><div class="chart-box sm"><canvas id="cGrid"></canvas></div></section>`;
  }
  return `
  <section class="day-nav card">
    <button class="icon-btn" data-day="-1" aria-label="اليوم السابق">${icons.chevR}</button>
    <label class="day-label"><b>${esc(label)}</b><input type="date" id="dayPick" value="${state.histDate}" max="${today()}"></label>
    <button class="icon-btn" data-day="1" aria-label="اليوم التالي" ${state.histDate >= today() ? 'disabled' : ''}>${icons.chevL}</button>
  </section>
  ${body}`;
}

function lineChart(id, labels, datasets, opts = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  charts.push(new Chart(el, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true, spanGaps: true, ...d,
        backgroundColor: (ctx) => {
          const { chartArea, ctx: c } = ctx.chart;
          if (!chartArea) return 'transparent';
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, d.borderColor + '55');
          g.addColorStop(1, d.borderColor + '00');
          return g;
        },
      })),
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: datasets.length > 1, labels: { boxWidth: 10, usePointStyle: true } },
        tooltip: { rtl: true, backgroundColor: '#0f1a33ee', padding: 10, titleFont: { weight: '700' } },
      },
      scales: {
        x: { ticks: { maxTicksLimit: 7, maxRotation: 0 }, grid: { display: false } },
        y: { grid: { color: '#ffffff10' }, ...opts.y },
      },
    },
  }));
}

function bindCharts() {
  $('.day-nav').onclick = (e) => {
    const b = e.target.closest('[data-day]');
    if (!b || b.disabled) return;
    const d = new Date(state.histDate + 'T12:00:00');
    d.setDate(d.getDate() + Number(b.dataset.day));
    state.histDate = d.toISOString().slice(0, 10);
    loadHistory();
  };
  $('#dayPick').onchange = (e) => { if (e.target.value) { state.histDate = e.target.value; loadHistory(); } };
  if (!state.hist && !state.histLoading) { loadHistory(); return; }
  const s = state.hist;
  if (!s || !s.t?.length) return;
  lineChart('cPower', s.t, [
    { label: 'الألواح (واط)', data: s.pv, borderColor: '#fbbf24' },
    { label: 'الاستهلاك (واط)', data: s.load, borderColor: '#38bdf8' },
  ], { y: { beginAtZero: true } });
  lineChart('cSoc', s.t, [{ label: 'الشحن %', data: s.soc, borderColor: '#34d399' }], { y: { min: 0, max: 100 } });
  lineChart('cBatV', s.t, [{ label: 'فولت', data: s.batV, borderColor: '#a78bfa' }]);
  lineChart('cGrid', s.t, [{ label: 'فولت', data: s.gridV, borderColor: '#f472b6' }], { y: { beginAtZero: true } });
}

async function loadHistory() {
  const d = device();
  if (!d) return;
  state.histLoading = true;
  if (state.tab === 'charts') render();
  try {
    const raw = state.demo ? demoHistory(state.histDate) : await api.dayHistory(d, state.histDate);
    state.hist = historySeries(raw);
  } catch (err) {
    state.hist = { error: err.message };
  } finally {
    state.histLoading = false;
    if (state.tab === 'charts') render();
  }
}

// ---------------- التنبيهات ----------------
async function notify(title, body) {
  if (!state.prefs.notify || !Capacitor.isNativePlatform()) return;
  try {
    await LocalNotifications.schedule({
      notifications: [{ id: Math.floor(Date.now() % 2e9), title, body}],
    });
  } catch { /* تجاهل */ }
}

function raise(key, title, body, kind = 'warn') {
  state.alerts.unshift({ key, title, body, kind, at: Date.now(), read: false });
  state.alerts = state.alerts.slice(0, 100);
  store.set('alerts', state.alerts);
  notify(title, body);
  renderHeader();
  if (state.tab === 'alerts') render();
}

// كل تنبيه يُطلق مرة واحدة عند تجاوز الحد، ثم يُعاد تسليحه عند العودة للوضع الطبيعي
function edge(key, active, onRaise, onClear) {
  const was = !!state.flags[key];
  if (active && !was) onRaise?.();
  if (!active && was) onClear?.();
  state.flags[key] = active;
  store.set('flags', state.flags);
}

function checkAlerts(m) {
  const p = state.prefs;
  if (state.fails === 0 && state.flags.offline !== undefined) edge('offline', false);
  edge('lowSoc', m.battery.soc <= p.lowSoc && m.battery.w <= 0,
    () => raise('lowSoc', 'البطارية منخفضة', `نسبة الشحن ${m.battery.soc}% — قلّل الأحمال. ${batteryEta(m).text}`, 'bad'));
  edge('overload', m.load.pct >= p.overloadPct,
    () => raise('overload', 'حمل زائد', `الحمل وصل إلى ${m.load.pct}% (${fmt.w(m.load.w)})`, 'bad'));
  if (p.alertGrid) {
    edge('gridOff', m.grid.v < 90,
      () => raise('gridOff', 'انقطعت الكهرباء الوطنية', `المنظومة تعمل على البطارية (${m.battery.soc}%)`, 'warn'),
      () => raise('gridOn', 'عادت الكهرباء الوطنية', `الجهد ${m.grid.v.toFixed(0)} فولت`, 'ok'));
  }
  if (p.alertFull) {
    edge('full', m.battery.soc >= 100, () => raise('full', 'البطارية ممتلئة', 'وصل الشحن إلى 100% — وقت مناسب لتشغيل الأحمال الكبيرة', 'ok'));
  }
  edge('fault', /fault/i.test(m.mode), () => raise('fault', 'عطل في الإنفرتر', 'الجهاز في وضع العطل، راجع الإنفرتر', 'bad'));
}

function viewAlerts() {
  const kindIc = { bad: icons.warn, warn: icons.warn, ok: icons.check, info: icons.info };
  const list = state.alerts.length
    ? state.alerts.map((a) => `
      <li class="alert ${a.kind} ${a.read ? '' : 'new'}">
        <div class="a-ic">${kindIc[a.kind] || icons.info}</div>
        <div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><time>${new Date(a.at).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' })}</time></div>
      </li>`).join('')
    : '<li class="empty">لا توجد تنبيهات بعد. ستظهر هنا عند انقطاع الكهرباء أو انخفاض البطارية.</li>';
  state.alerts.forEach((a) => { a.read = true; });
  store.set('alerts', state.alerts);
  setTimeout(renderHeader, 0);
  return `
  <section class="card">
    <div class="card-h"><h2>شروط التنبيه</h2></div>
    <div class="form">
      ${toggle('notify', 'إشعارات على الهاتف')}
      ${numField('lowSoc', 'تنبيه عند انخفاض البطارية إلى', '%', 5, 90)}
      ${numField('overloadPct', 'تنبيه عند تجاوز الحمل', '%', 30, 120)}
      ${toggle('alertGrid', 'انقطاع وعودة الكهرباء الوطنية')}
      ${toggle('alertFull', 'اكتمال شحن البطارية')}
    </div>
    <p class="hint">التنبيهات تعمل ما دام التطبيق مفتوحاً أو في الخلفية. يُفحص الجهاز كل ${state.prefs.pollSec} ثانية.</p>
  </section>
  <section class="card">
    <div class="card-h"><h2>سجل التنبيهات</h2>${state.alerts.length ? '<button class="link" id="clearAlerts">مسح</button>' : ''}</div>
    <ul class="alerts">${list}</ul>
  </section>`;
}

function toggle(key, label) {
  return `<label class="sw-row"><span>${label}</span><input type="checkbox" class="sw" data-pref="${key}" ${state.prefs[key] ? 'checked' : ''}></label>`;
}
function numField(key, label, unit, min, max) {
  return `<label class="num-row"><span>${label}</span><span class="num-in"><input type="number" inputmode="numeric" data-pref="${key}" value="${state.prefs[key]}" min="${min}" max="${max}"><small>${unit}</small></span></label>`;
}

function bindPrefs(root) {
  root.querySelectorAll('[data-pref]').forEach((el) => {
    el.onchange = async () => {
      const k = el.dataset.pref;
      if (el.type === 'checkbox') state.prefs[k] = el.checked;
      else {
        const v = Number(el.value);
        const min = Number(el.min), max = Number(el.max);
        state.prefs[k] = Math.min(max, Math.max(min, Number.isFinite(v) ? v : DEFAULT_PREFS[k]));
        el.value = state.prefs[k];
      }
      store.set('prefs', state.prefs);
      if (k === 'notify' && el.checked && Capacitor.isNativePlatform()) {
        const r = await LocalNotifications.requestPermissions().catch(() => ({}));
        if (r.display !== 'granted') toast('لم يُسمح بالإشعارات من إعدادات الهاتف', 'bad');
      }
      if (k === 'pollSec') startPolling();
      toast('تم الحفظ', 'ok');
    };
  });
}

function bindAlerts() {
  bindPrefs($('#view'));
  const c = $('#clearAlerts');
  if (c) c.onclick = () => { state.alerts = []; store.set('alerts', []); render(); };
}

// ---------------- الإعدادات ----------------
const SETTING_AR = {
  'output source priority': 'أولوية مصدر الخرج',
  'charger source priority': 'أولوية مصدر الشحن',
  'ac input range': 'نطاق جهد الدخل',
  'battery type': 'نوع البطارية',
  'max charging current': 'أقصى تيار شحن',
  'max. charging current': 'أقصى تيار شحن',
  'max utility charging current': 'أقصى تيار شحن من الكهرباء',
  'max. utility charging current': 'أقصى تيار شحن من الكهرباء',
  'max ac charging current': 'أقصى تيار شحن من الكهرباء',
  'buzzer': 'صوت التنبيه',
  'backlight': 'إضاءة الشاشة',
  'overload restart': 'إعادة التشغيل بعد الحمل الزائد',
  'over temperature restart': 'إعادة التشغيل بعد ارتفاع الحرارة',
  'overload bypass': 'التمرير عند الحمل الزائد',
  'lcd return to default display': 'عودة الشاشة للعرض الافتراضي',
  'record fault code': 'تسجيل رموز الأعطال',
  'output voltage': 'جهد الخرج',
  'output frequency': 'تردد الخرج',
  'bulk charging voltage': 'جهد الشحن السريع (Bulk)',
  'floating charging voltage': 'جهد الشحن العائم (Float)',
  'battery cut-off voltage': 'جهد فصل البطارية',
  'low dc cut-off voltage': 'جهد فصل البطارية',
  'back to grid voltage': 'جهد العودة للكهرباء',
  'back to discharge voltage': 'جهد العودة للتفريغ',
  'battery equalization': 'معادلة البطارية',
  'beeps while primary source interrupt': 'تنبيه صوتي عند انقطاع المصدر',
};
const OPTION_AR = {
  'utility first': 'الكهرباء أولاً', 'solar first': 'الألواح أولاً', 'sbu priority': 'ألواح ← بطارية ← كهرباء (SBU)',
  'sub priority': 'ألواح ← كهرباء ← بطارية (SUB)', 'usb': 'كهرباء ← ألواح ← بطارية', 'sub': 'ألواح ← كهرباء ← بطارية',
  'sbu': 'ألواح ← بطارية ← كهرباء', 'solar + utility': 'الألواح والكهرباء معاً', 'only solar charging permitted': 'الشحن من الألواح فقط',
  'enable': 'مفعّل', 'disable': 'معطّل', 'enabled': 'مفعّل', 'disabled': 'معطّل', 'appliance': 'أجهزة منزلية (90-280V)', 'ups': 'UPS (170-280V)',
  'agm': 'AGM', 'flooded': 'سائلة', 'user': 'مخصّص', 'lib': 'ليثيوم', 'lithium': 'ليثيوم',
};
const trS = (s) => SETTING_AR[String(s).trim().toLowerCase()] || s;
const trO = (s) => OPTION_AR[String(s).trim().toLowerCase()] || s;

function viewSettings() {
  const d = device();
  let fields;
  if (state.demo) fields = '<p class="hint">إعدادات الإنفرتر متاحة بعد تسجيل الدخول بحسابك الحقيقي.</p>';
  else if (state.fieldsError) fields = `<div class="empty bad">${esc(state.fieldsError)}</div><button class="btn ghost" id="loadFields">إعادة المحاولة</button>`;
  else if (!state.fields) fields = '<button class="btn primary" id="loadFields">عرض إعدادات الإنفرتر</button>';
  else if (!state.fields.length) fields = '<p class="hint">هذا الجهاز لا يدعم تعديل الإعدادات عن بُعد.</p>';
  else {
    fields = `<p class="hint warn-hint">${icons.warn} تغيير هذه الإعدادات يؤثر على عمل الإنفرتر مباشرة. غيّر فقط ما تعرفه.</p>
      <ul class="fields">${state.fields.map((f, i) => `
        <li class="field" data-i="${i}">
          <button class="field-h"><span>${esc(trS(f.name))}</span><small>${esc(f.name !== trS(f.name) ? f.name : '')}</small>${icons.chevL}</button>
          <div class="field-b"></div>
        </li>`).join('')}</ul>`;
  }
  return `
  <section class="card">
    <div class="card-h"><h2>إعدادات الإنفرتر</h2></div>
    ${fields}
  </section>
  <section class="card">
    <div class="card-h"><h2>البطارية والتطبيق</h2></div>
    <div class="form">
      ${numField('batteryAh', 'سعة البطارية', 'أمبير ساعة', 10, 2000)}
      ${numField('batteryNominalV', 'جهد البطارية الاسمي', 'فولت', 12, 60)}
      ${numField('cutoffSoc', 'أدنى نسبة مسموح التفريغ إليها', '%', 0, 60)}
      ${numField('pollSec', 'تحديث البيانات كل', 'ثانية', 10, 600)}
    </div>
    <p class="hint">تُستخدم السعة لحساب المدة المتبقية للبطارية بدقة.</p>
  </section>
  <section class="card">
    <div class="card-h"><h2>الجهاز</h2></div>
    ${state.devices.length > 1 ? `<label class="num-row"><span>الجهاز المعروض</span><select id="devSel">${state.devices.map((x) => `<option value="${esc(x.sn)}" ${x.sn === d?.sn ? 'selected' : ''}>${esc(x.alias)}</option>`).join('')}</select></label>` : ''}
    <dl class="kv">
      <dt>الاسم</dt><dd>${esc(d?.alias)}</dd>
      <dt>الرقم التسلسلي</dt><dd dir="ltr">${esc(d?.sn)}</dd>
      <dt>رقم وحدة الواي فاي</dt><dd dir="ltr">${esc(d?.pn)}</dd>
      <dt>الحساب</dt><dd dir="ltr">${esc(state.demo ? 'وضع تجريبي' : state.session?.usr)}</dd>
    </dl>
    <button class="btn danger" id="logoutBtn">${icons.logout} ${state.demo ? 'الخروج من الوضع التجريبي' : 'تسجيل الخروج'}</button>
  </section>
  <p class="foot">طاقتي · الإصدار 1.0</p>`;
}

function bindSettings() {
  const v = $('#view');
  bindPrefs(v);
  $('#logoutBtn').onclick = async () => { if (await confirmDialog('تسجيل الخروج', 'هل تريد تسجيل الخروج من الحساب؟')) logout(); };
  const sel = $('#devSel');
  if (sel) sel.onchange = () => {
    state.devSn = sel.value; store.set('devSn', sel.value);
    state.model = null; state.hist = null; state.fields = null;
    renderHeader(); refresh(); render();
  };
  const lf = $('#loadFields');
  if (lf) lf.onclick = async () => {
    lf.disabled = true; lf.textContent = 'جارٍ التحميل…';
    try { state.fields = await api.ctrlFields(device()); state.fieldsError = null; } catch (e) { state.fieldsError = e.message; }
    render();
  };
  const list = $('.fields');
  if (list) list.onclick = (e) => {
    const h = e.target.closest('.field-h');
    if (h) openField(h.parentElement);
  };
}

async function openField(li) {
  const open = li.classList.toggle('open');
  if (!open) return;
  const f = state.fields[Number(li.dataset.i)];
  const body = li.querySelector('.field-b');
  body.innerHTML = '<div class="spinner sm"></div>';
  let cur = '';
  try {
    const r = await api.ctrlValue(device(), f.id);
    cur = r.val ?? '';
  } catch (e) {
    body.innerHTML = `<div class="err">${esc(e.message)}</div>`;
    return;
  }
  const items = f.item || [];
  const input = items.length
    ? `<select class="f-in">${items.map((it) => `<option value="${esc(it.key)}" ${String(it.key) === String(cur) || String(it.val) === String(cur) ? 'selected' : ''}>${esc(trO(it.val))}</option>`).join('')}</select>`
    : `<span class="num-in"><input class="f-in" dir="ltr" inputmode="decimal" value="${esc(cur)}"><small>${esc(f.unit || '')}</small></span>`;
  const curLabel = items.find((it) => String(it.key) === String(cur) || String(it.val) === String(cur));
  body.innerHTML = `
    <div class="cur">القيمة الحالية: <b>${esc(curLabel ? trO(curLabel.val) : cur || '—')} ${esc(!items.length ? f.unit || '' : '')}</b></div>
    ${f.hint ? `<p class="hint" dir="ltr">${esc(f.hint)}</p>` : ''}
    <div class="f-row">${input}<button class="btn primary f-save">حفظ</button></div>`;
  body.querySelector('.f-save').onclick = async () => {
    const inp = body.querySelector('.f-in');
    const val = inp.value.trim();
    const shown = items.length ? inp.options[inp.selectedIndex].text : `${val} ${f.unit || ''}`;
    if (!val) return;
    const ok = await confirmDialog('تأكيد التغيير', `سيتم تغيير <b>${esc(trS(f.name))}</b> إلى <b>${esc(shown)}</b> على الإنفرتر مباشرة. هل أنت متأكد؟`);
    if (!ok) return;
    try {
      await api.setCtrl(device(), f.id, val);
      toast('تم إرسال الإعداد إلى الإنفرتر', 'ok');
      li.classList.remove('open');
      setTimeout(() => openField(li), 1500);
    } catch (e) {
      toast(e.message, 'bad');
    }
  };
}

// ---------------- التشغيل ----------------
async function boot() {
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#0a1226' }).catch(() => {});
    CapApp.addListener('resume', () => { if (state.session || state.demo) refresh(); });
    CapApp.addListener('backButton', () => { if (state.tab !== 'home') switchTab('home'); else CapApp.minimizeApp(); });
    if (state.prefs.notify) LocalNotifications.requestPermissions().catch(() => {});
  }
  if (state.demo || (state.session?.token && state.devices.length)) startApp();
  else renderLogin();
}

boot();
