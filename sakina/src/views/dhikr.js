// أدوات الذكر المشتركة: نسخ، مشاركة نصاً أو صورة، المفضلة
import { state, save } from '../store.js';
import { ITEM_BY_ID, CATEGORY_BY_ID } from '../data/adhkar.js';
import { copyText, shareText, shareImage } from '../native.js';
import { toast, renderShareCard, dhikrText } from '../ui.js';
import { icon } from '../icons.js';

const extra = new Map();
/** تسجيل نص عابر (آية اليوم، دعاء الحالة...) ليستعمله زر نسخ/مشاركة */
export function registerText(key, data) { extra.set(key, data); return key; }

function payload(el) {
  const id = el.dataset.id;
  if (id) {
    const it = ITEM_BY_ID[id] || state.custom.find((c) => c.id === id);
    if (!it) return null;
    const cat = CATEGORY_BY_ID[it.cat];
    return { text: it.t, source: it.s || '', title: it.h || (cat ? cat.title : 'من أذكاري') };
  }
  return extra.get(el.dataset.key) || null;
}

const fullText = (p) => `${dhikrText(p.text)}${p.source ? `\n\n[${p.source}]` : ''}\n\n— من تطبيق سكينة`;

export const isFav = (id) => state.favorites.indexOf(id) !== -1;

/** شريط أدوات البطاقة */
export function toolsRow(attr, { fav = null, extraBtns = '' } = {}) {
  return `<div class="tools-row">
    <button class="tool" data-act="d-copy" ${attr} aria-label="نسخ">${icon('copy')}</button>
    <button class="tool" data-act="d-share" ${attr} aria-label="مشاركة">${icon('share')}</button>
    <button class="tool" data-act="d-image" ${attr} aria-label="مشاركة كصورة">${icon('image')}</button>
    ${fav ? `<button class="tool ${isFav(fav) ? 'on' : ''}" data-act="d-fav" data-id="${fav}" aria-label="المفضلة" aria-pressed="${isFav(fav)}">${icon('heart')}</button>` : ''}
    ${extraBtns}
  </div>`;
}

export const actions = {
  'd-copy': async (el) => {
    const p = payload(el);
    if (p && (await copyText(fullText(p)))) toast('تم نسخ الذكر بنجاح');
  },
  'd-share': async (el) => {
    const p = payload(el);
    if (!p) return;
    const r = await shareText(fullText(p));
    if (r === 'copied') toast('تم نسخ النص لمشاركته');
  },
  'd-image': async (el) => {
    const p = payload(el);
    if (!p) return;
    toast('جارٍ تجهيز البطاقة…', 'image');
    try {
      const r = await shareImage(await renderShareCard(p));
      if (r === 'downloaded') toast('تم حفظ البطاقة كصورة', 'download');
    } catch (e) { toast('تعذّر إنشاء البطاقة', 'info'); }
  },
  'd-fav': (el) => {
    const id = el.dataset.id;
    const i = state.favorites.indexOf(id);
    if (i === -1) state.favorites.push(id); else state.favorites.splice(i, 1);
    save();
    const on = i === -1;
    document.querySelectorAll(`[data-act="d-fav"][data-id="${id}"]`).forEach((b) => { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    toast(on ? 'أُضيف إلى المفضلة' : 'أُزيل من المفضلة', 'heart');
  },
};
