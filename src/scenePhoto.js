// مشهد «الصور»: صورة واقعية للبيت تتبدّل مع الطقس والوقت وحالة المنظومة، وفوقها طبقة SVG
// بنفس أبعاد الصورة ترسم ما يتغيّر لحظياً: نبضات الطاقة على الأسلاك، وشرائح البطارية بنسبتها
// الحقيقية، وضوء الإنفرتر. الصور مولّدة من لقطة واحدة فكل العناصر في المكان نفسه في كل الحالات.

export const PHOTO_W = 1088, PHOTO_H = 1106;
export const PHOTOS = ['day', 'cloudy', 'rain', 'sunset', 'night', 'night-grid', 'offline'];
// الصور الداكنة تحتاج نصاً فاتحاً فوقها
const DARK = new Set(['rain', 'night', 'night-grid']);

// مسارات الأسلاك على الصورة (إحداثيات الصورة نفسها)
const PATHS = {
  solar: 'M560 575 L560 678',
  grid: 'M760 375 L655 445 L637 455 L637 718 L587 694',
  // من الإنفرتر إلى البطارية؛ التفريغ يسير عكسه
  bat: 'M585 722 L632 746',
  load: 'M535 700 L480 671',
};
const STRIP = { x: 662, y: 750, w: 14, h: 69, n: 6, gap: 3 };
const LED = [550, 706];

const hhmm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

/**
 * أي صورة تناسب الحالة الآن. sky من الطقس الحقيقي (أو الساعة)، وsunset بصيغة «17:05» إن عُرف.
 */
export function photoFor({ live, sky, gridFeeds, sunset, now = new Date() }) {
  if (!live) return 'offline';
  if (sky === 'night') return gridFeeds ? 'night-grid' : 'night';
  if (sky === 'rain' || sky === 'storm') return 'rain';
  if (sky === 'cloudy' || sky === 'fog' || sky === 'snow') return 'cloudy';
  const ss = hhmm(sunset);
  const t = now.getHours() * 60 + now.getMinutes();
  if (ss !== null && t >= ss - 75 && t < ss + 20) return 'sunset';
  return 'day';
}

// لون شرائح البطارية: أخضر يشحن، أزرق يشحن من الشبكة، كهرماني يُفرّغ، أحمر منخفضة
export function batLook({ soc, batW, live, low = 30, gridCharging = false }) {
  if (!live || soc === null || soc === undefined) return { lit: 0, color: '' };
  const lit = soc <= 0 ? 0 : Math.max(1, Math.round((soc / 100) * STRIP.n));
  const color = soc <= low ? 'red' : (batW ?? 0) > 10 ? (gridCharging ? 'blue' : 'green') : (batW ?? 0) < -10 ? 'amber' : 'green';
  return { lit, color, charging: (batW ?? 0) > 10 };
}

export function scenePhoto({ img, flows, labels, flowLine, bat, led }) {
  const { x, y, w, h, n, gap } = STRIP;
  const sh = (h - gap * (n - 1)) / n;
  const segs = Array.from({ length: n }, (_, i) => {
    const on = i < bat.lit;
    const sy = y + h - (i + 1) * sh - i * gap;
    const top = on && i === bat.lit - 1 && bat.charging ? ' top' : '';
    return `<rect class="seg${on ? ' on ' + bat.color : ''}${top}" x="${x}" y="${sy.toFixed(1)}" width="${w}" height="${sh.toFixed(1)}" rx="2.5"/>`;
  }).join('');
  const line = (id) => flowLine(id, PATHS[id], flows[id].on, flows[id].w, flows[id].reverse);
  return `<img class="ph-img" src="scene/${img}.webp" alt="" decoding="async" draggable="false">
  <svg viewBox="0 0 ${PHOTO_W} ${PHOTO_H}" class="flow-svg scene-svg photo" aria-hidden="true">
    ${line('grid')}${line('solar')}${line('bat')}${line('load')}
    <g class="bat-segs">${segs}</g>
    <circle class="ph-led ${led}" cx="${LED[0]}" cy="${LED[1]}" r="4.5"/>
  </svg>
  <button class="node corner n-solar ${labels.solar.dim ? 'dim' : ''}" data-page="solar" aria-label="تفاصيل الألواح"><small>الألواح</small><b><bdi>${labels.solar.value}</bdi></b></button>
  <button class="node corner n-grid ${labels.grid.dim ? 'dim' : ''}" data-page="grid" aria-label="تفاصيل كهرباء الشبكة"><small>${labels.grid.title}</small><b><bdi>${labels.grid.value}</bdi></b></button>
  <button class="node corner n-bat ${labels.bat.dim ? 'dim' : ''}" data-page="battery" aria-label="تفاصيل البطارية">${labels.bat.tag}<b><bdi>${labels.bat.value}</bdi></b></button>
  <button class="node corner n-load ${labels.load.dim ? 'dim' : ''}" data-page="load" aria-label="تفاصيل الحمل"><small>البيت</small><b><bdi>${labels.load.value}</bdi></b></button>
  <button class="node n-inv" style="left:${(LED[0] / PHOTO_W * 100).toFixed(1)}%;top:${(718 / PHOTO_H * 100).toFixed(1)}%" data-page="device" aria-label="تفاصيل الإنفرتر"></button>
  <button class="node n-batbox" style="left:${(669 / PHOTO_W * 100).toFixed(1)}%;top:${(760 / PHOTO_H * 100).toFixed(1)}%" data-page="battery" aria-label="البطارية"></button>`;
}

export const photoIsDark = (img) => DARK.has(img);
