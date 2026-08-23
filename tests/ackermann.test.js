'use strict';
// (b) Ackermann calibration — wsRearAxleRadius / wsDeltaMax / wsCalibrationNumbers.
//
// Reference vehicle: wb 5.1, track 2.5, body 2.5, front overhang 1.28, kerb-to-kerb
// radius 8.7 m (a 14 m³ rear-loader class chassis). Per Austroads AP-G34-23 §3.5 the
// closed-form model must reproduce the published turning circle exactly:
//   kerb  ⌀ 17.40 m   (outer front WHEEL — what spec sheets quote)
//   wall  ⌀ 19.01 m   (outer front BODY corner)
//   inner ⌀  9.10 m   (inner rear wheel)
// The kerb figure is an identity: minR is the input, so kerb ⌀ MUST equal 2×minR.
// Any drift there is a model regression, not a rounding artefact.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./extract.js');
const { mppElements, checkboxEl } = require('./helpers.js');

const ws = loadEngine({ elements: mppElements() });

const VEH = { id: 'test_ref', name: 'Reference rear loader', wb: 5.1, tw: 2.5, bw: 2.5, fo: 1.28, ro: 2.0, minR: 8.7 };

const round2 = n => Number(n.toFixed(2));

test('wsCalibrationNumbers: reference vehicle yields kerb 17.40 / wall 19.01 / inner 9.10', () => {
  const cal = ws.wsCalibrationNumbers(VEH);
  assert.equal(round2(cal.kerbDia), 17.40, `kerb ⌀ was ${cal.kerbDia}`);
  assert.equal(round2(cal.wallDia), 19.01, `wall ⌀ was ${cal.wallDia}`);
  assert.equal(round2(cal.innerDia), 9.10, `inner ⌀ was ${cal.innerDia}`);
});

test('wsCalibrationNumbers: kerb diameter is exactly 2×minR (identity, not approximation)', () => {
  const cal = ws.wsCalibrationNumbers(VEH);
  assert.ok(Math.abs(cal.kerbDia - 2 * VEH.minR) < 1e-9,
    `kerb identity drift: ${cal.kerbDia} vs ${2 * VEH.minR}`);
});

test('wsRearAxleRadius: reference vehicle rear-axle radius matches the closed form', () => {
  // Rr = sqrt(minR² − wb²) − tw/2
  const expected = Math.sqrt(VEH.minR ** 2 - VEH.wb ** 2) - VEH.tw / 2;
  const got = ws.wsRearAxleRadius(VEH);
  assert.ok(Math.abs(got - expected) < 1e-12, `Rr ${got} vs ${expected}`);
  assert.ok(Math.abs(got - 5.798404) < 1e-5, `Rr ${got} drifted from 5.798404 m`);
});

test('wsDeltaMax: max steer follows the bicycle model and stays inside the 45° cap', () => {
  const d = ws.wsDeltaMax(VEH);
  const expected = Math.atan(VEH.wb / ws.wsRearAxleRadius(VEH));
  assert.ok(Math.abs(d - expected) < 1e-12, `deltaMax ${d} vs ${expected}`);
  assert.ok(d <= 45 * Math.PI / 180 + 1e-12, 'deltaMax exceeded the 45° mechanical cap');
  // ≈41.3° for this chassis — the pre-fix model understeered it to ~26°.
  assert.ok(Math.abs(d * 180 / Math.PI - 41.34) < 0.05, `deltaMax ${(d * 180 / Math.PI).toFixed(2)}° drifted`);
});

test('wall-to-wall radius (rww) takes precedence over the kerb radius when present', () => {
  const withRww = { ...VEH, rww: 9.45 };
  const expected = Math.sqrt(withRww.rww ** 2 - (withRww.wb + withRww.fo) ** 2) - withRww.bw / 2;
  assert.ok(Math.abs(ws.wsRearAxleRadius(withRww) - expected) < 1e-12,
    'rww branch not taken — kerb radius used instead');
  const cal = ws.wsCalibrationNumbers(withRww);
  assert.ok(Math.abs(cal.wallDia - 2 * withRww.rww) < 1e-9,
    `wall identity drift with rww supplied: ${cal.wallDia} vs ${2 * withRww.rww}`);
});

