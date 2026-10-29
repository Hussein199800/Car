// بيانات الوضع التجريبي فقط — تُعرض دائماً مع شارة «تجريبي» ولا تختلط بالبيانات الحقيقية

function sampleAt(t) {
  const d = new Date(t);
  const h = d.getHours() + d.getMinutes() / 60;
  const sun = Math.max(0, Math.sin(((h - 6) / 13) * Math.PI));
  const wave = Math.sin(t / 7e5);
  const pvW = Math.round(sun * 4200 * (0.92 + 0.08 * wave));
  const load = Math.round(380 + 250 * Math.max(0, Math.sin(((h - 15) / 8) * Math.PI)) + 30 * wave);
  const soc = Math.round(Math.min(100, Math.max(20, 55 + 40 * sun - (h > 18 || h < 6 ? 10 : 0))));
  const batV = +(48.5 + soc * 0.055).toFixed(1);
  // أولوية SBU: الحمل على الألواح والبطارية، ولا يتحول للشبكة إلا إذا ضعفت البطارية بلا شمس
  const onGrid = sun <= 0.05 && soc <= 40;
  const net = onGrid ? Math.max(0, pvW) : pvW - load;
  const pad = (x) => String(x).padStart(2, '0');
  return [
    ['Timestamp', `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`, ''],
    ['SN', '00000000000000', ''],
    ['Machine Type', 'Off Grid', ''],
    ['Main CPU Firmware Version', '00069.00', ''],
    ['Grid Voltage', (230 + wave).toFixed(1), 'V'],
    ['Grid Frequency', '50.0', 'Hz'],
    ['PV1 Input Voltage', (sun ? 280 + 10 * wave : 0).toFixed(1), 'V'],
    ['PV1 Charging Power', pvW, 'W'],
    ['Battery Voltage', batV, 'V'],
    ['Battery Capacity', soc, '%'],
    ['Battery Charging Current', net > 0 ? Math.round(net / batV) : 0, 'A'],
    ['Battery Discharge Current', net < 0 ? Math.round(-net / batV) : 0, 'A'],
    ['AC Output Voltage', '230.0', 'V'],
    ['AC Output Frequency', '50.0', 'Hz'],
    ['AC Output Apparent Power', Math.round(load * 1.3), 'VA'],
    ['AC Output Active Power', load, 'W'],
    ['Output Load Percent', Math.round((load / 6500) * 100), '%'],
    ['Battery Rating Voltage', '48.0', 'V'],
    ['AC Output Rating Active Power', '6500', 'W'],
    ['Battery Type', 'Lib', ''],
    ['Output Source Priority', 'Solar Bat Utility', ''],
    ['Charger Source Priority', 'Solar + Utility', ''],
    ['Load Status', 'Load on', ''],
    ['Model', onGrid ? 'Line Mode' : 'Battery Mode', ''],
    ['Today generation', h < 6 ? 0 : Math.round(((4200 * 13) / Math.PI) * (1 - Math.cos((Math.PI * Math.min(h - 6, 13)) / 13))), 'Wh'],
    ['Inverter Fault', '-', ''],
  ];
}

export function demoPoints(t = Date.now()) {
  return sampleAt(t).map(([title, val, unit]) => ({ title, val: String(val), unit }));
}

export function demoHistory(date) {
  const first = sampleAt(Date.now());
  const titles = first.map((x) => x[0]);
  const rows = [];
  const base = new Date(date + 'T00:00:00').getTime();
  const end = Math.min(base + 864e5 - 1, Date.now());
  for (let t = base; t <= end; t += 5 * 60000) rows.push(sampleAt(t).map((x) => String(x[1])));
  return { titles, rows };
}
