// التبويب الخامس: التخصيص والأدوات
import { state, save, flush, replaceAll, clearAll } from '../store.js';
import { icon } from '../icons.js';
import { num, esc, normalize } from '../text.js';
import { CITIES } from '../data/cities.js';
import { METHODS } from '../prayer.js';
import { location, deviceTz, rescheduleNotifications } from '../services.js';
import { pageHead, refresh } from './common.js';
import { THEMES, openSheet, confirmSheet, toast } from '../ui.js';
import { getPosition, notificationsSupported, ensureNotifyPermission, exactAlarmsAllowed, openExactAlarmSettings, saveTextFile, isNative } from '../native.js';

const VERSION = '1.0.0';

const sw = (on, act, extra = '') => `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" data-act="${act}" ${extra}><i></i></button>`;
const row = (ic, label, sub, control) => `<div class="set-row"><span class="set-ic">${icon(ic)}</span><div class="set-txt"><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div>${control}</div>`;

function themes() {
  return `<div class="theme-grid">${Object.entries(THEMES).map(([k, t]) => `
    <button class="theme-card ${state.settings.theme === k ? 'on' : ''}" data-act="set-theme" data-k="${k}" aria-pressed="${state.settings.theme === k}" style="background:${t.bg};color:${t.text}">
      <span class="tc-preview" style="background:${t.card}">
        <i style="background:${t.primary}"></i><i style="background:${t.secondary}"></i><i style="background:${t.text};opacity:.25"></i>
      </span>
      <b>${t.name}</b><small style="color:${t.text}">${t.hint}</small>
      <span class="tc-check" style="background:${t.primary};color:${t.dark ? t.bg : '#fff'}">${icon('check')}</span>
    </button>`).join('')}</div>`;
}

function notifRow(key, ic, label) {
  const n = state.settings.notif[key];
  return `<div class="set-row">
    <span class="set-ic">${icon(ic)}</span>
    <div class="set-txt"><b>${label}</b><small>${n.on ? 'مفعّل يومياً' : 'متوقف'}</small></div>
    <input type="time" class="time-in" value="${n.time}" data-time="${key}" ${n.on ? '' : 'disabled'} aria-label="وقت ${label}">
    ${sw(n.on, 'set-notif', `data-k="${key}"`)}
  </div>`;
}

