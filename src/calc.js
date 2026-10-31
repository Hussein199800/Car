// حاسبة الأحمال: تحويل أمبير الكهرباء إلى واط وإلى أمبير البطارية، وقائمة أجهزة البيت
// مع الحمل الكلي وتيار الإقلاع والمدة على البطارية واقتراح الألواح والبطاريات.
import { store } from './data.js';

// معامل القدرة: الأحمال الحرارية ≈ 1، والمحركات (مكيف، مضخة، ثلاجة) أقل
const PF = { res: 1, motor: 0.8 };

// كتالوج أجهزة بقيم تقريبية شائعة؛ يستطيع المستخدم تعديل القدرة لكل جهاز
// surge: مضاعف تيار الإقلاع، duty: نسبة الوقت الذي يعمل فيه فعلياً (الثلاجة تفصل وتشغل)
export const APPLIANCES = [
  { id: 'led', e: '💡', name: 'إنارة LED', w: 10 },
  { id: 'fan', e: '🌀', name: 'مروحة', w: 70, surge: 1.5 },
  { id: 'tv', e: '📺', name: 'تلفاز', w: 100 },
  { id: 'recv', e: '📡', name: 'رسيفر', w: 25 },
  { id: 'router', e: '📶', name: 'راوتر', w: 12 },
  { id: 'phone', e: '📱', name: 'شاحن هاتف', w: 10 },
  { id: 'laptop', e: '💻', name: 'لابتوب', w: 65 },
  { id: 'pc', e: '🖥️', name: 'حاسوب مكتبي', w: 250 },
  { id: 'fridge', e: '🧊', name: 'ثلاجة', w: 150, surge: 3, duty: 0.4 },
  { id: 'freezer', e: '❄️', name: 'مجمّدة', w: 200, surge: 3, duty: 0.5 },
  { id: 'acinv', e: '🌬️', name: 'مكيف 1 طن إنفرتر', w: 900, surge: 1.3, duty: 0.7 },
  { id: 'ac15', e: '🌬️', name: 'مكيف 1.5 طن عادي', w: 1600, surge: 3, duty: 0.8 },
  { id: 'cooler', e: '💨', name: 'مبردة هواء', w: 250, surge: 1.5 },
  { id: 'pump', e: '💧', name: 'مضخة ماء', w: 750, surge: 3 },
  { id: 'washer', e: '🧺', name: 'غسالة', w: 500, surge: 2 },
  { id: 'iron', e: '👕', name: 'مكواة', w: 1200 },
  { id: 'kettle', e: '☕', name: 'غلاية', w: 2000 },
  { id: 'micro', e: '🍲', name: 'مايكرويف', w: 1200 },
  { id: 'heater', e: '🔥', name: 'سخان ماء', w: 2000 },
  { id: 'vacuum', e: '🧹', name: 'مكنسة كهربائية', w: 1000, surge: 1.5 },
  { id: 'custom', e: '🔌', name: 'جهاز آخر', w: 100 },
];

const panelsAr = (n) => (n === 1 ? 'لوح واحد' : n === 2 ? 'لوحان' : n <= 10 ? `${n} ألواح` : `${n} لوحاً`);
const num = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0, useGrouping: false }) : '—');

export function defaultsCalc() {
  return { mode: 'ac', input: 1, acV: 220, kind: 'res', eff: 90, tab: 'conv', backupH: 8, sunH: 5, list: [] };
}

// ---------- الحساب ----------
export function convert(c, sysV) {
  const pf = PF[c.kind];
  const eff = c.eff / 100;
  let watts;
  if (c.mode === 'ac') watts = c.input * c.acV * pf;
  else if (c.mode === 'w') watts = c.input;
  else watts = c.input * sysV * eff;
  const acA = watts / (c.acV * pf);
  const dc = (v) => watts / (v * eff);
  return { watts, acA, dc12: dc(12), dc24: dc(24), dc48: dc(48), dcSys: dc(sysV) };
}

