'use strict';
// (c) Path refinement — wsRefinePos / wsShouldRefine (index.html).
//
// wsRefinePos resamples a driven rear-axle path, low-passes it, repairs curvature the
// low-pass tightened past the vehicle's minimum radius, then RE-INTEGRATES it through
// the bicycle model under curvature and steer-rate limits. Its contract:
//   • the result is always physically drivable — never a cosmetic spline
//   • the smoothed path covers the raw path's full length and arrives at its endpoint
//   • gear segments chain, so the path stays continuous through a cusp
//   • reverse flags survive intact
//
// TWO CORPORA, because the two have different contracts:
//
//   DRIVEN  — hand-driven paths (helpers.drivenPath), integrated through the same
//             bicycle model wsSweptDriveMove uses, with cursor noise in the steering
//             command. This is what refinement is FOR, so it carries the full
//             contract: length, endpoint, continuity, curvature, gears.
//
//   PLANNED — Reeds-Shepp auto-paths at exactly full lock. These are NOT refined in
//             production (see wsShouldRefine): Reeds-Shepp assumes instantaneous
//             steering, which a 6.0 s lock-to-lock truck physically cannot reproduce —
//             8.33 m of travel to go lock-to-lock against arcs only a few metres long.
//             They are kept here to prove the safety invariants hold even when
//             wsRefinePos is handed a reference it cannot perfectly track: bounded
//             curvature, preserved gears, and guaranteed termination.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine } = require('./extract.js');
const { rng, posLength, posFromPts, drivenPath, gearRuns, checkboxEl, mppElements, pct } = require('./helpers.js');

const VEH = { id: 'test_ref', name: 'Reference rear loader', wb: 5.1, tw: 2.5, bw: 2.5, fo: 1.28, ro: 2.0, minR: 8.7 };
const MPP = 0.05;
const STEP = 4;               // wsRefinePos's fixed integration step, in canvas px
const REFINE_GUARD = 20000;   // the runaway backstop the old follower used to hit

function engine(lockLimited = true) {
  return loadEngine({ elements: { ...mppElements(), 'ws-swept-lock': checkboxEl(lockLimited) } });
}

const ws = engine(true);
const WB_PX = VEH.wb / MPP;
const R_MIN_PX = ws.wsRearAxleRadius(VEH) / MPP;
const KAPPA_MAX = Math.tan(ws.wsDeltaMax(VEH)) / WB_PX;

// Only keep paths whose every gear run is long enough to actually be refined; runs
// shorter than 8 poses are passed through by design, so they would test the input.
const usable = pos => !gearRuns(pos).some(g => g.n < 12) && posLength(pos) >= 80;

function drivenCorpus(n, seed) {
  const rnd = rng(seed), out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 15) {
    const pos = drivenPath(ws, VEH, MPP, rnd);
    if (usable(pos)) out.push(pos);
  }
  return out;
}

function plannedCorpus(n, seed) {
  const rnd = rng(seed), out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 15) {
    const ang = rnd() * Math.PI * 2, reach = R_MIN_PX * (0.6 + rnd() * 4);
    const r = ws.wsRsPlan(500, 500, (rnd() * 2 - 1) * Math.PI,
                          500 + Math.cos(ang) * reach, 500 + Math.sin(ang) * reach,
                          (rnd() * 2 - 1) * Math.PI, R_MIN_PX, STEP);
    if (!r) continue;
    const pos = posFromPts(r.pts, WB_PX);
    if (usable(pos)) out.push(pos);
  }
  return out;
}

const DRIVEN = drivenCorpus(400, 0x0DA1);
const PLANNED = plannedCorpus(400, 0xA11CE);
const ALL = [...DRIVEN, ...PLANNED];

test('both corpora are non-degenerate and contain cusps', () => {
  assert.equal(DRIVEN.length, 400, `only built ${DRIVEN.length} driven paths`);
  assert.equal(PLANNED.length, 400, `only built ${PLANNED.length} planned paths`);
  assert.ok(DRIVEN.filter(p => gearRuns(p).length > 1).length > 50, 'too few multi-gear driven paths');
  assert.ok(PLANNED.some(p => gearRuns(p).length > 1), 'no multi-gear planned paths');
  // the driven corpus must actually be jittery, or refinement has nothing to remove
  const wobble = DRIVEN.map(pos => {
    let sum = 0, n = 0;
    for (let i = 2; i < pos.length; i++) {
      if (pos[i].rev !== pos[i - 1].rev || pos[i - 1].rev !== pos[i - 2].rev) continue;
      sum += Math.abs(ws.wsNormA(ws.wsNormA(pos[i].hdg - pos[i - 1].hdg) - ws.wsNormA(pos[i - 1].hdg - pos[i - 2].hdg)));
      n++;
    }
    return n ? sum / n : 0;
  });
  assert.ok(pct(wobble, 0.5) > 1e-4, `driven corpus is too smooth to be a jitter test (median wobble ${pct(wobble, 0.5)})`);
});