test('the drawn full-lock circle measures back to the closed-form diameters', () => {
  // Reproduces wsCalibrationCircle()'s self-test: sweep a 360° arc at Rr, build the
  // wheel/body tracks with wsTracksFromPos, and measure the drawn circles.
  const mpp = 0.05;
  const cal = ws.wsCalibrationNumbers(VEH);
  const cx = 1000, cy = 1000;
  const WB = VEH.wb / mpp, Rr = cal.Rr / mpp;
  const pos = [];
  for (let a = 0; a <= Math.PI * 2.08; a += 0.005) {
    const rx = cx + Rr * Math.cos(a), ry = cy + Rr * Math.sin(a);
    const hdg = ws.wsNormA(a + Math.PI / 2);
    pos.push({ rx, ry, fx: rx + WB * Math.cos(hdg), fy: ry + WB * Math.sin(hdg), hdg, rev: false });
  }
  const tk = ws.wsTracksFromPos(pos, VEH, mpp);
  const diaOf = t => 2 * mpp * t.reduce((m, p) => Math.max(m, Math.hypot(p.x - cx, p.y - cy)), 0);
  const innerOf = t => 2 * mpp * t.reduce((m, p) => Math.min(m, Math.hypot(p.x - cx, p.y - cy)), Infinity);

  const drawnKerb = Math.max(diaOf(tk.tkFWR), diaOf(tk.tkFWL));
  const drawnWall = Math.max(diaOf(tk.tkFR), diaOf(tk.tkFL));
  const drawnInner = Math.min(innerOf(tk.tkRWI), innerOf(tk.tkRWO));

  assert.ok(Math.abs(drawnKerb - cal.kerbDia) < 0.05, `drawn kerb ⌀ ${drawnKerb.toFixed(3)} vs model ${cal.kerbDia.toFixed(3)}`);
  assert.ok(Math.abs(drawnWall - cal.wallDia) < 0.05, `drawn wall ⌀ ${drawnWall.toFixed(3)} vs model ${cal.wallDia.toFixed(3)}`);
  assert.ok(Math.abs(drawnInner - cal.innerDia) < 0.05, `drawn inner ⌀ ${drawnInner.toFixed(3)} vs model ${cal.innerDia.toFixed(3)}`);
  assert.ok(Math.abs(drawnKerb - 2 * VEH.minR) < 0.05, 'drawn kerb ⌀ does not match the published turning circle');
});

test('every built-in preset produces a physically sane calibration', () => {
  for (const v of ws.WS_VEH) {
    const cal = ws.wsCalibrationNumbers(v);
    const d = ws.wsDeltaMax(v);
    assert.ok(cal.Rr > 0.5 - 1e-9, `${v.id}: rear-axle radius collapsed (${cal.Rr})`);
    assert.ok(Number.isFinite(cal.kerbDia) && cal.kerbDia > 0, `${v.id}: bad kerb ⌀`);
    assert.ok(cal.wallDia > cal.kerbDia, `${v.id}: wall ⌀ ${cal.wallDia} not outside kerb ⌀ ${cal.kerbDia}`);
    assert.ok(cal.innerDia < cal.kerbDia, `${v.id}: inner ⌀ not inside kerb ⌀`);
    assert.ok(d > 0 && d <= 45 * Math.PI / 180 + 1e-12, `${v.id}: deltaMax ${d} out of range`);
    if (!v.rww && v.minR) {
      assert.ok(Math.abs(cal.kerbDia - 2 * v.minR) < 0.02,
        `${v.id}: kerb identity drift ${cal.kerbDia.toFixed(3)} vs ${(2 * v.minR).toFixed(3)}`);
    }
    if (v.rww) {
      assert.ok(Math.abs(cal.wallDia - 2 * v.rww) < 0.02,
        `${v.id}: wall identity drift ${cal.wallDia.toFixed(3)} vs ${(2 * v.rww).toFixed(3)}`);
    }
  }
});

test('wsSweptMpp and wsLblF derive scale from the workspace selectors', () => {
  // A1 landscape (841 mm wide) at 1:100 rendered onto a 1682 px canvas ⇒ 0.05 m/px.
  const engine = ws;
  assert.ok(Math.abs(engine.wsSweptMpp() - 0.05) < 1e-12, `mpp was ${engine.wsSweptMpp()}`);
  assert.ok(Math.abs(engine.wsLblF() - 0.026 / 0.05) < 1e-12, `label factor was ${engine.wsLblF()}`);

  // No scale selected ⇒ null mpp, and labels fall back to 1.0 rather than NaN.
  const bare = loadEngine();
  assert.equal(bare.wsSweptMpp(), null);
  assert.equal(bare.wsLblF(), 1);

  // Label factor is clamped to [0.5, 3] across the plausible scale range.
  for (const scale of [50, 100, 200, 500, 1000, 2000]) {
    const e = loadEngine({ elements: mppElements({ scale }) });
    const f = e.wsLblF();
    assert.ok(f >= 0.5 && f <= 3, `1:${scale} produced label factor ${f}`);
  }
});

test('WS_LOCK_TO_LOCK_M encodes 6.0 s lock-to-lock at the 5 km/h design speed', () => {
  assert.ok(Math.abs(ws.WS_LOCK_TO_LOCK_M - (5 / 3.6) * 6) < 1e-12);
  assert.ok(Math.abs(ws.WS_LOCK_TO_LOCK_M - 8.3333) < 1e-3, `was ${ws.WS_LOCK_TO_LOCK_M}`);
  void checkboxEl; // steer-rate limiting is exercised in refine-pos.test.js
});