export function render() {
  const s = state.settings;
  const loc = location();
  return `${pageHead('الإعدادات', 'خصّص سكينة كما يريحك')}
    <section class="block">
      <div class="block-head"><h2>${icon('palette')} الثيم والألوان</h2></div>
      ${themes()}
    </section>

    <section class="card set-card">
      <h2 class="set-title">${icon('type')} القراءة</h2>
      <div class="set-row"><span class="set-ic">${icon('type')}</span><div class="set-txt"><b>حجم خط الأذكار</b><small>${num(s.fontSize)} بكسل</small></div>
        <div class="stepper sm"><button class="icon-btn" data-act="set-font" data-d="-2" aria-label="تصغير">${icon('minus')}</button><button class="icon-btn" data-act="set-font" data-d="2" aria-label="تكبير">${icon('plus')}</button></div></div>
      <p class="font-preview amiri" style="font-size:${s.fontSize}px">${s.tashkeel ? 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ' : 'سبحان الله وبحمده'}</p>
      ${row('sparkle', 'إظهار التشكيل', 'الحركات على نصوص الأذكار', sw(s.tashkeel, 'set-toggle', 'data-k="tashkeel"'))}
      ${row('focus', 'الانتقال التلقائي', 'إلى الذكر التالي عند اكتمال العدد', sw(s.autoAdvance, 'set-toggle', 'data-k="autoAdvance"'))}
      ${row('volume', 'صوت النقر', 'نقرة ناعمة مع كل تسبيحة', sw(s.sound, 'set-toggle', 'data-k="sound"'))}
      ${row('vibrate', 'الاهتزاز', 'اهتزاز خفيف عند العدّ', sw(s.haptic, 'set-toggle', 'data-k="haptic"'))}
      <div class="set-row"><span class="set-ic">${icon('list')}</span><div class="set-txt"><b>شكل الأرقام</b></div>
        <div class="seg sm">${[['arab', '١٢٣'], ['latn', '123']].map(([k, l]) => `<button class="seg-btn ${s.digits === k ? 'on' : ''}" data-act="set-digits" data-k="${k}">${l}</button>`).join('')}</div></div>
    </section>

    <section class="card set-card">
      <h2 class="set-title">${icon('mosque')} مواقيت الصلاة</h2>
      <button class="set-row link" data-act="set-city">
        <span class="set-ic">${icon('pin')}</span><div class="set-txt"><b>الموقع</b><small>${esc(loc.name)}${loc.country ? ` · ${loc.country}` : ''}${loc.gps ? ' (GPS)' : ''}</small></div>${icon('chevron')}
      </button>
      <label class="set-row"><span class="set-ic">${icon('calendar')}</span><div class="set-txt"><b>طريقة الحساب</b></div>
        <select data-sel="method">
          <option value="auto" ${s.method === 'auto' ? 'selected' : ''}>تلقائي حسب البلد (${METHODS[loc.method].name})</option>
          ${Object.entries(METHODS).map(([k, m]) => `<option value="${k}" ${s.method === k ? 'selected' : ''}>${m.name}</option>`).join('')}
        </select></label>
      <label class="set-row"><span class="set-ic">${icon('sun-dim')}</span><div class="set-txt"><b>حساب العصر</b></div>
        <select data-sel="asr"><option value="shafi" ${s.asr === 'shafi' ? 'selected' : ''}>الجمهور (المثل)</option><option value="hanafi" ${s.asr === 'hanafi' ? 'selected' : ''}>الحنفي (المثلين)</option></select></label>
      <label class="set-row"><span class="set-ic">${icon('moon')}</span><div class="set-txt"><b>تعديل التاريخ الهجري</b><small>حسب رؤية الهلال في بلدك</small></div>
        <select data-sel="hijriAdjust">${[-2, -1, 0, 1, 2].map((v) => `<option value="${v}" ${s.hijriAdjust === v ? 'selected' : ''}>${v === 0 ? 'بدون تعديل' : `${v > 0 ? '+' : ''}${num(v)} يوم`}</option>`).join('')}</select></label>
      <button class="set-row link" data-act="go" data-to="#/qibla">
        <span class="set-ic">${icon('compass')}</span><div class="set-txt"><b>بوصلة القبلة</b><small>اتجاه الكعبة المشرّفة من موقعك</small></div>${icon('chevron')}
      </button>
    </section>

    <section class="card set-card">
      <h2 class="set-title">${icon('bell')} التنبيهات</h2>
      ${notificationsSupported ? '' : `<p class="note">${icon('info')} التنبيهات تعمل في تطبيق أندرويد. في المتصفح يمكنك فتح التطبيق في أي وقت لمتابعة وردك.</p>`}
      ${notifRow('morning', 'sunrise', 'أذكار الصباح')}
      ${notifRow('evening', 'sunset', 'أذكار المساء')}
      ${notifRow('sleep', 'moon', 'أذكار النوم')}
      ${row('mosque', 'تنبيه أوقات الصلاة', 'عند دخول وقت كل صلاة', sw(s.notif.prayers, 'set-notif-flag', 'data-k="prayers"'))}
      ${row('calendar', 'تذكير الجمعة', 'سورة الكهف والصلاة على النبي ﷺ', sw(s.notif.friday, 'set-notif-flag', 'data-k="friday"'))}
      ${isNative ? '<p class="note small" data-exact hidden></p>' : ''}
    </section>

    <section class="card set-card">
      <h2 class="set-title">${icon('download')} البيانات</h2>
      <p class="muted small">كل بياناتك محفوظة على جهازك فقط، ولا يُرسَل شيء إلى أي خادم.</p>
      <div class="data-btns">
        <button class="btn btn-soft" data-act="data-export">${icon('download')} تصدير نسخة</button>
        <label class="btn btn-soft">${icon('upload')} استيراد نسخة<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="btn btn-danger-soft" data-act="data-clear">${icon('trash')} مسح البيانات</button>
      </div>
    </section>

    <section class="card about">
      <div class="about-logo">${icon('sparkle')}</div>
      <h2>سكينة</h2>
      <p class="muted">رفيقك الروحي اليومي · الإصدار ${num(VERSION)}</p>
      <p>أذكار وأدعية من صحيح السنة، ومواقيت صلاة دقيقة، ومسبحة، ومتابعة لعادتك اليومية. يعمل بالكامل بدون إنترنت، مجاناً وبلا إعلانات.</p>
      <div class="dev-card">
        <small>تطوير وتصميم</small>
        <b class="dev-name">حسين محمد علي الطويل</b>
        <p class="dev-dua amiri">اللَّهُمَّ اغْفِرْ لِعَبْدِكَ حسين محمد علي الطويل وَلِوَالِدَيْهِ، وَارْحَمْهُمَا كَمَا رَبَّيَاهُ صَغِيرًا، وَاجْعَلْ هَٰذَا الْعَمَلَ صَدَقَةً جَارِيَةً فِي مِيزَانِ حَسَنَاتِهِمْ، وَاجْمَعْهُمْ فِي الْفِرْدَوْسِ الْأَعْلَى مِنَ الْجَنَّةِ.</p>
        <p class="muted small">إن نفعك هذا التطبيق، فلا تنسَ مطوّره ووالديه من دعوة صادقة بظهر الغيب؛ فإن الملَك يقول: «ولك بمثل».</p>
      </div>
    </section>`;
}