export function summarizeLoads(list, c, sysV) {
  let run = 0, maxExtra = 0, whDay = 0, avg = 0;
  for (const it of list) {
    const w = it.w * it.qty;
    run += w;
    avg += w * (it.duty || 1);
    maxExtra = Math.max(maxExtra, it.w * ((it.surge || 1) - 1));
    whDay += w * it.hours * (it.duty || 1);
  }
  const eff = c.eff / 100;
  const peak = run + maxExtra;
  return {
    run, peak, whDay, avg,
    acA: run / c.acV,
    dcA: run / (sysV * eff),
    peakDcA: peak / (sysV * eff),
    // الألواح: الطاقة اليومية ÷ ساعات الشمس الفعّالة مع 25% فواقد (غبار، حرارة، أسلاك)
    pvKw: whDay / 1000 / (c.sunH * 0.75),
    // البطارية لساعات الاحتياط بتفريغ 80% وكفاءة الإنفرتر. نستخدم متوسط السحب الفعلي
    // (الثلاجة والمكيف يفصلان ويشغلان) بدل جمع القدرات كأنها تعمل بلا توقف
    batAh: (avg * c.backupH) / (sysV * 0.8 * eff),
  };
}

// ---------- العرض ----------
export function viewCalc(h) {
  const { state, esc, icons } = h;
  const c = state.calc;
  const sysV = h.sysV();
  const seg = `<div class="seg"><button data-ctab="conv" class="${c.tab === 'conv' ? 'on' : ''}">محوّل الأمبير</button><button data-ctab="list" class="${c.tab === 'list' ? 'on' : ''}">أجهزة بيتي</button></div>`;
  const intro = `<section class="hero c-amber calc-hero"><span class="g-deco">${icons.calc}</span><div class="h-ic">${icons.calc}</div>
    <b class="hero-t">حاسبة الأحمال</b><span>اعرف كم واط يسحب جهازك، وكم أمبير يأخذ من بطاريتك، وهل يتحمّله الإنفرتر</span></section>`;
  return intro + seg + (c.tab === 'conv' ? viewConverter(h, c, sysV) : viewList(h, c, sysV));
}

const chips = (name, opts, cur) => `<div class="chips-sel">${opts.map(([v, label]) => `<button data-set="${name}" data-v="${v}" class="${String(cur) === String(v) ? 'on' : ''}">${label}</button>`).join('')}</div>`;

