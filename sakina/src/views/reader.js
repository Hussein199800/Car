// صفحة قراءة الأذكار: وضع الخشوع والتركيز (بطاقة واحدة + حلقة تقدّم) ووضع القائمة الكلاسيكي
import { state, save, doneOf } from '../store.js';
import { icon } from '../icons.js';
import { num, esc } from '../text.js';
import { CATEGORY_BY_ID } from '../data/adhkar.js';
import { itemsOf, countOnce, resetCat, catProgress } from '../services.js';
import { ring, refresh } from './common.js';
import { toolsRow } from './dhikr.js';
import { tapFeedback, confirmSheet, toast, dhikrText, applyTheme } from '../ui.js';

export const full = true;
export const tab = 'library';

let catId = '';
let items = [];
let idx = 0;
let advanceTimer;

const META = {
  favorites: { title: 'المفضلة', icon: 'heart', empty: 'لم تحفظ أي ذكر بعد. اضغط على أيقونة القلب في أي ذكر ليظهر هنا.' },
  custom: { title: 'أذكاري الخاصة', icon: 'edit', empty: 'أضف أدعيتك وأذكارك الخاصة، وحدّد عدد تكرارها، وستُحفظ على جهازك.' },
};
const titleOf = (id) => (CATEGORY_BY_ID[id] ? CATEGORY_BY_ID[id].title : META[id].title);

const totals = () => {
  const total = items.length;
  const done = items.filter((it) => doneOf(it.id) >= it.n).length;
  return { total, done };
};

function header() {
  const { total, done } = totals();
  const s = state.settings;
  const focus = s.readMode === 'focus';
  return `<header class="reader-bar">
    <div class="rb-top">
      <button class="icon-btn" data-act="back" aria-label="رجوع">${icon('back')}</button>
      <div class="rb-title"><b>${titleOf(catId)}</b><small data-rb-count>${num(done)} من ${num(total)} مكتمل</small></div>
      ${catId === 'custom' ? `<button class="icon-btn" data-act="custom-add" aria-label="إضافة">${icon('plus')}</button>` : `<button class="icon-btn" data-act="r-reset" aria-label="إعادة ضبط العداد">${icon('refresh')}</button>`}
    </div>
    <div class="rb-tools" role="toolbar" aria-label="أدوات القراءة">
      <button class="rt" data-act="r-font" data-d="-2" aria-label="تصغير الخط"><span class="rt-a">A-</span></button>
      <button class="rt" data-act="r-font" data-d="2" aria-label="تكبير الخط"><span class="rt-a">A+</span></button>
      <button class="rt ${s.tashkeel ? 'on' : ''}" data-act="r-tashkeel" aria-pressed="${s.tashkeel}"><span class="rt-a amiri">تَشْ</span><small>التشكيل</small></button>
      <button class="rt" data-act="r-mode">${icon(focus ? 'list' : 'focus')}<small>${focus ? 'القائمة' : 'التركيز'}</small></button>
      ${catId === 'custom' ? '' : `<button class="rt" data-act="r-reset">${icon('refresh')}<small>تصفير</small></button>`}
    </div>
    <div class="reader-progress"><i data-rb-bar style="width:${total ? Math.round((done / total) * 100) : 0}%"></i></div>
  </header>`;
}

function meta(it) {
  return `${it.note ? `<p class="note">${icon('info')} ${esc(it.note)}</p>` : ''}
    ${it.v ? `<p class="virtue"><b>الفضل:</b> ${esc(it.v)}</p>` : ''}
    ${it.s ? `<p class="source">${esc(it.s)}</p>` : ''}`;
}

function counterLabel(it) {
  const left = Math.max(0, it.n - doneOf(it.id));
  return left ? `${num(left)} / ${num(it.n)}` : '✓';
}