export function mount(root) {
  root.querySelectorAll('select[data-sel]').forEach((sel) => sel.addEventListener('change', () => {
    const k = sel.dataset.sel;
    state.settings[k] = k === 'hijriAdjust' ? +sel.value : sel.value;
    save();
    rescheduleNotifications();
    refresh();
  }));
  root.querySelectorAll('input[data-time]').forEach((inp) => inp.addEventListener('change', () => {
    if (!inp.value) return;
    state.settings.notif[inp.dataset.time].time = inp.value;
    save();
    rescheduleNotifications();
    toast('تم تحديث وقت التذكير', 'bell');
  }));
  const imp = root.querySelector('[data-import]');
  if (imp) imp.addEventListener('change', async () => {
    const f = imp.files && imp.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await readFile(f));
      if (!data || typeof data !== 'object' || !data.settings) throw new Error('bad');
      replaceAll(data);
      toast('تم استيراد بياناتك');
      document.dispatchEvent(new Event('app:theme'));
    } catch (e) { toast('الملف غير صالح', 'info'); }
  });
  const exact = root.querySelector('[data-exact]');
  const n = state.settings.notif;
  if (exact && (n.prayers || n.morning.on || n.evening.on)) {
    exactAlarmsAllowed().then((ok) => {
      if (ok) return;
      exact.hidden = false;
      exact.innerHTML = `${icon('info')} لتصل التنبيهات في وقتها بالضبط، اسمح للتطبيق بـ«المنبّهات والتذكيرات». <button class="link-btn" data-act="exact-open">فتح الإعدادات</button>`;
    });
  }
}

// FileReader بدل Blob.text() ليعمل على WebView القديم في أندرويد ٨
const readFile = (f) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsText(f);
});

async function needPermission() {
  if (!notificationsSupported) { toast('التنبيهات متاحة في تطبيق أندرويد', 'info'); return false; }
  if (await ensureNotifyPermission()) return true;
  toast('اسمح للتطبيق بإرسال الإشعارات من إعدادات الهاتف', 'info');
  return false;
}