function viewConverter(h, c, sysV) {
  const { esc } = h;
  const r = convert(c, sysV);
  const label = { ac: `أمبير على ${c.acV} فولت`, w: 'واط', dc: `أمبير من بطارية ${sysV} فولت` }[c.mode];
  const m = h.state.model;
  const live = m && !m.stale && m.outW != null;
  const bats = [12, 24, 48].map((v) => `
    <div class="bat-v ${v === sysV ? 'mine' : ''}"><small>بطارية ${v} فولت${v === sysV ? ' · نظامك' : ''}</small><b>${num(r['dc' + v], 1)}</b><span>أمبير</span></div>`).join('');
  const quick = [1, 5, 10, 16, 20, 32].map((a) => {
    const w = a * c.acV * PF[c.kind];
    const e = c.eff / 100;
    return `<div class="tr"><span>${a} أمبير</span><span>${num(w)} واط</span><span>${num(w / (48 * e), 1)}</span><span>${num(w / (24 * e), 1)}</span><span>${num(w / (12 * e), 1)}</span></div>`;
  }).join('');
  return `
  <section class="card calc-in">
    <div class="card-h"><h2>ماذا تعرف؟</h2></div>
    ${chips('mode', [['ac', 'أمبير الكهرباء'], ['w', 'الواط'], ['dc', 'أمبير البطارية']], c.mode)}
    <label class="big-in"><input type="number" inputmode="decimal" min="0" step="any" id="calcInput" value="${esc(c.input)}"><span>${esc(label)}</span></label>
    ${live ? `<button class="link" id="useLive">${h.icons.flash} استخدم حمل بيتي الآن (${num(m.outW)} واط)</button>` : ''}
  </section>

  <section class="calc-res">
    <div class="res-main"><small>القدرة</small><b>${num(r.watts)}</b><span>واط</span></div>
    <div class="res-main"><small>تيار الكهرباء</small><b>${num(r.acA, 2)}</b><span>أمبير على ${c.acV} فولت</span></div>
  </section>
  <section class="card"><div class="card-h"><h2>كم يسحب من البطارية؟</h2></div><div class="bat-vs">${bats}</div>
    ${h.state.prefs.batteryAh && r.dcSys > 0 ? `<p class="hint">بطاريتك ${h.state.prefs.batteryAh} أمبير ساعة تكفي هذا الحمل نحو <b>${h.fmt.hours((h.state.prefs.batteryAh * 0.8) / r.dcSys)}</b> (بتفريغ 80%).</p>` : ''}
  </section>

  <details class="card fold"><summary><h2>إعدادات الحساب</h2>${h.icons.chevL}</summary>
    <div class="form">
      <div class="set-row"><span>جهد الكهرباء</span>${chips('acV', [[220, '220'], [230, '230'], [240, '240'], [110, '110']], c.acV)}</div>
      <div class="set-row"><span>نوع الجهاز</span>${chips('kind', [['res', 'حراري / إنارة'], ['motor', 'محرك (مكيف، مضخة)']], c.kind)}</div>
      <div class="set-row"><span>كفاءة الإنفرتر</span><span class="num-in"><input type="number" id="calcEff" min="70" max="99" value="${c.eff}"><small>%</small></span></div>
      ${h.state.model?.ratedV ? '' : `<div class="set-row"><span>جهد بطاريتك</span>${chips('sysV', [[12, '12'], [24, '24'], [48, '48']], sysV)}</div>`}
    </div>
  </details>

  <section class="card explain"><div class="card-h"><h2>كيف حسبناها؟</h2></div>
    <p><b>الواط = الأمبير × الجهد${c.kind === 'motor' ? ' × 0.8' : ''}</b><br>${c.kind === 'motor' ? 'المحركات لا تستغل كل التيار (معامل القدرة ≈ 0.8)، ' : ''}مثلاً 1 أمبير × ${c.acV} فولت = <b>${num(c.acV * PF[c.kind])} واط</b>.</p>
    <p><b>أمبير البطارية = الواط ÷ (جهد البطارية × كفاءة الإنفرتر)</b><br>جهد البطارية أقل بكثير من 220، لذا تيارها أكبر بكثير. والإنفرتر يفقد ~${100 - c.eff}% حرارة أثناء التحويل.</p>
    <p class="rule">كل <b>1 أمبير</b> على ${c.acV} فولت ≈ <b>${num(convert({ ...c, mode: 'ac', input: 1 }, 48).dc48, 1)}</b> أمبير من بطارية 48 ≈ <b>${num(convert({ ...c, mode: 'ac', input: 1 }, 24).dc24, 1)}</b> من 24 ≈ <b>${num(convert({ ...c, mode: 'ac', input: 1 }, 12).dc12, 1)}</b> من 12</p>
  </section>

  <section class="card"><div class="card-h"><h2>جدول سريع</h2><small class="muted">أمبير البطارية</small></div>
    <div class="table qt"><div class="tr th"><span>الكهرباء</span><span>القدرة</span><span>48 فولت</span><span>24 فولت</span><span>12 فولت</span></div>${quick}</div>
  </section>`;
}