// ── policy: planner output is never refined ─────────────────────────────
test('wsShouldRefine: planner-generated paths bypass refinement, driven paths do not', () => {
  assert.equal(ws.wsShouldRefine({ label: 'AUTO' }), false, 'Reeds-Shepp auto-paths must not be refined');
  assert.equal(ws.wsShouldRefine({ label: 'CAL' }), false, 'calibration circles must not be refined');
  assert.equal(ws.wsShouldRefine({}), true, 'hand-driven paths must be refined');
  assert.equal(ws.wsShouldRefine({ label: undefined }), true);
  assert.equal(ws.wsShouldRefine(null), false);
});

test('wsSweptFinalize routes the skip through wsShouldRefine', () => {
  const { SOURCE } = require('./extract.js');
  assert.match(SOURCE, /const usePos = \(smoothOn && wsShouldRefine\(path\)\) \? wsRefinePos\(/,
    'wsSweptFinalize no longer gates refinement on wsShouldRefine');
});

// ── 1. curvature (both corpora) ─────────────────────────────────────────
function worstCurvature(engineRef, corpus) {
  let worst = 0, worstAt = null;
  for (const [i, pos] of corpus.entries()) {
    const out = engineRef.wsRefinePos(pos, VEH, MPP);
    for (let j = 1; j < out.length; j++) {
      if (out[j].rev !== out[j - 1].rev) continue;   // gear change: not a steering event
      const d = Math.hypot(out[j].rx - out[j - 1].rx, out[j].ry - out[j - 1].ry);
      if (d < 1e-9) continue;
      const k = Math.abs(engineRef.wsNormA(out[j].hdg - out[j - 1].hdg)) / d;
      if (k / KAPPA_MAX > worst) { worst = k / KAPPA_MAX; worstAt = { path: i, index: j }; }
    }
  }
  return { worst, worstAt };
}

test('smoothed paths never exceed the vehicle curvature limit', () => {
  const { worst, worstAt } = worstCurvature(ws, ALL);
  assert.ok(worst <= 1 + 1e-6,
    `curvature reached ${worst.toFixed(6)}× the limit (κmax=${KAPPA_MAX.toExponential(4)} 1/px) at ${JSON.stringify(worstAt)}`);
});

test('curvature limit holds with steer-rate limiting disabled', () => {
  const free = engine(false);
  const { worst } = worstCurvature(free, [...DRIVEN.slice(0, 120), ...PLANNED.slice(0, 120)]);
  assert.ok(worst <= 1 + 1e-6, `unlimited-steer-rate curvature reached ${worst.toFixed(6)}× the limit`);
});

test('the smoothed reference is never tightened past the minimum turning radius', () => {
  // Guards the curvature-repair pass directly: a Laplacian pass scales an arc by
  // cos²(Δθ/2), so without repair the low-pass hands the follower a reference the
  // truck cannot hold. If repair regresses, the follower saturates and drifts.
  let saturated = 0, total = 0;
  for (const pos of DRIVEN) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    for (let j = 1; j < out.length; j++) {
      if (out[j].rev !== out[j - 1].rev) continue;
      const d = Math.hypot(out[j].rx - out[j - 1].rx, out[j].ry - out[j - 1].ry);
      if (d < 1e-9) continue;
      total++;
      if (Math.abs(ws.wsNormA(out[j].hdg - out[j - 1].hdg)) / d > KAPPA_MAX * 0.999) saturated++;
    }
  }
  assert.ok(saturated / total < 0.25,
    `${(100 * saturated / total).toFixed(1)}% of driven steps sit at full lock — the reference is being over-tightened`);
});

test('steer-rate limiting changes the result (the lock checkbox is actually read)', () => {
  const limited = ws.wsRefinePos(DRIVEN[0], VEH, MPP);
  const free = engine(false).wsRefinePos(DRIVEN[0], VEH, MPP);
  const differs = limited.length !== free.length ||
    limited.some((p, i) => Math.abs(p.rx - free[i].rx) > 1e-9 || Math.abs(p.ry - free[i].ry) > 1e-9);
  assert.ok(differs, 'ws-swept-lock made no difference — steer-rate limit is not being applied');
});

