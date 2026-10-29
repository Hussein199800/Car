// التبويب الثالث: المسبحة والخشوع
import { state, save, today } from '../store.js';
import { icon } from '../icons.js';
import { num, esc } from '../text.js';
import { TASBIHAT } from '../data/spirit.js';
import { pageHead, ring, refresh } from './common.js';
import { tapFeedback, openSheet, confirmSheet, toast, dhikrText } from '../ui.js';

const TARGETS = [33, 100, 1000, 0];
let breathing = false;
let breathTimer;
let phaseTimer;

const current = () => TASBIHAT.find((x) => x.id === state.tasbih.selected) || TASBIHAT[0];

function bead() {
  const tb = state.tasbih;
  const frac = tb.target ? tb.count / tb.target : (tb.count % 100) / 100;
  return `${ring(frac, 260, 10, 'tb-ring')}
    <span class="tb-count" data-tb-count>${num(tb.count)}</span>
    <span class="tb-target" data-tb-target>${tb.target ? `من ${num(tb.target)}` : 'عدّ مفتوح'}</span>`;
}

export function render() {
  const tb = state.tasbih;
  const d = current();
  const h = today();
  return `${pageHead('المسبحة', 'سبّح بقلب حاضر ونفَس هادئ')}
    <button class="tb-select card" data-act="tb-pick">
      <span class="eyebrow">${icon('beads')} التسبيحة</span>
      <b class="tb-text">${esc(dhikrText(d.t))}</b>
      <span class="tb-change">تغيير ${icon('down')}</span>
    </button>
    <p class="tb-virtue">${esc(d.v)} <small>${d.s}</small></p>

    <div class="tb-stage ${breathing ? 'breathing' : ''}">
      <div class="breath-ring"></div>
      <button class="tb-bead" data-tb-tap aria-label="سبّح، العدد الحالي ${tb.count}">${bead()}</button>
      <p class="breath-cue" data-cue>${breathing ? 'شهيق هادئ…' : ''}</p>
    </div>

    <div class="seg" role="radiogroup" aria-label="الهدف">${TARGETS.map((t) => `
      <button class="seg-btn ${tb.target === t ? 'on' : ''}" data-act="tb-target" data-t="${t}" role="radio" aria-checked="${tb.target === t}">${t ? num(t) : '∞'}</button>`).join('')}
    </div>

    <div class="tb-tools">
      <button class="tb-tool" data-act="tb-reset">${icon('refresh')}<small>تصفير</small></button>
      <button class="tb-tool ${state.settings.sound ? 'on' : ''}" data-act="tb-sound">${icon(state.settings.sound ? 'volume' : 'mute')}<small>الصوت</small></button>
      <button class="tb-tool ${state.settings.haptic ? 'on' : ''}" data-act="tb-haptic">${icon('vibrate')}<small>الاهتزاز</small></button>
      <button class="tb-tool ${breathing ? 'on' : ''}" data-act="tb-breath">${icon('wind')}<small>التنفس التسبيحي</small></button>
    </div>

    <div class="stats3">
      <div><b data-tb-today>${num(h.t)}</b><small>تسبيحات اليوم</small></div>
      <div><b data-tb-total>${num(tb.total)}</b><small>المجموع الكلي</small></div>
      <div><b data-tb-rounds>${num(tb.rounds)}</b><small>دورات مكتملة</small></div>
    </div>
    ${breathing ? '' : '<p class="tap-hint">اضغط على الدائرة للتسبيح، أو فعّل «التنفس التسبيحي» ليعدّ معك مع كل نفَس</p>'}`;
}

function count(root) {
  const tb = state.tasbih;
  const h = today();
  tb.count += 1;
  tb.total += 1;
  h.t += 1;
  let kind = 'tap';
  if (tb.target && tb.count >= tb.target) {
    tb.rounds += 1;
    kind = 'done';
    toast(`أتممت ${num(tb.target)} تسبيحة، تقبّل الله منك`, 'sparkle');
    tb.count = 0;
  } else if (!tb.target && tb.count % 100 === 0) kind = 'item';
  save();
  tapFeedback(kind);
  const b = root.querySelector('[data-tb-tap]');
  b.innerHTML = bead();
  b.classList.remove('pulse');
  void b.offsetWidth;
  b.classList.add('pulse');
  root.querySelector('[data-tb-today]').textContent = num(h.t);
  root.querySelector('[data-tb-total]').textContent = num(tb.total);
  root.querySelector('[data-tb-rounds]').textContent = num(tb.rounds);
}

function stopBreath() { clearInterval(breathTimer); clearTimeout(phaseTimer); }

// دورة نفَس كاملة ٨ ثوانٍ: شهيق ٤ ثوانٍ ثم زفير مع الذكر، ويُحسب تسبيح مع كل زفير
function startBreath(root) {
  stopBreath();
  const cue = root.querySelector('[data-cue]');
  const cycle = () => {
    cue.textContent = 'شهيق هادئ…';
    phaseTimer = setTimeout(() => {
      cue.textContent = `زفير: ${current().t}`;
      count(root);
    }, 4000);
  };
  cycle();
  breathTimer = setInterval(cycle, 8000);
}

export function mount(root) {
  root.querySelector('[data-tb-tap]').addEventListener('click', () => count(root));
  if (breathing) startBreath(root);
}
export function unmount() { stopBreath(); }

export const actions = {
  'tb-target': (el) => { state.tasbih.target = +el.dataset.t; state.tasbih.count = 0; save(); refresh(); },
  'tb-reset': async () => {
    if (!state.tasbih.count) return;
    if (await confirmSheet('تصفير المسبحة', 'سيُصفَّر العدّ الحالي فقط، وتبقى إحصائياتك محفوظة.', 'تصفير')) { state.tasbih.count = 0; save(); refresh(); }
  },
  'tb-sound': () => { state.settings.sound = !state.settings.sound; save(); refresh(); },
  'tb-haptic': () => { state.settings.haptic = !state.settings.haptic; save(); refresh(); },
  'tb-breath': () => { breathing = !breathing; refresh(); },
  'tb-pick': () => openSheet(`<h3 class="sheet-title">اختر التسبيحة</h3>
    <div class="pick-list">${TASBIHAT.map((d) => `
      <button class="pick ${d.id === state.tasbih.selected ? 'on' : ''}" data-pick="${d.id}">
        <b class="amiri">${esc(dhikrText(d.t))}</b><small>${esc(d.v)}</small>
      </button>`).join('')}</div>`, {
    onMount: (body, close) => body.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      state.tasbih.selected = b.dataset.pick;
      state.tasbih.count = 0;
      save();
      close();
      refresh();
    })),
  }),
};
