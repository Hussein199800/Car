// التبويب الأول: الرئيسية (السكينة)
import { state, save, today } from '../store.js';
import { icon } from '../icons.js';
import { num, esc } from '../text.js';
import { HIJRI_MONTHS, GREG_MONTHS, WEEKDAYS, WEEKDAY_LETTERS } from '../dates.js';
import { PRAYERS, METHODS } from '../prayer.js';
import { CATEGORY_BY_ID } from '../data/adhkar.js';
import { FEELINGS, DAILY_AYAT, DAILY_AHADITH, TASBIHAT } from '../data/spirit.js';
import { NAMES } from '../data/names.js';
import { location, localToday, hijriOf, nextPrayer, dayPeriod, GREETINGS, suggestedWird, catProgress, lastWeek, streak, methodKey } from '../services.js';
import { fmtTime, fmtCountdown, ring, bar, pct, daily, refresh } from './common.js';
import { openSheet, toast, tapFeedback, THEMES, dhikrText } from '../ui.js';
import { registerText, toolsRow } from './dhikr.js';

let timer;

function sky(period) {
  const stars = period === 'night' || period === 'fajr'
    ? `<div class="stars">${Array.from({ length: 14 }, (_, i) => `<i style="top:${(i * 37) % 70 + 6}%;right:${(i * 53) % 92 + 3}%;animation-delay:${(i % 5) * 0.7}s"></i>`).join('')}</div>` : '';
  return `<div class="sky-deco">${stars}<span class="orb"></span><span class="haze"></span></div>`;
}

function prayerCard() {
  const loc = location();
  const np = nextPrayer();
  const t = np.times;
  const nextKey = np.tomorrow ? null : np.key;
  const nextName = PRAYERS.find((p) => p.key === np.key).name;
  return `<section class="card prayer-card">
    <div class="pc-head">
      <h2>مواقيت الصلاة</h2>
      <button class="chip chip-outline" data-act="go" data-to="#/settings">${icon('pin')}<span>${esc(loc.name)}</span></button>
    </div>
    <div class="pc-grid">${PRAYERS.map((p) => `
      <div class="pc-cell ${p.key === nextKey || (np.tomorrow && p.key === 'fajr') ? 'next' : ''} ${p.key === 'sunrise' ? 'sunrise' : ''}">
        ${icon(p.icon)}<span class="pc-name">${p.name}</span><b class="pc-time">${fmtTime(t[p.key])}</b>
      </div>`).join('')}
    </div>
    <div class="countdown">
      <span class="cd-ic">${icon('bell')}</span>
      <span>باقي على أذان ${nextName}</span>
      <b data-countdown="${np.at.getTime()}">${fmtCountdown(np.at - Date.now())}</b>
    </div>
    <p class="pc-method">${METHODS[methodKey()].name}</p>
  </section>`;
}

function moods() {
  return `<section class="block">
    <div class="block-head"><h2>بماذا يشعر قلبك الآن؟</h2><span class="muted">اختر حالتك</span></div>
    <div class="mood-scroll">${FEELINGS.map((f) => `
      <button class="mood tone-${f.tone}" data-act="mood" data-id="${f.id}">
        <span class="mood-ic">${icon(f.icon)}</span><span>${f.label}</span>
      </button>`).join('')}
    </div>
  </section>`;
}

function bento() {
  const wird = suggestedWird();
  const cat = CATEGORY_BY_ID[wird];
  const prog = catProgress(wird);
  const mProg = catProgress('morning');
  const eProg = catProgress('evening');
  const [ayah, ayahRef] = daily(DAILY_AYAT);
  const [hadith, hadithRef] = daily(DAILY_AHADITH, 11);
  registerText('ayah-today', { text: `﴿${ayah}﴾`, source: `سورة ${ayahRef}`, title: 'آية اليوم' });
  registerText('hadith-today', { text: `«${hadith}»`, source: hadithRef, title: 'حديث اليوم' });
  const name = daily(NAMES, 3);
  const tb = TASBIHAT.find((x) => x.id === state.tasbih.selected) || TASBIHAT[0];
  const week = lastWeek();
  const h = today();
  return `<section class="bento">
    <button class="tile tile-wird span2" data-act="go" data-to="#/read/${wird}">
      <div class="tw-main">
        <span class="eyebrow">${icon('sparkle')} وردك الآن</span>
        <h3>${cat.title}</h3>
        <p>${prog >= 1 ? 'أتممته اليوم، تقبّل الله منك' : prog > 0 ? 'تابع من حيث توقفت' : cat.sub}</p>
        <div class="tw-bars">
          <span><small>الصباح</small>${bar(mProg)}</span>
          <span><small>المساء</small>${bar(eProg)}</span>
        </div>
      </div>
      <div class="tw-ring">${ring(prog, 92, 7)}<b>${pct(prog)}</b></div>
    </button>

    <article class="tile tile-ayah span2">
      <span class="eyebrow">${icon('book')} آية اليوم</span>
      <p class="quran">﴿${dhikrText(ayah)}﴾</p>
      <div class="tile-foot"><small>سورة ${ayahRef}</small>${toolsRow('data-key="ayah-today"')}</div>
    </article>

    <button class="tile tile-mini tone-teal" data-act="go" data-to="#/tasbih">
      <span class="mini-ic">${icon('beads')}</span>
      <b>المسبحة</b>
      <small>${esc(tb.t.length > 22 ? `${tb.t.slice(0, 22)}…` : tb.t)}</small>
      <span class="mini-num">${num(h.t)} <small>اليوم</small></span>
    </button>
    <button class="tile tile-mini tone-amber" data-act="go" data-to="#/names">
      <span class="mini-ic">${icon('star')}</span>
      <b>أسماء الله الحسنى</b>
      <small>اسم اليوم</small>
      <span class="mini-name">${name[0]}</span>
    </button>

    <article class="tile tile-hadith span2">
      <span class="eyebrow">${icon('sparkle')} حديث اليوم</span>
      <p class="hadith">«${dhikrText(hadith)}»</p>
      <div class="tile-foot"><small>${hadithRef}</small>${toolsRow('data-key="hadith-today"')}</div>
    </article>

    <button class="tile tile-streak span2" data-act="go" data-to="#/journal">
      <div><span class="eyebrow">${icon('flame')} أيام الالتزام</span><b class="streak-num">${num(streak())}</b><small>يوماً متتالياً</small></div>
      <div class="week-stars">${week.map((d) => `<span class="ws ${d.rec.m && d.rec.e ? 'full' : d.rec.m || d.rec.e ? 'half' : ''} ${d.isToday ? 'today' : ''}">${icon('star')}<small>${WEEKDAY_LETTERS[d.date.getDay()]}</small></span>`).join('')}</div>
    </button>
  </section>`;
}