function viewList(h, c, sysV) {
  const { esc, state } = h;
  const s = summarizeLoads(c.list, c, sysV);
  const rated = state.model?.ratedW || null;
  const pct = rated ? (s.run / rated) * 100 : null;
  const peakPct = rated ? (s.peak / rated) * 100 : null;
  const verdict = !rated ? null
    : peakPct > 100 ? ['bad', 'يتجاوز قدرة الإنفرتر عند الإقلاع — شغّل الأجهزة الكبيرة واحداً تلو الآخر أو قلّلها']
      : pct > 80 ? ['warn', 'قريب من الحد الأقصى — يعمل لكن الإنفرتر سيسخن، وفّر هامشاً']
        : ['ok', 'مناسب — الإنفرتر يتحمّل هذه الأحمال براحة'];
  const ah = state.prefs.batteryAh;
  const catalog = `<div class="appl">${APPLIANCES.map((a) => `<button class="appl-b" data-add="${a.id}"><span class="ae">${a.e}</span><b>${esc(a.name)}</b><small>${a.w} واط</small></button>`).join('')}</div>`;
  const rows = c.list.length ? c.list.map((it, i) => `
    <div class="ld" data-i="${i}">
      <div class="ld-h"><span class="ae">${esc(it.e)}</span><b>${esc(it.name)}</b><button class="ld-x" data-del="${i}" aria-label="حذف">×</button></div>
      <div class="ld-r">
        <label>القدرة<span class="num-in"><input type="number" min="1" data-f="w" value="${it.w}"><small>واط</small></span></label>
        <label>العدد<span class="qty"><button data-q="-1">−</button><b>${it.qty}</b><button data-q="1">+</button></span></label>
        <label>ساعات/يوم<span class="num-in"><input type="number" min="0" max="24" step="0.5" data-f="hours" value="${it.hours}"><small>س</small></span></label>
      </div>
    </div>`).join('') : '<div class="empty">اضغط على الأجهزة بالأسفل لإضافتها إلى قائمتك.</div>';
  return `
  <section class="calc-res">
    <div class="res-main"><small>الحمل عند التشغيل</small><b>${num(s.run)}</b><span>واط · ${num(s.acA, 1)} أمبير كهرباء</span></div>
    <div class="res-main"><small>من البطارية (${sysV}V)</small><b>${num(s.dcA, 1)}</b><span>أمبير</span></div>
  </section>
  ${rated ? `<section class="card">
    <div class="card-h"><h2>هل يتحمّلها الإنفرتر؟</h2><b>${num(pct)}%</b></div>
    <div class="bar"><i class="${verdict[0] === 'bad' ? 'hot' : verdict[0] === 'warn' ? 'warm' : ''}" style="width:${Math.min(100, pct)}%"></i></div>
    <div class="bar-legend"><span>0</span><span>قدرة الإنفرتر ${num(rated)} واط</span></div>
    <p class="verdict ${verdict[0]}">${esc(verdict[1])}</p>
    <p class="hint">لحظة الإقلاع قد يصل السحب إلى <b>${num(s.peak)} واط</b> (${h.fmt.pct(num(peakPct))}) بسبب المحركات.</p>
  </section>` : ''}
  <h3 class="sec-h">أجهزتي (${c.list.length})</h3>
  <div class="lds">${rows}</div>
  ${c.list.length ? `
  <div class="stats">
    <div class="stat c-amber"><small>الاستهلاك اليومي</small><b>${num(s.whDay / 1000, 2)}</b><span>كيلوواط ساعة</span></div>
    <div class="stat c-sky"><small>ذروة الإقلاع</small><b>${num(s.peak)}</b><span>واط · ${num(s.peakDcA)} أمبير بطارية</span></div>
    ${ah ? `<div class="stat c-green"><small>تكفي بطاريتك</small><b>${s.dcA ? h.fmt.hours((ah * 0.8) / s.dcA) : '—'}</b><span>عند تشغيلها كلها معاً</span></div>` : ''}
    <div class="stat c-violet"><small>ألواح مقترحة</small><b>${num(s.pvKw, 1)} ك.واط</b><span>≈ ${panelsAr(Math.max(1, Math.ceil((s.pvKw * 1000) / 550)))} بقدرة 550 واط</span></div>
    <div class="stat c-pink"><small>بطارية تكفي ${h.fmt.hours(c.backupH)}</small><b>${num(s.batAh)}</b><span>أمبير ساعة على ${sysV} فولت</span></div>
  </div>
  <details class="card fold"><summary><h2>افتراضات الحساب</h2>${h.icons.chevL}</summary><div class="form">
    <div class="set-row"><span>ساعات الشمس الفعّالة يومياً</span><span class="num-in"><input type="number" id="calcSun" min="2" max="9" step="0.5" value="${c.sunH}"><small>س</small></span></div>
    <div class="set-row"><span>ساعات الاحتياط المطلوبة</span><span class="num-in"><input type="number" id="calcBackup" min="1" max="48" value="${c.backupH}"><small>س</small></span></div>
  </div><p class="hint">القيم تقديرية للتخطيط. الثلاجة والمكيف لا يعملان طوال الوقت، لذا حُسب استهلاكهما اليومي بنسبة تشغيل تقريبية. اقتراح الألواح يشمل 25% فواقد، والبطارية محسوبة على متوسط السحب الفعلي (${num(s.avg)} واط) بتفريغ 80%.</p></details>
  <button class="btn ghost wide" id="clearLoads">مسح القائمة</button>` : ''}
  <h3 class="sec-h">أضف جهازاً</h3>
  ${catalog}`;
}

