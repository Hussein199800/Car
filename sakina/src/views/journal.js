// التبويب الرابع: رحلتي والأيام المهمة
import { state, save, today } from '../store.js';
import { icon } from '../icons.js';
import { num } from '../text.js';
import { HIJRI_MONTHS, GREG_MONTHS, WEEKDAYS, WEEKDAY_LETTERS, addDays, dateKey } from '../dates.js';
import { OCCASIONS, WHITE_DAYS, FRIDAY, MON_THU } from '../data/occasions.js';
import { NAMES } from '../data/names.js';
import { localToday, hijriOf, streak, lastWeek, palms } from '../services.js';
import { pageHead, refresh } from './common.js';
import { tapFeedback } from '../ui.js';

const PRAYER_NAMES = ['الفجر', 'الظهر', 'العصر', 'المغرب', 'العشاء'];

// جدول الأيام الهجرية لسنة قادمة، يُبنى مرة واحدة في اليوم
let table = null;
let tableKey = '';
function hijriTable() {
  const g0 = localToday();
  const k = `${dateKey()}|${state.settings.hijriAdjust}`;
  if (tableKey !== k) {
    table = [];
    for (let i = 0; i < 390; i++) { const g = addDays(g0, i); table.push({ g, h: hijriOf(g), days: i }); }
    tableKey = k;
  }
  return table;
}

function upcoming() {
  const t = hijriTable();
  const list = [];
  for (const o of OCCASIONS) {
    const hit = t.find((x) => x.h.m === o.m && x.h.d === o.d);
    if (hit) list.push({ ...o, ...hit });
  }
  const white = t.find((x) => x.h.d >= 13 && x.h.d <= 15);
  if (white) list.push({ ...WHITE_DAYS, ...white });
  const fri = t.find((x) => x.g.wd === 5);
  if (fri) list.push({ ...FRIDAY, ...fri });
  const mt = t.find((x) => x.g.wd === 1 || x.g.wd === 4);
  if (mt) list.push({ ...MON_THU, ...mt, title: `صيام ${WEEKDAYS[mt.g.wd]}` });
  return list.sort((a, b) => a.days - b.days);
}

const daysLabel = (d) => (d === 0 ? 'اليوم' : d === 1 ? 'غداً' : d === 2 ? 'بعد يومين' : d <= 10 ? `بعد ${num(d)} أيام` : `بعد ${num(d)} يوماً`);

function oasis(n) {
  const shown = Math.min(n, 12);
  const palmsSvg = Array.from({ length: shown }, (_, i) => {
    const x = 30 + ((i * 47) % 300);
    const s = 0.75 + ((i * 7) % 5) * 0.09;
    const y = 112 - (i % 3) * 6;
    return `<g transform="translate(${x} ${y}) scale(${s})" class="palm">
      <path d="M0 0 C 2 -18 1 -36 -2 -54" stroke-width="5" class="trunk" fill="none"/>
      <path d="M-2 -54 c -10 -8 -24 -6 -32 4 c 10 -4 20 -3 32 -4z M-2 -54 c 10 -9 25 -7 33 3 c -10 -4 -21 -3 -33 -3z M-2 -54 c -4 -12 -16 -18 -26 -14 c 9 2 18 7 26 14z M-2 -54 c 5 -12 17 -17 27 -12 c -9 2 -19 6 -27 12z" class="fronds"/>
    </g>`;
  }).join('');
  return `<svg class="oasis-svg" viewBox="0 0 360 140" role="img" aria-label="واحتك الروحية فيها ${n} نخلة">
    <circle cx="300" cy="34" r="16" class="o-sun"/>
    <path d="M0 118 C 70 100 120 124 190 112 S 300 100 360 116 V140 H0z" class="o-dune2"/>
    <ellipse cx="180" cy="124" rx="62" ry="7" class="o-water"/>
    ${palmsSvg || '<g transform="translate(180 116)" class="palm"><path d="M0 0 v-14" stroke-width="3" class="trunk"/><path d="M0 -12 c -8 -6 -14 -2 -14 2 c 6 0 10 -1 14 -2z M0 -14 c 6 -8 13 -6 14 -2 c -6 1 -10 1 -14 2z" class="fronds"/></g>'}
    <path d="M0 126 C 90 116 150 134 230 124 S 330 118 360 128 V140 H0z" class="o-dune"/>
  </svg>`;
}