export function render() {
  const period = dayPeriod();
  const g = localToday();
  const hj = hijriOf(g);
  const greet = GREETINGS[period];
  const wird = suggestedWird();
  const theme = THEMES[state.settings.theme];
  return `<section class="sky sky-${period}">
      ${sky(period)}
      <div class="sky-top">
        <span class="brand">${icon('sparkle')} سكينة</span>
        <button class="icon-glass" data-act="theme-cycle" aria-label="تغيير الثيم: ${theme.name}">${icon(theme.dark ? 'sun' : 'moon')}</button>
      </div>
      <div class="greet">
        <p class="greet-date">${WEEKDAYS[g.wd]} · ${num(hj.d)} ${HIJRI_MONTHS[hj.m - 1]} ${num(hj.y)} هـ</p>
        <h1>${greet.title}</h1>
        <p class="greet-sub">${greet.sub}</p>
        <p class="greet-greg">${num(g.d)} ${GREG_MONTHS[g.m - 1]} ${num(g.y)} م</p>
      </div>
      <button class="suggest" data-act="go" data-to="#/read/${wird}">
        <span class="suggest-ic">${icon(CATEGORY_BY_ID[wird].icon)}</span>
        <span class="suggest-txt"><small>الأنسب لك الآن</small><b>${CATEGORY_BY_ID[wird].title}</b></span>
        <span class="suggest-go">${icon('chevron')}</span>
      </button>
    </section>
    <div class="home-body">
      ${prayerCard()}
      ${moods()}
      ${bento()}
      <p class="dua-credit">دعوة لحسين محمد علي الطويل</p>
    </div>`;
}

export function mount(el) {
  clearInterval(timer);
  timer = setInterval(() => {
    const cd = el.querySelector('[data-countdown]');
    if (!cd) return;
    const left = +cd.dataset.countdown - Date.now();
    if (left <= 0) { refresh(); return; }
    cd.textContent = fmtCountdown(left);
  }, 1000);
}
export function unmount() { clearInterval(timer); }

function moodSheet(f) {
  let left = f.count;
  registerText(`mood-ayah-${f.id}`, { text: f.ayah, source: f.ayahRef, title: f.label });
  registerText(`mood-dua-${f.id}`, { text: f.dua, source: f.duaRef, title: f.label });
  openSheet(`
    <div class="mood-head tone-${f.tone}"><span class="mood-ic big">${icon(f.icon)}</span>
      <div><small>حين تشعر بـ</small><h3>${f.label}</h3></div></div>
    <div class="mood-block">
      <span class="eyebrow">${icon('book')} آية تواسيك</span>
      <p class="quran">${dhikrText(f.ayah)}</p>
      <div class="tile-foot"><small>${f.ayahRef}</small>${toolsRow(`data-key="mood-ayah-${f.id}"`)}</div>
    </div>
    <div class="mood-block">
      <span class="eyebrow">${icon('hands')} دعاء مأثور</span>
      <p class="dhikr-sm">${dhikrText(f.dua)}</p>
      <div class="mood-counter">
        <button class="counter-btn" data-mood-tap aria-label="عدّ">
          ${ring(0, 76, 6)}<b data-left>${num(left)}</b>
        </button>
        <div><small>${f.duaRef}</small><p class="muted" data-hint>اضغط على العداد مع كل تكرار</p></div>
      </div>
      ${toolsRow(`data-key="mood-dua-${f.id}"`)}
    </div>
    <div class="mood-message">
      <span class="eyebrow">${icon('leaf')} رسالة سكينة وتدبّر</span>
      <p>${f.message}</p>
    </div>`, {
    cls: 'sheet-tall',
    onMount: (body) => {
      const btn = body.querySelector('[data-mood-tap]');
      btn.addEventListener('click', () => {
        if (left <= 0) return;
        left -= 1;
        tapFeedback(left ? 'tap' : 'item');
        body.querySelector('[data-left]').textContent = left ? num(left) : '✓';
        btn.querySelector('.ring').outerHTML = ring((f.count - left) / f.count, 76, 6);
        if (!left) {
          btn.classList.add('done');
          body.querySelector('[data-hint]').textContent = 'تقبّل الله دعاءك وأنزل على قلبك السكينة';
          today().r += f.count;
          save();
        }
      });
    },
  });
}

export const actions = {
  mood: (el) => moodSheet(FEELINGS.find((f) => f.id === el.dataset.id)),
  'theme-cycle': () => {
    const keys = Object.keys(THEMES);
    state.settings.theme = keys[(keys.indexOf(state.settings.theme) + 1) % keys.length];
    save();
    document.dispatchEvent(new Event('app:theme'));
    toast(`ثيم ${THEMES[state.settings.theme].name}`, 'palette');
  },
};
