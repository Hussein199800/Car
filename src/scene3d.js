// مشهد ثلاثي الأبعاد (إسقاط متساوي القياس) بأسلوب نظيف: بيت أبيض بسقف ألواح داكنة، مرآب بسيارة، بطارية
// تضيء شرائحها بنسبة الشحن، إنفرتر على الجدار، وبرج كهرباء. القيم في الزوايا الأربع،
// والأسلاك تسري فيها أسهم ملوّنة باتجاه الطاقة الحقيقي (لون لكل نوع تدفق).

const S = 23; // حجم الوحدة بالبكسل
const OX = 198, OY = 104;
const C30 = Math.cos(Math.PI / 6), S30 = 0.5;

// من إحداثيات العالم إلى الشاشة
export const P = (x, y, z = 0) => [OX + (x - y) * C30 * S, OY + (x + y) * S30 * S - z * S];
const pt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
const poly = (cls, ...pts) => `<polygon class="${cls}" points="${pts.map((p) => pt(P(...p))).join(' ')}"/>`;
const path = (...pts) => 'M' + pts.map((p) => pt(P(...p))).join(' L');
const at = (x, y, z) => { const [sx, sy] = P(x, y, z); return `left:${(sx / 4).toFixed(1)}%;top:${(sy / 3.6).toFixed(1)}%`; };

// صندوق: الأوجه الظاهرة فقط (العلوي، المواجه لـ +x، المواجه لـ +y)
function box(cls, x0, x1, y0, y1, z0, z1) {
  return poly(`${cls} top`, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1])
    + poly(`${cls} sx`, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1])
    + poly(`${cls} sy`, [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]);
}


function house() {
  const [x0, x1, y0, y1, h, ridge] = [3.2, 8.4, 3.2, 7.4, 3.1, 5.2];
  const ym = (y0 + y1) / 2;
  let s = '';
  s += poly('shadow', [x0 + 0.6, y0 + 0.8, 0], [x1 + 1.6, y0 + 0.8, 0], [x1 + 1.6, y1 + 1.1, 0], [x0 + 0.6, y1 + 1.1, 0]);
  s += poly('roof back', [x0 - 0.3, ym, ridge], [x1 + 0.3, ym, ridge], [x1 + 0.3, y0 - 0.35, h - 0.15], [x0 - 0.3, y0 - 0.35, h - 0.15]);
  s += poly('wall sy', [x0, y1, 0], [x1, y1, 0], [x1, y1, h], [x0, y1, h]);
  s += poly('wall sx', [x1, y0, 0], [x1, y1, 0], [x1, y1, h], [x1, y0, h]);
  s += poly('wall gable', [x1, y0, h], [x1, y1, h], [x1, ym, ridge]);
  // مدخل ونوافذ على الواجهة الجانبية
  s += poly('frame', [x1, 4.0, 0], [x1, 5.6, 0], [x1, 5.6, 2.2], [x1, 4.0, 2.2]);
  s += poly('glass', [x1, 4.15, 0.05], [x1, 5.45, 0.05], [x1, 5.45, 2.05], [x1, 4.15, 2.05]);
  s += poly('win', [x1, 6.0, 1.2], [x1, 6.9, 1.2], [x1, 6.9, 2.3], [x1, 6.0, 2.3]);
  s += poly('step', [x1, 3.8, 0], [x1 + 0.9, 3.8, 0], [x1 + 0.9, 5.8, 0], [x1, 5.8, 0]);
  // السقف الأمامي مغطى بالألواح بالكامل تقريباً
  s += poly('roof front', [x0 - 0.3, ym, ridge], [x1 + 0.3, ym, ridge], [x1 + 0.3, y1 + 0.35, h - 0.15], [x0 - 0.3, y1 + 0.35, h - 0.15]);
  const cols = 5, rows = 3;
  const yz = (t) => [ym + (y1 + 0.25 - ym) * t, ridge - (ridge - h + 0.1) * t + 0.05];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const ax = x0 + 0.05 + c * 1.04, bx = ax + 0.98;
      const [ya, za] = yz(0.06 + r * 0.31), [yb, zb] = yz(0.06 + r * 0.31 + 0.28);
      s += poly('panel', [ax, ya, za], [bx, ya, za], [bx, yb, zb], [ax, yb, zb]);
    }
  }
  s += `<path class="ridge" d="${path([x0 - 0.3, ym, ridge], [x1 + 0.3, ym, ridge])}"/>`;
  return s;
}

// مرآب ملاصق للبيت بسيارة بيضاء
function garage() {
  let s = box('gar', 0.6, 3.2, 3.8, 7.4, 0, 2.2);
  s += poly('gar-open', [0.75, 7.4, 0], [3.05, 7.4, 0], [3.05, 7.4, 1.8], [0.75, 7.4, 1.8]);
  for (let i = 0; i < 4; i++) s += `<path class="slat" d="${path([0.75, 7.41, 1.75 - i * 0.12], [3.05, 7.41, 1.75 - i * 0.12])}"/>`;
  s += box('car', 1.0, 2.8, 6.4, 8.4, 0.25, 0.85) + box('car cab', 1.25, 2.55, 6.6, 7.7, 0.85, 1.35);
  // العجلات على جانب السيارة الظاهر، ملامسة للأرض
  for (const y of [6.85, 7.95]) { const [cx, cy] = P(2.8, y, 0.28); s += `<ellipse class="wheel" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="3.6" ry="4.6"/>`; }
  return s;
}

