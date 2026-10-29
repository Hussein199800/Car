// حالة التطبيق محفوظة في localStorage: الإعدادات، تقدّم اليوم، المفضلة، الأذكار الخاصة، المسبحة، السجل
import { dateKey } from './dates.js';

const KEY = 'sakina.v1';

export const DEFAULTS = {
  settings: {
    theme: 'oasis',
    fontSize: 25,
    tashkeel: true,
    autoAdvance: true,
    sound: true,
    haptic: true,
    digits: 'arab',
    readMode: 'focus',
    location: { type: 'city', cityId: 0 },
    method: 'auto',
    asr: 'shafi',
    hijriAdjust: 0,
    notif: {
      morning: { on: false, time: '06:30' },
      evening: { on: false, time: '17:00' },
      sleep: { on: false, time: '22:30' },
      prayers: false,
      friday: false,
    },
  },
  progress: { date: '', counts: {} },
  favorites: [],
  custom: [],
  tasbih: { selected: 'subhan', target: 33, count: 0, rounds: 0, total: 0 },
  history: {},
};

function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(base)) return saved === undefined ? base : saved;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], saved[k]) : saved[k];
  }
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return merge(DEFAULTS, raw ? JSON.parse(raw) : {});
  } catch (e) {
    return merge(DEFAULTS, {});
  }
}

export const state = load();

let timer;
export function save() {
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
export function flush() {
  clearTimeout(timer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* التخزين ممتلئ أو محجوب */ }
}

/** تقدّم اليوم يُصفَّر تلقائياً مع بداية يوم جديد */
export function today() {
  const k = dateKey();
  if (state.progress.date !== k) state.progress = { date: k, counts: {} };
  if (!state.history[k]) state.history[k] = { m: 0, e: 0, p: 0, r: 0, t: 0, pr: [0, 0, 0, 0, 0] };
  return state.history[k];
}

export const doneOf = (id) => (today(), state.progress.counts[id] || 0);

export function replaceAll(data) {
  const next = merge(DEFAULTS, data);
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  flush();
}

export function clearAll() {
  try { localStorage.removeItem(KEY); } catch (e) { /* تجاهل */ }
  replaceAll({});
}