function cityPicker() {
  openSheet(`<h3 class="sheet-title">اختر موقعك</h3>
    <button class="btn btn-primary wide" data-gps>${icon('location')} استخدام موقعي الحالي</button>
    <label class="search in-sheet">${icon('search')}<input type="search" placeholder="ابحث عن مدينة أو دولة…" data-q></label>
    <div class="city-list" data-list></div>`, {
    cls: 'sheet-tall',
    onMount: (body, close) => {
      const list = body.querySelector('[data-list]');
      const draw = (q) => {
        const nq = normalize(q || '');
        const sel = state.settings.location;
        list.innerHTML = CITIES.filter((c) => !nq || normalize(`${c.name} ${c.country}`).indexOf(nq) !== -1)
          .map((c) => `<button class="city ${sel.type === 'city' && sel.cityId === c.id ? 'on' : ''}" data-city="${c.id}"><b>${c.name}</b><small>${c.country}</small></button>`).join('')
          || '<p class="muted center">لا توجد مدينة بهذا الاسم</p>';
      };
      draw('');
      body.querySelector('[data-q]').addEventListener('input', (e) => draw(e.target.value));
      list.addEventListener('click', (e) => {
        const b = e.target.closest('[data-city]');
        if (!b) return;
        state.settings.location = { type: 'city', cityId: +b.dataset.city };
        save();
        rescheduleNotifications();
        close();
        toast(`تم اختيار ${CITIES[+b.dataset.city].name}`, 'pin');
        refresh();
      });
      body.querySelector('[data-gps]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = `${icon('location')} جارٍ تحديد الموقع…`;
        try {
          const p = await getPosition();
          // نقترح طريقة الحساب من أقرب مدينة مدمجة
          let near = CITIES[0];
          let best = Infinity;
          for (const c of CITIES) { const d = (c.lat - p.lat) ** 2 + (c.lng - p.lng) ** 2; if (d < best) { best = d; near = c; } }
          state.settings.location = { type: 'gps', lat: p.lat, lng: p.lng, tz: deviceTz(), method: near.method, name: best < 1.5 ? `قرب ${near.name}` : 'موقعي الحالي' };
          save();
          rescheduleNotifications();
          close();
          toast('تم تحديد موقعك بنجاح', 'location');
          refresh();
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = `${icon('location')} استخدام موقعي الحالي`;
          toast('تعذّر تحديد الموقع، اختر مدينتك من القائمة', 'info');
        }
      });
    },
  });
}

export const actions = {
  'set-theme': (el) => { state.settings.theme = el.dataset.k; save(); document.dispatchEvent(new Event('app:theme')); },
  'set-font': (el) => { state.settings.fontSize = Math.max(18, Math.min(44, state.settings.fontSize + +el.dataset.d)); save(); document.dispatchEvent(new Event('app:theme')); },
  'set-toggle': (el) => { const k = el.dataset.k; state.settings[k] = !state.settings[k]; save(); refresh(); },
  'set-digits': (el) => { state.settings.digits = el.dataset.k; save(); document.dispatchEvent(new Event('app:theme')); },
  'set-city': () => cityPicker(),
  'set-notif': async (el) => {
    const n = state.settings.notif[el.dataset.k];
    if (!n.on && !(await needPermission())) return;
    n.on = !n.on;
    save();
    await rescheduleNotifications();
    refresh();
  },
  'set-notif-flag': async (el) => {
    const k = el.dataset.k;
    if (!state.settings.notif[k] && !(await needPermission())) return;
    state.settings.notif[k] = !state.settings.notif[k];
    save();
    await rescheduleNotifications();
    refresh();
  },
  'exact-open': () => openExactAlarmSettings(),
  'data-export': async () => {
    flush();
    await saveTextFile(`sakina-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1));
    toast('تم تجهيز نسخة من بياناتك', 'download');
  },
  'data-clear': async () => {
    if (!(await confirmSheet('مسح كل البيانات', 'ستُحذف الإعدادات والتقدّم والمفضلة وأذكارك الخاصة وسجلّ الالتزام. لا يمكن التراجع عن ذلك.', 'مسح نهائي', true))) return;
    clearAll();
    await rescheduleNotifications();
    toast('تم مسح البيانات', 'trash');
    document.dispatchEvent(new Event('app:theme'));
  },
};