// ── 2. rear-axle / front-axle consistency ───────────────────────────────
test('front axle stays exactly one wheelbase ahead of the rear axle', () => {
  for (const pos of [...DRIVEN.slice(0, 100), ...PLANNED.slice(0, 100)]) {
    for (const p of ws.wsRefinePos(pos, VEH, MPP)) {
      assert.ok(Math.abs(Math.hypot(p.fx - p.rx, p.fy - p.ry) - WB_PX) < 1e-6, 'wheelbase drift');
      assert.ok(Math.abs(ws.wsNormA(Math.atan2(p.fy - p.ry, p.fx - p.rx) - p.hdg)) < 1e-9, 'axle/heading mismatch');
      assert.ok(Number.isFinite(p.rx) && Number.isFinite(p.ry) && Number.isFinite(p.hdg), 'non-finite pose');
    }
  }
});

// ── 3. reverse flags (both corpora) ─────────────────────────────────────
test('reverse flags and gear order survive refinement', () => {
  const bad = [];
  for (const [i, pos] of ALL.entries()) {
    const before = gearRuns(pos).map(g => g.rev);
    const after = gearRuns(ws.wsRefinePos(pos, VEH, MPP)).map(g => g.rev);
    if (JSON.stringify(before) !== JSON.stringify(after)) bad.push({ path: i, before, after });
  }
  assert.equal(bad.length, 0, `${bad.length} paths changed gear sequence; first: ${JSON.stringify(bad[0])}`);
});

test('every output pose carries an explicit boolean rev flag', () => {
  for (const pos of [...DRIVEN.slice(0, 100), ...PLANNED.slice(0, 100)])
    for (const p of ws.wsRefinePos(pos, VEH, MPP))
      assert.equal(typeof p.rev, 'boolean', 'rev flag missing or non-boolean');
});

// ── 4. termination (both corpora) ───────────────────────────────────────
test('refinement terminates on its own, never on the iteration backstop', () => {
  const runaway = [];
  for (const [i, pos] of ALL.entries()) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    for (const seg of ws.wsGearSegments(out)) {
      if (seg.pos.length >= REFINE_GUARD) {
        runaway.push({ path: i, inputPts: pos.length, outputPts: out.length,
                       inputLen: +posLength(pos).toFixed(1), outputLen: +posLength(out).toFixed(1) });
        break;
      }
    }
  }
  assert.equal(runaway.length, 0,
    `${runaway.length}/${ALL.length} paths hit the ${REFINE_GUARD}-iteration guard ` +
    `(the follower orbits instead of arriving); first: ${JSON.stringify(runaway[0])}`);
});

test('output size stays bounded even for a reference the truck cannot track', () => {
  // PLANNED is deliberately untrackable (instant-steering reference). Refinement must
  // still degrade gracefully rather than emitting kilometres of orbiting path.
  for (const [i, pos] of PLANNED.entries()) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    assert.ok(out.length <= pos.length * 4 + 400,
      `path ${i}: ${pos.length} input poses produced ${out.length} output poses`);
  }
});

// ── 5. full length (driven contract) ────────────────────────────────────
test('smoothed paths complete the full length of the raw path', () => {
  const short = [], long = [], ratios = [];
  for (const [i, pos] of DRIVEN.entries()) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    const lin = posLength(pos), lout = posLength(out), ratio = lout / lin;
    ratios.push(ratio);
    if (ratio < 0.9) short.push({ path: i, ratio: +ratio.toFixed(3), rawLen: +lin.toFixed(1), smoothedLen: +lout.toFixed(1) });
    if (ratio > 1.5) long.push({ path: i, ratio: +ratio.toFixed(3), rawLen: +lin.toFixed(1), smoothedLen: +lout.toFixed(1) });
  }
  const summary = `median ${pct(ratios, 0.5).toFixed(3)}× · p05 ${pct(ratios, 0.05).toFixed(3)}× · p95 ${pct(ratios, 0.95).toFixed(3)}×`;
  assert.equal(short.length, 0,
    `${short.length}/${DRIVEN.length} smoothed paths stop more than 10% short (${summary}); worst: ${JSON.stringify(short.sort((a, b) => a.ratio - b.ratio)[0])}`);
  assert.equal(long.length, 0,
    `${long.length}/${DRIVEN.length} smoothed paths overrun by more than 50% (${summary}); worst: ${JSON.stringify(long.sort((a, b) => b.ratio - a.ratio)[0])}`);
});

