// التبويب الثاني: مكتبة الأذكار والأدعية
import { state, save } from '../store.js';
import { icon } from '../icons.js';
import { num, esc, normalize } from '../text.js';
import { CATEGORIES } from '../data/adhkar.js';
import { catProgress, itemsOf } from '../services.js';
import { pageHead, bar, go } from './common.js';
import { openSheet, toast, dhikrText } from '../ui.js';

let query = '';
const INDEX = CATEGORIES.flatMap((c) => c.items.map((it, i) => ({ it, cat: c, i, key: normalize(`${c.title} ${it.h || ''} ${it.t}`) })));

function catCard(c, big = false) {
  const p = catProgress(c.id);
  const items = itemsOf(c.id);
  return `<button class="cat-card tone-${c.tone} ${big ? 'big' : ''}" data-act="go" data-to="#/read/${c.id}">
    <span class="cat-ic">${icon(c.icon)}</span>
    <span class="cat-txt"><b>${c.title}</b><small>${c.sub}</small></span>
    ${big ? `<span class="cat-prog">${bar(p)}<small>${p >= 1 ? 'مكتمل ✓' : `${num(items.length)} ذكراً`}</small></span>` : ''}
  </button>`;
}

function sections() {
  const group = (g) => CATEGORIES.filter((c) => c.group === g);
  return `
    <section class="block">
      <div class="block-head"><h2>أذكار اليوم والليلة</h2></div>
      <div class="cat-grid">${group('daily').map((c) => catCard(c, true)).join('')}</div>
    </section>
    <section class="block">
      <div class="block-head"><h2>أذكار المواقف اليومية</h2></div>
      <div class="cat-rows">${group('moments').map((c) => catCard(c)).join('')}</div>
    </section>
    <section class="block">
      <div class="block-head"><h2>الأدعية والرقية</h2></div>
      <div class="cat-rows one">${group('duas').map((c) => catCard(c)).join('')}</div>
    </section>
    <section class="block">
      <div class="block-head"><h2>خاصّتي</h2></div>
      <div class="mine-grid">
        <button class="mine-card tone-rose" data-act="go" data-to="#/read/favorites">
          <span class="cat-ic">${icon('heart')}</span><b>المفضلة</b><small>${num(state.favorites.length)} محفوظ</small>
        </button>
        <button class="mine-card tone-violet" data-act="go" data-to="#/read/custom">
          <span class="cat-ic">${icon('edit')}</span><b>أذكاري الخاصة</b><small>${num(state.custom.length)} ذكر</small>
        </button>
      </div>
      <button class="btn btn-soft wide" data-act="custom-add">${icon('plus')} إضافة ذكر أو دعاء جديد</button>
    </section>`;
}

function results() {
  const q = normalize(query);
  const words = q.split(' ').filter(Boolean);
  const custom = state.custom.map((it, i) => ({ it, cat: { id: 'custom', title: 'أذكاري الخاصة' }, i, key: normalize(it.t) }));
  const found = INDEX.concat(custom).filter((x) => words.every((w) => x.key.indexOf(w) !== -1)).slice(0, 60);
  if (!found.length) return `<div class="empty">${icon('search')}<p>لا نتائج لـ «${esc(query)}»</p><small>جرّب كلمة أخرى، البحث يعمل بدون تشكيل</small></div>`;
  return `<p class="muted results-count">${num(found.length)} نتيجة</p>
    <div class="results">${found.map((x) => `
      <button class="result" data-act="go" data-to="#/read/${x.cat.id}:${x.i}">
        <small>${x.cat.title}${x.it.h ? ` · ${x.it.h}` : ''}</small>
        <p>${esc(dhikrText(x.it.t))}</p>
      </button>`).join('')}</div>`;
}

