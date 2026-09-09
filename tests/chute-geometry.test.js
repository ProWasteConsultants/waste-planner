'use strict';
// Chute-angle geometry — the "Chute Angle" tab of PW_WMP_Master.xlsm, Method 1,
// plus the two working-backwards helpers (Methods 2 and 3) and the per-opening
// geometry the canvas circles and DXF connectors are drawn from.
//
// The reference numbers are the spreadsheet's own default single-room case:
// 3100 floor-to-floor, 300 slab, a 1330 mm bin under the chute →
// drop 1470 mm, r_max 1470 mm at 45° (GW) and 609 mm at 22.5° (recycling).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout } = require('./extract.js');

const ws = loadLayout();
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps || 1e-3), `${a} !== ${b}`);

test('default case: drop = ffh − termination height − slab', () => {
  const levels = ws.wsChuteDefaultLevels(3.1, 0.3);
  const drops = ws.wsChuteLevelDrops(levels, 1.33);
  assert.equal(drops.length, 1);
  near(drops[0].drop, 1.47);
  assert.equal(drops[0].deflecting, true);
});

test('spreadsheet reference: r_max 1470 @45°, 609 @22.5°', () => {
  const levels = ws.wsChuteDefaultLevels(3.1, 0.3);
  near(ws.wsChuteRmaxM(levels, 1.33, 45), 1.47);
  near(ws.wsChuteRmaxM(levels, 1.33, 22.5), 0.609, 5e-4);
  near(ws.wsChuteDropM(levels, 1.33), 1.47);
});

test('acceptance: ffh 3100 → 2800 shrinks the circle — r_max at 45° equals the drop', () => {
  const levels = ws.wsChuteDefaultLevels(2.8, 0.3);
  near(ws.wsChuteRmaxM(levels, 1.33, 45), 1.17);
});

test('multi-level: transitions on consecutive deflecting levels add up', () => {
  // basement 0, two 3.1 m levels above; both lower levels deflect. The slab is
  // subtracted only where the level ABOVE is passed straight through — a
  // deflecting level above owns its own transition, so no slab comes off.
  const levels = [
    { fflM: 0.0, deflecting: true, terminate: true,  slabM: 0.3 },
    { fflM: 3.1, deflecting: true, terminate: false, slabM: 0.3 },
    { fflM: 6.2, deflecting: false, terminate: false, slabM: 0.3 },
  ];
  const drops = ws.wsChuteLevelDrops(levels, 1.33);
  near(drops[0].drop, 3.1 - 1.33);          // level above deflects → no slab off
  near(drops[1].drop, 3.1 - 0.3);           // straight through the slab above
  near(ws.wsChuteRmaxM(levels, 1.33, 45), (3.1 - 1.33) + (3.1 - 0.3));
  // a non-deflecting level contributes no transition even with drop available
  levels[1].deflecting = false;
  near(ws.wsChuteRmaxM(levels, 1.33, 45), 3.1 - 1.33 - 0.3);
});

test('helpers: Method 2 (min vertical for a transition) and Method 3 (implied angle)', () => {
  near(ws.wsChuteMinVerticalM(1.0, 45), 1.0);
  near(ws.wsChuteMinVerticalM(0.609, 22.5), 1.47, 2e-3);
  near(ws.wsChuteAngleDeg(1.0, 1.0), 45);
  near(ws.wsChuteAngleDeg(0.609, 1.47), 22.5, 0.05);
  assert.ok(ws.wsChuteAngleDeg(2.0, 1.0) > 45, 'a wide shown transition reads over the max');
});

test('wsChuteOpeningGeom: streams pick their own max; recycling override keeps the preferred circle', () => {
  const ch = { calcRoom: null, geom: { ffh_mm: 3100, slab_mm: 300, rec_deg: 45 } };
  const gw = ws.wsChuteOpeningGeom(ch, { stream: 'GW', recv: 'BIN_1100' });
  near(gw.rmaxM, 1.47);
  assert.equal(gw.rprefM, null, 'garbage has one circle — 45° is both max and preferred');
  const rec = ws.wsChuteOpeningGeom(ch, { stream: 'REC', recv: 'BIN_1100' });
  near(rec.rmaxM, 1.47, 2e-3);              // override raised to the worst case
  near(rec.rprefM, 0.609, 5e-4);            // preferred 22.5° stays as the dashed reminder
  assert.equal(rec.maxDeg, 45);
  assert.equal(rec.prefDeg, 22.5);
  // no override → recycling gets a single 22.5° circle
  const rec2 = ws.wsChuteOpeningGeom({ geom: { ffh_mm: 3100, slab_mm: 300 } }, { stream: 'REC', recv: 'BIN_1100' });
  near(rec2.rmaxM, 0.609, 5e-4);
  assert.equal(rec2.rprefM, null);
});

test('wsChuteOpeningGeom: termination height comes from the receiver', () => {
  const ch = { geom: { ffh_mm: 3100, slab_mm: 300 } };
  // library-backed receiver height wins
  near(ws.wsChuteOpeningGeom(ch, { stream: 'GW', recv: 'LIB_x', hM: 2.0 }).rmaxM, 0.8);
  // built-in spec height next
  near(ws.wsChuteOpeningGeom(ch, { stream: 'GW', recv: 'BIN_660' }).rmaxM, 3.1 - 1.19 - 0.3);
  // an unsized compactor gets the conservative 1.5 m estimate
  near(ws.wsChuteOpeningGeom(ch, { stream: 'GW', recv: 'COMPACTOR' }).rmaxM, 3.1 - 1.5 - 0.3);
});

test('wsRecvDims: a library receiver draws from the record, built-ins stay the fallback', () => {
  const lib = ws.wsRecvDims('LIB_chute_comp_1100', null, { wM: 2.4, dM: 1.8, hM: 2.1, lbl: 'Compactor + 1100L bin' });
  assert.equal(lib.known, true);
  near(lib.w, 2.4); near(lib.d, 1.8);
  assert.equal(lib.spec.label, 'Compactor + 1100L bin');
  const builtin = ws.wsRecvDims('BIN_1100', null);
  near(builtin.w, 1.37); near(builtin.d, 1.07);
  assert.equal(builtin.spec.h, 1.33, 'built-in receivers carry termination heights');
});
