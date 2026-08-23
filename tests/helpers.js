'use strict';
// Shared test utilities: deterministic RNG, geometry helpers, DOM element stubs.

/** mulberry32 — small, fast, seedable. Deterministic across runs and platforms. */
function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const normA = a => { let r = a % TAU; if (r > Math.PI) r -= TAU; if (r < -Math.PI) r += TAU; return r; };

/** Arc length of a pos[] array along the rear axle. */
const posLength = pos => pos.reduce((s, p, i) => (i ? s + Math.hypot(p.rx - pos[i - 1].rx, p.ry - pos[i - 1].ry) : 0), 0);

/**
 * Integrate Reeds-Shepp segments from a world start pose at turning radius R.
 * Mirrors the planner's internal rsIntegrate, scaled out of the unit frame.
 */
function integrateSegs(segs, sx, sy, sth, R) {
  let x = sx, y = sy, th = sth;
  for (const s of segs) {
    const v = s.v;
    if (s.t === 'S') { x += R * v * Math.cos(th); y += R * v * Math.sin(th); }
    else {
      const k = s.t === 'L' ? 1 : -1;
      x += R * k * (Math.sin(th + k * v) - Math.sin(th));
      y += -R * k * (Math.cos(th + k * v) - Math.cos(th));
      th += k * v;
    }
  }
  return { x, y, th };
}

/** Build a pos[] (the shape wsRefinePos consumes) from planner points. */
function posFromPts(pts, wbPx, jitter = 0, rnd = null) {
  return pts.map(p => {
    const rx = p.x + (jitter && rnd ? (rnd() - 0.5) * jitter : 0);
    const ry = p.y + (jitter && rnd ? (rnd() - 0.5) * jitter : 0);
    return { rx, ry, hdg: p.hdg, fx: rx + wbPx * Math.cos(p.hdg), fy: ry + wbPx * Math.sin(p.hdg), rev: !!p.rev };
  });
}

/**
 * Simulate a HAND-DRIVEN path — the input wsRefinePos is actually for.
 *
 * Reproduces what wsSweptDriveMove stores in path.pos: the rear axle integrated
 * through the bicycle model, steering toward a moving cursor under the same
 * curvature and steer-rate limits, with cursor noise injected into the steering
 * command. The result is kinematically valid but visibly wobbly — jitter shows up
 * as steering chatter within the limits, not as limit violations.
 *
 * @param ws  the loaded engine (for wsNormA / wsDeltaMax / WS_LOCK_TO_LOCK_M)
 * @param v   vehicle
 * @param mpp metres per pixel
 * @param rnd seeded RNG
 */
function drivenPath(ws, v, mpp, rnd, { step = 4, minSteps = 90, spanSteps = 160, noise = 0.5, gearFlipChance = 0.35 } = {}) {
  const WB = v.wb / mpp;
  const deltaMax = ws.wsDeltaMax(v);
  const kMax = Math.tan(deltaMax) / WB;
  const steerRate = (2 * deltaMax) / (ws.WS_LOCK_TO_LOCK_M / mpp);

  let rx = 500, ry = 500, hdg = (rnd() * 2 - 1) * Math.PI, delta = 0, rev = rnd() < 0.25;
  const pos = [];
  let target = null, hold = 0;
  const total = minSteps + Math.floor(rnd() * spanSteps);

  for (let s = 0; s < total; s++) {
    if (hold <= 0) {
      const a = rnd() * Math.PI * 2, d = 120 + rnd() * 260;
      target = { x: rx + Math.cos(a) * d, y: ry + Math.sin(a) * d };
      hold = 25 + Math.floor(rnd() * 60);
      if (s > 0 && rnd() < gearFlipChance) rev = !rev;   // driver shifts gear
    }
    hold--;
    const dir = rev ? -1 : 1;
    const travel = hdg + (dir < 0 ? Math.PI : 0);
    const alpha = ws.wsNormA(Math.atan2(target.y - ry, target.x - rx) - travel);
    let kappa = 2 * Math.sin(alpha) / Math.max(Math.hypot(target.x - rx, target.y - ry), 40);
    kappa += (rnd() - 0.5) * kMax * noise;             // cursor jitter
    let dDes = Math.atan(dir * kappa * WB);
    if (dDes > deltaMax) dDes = deltaMax;
    if (dDes < -deltaMax) dDes = -deltaMax;
    const dd = dDes - delta, mx = steerRate * step;
    delta += Math.abs(dd) > mx ? Math.sign(dd) * mx : dd;
    rx += dir * step * Math.cos(hdg); ry += dir * step * Math.sin(hdg);
    hdg = ws.wsNormA(hdg + (dir * step / WB) * Math.tan(delta));
    pos.push({ rx, ry, hdg, rev, fx: rx + WB * Math.cos(hdg), fy: ry + WB * Math.sin(hdg) });
  }
  return pos;
}

/** The raw run-length-encoded gear sequence, including runs too short for wsGearSegments. */
function gearRuns(pos) {
  const runs = [];
  (pos || []).forEach(p => {
    const rv = !!p.rev;
    if (!runs.length || runs[runs.length - 1].rev !== rv) runs.push({ rev: rv, n: 0 });
    runs[runs.length - 1].n++;
  });
  return runs;
}

// ── DOM element stubs ──
const selectEl = value => ({ value, tagName: 'SELECT' });
const canvasEl = (width, height = 800) => ({ width, height, tagName: 'CANVAS' });
const checkboxEl = checked => ({ checked, type: 'checkbox', tagName: 'INPUT' });

/** Elements that make wsSweptMpp() return a known metres-per-pixel value. */
function mppElements({ scale = 100, paperWmm = 841, canvasWidth = 1682 } = {}) {
  return {
    'ws-scale-sel': selectEl(String(scale)),
    'ws-paper-sel': selectEl(`${paperWmm},594`),
    'ws-pdf-canvas': canvasEl(canvasWidth),
  };
}

const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))]; };

module.exports = { rng, normA, TAU, posLength, integrateSegs, posFromPts, drivenPath, gearRuns, selectEl, canvasEl, checkboxEl, mppElements, pct };
