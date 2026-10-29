import test from 'node:test';
import assert from 'node:assert/strict';
import * as adhan from 'adhan';
import { computeTimes, qiblaBearing } from '../src/prayer.js';
import { toHijri, nextHijriDate, ymdInTz } from '../src/dates.js';
import { CATEGORIES } from '../src/data/adhkar.js';
import { NAMES } from '../src/data/names.js';
import { CITIES } from '../src/data/cities.js';
import { normalize, stripTashkeel } from '../src/text.js';

const ADHAN_METHODS = {
  mwl: () => adhan.CalculationMethod.MuslimWorldLeague(),
  egypt: () => adhan.CalculationMethod.Egyptian(),
  makkah: () => adhan.CalculationMethod.UmmAlQura(),
  karachi: () => adhan.CalculationMethod.Karachi(),
  isna: () => adhan.CalculationMethod.NorthAmerica(),
  kuwait: () => adhan.CalculationMethod.Kuwait(),
  qatar: () => adhan.CalculationMethod.Qatar(),
};

test('مواقيت الصلاة تطابق مكتبة adhan المرجعية بفارق دقيقتين على الأكثر', () => {
  const cities = ['مكة المكرمة', 'القاهرة', 'بغداد', 'صنعاء', 'الدوحة', 'كراتشي', 'نيويورك', 'الكويت'];
  const days = [{ y: 2026, m: 1, d: 15 }, { y: 2026, m: 6, d: 21 }, { y: 2026, m: 10, d: 29 }];
  for (const name of cities) {
    const c = CITIES.find((x) => x.name === name);
    for (const day of days) {
      for (const asr of ['shafi', 'hanafi']) {
        const ours = computeTimes(day, c, { method: c.method, asr });
        const params = ADHAN_METHODS[c.method]();
        params.madhab = asr === 'hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
        params.adjustments = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
        params.methodAdjustments = { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 };
        const ref = new adhan.PrayerTimes(new adhan.Coordinates(c.lat, c.lng), new Date(day.y, day.m - 1, day.d), params);
        for (const k of ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha']) {
          const diff = Math.abs(ours[k] - ref[k]) / 60000;
          assert.ok(diff <= 2, `${name} ${day.y}-${day.m}-${day.d} ${k} ${asr}: فارق ${diff.toFixed(1)} دقيقة`);
        }
      }
    }
  }
});

test('ترتيب الصلوات منطقي في خطوط العرض العالية صيفاً', () => {
  const t = computeTimes({ y: 2026, m: 6, d: 21 }, { lat: 59.33, lng: 18.07 }, { method: 'mwl' });
  const order = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'].map((k) => t[k].getTime());
  for (const v of order) assert.ok(Number.isFinite(v));
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1]);
});

test('اتجاه القبلة يطابق المرجع', () => {
  for (const c of CITIES.filter((x) => x.name !== 'مكة المكرمة')) {
    const ref = adhan.Qibla(new adhan.Coordinates(c.lat, c.lng));
    assert.ok(Math.abs(qiblaBearing(c.lat, c.lng) - ref) < 0.1, c.name);
  }
});

test('التاريخ الهجري (أم القرى)', () => {
  assert.deepEqual(toHijri({ y: 2026, m: 10, d: 29 }), { y: 1448, m: 5, d: 18 });
  assert.deepEqual(toHijri({ y: 2025, m: 3, d: 1 }), { y: 1446, m: 9, d: 1 });
  const ramadan = nextHijriDate({ y: 2026, m: 10, d: 29 }, 9, 1);
  assert.equal(ramadan.h.y, 1448);
  assert.ok(ramadan.days > 100 && ramadan.days < 140);
});

test('التاريخ المحلي حسب المنطقة الزمنية', () => {
  const d = new Date('2026-10-29T22:30:00Z');
  assert.equal(ymdInTz(d, 'Asia/Baghdad').d, 30);
  assert.equal(ymdInTz(d, 'America/New_York').d, 29);
});

test('المحتوى كامل وغير مختصر', () => {
  assert.equal(NAMES.length, 99);
  const ids = new Set();
  for (const c of CATEGORIES) {
    assert.ok(c.items.length > 0, c.id);
    for (const it of c.items) {
      assert.ok(it.t && it.t.length > 3, it.id);
      assert.ok(!/\.\.\.|…|إلخ/.test(it.t), `نص مختصر في ${it.id}`);
      assert.ok(Number.isInteger(it.n) && it.n > 0, it.id);
      assert.ok(it.s, `مصدر مفقود في ${it.id}`);
      assert.ok(!ids.has(it.id));
      ids.add(it.id);
    }
  }
  const morning = CATEGORIES.find((c) => c.id === 'morning').items;
  const evening = CATEGORIES.find((c) => c.id === 'evening').items;
  assert.ok(morning.length >= 20 && evening.length >= 20);
  assert.ok(morning.some((x) => x.t.startsWith('أَصْبَحْنَا')));
  assert.ok(evening.some((x) => x.t.startsWith('أَمْسَيْنَا')));
});

test('البحث بدون تشكيل وتوحيد الهمزات', () => {
  assert.equal(stripTashkeel('سُبْحَانَ اللَّهِ'), 'سبحان الله');
  assert.equal(normalize('أَسْتَغْفِرُ اللَّهَ'), normalize('استغفر الله'));
  assert.equal(normalize('رحمة'), normalize('رحمه'));
  assert.equal(normalize('إِلَٰهَ'), 'اله');
});