export function render() {
  return `${pageHead('الأذكار والأدعية', 'من حصن المسلم وصحيح السنة')}
    <label class="search">${icon('search')}
      <input type="search" id="lib-q" placeholder="ابحث في نص الذكر أو عنوانه…" value="${esc(query)}" autocomplete="off" enterkeyhint="search">
      <button class="icon-btn sm ${query ? '' : 'hidden'}" data-act="lib-clear" aria-label="مسح">${icon('x')}</button>
    </label>
    <div id="lib-body">${query ? results() : sections()}</div>`;
}

export function mount(el) {
  const input = el.querySelector('#lib-q');
  input.addEventListener('input', () => {
    query = input.value;
    el.querySelector('#lib-body').innerHTML = query.trim() ? results() : sections();
    el.querySelector('[data-act="lib-clear"]').classList.toggle('hidden', !query);
  });
}

/** نافذة إضافة/تعديل ذكر خاص */
export function customEditor(existing) {
  const it = existing || { t: '', n: 1, note: '' };
  openSheet(`<h3 class="sheet-title">${existing ? 'تعديل الذكر' : 'ذكر أو دعاء جديد'}</h3>
    <label class="field"><span>نص الذكر أو الدعاء</span>
      <textarea id="c-text" rows="5" placeholder="اكتب دعاءك هنا…">${esc(it.t)}</textarea></label>
    <div class="field"><span>عدد مرات التكرار</span>
      <div class="stepper">
        <button class="icon-btn" data-step="-1" aria-label="إنقاص">${icon('minus')}</button>
        <input id="c-n" type="number" inputmode="numeric" min="1" max="10000" value="${it.n}">
        <button class="icon-btn" data-step="1" aria-label="زيادة">${icon('plus')}</button>
      </div>
      <div class="quick-n">${[1, 3, 7, 33, 100].map((n) => `<button class="chip" data-n="${n}">${num(n)}</button>`).join('')}</div>
    </div>
    <label class="field"><span>ملاحظة (اختياري)</span><input id="c-note" type="text" value="${esc(it.note || '')}" placeholder="مثلاً: بعد صلاة الفجر"></label>
    <div class="row-btns"><button class="btn btn-primary" data-save>${icon('check')} حفظ</button>
    ${existing ? `<button class="btn btn-danger-soft" data-del>${icon('trash')} حذف</button>` : '<button class="btn btn-ghost" data-close>إلغاء</button>'}</div>`, {
    onMount: (body, close) => {
      const n = body.querySelector('#c-n');
      body.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => { n.value = Math.max(1, (+n.value || 1) + +b.dataset.step); }));
      body.querySelectorAll('[data-n]').forEach((b) => b.addEventListener('click', () => { n.value = b.dataset.n; }));
      body.querySelector('[data-save]').addEventListener('click', () => {
        const t = body.querySelector('#c-text').value.trim();
        if (!t) { toast('اكتب نص الذكر أولاً', 'info'); return; }
        const data = { t, n: Math.min(10000, Math.max(1, parseInt(n.value, 10) || 1)), note: body.querySelector('#c-note').value.trim(), s: 'من أذكاري الخاصة' };
        if (existing) Object.assign(state.custom.find((c) => c.id === existing.id), data);
        else state.custom.push({ id: `custom-${Date.now().toString(36)}`, ...data });
        save();
        close();
        toast(existing ? 'تم حفظ التعديل' : 'تمت إضافة الذكر');
        document.dispatchEvent(new Event('app:refresh'));
      });
      const del = body.querySelector('[data-del]');
      if (del) del.addEventListener('click', () => {
        state.custom = state.custom.filter((c) => c.id !== existing.id);
        state.favorites = state.favorites.filter((id) => id !== existing.id);
        delete state.progress.counts[existing.id];
        save();
        close();
        toast('تم حذف الذكر', 'trash');
        document.dispatchEvent(new Event('app:refresh'));
      });
    },
  });
}

export const actions = {
  'lib-clear': () => { query = ''; go('#/library'); document.dispatchEvent(new Event('app:refresh')); },
  'custom-add': () => customEditor(),
  'custom-edit': (el) => customEditor(state.custom.find((c) => c.id === el.dataset.id)),
};
