// أسماء الله الحسنى: بطاقات تفاعلية مع المعنى وكيف تدعو بالاسم
import { icon } from '../icons.js';
import { num, esc, normalize } from '../text.js';
import { NAMES } from '../data/names.js';
import { fullHead } from './common.js';
import { openSheet, dhikrText } from '../ui.js';
import { registerText, toolsRow } from './dhikr.js';

export const full = true;
export const tab = 'journal';

const TONES = ['teal', 'amber', 'violet', 'indigo', 'rose', 'sand'];

const grid = (q) => {
  const nq = normalize(q || '');
  const list = NAMES.map((n, i) => ({ n, i })).filter(({ n }) => !nq || normalize(`${n[0]} ${n[1]}`).indexOf(nq) !== -1);
  if (!list.length) return `<div class="empty">${icon('search')}<p>لا نتائج</p></div>`;
  return list.map(({ n, i }) => `<button class="name-card tone-${TONES[i % TONES.length]}" data-act="name-open" data-i="${i}">
    <small>${num(i + 1)}</small><b>${dhikrText(n[0])}</b></button>`).join('');
};

export function render() {
  return `${fullHead('أسماء الله الحسنى', '﴿وَلِلَّهِ الْأَسْمَاءُ الْحُسْنَىٰ فَادْعُوهُ بِهَا﴾')}
    <div class="names-page">
      <p class="names-intro">قال ﷺ: «إن لله تسعة وتسعين اسماً، مائةً إلا واحداً، من أحصاها دخل الجنة» رواه البخاري ومسلم. وإحصاؤها: حفظها، وفهم معانيها، والعمل بمقتضاها، ودعاء الله بها.</p>
      <label class="search">${icon('search')}<input type="search" placeholder="ابحث عن اسم أو معنى…" data-nq autocomplete="off"></label>
      <div class="names-grid" data-grid>${grid('')}</div>
    </div>`;
}

export function mount(root) {
  root.querySelector('[data-nq]').addEventListener('input', (e) => { root.querySelector('[data-grid]').innerHTML = grid(e.target.value); });
}

export const actions = {
  'name-open': (el) => {
    const i = +el.dataset.i;
    const [name, meaning, dua] = NAMES[i];
    registerText(`name-${i}`, { text: `${name}\n${dua}`, source: meaning, title: 'من أسماء الله الحسنى' });
    openSheet(`<div class="name-sheet tone-${TONES[i % TONES.length]}">
      <small class="muted">الاسم ${num(i + 1)} من ${num(99)}</small>
      <h2 class="name-big">${dhikrText(name)}</h2>
      <div class="mood-block"><span class="eyebrow">${icon('info')} المعنى</span><p>${esc(meaning)}</p></div>
      <div class="mood-block"><span class="eyebrow">${icon('hands')} كيف تدعو به</span><p class="dhikr-sm">${esc(dua)}</p></div>
      ${toolsRow(`data-key="name-${i}"`)}
      <div class="row-btns">
        <button class="btn btn-ghost" data-nav="${i - 1}" ${i === 0 ? 'disabled' : ''}>${icon('back')} السابق</button>
        <button class="btn btn-ghost" data-nav="${i + 1}" ${i === 98 ? 'disabled' : ''}>التالي ${icon('chevron')}</button>
      </div>
    </div>`, {
      onMount: (body, close) => body.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
        close();
        setTimeout(() => actions['name-open']({ dataset: { i: b.dataset.nav } }), 200);
      })),
    });
  },
};