function focusView() {
  const it = items[idx];
  const done = doneOf(it.id);
  const isDone = done >= it.n;
  const editBtn = it.cat === 'custom' ? `<button class="tool" data-act="custom-edit" data-id="${it.id}" aria-label="تعديل">${icon('edit')}</button>` : '';
  return `<div class="focus" data-focus>
    <div class="focus-meta"><span class="chip chip-soft">${it.h ? esc(it.h) : titleOf(catId)}</span><span class="muted">${num(idx + 1)} من ${num(items.length)}</span></div>
    <article class="focus-card ${isDone ? 'done' : ''}" data-tap-zone>
      <p class="dhikr">${esc(dhikrText(it.t))}</p>
      ${meta(it)}
    </article>
    <div class="focus-foot">
      <button class="nav-btn" data-act="r-prev" ${idx === 0 ? 'disabled' : ''} aria-label="السابق">${icon('back')}</button>
      <button class="big-counter ${isDone ? 'done' : ''}" data-tap-zone aria-label="عدّ: ${counterLabel(it)}">
        ${ring(done / it.n, 112, 8)}
        <span class="bc-num" data-count>${counterLabel(it)}</span>
      </button>
      <button class="nav-btn" data-act="r-next" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="التالي">${icon('chevron')}</button>
    </div>
    <p class="tap-hint">اضغط على البطاقة أو العداد للتسبيح</p>
    ${toolsRow(`data-id="${it.id}"`, { fav: it.id, extraBtns: editBtn })}
  </div>`;
}

function listView() {
  return `<div class="dlist">${items.map((it, i) => {
    const done = doneOf(it.id);
    const isDone = done >= it.n;
    const editBtn = it.cat === 'custom' ? `<button class="tool" data-act="custom-edit" data-id="${it.id}" aria-label="تعديل">${icon('edit')}</button>` : '';
    return `<article class="d-card ${isDone ? 'done' : ''}" data-i="${i}" id="it-${i}">
      ${it.h ? `<h4>${esc(it.h)}</h4>` : ''}
      <p class="dhikr" data-tap-zone>${esc(dhikrText(it.t))}</p>
      ${meta(it)}
      <div class="d-foot">
        <button class="pill-counter ${isDone ? 'done' : ''}" data-tap-zone aria-label="عدّ">
          ${ring(done / it.n, 40, 4)}<span data-count>${counterLabel(it)}</span>
        </button>
        ${toolsRow(`data-id="${it.id}"`, { fav: it.id, extraBtns: editBtn })}
      </div>
    </article>`;
  }).join('')}</div>`;
}

function doneScreen() {
  return `<div class="done-screen">
    <div class="done-glow">${icon('check')}</div>
    <h2>تقبّل الله منك</h2>
    <p>أتممت ${titleOf(catId)} لهذا اليوم، جعلها الله حصناً لك ونوراً في قلبك.</p>
    <div class="row-btns">
      <button class="btn btn-primary" data-act="back">${icon('back')} العودة</button>
      <button class="btn btn-ghost" data-act="r-review">مراجعة الأذكار</button>
    </div>
  </div>`;
}

let review = false;
let stay = false; // إبقاء الذكر الحالي عند إعادة الرسم (تغيير التشكيل أو الوضع)

export function render(param) {
  const [id, start] = (param || '').split(':');
  if (id !== catId) review = false;
  catId = CATEGORY_BY_ID[id] || META[id] ? id : 'morning';
  items = itemsOf(catId);
  if (!items.length) {
    return `${header()}<div class="empty reader-empty">${icon(META[catId] ? META[catId].icon : 'book')}<p>${META[catId] ? META[catId].empty : ''}</p>
      ${catId === 'custom' ? `<button class="btn btn-primary" data-act="custom-add">${icon('plus')} إضافة ذكر جديد</button>` : ''}</div>`;
  }
  if (stay) { idx = Math.min(idx, items.length - 1); stay = false; } else if (start !== undefined && start !== '') { idx = Math.min(items.length - 1, Math.max(0, +start)); review = true; } else {
    const first = items.findIndex((it) => doneOf(it.id) < it.n);
    idx = first === -1 ? 0 : first;
  }
  const allDone = catProgress(catId) >= 1;
  const body = allDone && !review && state.settings.readMode === 'focus' ? doneScreen() : state.settings.readMode === 'focus' ? focusView() : listView();
  return `${header()}<div class="reader-body ${state.settings.readMode}">${body}</div>`;
}

function updateHeader(root) {
  const { total, done } = totals();
  const c = root.querySelector('[data-rb-count]');
  if (c) c.textContent = `${num(done)} من ${num(total)} مكتمل`;
  const b = root.querySelector('[data-rb-bar]');
  if (b) b.style.width = `${Math.round((done / total) * 100)}%`;
}

