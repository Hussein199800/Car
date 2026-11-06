// المشهد الكلاسيكي (إصدار 3.7): رسم مسطّح بسيط لبيت وألواح وبطارية وبرج، مع سماء متحركة من الطقس
export function sceneClassic({ soc = 0, flows, labels, flowLine }) {
  const lvl = Math.max(0, Math.min(100, soc));
  const line = (id, d) => flowLine(id, d, flows[id].on, flows[id].w, flows[id].reverse);
  return `<svg viewBox="0 0 360 300" class="flow-svg scene-svg classic" aria-hidden="true">
      <path class="ground" d="M0 248 Q180 228 360 248 L360 300 L0 300 Z"/>
      <g class="tower"><path d="M318 238 L330 120 L342 238 M322 200 H338 M325 165 H335 M312 140 H348 M316 128 H344"/></g>
      <g class="house">
        <path class="wall" d="M150 238 V150 L230 112 L310 150 V238 Z"/>
        <path class="roof" d="M136 156 L230 104 L322 156"/>
        <path class="panels" d="M152 140 L226 101 L240 116 L168 154 Z"/>
        <path class="panel-lines" d="M170 131 L184 145 M188 121 L202 136 M207 111 L220 126 M160 147 L233 108"/>
        <rect class="door" x="264" y="192" width="26" height="46" rx="3"/>
        <rect class="win" x="236" y="168" width="20" height="18" rx="2"/>
      </g>
      <g class="battery-box"><rect x="96" y="176" width="34" height="62" rx="7"/><rect class="lvl" x="101" y="${181 + Math.round(52 * (1 - lvl / 100))}" width="24" height="${Math.round(52 * (lvl / 100))}" rx="4"/></g>
      ${line('solar', 'M196 128 L196 168')}
      ${line('grid', 'M330 150 L330 160 L210 160 L210 168')}
      ${line('load', 'M212 186 L250 186 L250 214 L264 214')}
      ${line('bat', 'M182 186 L150 186 L150 206 L130 206')}
      <rect class="inv-box" x="182" y="168" width="30" height="34" rx="6"/><circle class="inv-led" cx="197" cy="178" r="3"/>
    </svg>
    <button class="node n-solar ${labels.solar.dim ? 'dim' : ''}" data-page="solar" aria-label="تفاصيل الألواح"><small>الألواح</small><b><bdi>${labels.solar.value}</bdi></b></button>
    <button class="node n-grid ${labels.grid.dim ? 'dim' : ''}" data-page="grid" aria-label="تفاصيل كهرباء الشبكة"><small>${labels.grid.title}</small><b><bdi>${labels.grid.value}</bdi></b></button>
    <button class="node n-bat ${labels.bat.dim ? 'dim' : ''}" data-page="battery" aria-label="تفاصيل البطارية"><b><bdi>${labels.bat.value}</bdi></b>${labels.bat.tag}</button>
    <button class="node n-load ${labels.load.dim ? 'dim' : ''}" data-page="load" aria-label="تفاصيل الحمل"><small>الحمل</small><b><bdi>${labels.load.value}</bdi></b></button>
    <button class="node n-inv" data-page="device" aria-label="تفاصيل الإنفرتر"></button>`;
}
