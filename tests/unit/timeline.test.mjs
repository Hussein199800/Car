// اختبارات منقولة من مختبر watch-power ومكيّفة لطاقتي
import test from 'node:test';
import assert from 'node:assert/strict';
import { revalidate, normalize } from '../../src/model.js';
import { overlap } from '../../src/control.js';
import { timePoints, replayAt, simulateDevice, MAX_GAP_MS } from '../../src/timeline.js';
const now = Date.now();
const m = { ts: now, outW: 1500, ratedW: 5000, mode: 'Battery Mode', batW: -1000, soc: 60, ratedV: 48 };
test('القراءة تُعاد صلاحيتها بعد فشل الاتصال؛ بلا وقت أو متقدمة كثيراً = ليست حيّة', () => {
 const old = { ts: now - 14 * 60000, stale: false };
 assert.equal(revalidate(old, 15, now + 60000).stale, true);
 assert.equal(revalidate({ts:null},15,now).stale,true);
 // متقدمة بدقائق (فرق ساعة الخادم) ما زالت حيّة؛ أكثر من 20 دقيقة ليست حيّة
 assert.equal(revalidate({ts:now+5*60000},15,now).stale,false);
 assert.equal(revalidate({ts:now+25*60000},15,now).stale,true);
 assert.equal(normalize([]).stale,true);
});
test('one-minute overlap, half-open touching boundaries, cross midnight and dated rules', () => {
 const s = (a,b,days=[0,1,2,3,4,5,6]) => ({startMin:a,endMin:b,days});
 assert.ok(overlap([s(601,603),s(602,604)]));
 assert.equal(overlap([s(601,602),s(602,603)]),null);
 assert.ok(overlap([s(1439,2,[6]),s(1,3,[0])]));
 assert.equal(overlap([s(1439,1,[6]),s(1,3,[0])]),null);
 assert.ok(overlap([{...s(1439,2),date:'2026-01-01'},{...s(1,3),date:'2026-01-02'}]));
 assert.equal(overlap([{...s(1,3),date:'2026-01-01'},{...s(1,3),date:'2026-01-02'}]),null);
});
test('real timestamps preserve unequal spacing and nulls break long gaps', () => {
 const pts=timePoints([0,60000,3600000],[1,null,3]);
 assert.deepEqual(pts,[{x:0,y:1},{x:60000,y:null},{x:1830000,y:null},{x:3600000,y:3}]);
});
test('replay uses recorded steps, exact endpoints, no invented gap or extrapolation', () => {
 const s=[{ts:1000,outW:1},{ts:61000,outW:2},{ts:61000+MAX_GAP_MS+1,outW:3}];
 assert.equal(replayAt(s,500),null);assert.equal(replayAt(s,2000),s[0]);
 assert.equal(replayAt(s,62000),null);assert.equal(replayAt(s,s[2].ts),s[2]);
 assert.equal(replayAt(s,s[2].ts+1),null);
});
test('simulation calculates incremental AC energy, inverter headroom and DC impact', () => {
 const r=simulateDevice(m,{watts:900,minutes:120,batteryAh:200},now);
 assert.equal(r.energyWh,1800); assert.equal(r.totalW,2400);assert.equal(r.headroomW,2600);
 assert.equal(r.battery.projectedBatW,-2000); assert.ok(Math.abs(r.battery.projectedSoc-18.333333333)<1e-7);
 assert.equal(r.battery.belowReserve,true);
 const on=simulateDevice(m,{watts:900,minutes:120,batteryAh:200,alreadyOn:true},now);
 assert.equal(on.addedW,0);assert.equal(on.addedWh,0);assert.equal(on.totalW,1500);assert.equal(on.battery.extraSocDrop,0);
});
test('simulation rejects bad input and gates stale, absent and grid battery estimates', () => {
 assert.ok(simulateDevice(m,{watts:-1,minutes:60},now).error);
 assert.ok(simulateDevice({...m,ts:now-16*60000},{watts:100,minutes:60},now).unavailable);
 assert.equal(simulateDevice({...m,mode:'Line Mode'},{watts:100,minutes:60,batteryAh:200},now).battery,null);
 assert.equal(simulateDevice(m,{watts:100,minutes:60},now).battery,null);
 assert.equal(simulateDevice({...m,ratedW:null},{watts:100,minutes:60},now).headroomW,null);
});

test('battery estimates respect physical SOC bounds when duration exceeds capacity', () => {
 const r = simulateDevice(m,{watts:5000,minutes:1440,batteryAh:200},now);
 assert.equal(r.battery.projectedSoc,0);assert.equal(r.battery.outsideCapacity,true);
});