test('smoothed paths arrive at the raw path endpoint (endpoints are pinned)', () => {
  const bad = [], gaps = [];
  for (const [i, pos] of DRIVEN.entries()) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    const a = out[out.length - 1], b = pos[pos.length - 1];
    const gap = Math.hypot(a.rx - b.rx, a.ry - b.ry);
    gaps.push(gap);
    const tol = Math.max(3 * STEP, 0.05 * posLength(pos));   // 12 px, or 5% of the path
    if (gap > tol) bad.push({ path: i, gapPx: +gap.toFixed(1), gapM: +(gap * MPP).toFixed(2), tolPx: +tol.toFixed(1) });
  }
  assert.equal(bad.length, 0,
    `${bad.length}/${DRIVEN.length} smoothed paths miss the raw endpoint ` +
    `(gap median ${(pct(gaps, 0.5) * MPP).toFixed(2)} m · p95 ${(pct(gaps, 0.95) * MPP).toFixed(2)} m · max ${(pct(gaps, 1) * MPP).toFixed(2)} m); ` +
    `worst: ${JSON.stringify(bad.sort((a, b) => b.gapPx - a.gapPx)[0])}`);
});

test('the path is continuous — no teleport between gear segments', () => {
  const bad = [], jumps = [];
  for (const [i, pos] of DRIVEN.entries()) {
    const out = ws.wsRefinePos(pos, VEH, MPP);
    for (let j = 1; j < out.length; j++) {
      if (out[j].rev === out[j - 1].rev) continue;
      const jump = Math.hypot(out[j].rx - out[j - 1].rx, out[j].ry - out[j - 1].ry);
      jumps.push(jump);
      if (jump > 2 * STEP) bad.push({ path: i, jumpPx: +jump.toFixed(1), jumpM: +(jump * MPP).toFixed(2) });
    }
  }
  assert.ok(jumps.length > 50, `only ${jumps.length} gear changes in the corpus — continuity is not being exercised`);
  assert.equal(bad.length, 0,
    `${bad.length}/${jumps.length} gear changes jump more than ${2 * STEP} px ` +
    `(median ${(pct(jumps, 0.5) * MPP).toFixed(2)} m · max ${(pct(jumps, 1) * MPP).toFixed(2)} m); ` +
    `worst: ${JSON.stringify(bad.sort((a, b) => b.jumpPx - a.jumpPx)[0])}`);
});

test('refinement actually removes jitter', () => {
  // The point of the exercise: mean absolute change in per-step turn rate should drop.
  const wobbleOf = pos => {
    let sum = 0, n = 0;
    for (let i = 2; i < pos.length; i++) {
      if (pos[i].rev !== pos[i - 1].rev || pos[i - 1].rev !== pos[i - 2].rev) continue;
      sum += Math.abs(ws.wsNormA(ws.wsNormA(pos[i].hdg - pos[i - 1].hdg) - ws.wsNormA(pos[i - 1].hdg - pos[i - 2].hdg)));
      n++;
    }
    return n ? sum / n : 0;
  };
  const improved = DRIVEN.filter(pos => wobbleOf(ws.wsRefinePos(pos, VEH, MPP)) < wobbleOf(pos)).length;
  assert.ok(improved >= DRIVEN.length * 0.95,
    `refinement reduced steering chatter on only ${improved}/${DRIVEN.length} driven paths`);
});

// ── 6. passthrough / edge cases ─────────────────────────────────────────
test('paths too short to refine are returned untouched', () => {
  for (const n of [0, 1, 3, 7]) {
    const pos = DRIVEN[0].slice(0, n);
    assert.equal(ws.wsRefinePos(pos, VEH, MPP), pos, `${n}-point path was not passed through by identity`);
  }
  assert.equal(ws.wsRefinePos(null, VEH, MPP), null);
  assert.equal(ws.wsRefinePos(undefined, VEH, MPP), undefined);
});

test('refinement is deterministic', () => {
  for (const pos of [DRIVEN[3], PLANNED[3]]) {
    const a = ws.wsRefinePos(pos, VEH, MPP);
    const b = ws.wsRefinePos(pos, VEH, MPP);
    assert.equal(a.length, b.length);
    a.forEach((p, i) => assert.ok(Math.abs(p.rx - b[i].rx) < 1e-12 && Math.abs(p.ry - b[i].ry) < 1e-12));
  }
});

test('refinement does not mutate its input', () => {
  const pos = DRIVEN[5];
  const snapshot = JSON.stringify(pos);
  ws.wsRefinePos(pos, VEH, MPP);
  assert.equal(JSON.stringify(pos), snapshot, 'wsRefinePos mutated the raw path it was given');
});

test('a single-gear forward path keeps every pose in forward gear', () => {
  const fwd = DRIVEN.find(p => gearRuns(p).length === 1 && !p[0].rev);
  assert.ok(fwd, 'no single-gear forward path in corpus');
  assert.ok(ws.wsRefinePos(fwd, VEH, MPP).every(p => p.rev === false), 'forward path picked up a reverse pose');
});