function tap(root, i, scope) {
  const it = items[i];
  const res = countOnce(it, catId);
  if (res.already) { if (state.settings.readMode === 'focus' && i < items.length - 1) moveTo(root, i + 1); return; }
  tapFeedback(res.catDone ? 'done' : res.itemDone ? 'item' : 'tap');
  const done = doneOf(it.id);
  scope.querySelectorAll('[data-count]').forEach((el) => { el.textContent = counterLabel(it); });
  const counter = scope.querySelector('.big-counter, .pill-counter');
  const big = counter.classList.contains('big-counter');
  counter.querySelector('.ring').outerHTML = ring(done / it.n, big ? 112 : 40, big ? 8 : 4);
  counter.classList.remove('pulse');
  void counter.offsetWidth;
  counter.classList.add('pulse');
  updateHeader(root);
  if (!res.itemDone) return;
  counter.classList.add('done');
  (scope.querySelector('.focus-card') || scope).classList.add('done');
  if (res.catDone) {
    clearTimeout(advanceTimer);
    advanceTimer = setTimeout(() => {
      review = false;
      if (state.settings.readMode === 'focus') refresh();
      else toast('تقبّل الله منك، أتممت الأذكار', 'sparkle');
    }, 650);
    return;
  }
  if (!state.settings.autoAdvance) return;
  clearTimeout(advanceTimer);
  if (state.settings.readMode === 'focus') {
    const next = items.findIndex((x, j) => j > i && doneOf(x.id) < x.n);
    advanceTimer = setTimeout(() => moveTo(root, next === -1 ? Math.min(i + 1, items.length - 1) : next), 520);
  } else {
    const nextCard = root.querySelector(`#it-${i + 1}`);
    if (nextCard) advanceTimer = setTimeout(() => nextCard.scrollIntoView({ behavior: 'smooth', block: 'center' }), 350);
  }
}

function moveTo(root, i) {
  if (i < 0 || i >= items.length || i === idx) return;
  const dir = i > idx ? 'next' : 'prev';
  idx = i;
  const body = root.querySelector('.reader-body');
  body.innerHTML = focusView();
  body.firstElementChild.classList.add(`slide-${dir}`);
  bindFocus(root);
}

function bindFocus(root) {
  const f = root.querySelector('[data-focus]');
  if (!f) return;
  f.addEventListener('click', (e) => {
    if (!e.target.closest('[data-tap-zone]') || e.target.closest('[data-act]')) return;
    tap(root, idx, f);
  });
  // السحب الأفقي للتنقل بين الأذكار
  let x0 = null;
  f.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  f.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 70) moveTo(root, dx > 0 ? idx + 1 : idx - 1);
  }, { passive: true });
}

let rootRef;
export function mount(root, param) {
  rootRef = root;
  bindFocus(root);
  const list = root.querySelector('.dlist');
  if (list) {
    list.addEventListener('click', (e) => {
      if (!e.target.closest('[data-tap-zone]') || e.target.closest('[data-act]')) return;
      const card = e.target.closest('.d-card');
      tap(root, +card.dataset.i, card);
    });
    const start = (param || '').split(':')[1];
    if (start) { const el = root.querySelector(`#it-${start}`); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 60); }
  }
}
export function unmount() { clearTimeout(advanceTimer); }

export const actions = {
  'r-font': (el) => {
    state.settings.fontSize = Math.max(18, Math.min(44, state.settings.fontSize + +el.dataset.d));
    save();
    applyTheme();
  },
  'r-tashkeel': () => { state.settings.tashkeel = !state.settings.tashkeel; stay = true; save(); refresh(); },
  'r-mode': () => { state.settings.readMode = state.settings.readMode === 'focus' ? 'list' : 'focus'; review = true; stay = true; save(); refresh(); },
  'r-prev': () => moveTo(rootRef, idx - 1),
  'r-next': () => moveTo(rootRef, idx + 1),
  'r-review': () => { review = true; idx = 0; rootRef.querySelector('.reader-body').innerHTML = focusView(); bindFocus(rootRef); },
  'r-reset': async () => {
    if (!(await confirmSheet('إعادة ضبط العداد', `سيُصفَّر عدّاد «${titleOf(catId)}» لتبدأ من جديد.`, 'تصفير'))) return;
    resetCat(catId);
    review = false;
    toast('تم تصفير العداد', 'refresh');
    refresh();
  },
};