export function render() {
  const h = today();
  const week = lastWeek();
  const s = streak();
  const weekRead = week.reduce((a, d) => a + (d.rec.r || 0), 0);
  const weekTasbih = week.reduce((a, d) => a + (d.rec.t || 0), 0);
  const p = palms();
  const rows = [
    { k: 'm', label: 'الصباح', ic: 'sunrise' },
    { k: 'e', label: 'المساء', ic: 'sunset' },
    { k: 'p', label: 'بعد الصلاة', ic: 'mosque' },
  ];
  const events = upcoming().slice(0, 12);
  const g = localToday();
  const hj = hijriOf(g);
  return `${pageHead('رحلتي', `${num(hj.d)} ${HIJRI_MONTHS[hj.m - 1]} ${num(hj.y)} هـ · ${num(g.d)} ${GREG_MONTHS[g.m - 1]}`)}
    <section class="card streak-hero">
      <div class="sh-main">
        <span class="sh-flame">${icon('flame')}</span>
        <div><b>${num(s)}</b><small>${s === 1 ? 'يوم التزام' : 'أيام التزام متتالية'}</small></div>
      </div>
      <div class="sh-stats">
        <div><b>${num(weekRead)}</b><small>ذكراً هذا الأسبوع</small></div>
        <div><b>${num(weekTasbih)}</b><small>تسبيحة هذا الأسبوع</small></div>
        <div><b>${num(p)}</b><small>نخلة في واحتك</small></div>
      </div>
    </section>

    <section class="card week-card">
      <div class="block-head"><h2>أسبوعي</h2><span class="muted">آخر ٧ أيام</span></div>
      <div class="wk-grid">
        <span></span>${week.map((d) => `<span class="wk-day ${d.isToday ? 'today' : ''}"><small>${WEEKDAY_LETTERS[d.date.getDay()]}</small>${num(d.date.getDate())}</span>`).join('')}
        ${rows.map((r) => `<span class="wk-label">${icon(r.ic)}${r.label}</span>${week.map((d) => `<span class="wk-cell ${d.rec[r.k] ? 'on' : ''}">${icon(d.rec[r.k] ? 'star' : 'check')}</span>`).join('')}`).join('')}
        <span class="wk-label">${icon('mosque')}الصلوات</span>${week.map((d) => { const c = (d.rec.pr || []).filter(Boolean).length; return `<span class="wk-cell num ${c === 5 ? 'on' : c ? 'part' : ''}">${num(c)}</span>`; }).join('')}
      </div>
    </section>

    <section class="card">
      <div class="block-head"><h2>صلواتي اليوم</h2><span class="muted">${num(h.pr.filter(Boolean).length)} من ${num(5)}</span></div>
      <div class="pr-checks">${PRAYER_NAMES.map((n, i) => `
        <button class="pr-check ${h.pr[i] ? 'on' : ''}" data-act="pr-toggle" data-i="${i}" aria-pressed="${!!h.pr[i]}">${icon('check')}<span>${n}</span></button>`).join('')}
      </div>
    </section>

    <section class="card oasis-card">
      <div class="block-head"><h2>واحتك الروحية</h2>${icon('palm')}</div>
      ${oasis(p)}
      <p class="muted center">${p ? `غرست ${num(p)} ${p === 1 ? 'نخلة' : 'نخلات'} بإتمام أذكار الصباح والمساء معاً. «من قال سبحان الله العظيم وبحمده غُرست له نخلة في الجنة» رواه الترمذي.` : 'أتمم أذكار الصباح والمساء في يوم واحد لتغرس أول نخلة في واحتك.'}</p>
    </section>

    <section class="block">
      <div class="block-head"><h2>الأيام المهمة القادمة</h2>${icon('calendar')}</div>
      <ol class="timeline">${events.map((e) => `
        <li class="tl-item tone-${e.tone}">
          <span class="tl-dot"></span>
          <details class="tl-card">
            <summary>
              <div><b>${e.title}</b><small>${num(e.h.d)} ${HIJRI_MONTHS[e.h.m - 1]} · ${WEEKDAYS[e.g.wd]} ${num(e.g.d)} ${GREG_MONTHS[e.g.m - 1]}</small></div>
              <span class="tl-badge ${e.days <= 1 ? 'soon' : ''}">${daysLabel(e.days)}</span>
            </summary>
            <p>${e.acts}</p>
          </details>
        </li>`).join('')}
      </ol>
      <p class="muted small center">التواريخ الهجرية بتقويم أم القرى، ويمكن تعديلها يوماً أو يومين من الإعدادات حسب رؤية الهلال في بلدك.</p>
    </section>

    <button class="card names-link" data-act="go" data-to="#/names">
      <div class="nl-names">${NAMES.slice(1, 7).map((n) => `<span>${n[0]}</span>`).join('')}</div>
      <div class="nl-txt"><b>أسماء الله الحسنى</b><small>٩٩ اسماً مع المعنى وكيف تدعو بها</small></div>
      ${icon('chevron')}
    </button>`;
}

export const actions = {
  'pr-toggle': (el) => {
    const h = today();
    const i = +el.dataset.i;
    h.pr[i] = h.pr[i] ? 0 : 1;
    save();
    tapFeedback(h.pr[i] ? 'item' : 'tap');
    refresh();
  },
};