function pylon() {
  const [x, y] = [9.1, 1.5];
  const legs = [[-0.45, -0.45], [0.45, -0.45], [0.45, 0.45], [-0.45, 0.45]];
  let d = '';
  for (const [dx, dy] of legs) d += path([x + dx, y + dy, 0], [x + dx * 0.25, y + dy * 0.25, 5.4]) + ' ';
  for (const z of [1.4, 2.8, 4.2]) {
    const k = 1 - (z / 5.4) * 0.75;
    d += path(...legs.map(([dx, dy]) => [x + dx * k, y + dy * k, z]), [x + legs[0][0] * k, y + legs[0][1] * k, z]) + ' ';
  }
  d += path([x - 1.2, y, 5.4], [x + 1.2, y, 5.4]) + ' ' + path([x - 0.9, y, 4.7], [x + 0.9, y, 4.7]) + ' ' + path([x, y, 5.4], [x, y, 6.2]);
  return `<path class="tower" d="${d}"/>`;
}


/**
 * يبني المشهد. flowLine تأتي من الواجهة (نبضات متحركة على مسار)، فتبقى سلوكياتها واختباراتها كما هي.
 */
export function scene3d({ flows, labels, flowLine, bat: look = { lit: 0, color: '' } }) {
  // شرائح البطارية على وجهها الأمامي بنسبة الشحن الحقيقية ولون حالتها (نفس منطق مشهد الصور)
  const N = 5, z0 = 0.3, z1 = 2.2, gap = 0.08, hh = (z1 - z0 - gap * (N - 1)) / N;
  let segs = poly('bat-win', [3.55, 8.8, z0 - 0.08], [4.05, 8.8, z0 - 0.08], [4.05, 8.8, z1 + 0.08], [3.55, 8.8, z1 + 0.08]);
  const litN = look.lit ? Math.max(1, Math.round((look.lit / 6) * N)) : 0;
  for (let i = 0; i < N; i++) {
    const a = z0 + i * (hh + gap), b = a + hh, on = i < litN;
    const top = on && look.charging && i === litN - 1 ? ' top' : '';
    segs += poly(`bseg${on ? ' on ' + look.color : ''}${top}`, [3.62, 8.8, a], [3.98, 8.8, a], [3.98, 8.8, b], [3.62, 8.8, b]);
  }
  const bat = box('bat', 3.3, 4.3, 7.8, 8.8, 0, 2.6) + segs;
  const inv = box('inv', 4.9, 5.8, 7.4, 7.75, 1.3, 2.5) + poly('inv-band', [5.05, 7.75, 1.8], [5.65, 7.75, 1.8], [5.65, 7.75, 1.95], [5.05, 7.75, 1.95]);
  const ground = poly('ground top', [-0.5, -0.5, 0], [12, -0.5, 0], [12, 11.5, 0], [-0.5, 11.5, 0]);
  const line = (id, pts, f) => flowLine(id, path(...pts), f.on, f.w, f.reverse, f.kind);
  return `<svg viewBox="0 0 400 360" class="flow-svg scene-svg iso" aria-hidden="true">
    ${ground}${pylon()}${garage()}${house()}
    <path class="cable" d="${path([9.1, 1.5, 5.4], [8.4, 3.4, 3.4])}"/>
    ${line('grid', [[8.4, 3.4, 3.0], [8.4, 3.4, 2.75], [8.4, 7.42, 2.75], [5.7, 7.5, 2.75], [5.7, 7.5, 2.5]], flows.grid)}
    ${line('solar', [[5.35, 6.4, 4.0], [5.35, 7.6, 3.05], [5.35, 7.6, 2.5]], flows.solar)}
    ${line('bat', [[4.9, 7.6, 1.6], [4.6, 7.6, 1.6], [4.6, 8.3, 1.6], [4.3, 8.3, 1.6]], flows.bat)}
    ${line('load', [[5.8, 7.55, 1.6], [7.0, 7.45, 1.6], [8.4, 7.45, 1.6], [8.4, 5.6, 1.6]], flows.load)}
    ${bat}${inv}
  </svg>
  <button class="node corner n-solar ${labels.solar.dim ? 'dim' : ''}" data-page="solar" aria-label="تفاصيل الألواح"><small>الألواح</small><b><bdi>${labels.solar.value}</bdi></b></button>
  <button class="node corner n-grid ${labels.grid.dim ? 'dim' : ''}" data-page="grid" aria-label="تفاصيل كهرباء الشبكة"><small>${labels.grid.title}</small><b><bdi>${labels.grid.value}</bdi></b></button>
  <button class="node corner n-bat ${labels.bat.dim ? 'dim' : ''}" data-page="battery" aria-label="تفاصيل البطارية">${labels.bat.tag}<b><bdi>${labels.bat.value}</bdi></b></button>
  <button class="node corner n-load ${labels.load.dim ? 'dim' : ''}" data-page="load" aria-label="تفاصيل الحمل"><small>البيت</small><b><bdi>${labels.load.value}</bdi></b></button>
  <button class="node n-inv" style="${at(5.35, 7.75, 1.9)}" data-page="device" aria-label="تفاصيل الإنفرتر"></button>`;
}
