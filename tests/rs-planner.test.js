'use strict';
// (a) Reeds-Shepp planner property test — wsRsPlan (index.html).
//
// The auto-path tool (wsAutoPathStart → wsAutoPlanPts) asks wsRsPlan for a path
// between two arbitrary poses at the vehicle's MINIMUM rear-axle radius. Two
// properties must hold for every pose pair in the plane:
//   1. a solution always exists (Reeds-Shepp is complete for the car-like model)
//   2. the returned word integrates EXACTLY onto the goal pose
// Property 2 is what stops a formula/transform slip in one of the 8 word
// families from silently drawing a swept path to the wrong place.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./extract.js');
const { rng, normA, integrateSegs } = require('./helpers.js');

const ws = loadEngine();

const SAMPLES = 10000;
const POS_TOL = 1e-6;   // metres/pixels — the planner's own acceptance threshold
const HDG_TOL = 1e-6;   // radians

// Poses are drawn in canvas pixels, the units the app actually plans in.
// Radii span the built-in fleet: a Hino 300 mini through a 12.5m HRV at 0.05 m/px.
function randomCase(rnd) {
  const R = 60 + rnd() * 260;
  const reach = R * (0.05 + rnd() * 6);          // from sub-radius to long-haul
  const ang = rnd() * Math.PI * 2;
  return {
    sx: 500 + (rnd() - 0.5) * 40,
    sy: 500 + (rnd() - 0.5) * 40,
    sth: (rnd() * 2 - 1) * Math.PI,
    gx: 500 + Math.cos(ang) * reach,
    gy: 500 + Math.sin(ang) * reach,
    gth: (rnd() * 2 - 1) * Math.PI,
    R,
    ds: 2 + rnd() * 6,
  };
}

test('wsRsPlan: 10,000 random pose pairs all produce a path that integrates exactly onto the goal', () => {
  const rnd = rng(0xC0FFEE);
  const noSolution = [];
  const posErrors = [];
  const hdgErrors = [];
  let worstPos = 0, worstHdg = 0, worstCase = null;

  for (let i = 0; i < SAMPLES; i++) {
    const c = randomCase(rnd);
    const r = ws.wsRsPlan(c.sx, c.sy, c.sth, c.gx, c.gy, c.gth, c.R, c.ds);

    if (!r) { noSolution.push(c); continue; }

    // (i) the word itself, re-integrated through the kinematic model
    const end = integrateSegs(r.segs, c.sx, c.sy, c.sth, c.R);
    const ePos = Math.hypot(end.x - c.gx, end.y - c.gy);
    const eHdg = Math.abs(normA(end.th - c.gth));

    // (ii) the sampled polyline the UI actually draws
    const last = r.pts[r.pts.length - 1];
    const sPos = Math.hypot(last.x - c.gx, last.y - c.gy);
    const sHdg = Math.abs(normA(last.hdg - c.gth));

    const p = Math.max(ePos, sPos), h = Math.max(eHdg, sHdg);
    posErrors.push(p); hdgErrors.push(h);
    if (p > worstPos) { worstPos = p; worstCase = c; }
    if (h > worstHdg) worstHdg = h;
  }

  assert.equal(noSolution.length, 0,
    `${noSolution.length}/${SAMPLES} pose pairs returned no solution; first: ${JSON.stringify(noSolution[0])}`);
  assert.ok(worstPos <= POS_TOL,
    `worst position error ${worstPos.toExponential(3)} px > ${POS_TOL} — case ${JSON.stringify(worstCase)}`);
  assert.ok(worstHdg <= HDG_TOL,
    `worst heading error ${worstHdg.toExponential(3)} rad > ${HDG_TOL}`);
});

test('wsRsPlan: reported length equals the integrated word length and respects the lower bound', () => {
  const rnd = rng(0x5EED);
  for (let i = 0; i < 2000; i++) {
    const c = randomCase(rnd);
    const r = ws.wsRsPlan(c.sx, c.sy, c.sth, c.gx, c.gy, c.gth, c.R, c.ds);
    assert.ok(r, 'no solution');
    const wordLen = r.segs.reduce((a, s) => a + Math.abs(s.v), 0) * c.R;
    assert.ok(Math.abs(r.length - wordLen) < 1e-9, 'length disagrees with the returned word');
    const straight = Math.hypot(c.gx - c.sx, c.gy - c.sy);
    assert.ok(r.length >= straight - 1e-6,
      `path length ${r.length} shorter than the straight-line distance ${straight}`);
  }
});

test('wsRsPlan: sampled points honour the requested spacing and stay on the word', () => {
  const rnd = rng(0xB1A5);
  for (let i = 0; i < 500; i++) {
    const c = randomCase(rnd);
    const r = ws.wsRsPlan(c.sx, c.sy, c.sth, c.gx, c.gy, c.gth, c.R, c.ds);
    assert.ok(r);
    assert.ok(r.pts.length >= 2, 'degenerate sampling');
    for (let j = 1; j < r.pts.length; j++) {
      const d = Math.hypot(r.pts[j].x - r.pts[j - 1].x, r.pts[j].y - r.pts[j - 1].y);
      assert.ok(d <= c.ds * 1.5 + 1e-9,
        `sample gap ${d.toFixed(3)} exceeds requested ds=${c.ds.toFixed(3)}`);
    }
    // every point carries a gear flag, and the first matches the first segment
    assert.ok(r.pts.every(p => typeof p.rev === 'boolean'), 'missing rev flag on a sample');
    assert.equal(r.pts[0].rev, r.segs[0].v < 0, 'first sample gear disagrees with the first segment');
  }
});

test('wsRsPlan: degenerate and near-degenerate goals are solved, not rejected', () => {
  const cases = [
    ['identical pose',        500, 500, 0,            500, 500, 0],
    ['pure heading reversal', 500, 500, 0,            500, 500, Math.PI],
    ['tiny lateral offset',   500, 500, 0,            500, 500.001, 0],
    ['tiny forward offset',   500, 500, 0,            500.001, 500, 0],
    ['exactly behind',        500, 500, 0,            300, 500, 0],
    ['on the turning circle', 500, 500, 0,            500, 200, Math.PI],
  ];
  for (const [name, sx, sy, sth, gx, gy, gth] of cases) {
    const r = ws.wsRsPlan(sx, sy, sth, gx, gy, gth, 150, 4);
    assert.ok(r, `${name}: returned no solution`);
    const end = integrateSegs(r.segs, sx, sy, sth, 150);
    assert.ok(Math.hypot(end.x - gx, end.y - gy) <= 1e-6, `${name}: position error`);
    assert.ok(Math.abs(normA(end.th - gth)) <= 1e-6, `${name}: heading error`);
  }
});