export function bindCalc(h) {
  const { state, $ } = h;
  const c = state.calc;
  const save = (rerender = true) => { store.set('calc', c); if (rerender) h.render(); };
  document.querySelectorAll('[data-ctab]').forEach((b) => { b.onclick = () => { c.tab = b.dataset.ctab; save(); }; });
  document.querySelectorAll('[data-set]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.set;
      const v = b.dataset.v;
      if (k === 'mode' && c.mode !== v) {
        // نحوّل الرقم المكتوب إلى الوحدة الجديدة حتى تبقى النتيجة نفسها
        const r = convert(c, h.sysV());
        c.input = +({ ac: r.acA, w: r.watts, dc: r.dcSys }[v]).toFixed(v === 'w' ? 0 : 2);
      }
      c[k] = ['acV', 'sysV'].includes(k) ? Number(v) : v;
      save();
    };
  });
  const inp = $('#calcInput');
  if (inp) {
    inp.oninput = () => {
      c.input = Math.max(0, Number(inp.value) || 0);
      store.set('calc', c);
      // نحدّث النتائج دون إعادة رسم الحقل حتى لا تختفي لوحة المفاتيح
      const pos = inp.selectionStart;
      h.render();
      const again = $('#calcInput');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch { /* number */ } }
    };
  }
  const bindNum = (id, key, min, max) => {
    const el = $(id);
    if (el) el.onchange = () => { c[key] = Math.min(max, Math.max(min, Number(el.value) || min)); save(); };
  };
  bindNum('#calcEff', 'eff', 70, 99);
  bindNum('#calcSun', 'sunH', 2, 9);
  bindNum('#calcBackup', 'backupH', 1, 48);
  const live = $('#useLive');
  if (live) live.onclick = () => { c.mode = 'w'; c.input = Math.round(state.model.outW); save(); };

  document.querySelectorAll('[data-add]').forEach((b) => {
    b.onclick = () => {
      const a = APPLIANCES.find((x) => x.id === b.dataset.add);
      const existing = c.list.find((x) => x.id === a.id && a.id !== 'custom');
      if (existing) existing.qty++;
      else c.list.push({ ...a, qty: 1, hours: a.id === 'fridge' || a.id === 'freezer' || a.id === 'router' ? 24 : 4 });
      h.toast(`أُضيف: ${a.name}`, 'ok');
      save();
    };
  });
  document.querySelectorAll('.ld').forEach((row) => {
    const it = c.list[Number(row.dataset.i)];
    row.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => { it.qty = Math.max(1, it.qty + Number(b.dataset.q)); save(); }; });
    row.querySelectorAll('[data-f]').forEach((el) => {
      el.onchange = () => { const f = el.dataset.f; it[f] = Math.max(f === 'w' ? 1 : 0, Math.min(f === 'hours' ? 24 : 100000, Number(el.value) || 0)); save(); };
    });
  });
  document.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { c.list.splice(Number(b.dataset.del), 1); save(); }; });
  const clr = $('#clearLoads');
  if (clr) clr.onclick = async () => { if (await h.confirm('مسح القائمة', 'هل تريد حذف كل الأجهزة من القائمة؟')) { c.list = []; save(); } };
}
