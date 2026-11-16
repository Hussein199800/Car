// واجهة «محاكاة جهاز على الحمل الحالي» في حاسبة الأحمال
import { simulateDevice } from './timeline.js';
import { latinDigits } from './model.js';
export function viewSimulation(h) {
  const c = h.state.simulation ||= { watts: 1000, minutes: 60, alreadyOn: false };
  return `<section class="card" id="simulation"><h2>محاكاة جهاز على الحمل الحالي</h2>
    <div class="form"><label class="num-row"><span>قدرة الجهاز</span><span class="num-in"><input id="simWatts" inputmode="decimal" type="text" value="${c.watts}"><small>واط</small></span></label>
    <label class="num-row"><span>مدة التشغيل</span><span class="num-in"><input id="simMinutes" inputmode="decimal" type="text" value="${c.minutes}"><small>دقيقة</small></span></label>
    <label class="sim-check"><input id="simAlreadyOn" type="checkbox" ${c.alreadyOn ? 'checked' : ''}> الجهاز يعمل الآن ومشمول في قراءة الحمل</label></div>
    <div id="simResult" role="status" aria-live="polite"></div>
    <p class="hint">افتراضات: قدرة ثابتة طوال المدة، وثبات الحمل وإنتاج الألواح ووضع التشغيل. كفاءة التحويل 90%. الطاقة تخص الجهاز وحده؛ إذا كان يعمل أصلاً فالإضافة صفر. لا يشمل تيار الإقلاع أو حدود القدرة الظاهرية. أثر البطارية تقدير خطي في وضع البطارية فقط، ويتطلب نسبة الشحن وسعتها وجهدها المقنّن. لا تُرسل أي أوامر.</p></section>`;
}
export function bindSimulation(h) {
  const root = h.$('#simulation'); if (!root) return;
  const c = h.state.simulation;
  const update = () => {
    c.watts = Number(latinDigits(h.$('#simWatts').value));
    c.minutes = Number(latinDigits(h.$('#simMinutes').value));
    c.alreadyOn = h.$('#simAlreadyOn').checked;
    const r = simulateDevice(h.state.model, { ...c, ...h.state.prefs });
    // الواط بلا كسور، والطاقة بمنزلتين، والنسب بمنزلة
    const digits = { 'واط': 0, 'ك.و.س': 2, '%': 1, 'نقطة مئوية': 1 };
    const f = (v, unit) => Number.isFinite(v) ? v.toFixed(digits[unit] ?? 2) : '—';
    const row = (label, value, unit, key) => `<div class="sim-row"><span>${label}</span><b><bdi data-sim-value="${key}">${f(value, unit)}</bdi> <small>${unit}</small></b></div>`;
    const note = (text, cls = '') => `<p class="hint ${cls}">${text}</p>`;
    let html = r.error ? note(r.error,'bad') : row('طاقة الجهاز خلال المدة',r.energyWh/1000,'ك.و.س','energy');
    if (!r.error) {
      if (r.unavailable) html += note(r.unavailable,'bad');
      else {
        html += row('الحمل المتوقع',r.totalW,'واط','totalW') + row('القدرة الإضافية',r.addedW,'واط','addedW') + row('الطاقة الإضافية',r.addedWh/1000,'ك.و.س','addedEnergy') + row('هامش الإنفرتر',r.headroomW,'واط','headroom');
        if(r.headroomW < 0) html += note('تجاوز القدرة المقنّنة للإنفرتر.','bad');
        if(r.headroomW === null) html += note('قدرة الإنفرتر المقنّنة غير متاحة.');
        if(c.alreadyOn) html += note('الجهاز مشمول في الحمل الحالي؛ لم تُضف قدرته مرة أخرى.');
        if(r.battery) {
          html += row('قدرة البطارية المتوقعة',r.battery.projectedBatW,'واط','batW') + note('الموجب شحن، والسالب تفريغ.') + row('الشحن عند نهاية المدة',r.battery.projectedSoc,'%','soc') + row('النقص الإضافي للشحن',r.battery.extraSocDrop,'نقطة مئوية','socDrop');
          if(r.battery.belowReserve) html += note('أقل من احتياطي البطارية المحدد.','bad');
          if(r.battery.outsideCapacity) html += note('يصل المعدل الخطي إلى حد السعة قبل انتهاء المدة؛ لن يستمر التشغيل بهذا المعدل طوال المدة.','bad');
        } else html += note('أثر البطارية غير متاح: يلزم وضع البطارية وقراءات الشحن والقدرة والسعة والجهد المقنّن.');
      }
    }
    h.$('#simResult').innerHTML = html;
  };
  root.querySelectorAll('input').forEach(el => el.oninput = update); update();
}
