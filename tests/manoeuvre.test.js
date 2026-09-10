'use strict';
// Manoeuvrability engine — can a bin actually be WHEELED where it needs to go?
//
// The engine walks a footprint along waypoints (pivot-on-spot for small MGBs,
// filleted wide turns for big bins) and checks every pose against door-trimmed
// walls and the placed items, on the same wsFp* SAT geometry the generator
// already uses. These tests pin the kinematics to closed-form cases, the
// doorway exception, the operator zone, the accessibility peeling, and the
// friendly-surface/engineering-underneath wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, loadEngine } = require('./extract.js');

const BLOCKS = [
  ['wsOBBCorners',        /^function wsOBBCorners\(/],
  ['wsFpRect',            /^function wsFpRect\(/],
  ['wsFpCircle',          /^function wsFpCircle\(/],
  ['wsFpCornersOf',       /^function wsFpCornersOf\(/],
  ['wsSATOverlap',        /^function wsSATOverlap\(/],
  ['wsCircleRectOverlap', /^function wsCircleRectOverlap\(/],
  ['wsFpOverlap',         /^function wsFpOverlap\(/],
  ['wsSegPointDist',      /^function wsSegPointDist\(/],
  ['wsFpDist',            /^function wsFpDist\(/],
  ['WS_MAN_DEFAULTS',     /^const WS_MAN_DEFAULTS = /],
  ['wsManBehaviour',      /^function wsManBehaviour\(/],
  ['wsManFpAt',           /^function wsManFpAt\(/],
  ['wsManOperatorFp',     /^function wsManOperatorFp\(/],
  ['wsManPoses',          /^function wsManPoses\(/],
  ['wsManWalls',          /^function wsManWalls\(/],
  ['wsManWallHit',        /^function wsManWallHit\(/],
  ['wsManWallClr',        /^function wsManWallClr\(/],
  ['wsManPoseCheck',      /^function wsManPoseCheck\(/],
  ['wsManRun',            /^function wsManRun\(/],
  ['wsManSpin',           /^function wsManSpin\(/],
  ['wsManAccess',         /^function wsManAccess\(/],
  ['wsManConflict',       /^function wsManConflict\(/],
];
const ws = loadEngine({ blocks: BLOCKS });

// Everything below works in px with mpp = 1 (units are whatever you say they
// are — the engine only converts through opts.mpp for the wide-turn radius
// and the operator buffer).

// ── behaviour tiers ──────────────────────────────────────────────────────
test('behaviour: small MGBs pivot, big bins turn wide, library overrides win and clear the assumed flag', () => {
  assert.deepEqual(ws.wsManBehaviour({ kind: 'bin', type: 'b240' }, null), { turn: 'pivot', rM: 0, assumed: true });
  const big = ws.wsManBehaviour({ kind: 'bin', type: 'b1100' }, null);
  assert.equal(big.turn, 'wide');
  assert.equal(big.rM, ws.WS_MAN_DEFAULTS.wideRM);
  const lib = ws.wsManBehaviour({ kind: 'equip', w: 1.8, d: 1.2 }, { turn_type: 'wide', turn_radius_mm: 1800 });
  assert.deepEqual(lib, { turn: 'wide', rM: 1.8, assumed: false });
  assert.equal(ws.wsManBehaviour({ kind: 'equip', w: 0.6, d: 0.7 }, null).turn, 'pivot');
  assert.equal(ws.wsManBehaviour({ kind: 'equip', w: 2.2, d: 1.4 }, null).turn, 'wide');
});

// ── pose footprint orientation ───────────────────────────────────────────
test('footprint at a pose: the item travels along its depth axis', () => {
  const fp = ws.wsManFpAt(0, 0, 0, 10, 20);   // heading east, half-width 10, half-depth 20
  const cs = ws.wsFpCornersOf(fp);
  const xs = cs.map(c => c.x), ys = cs.map(c => c.y);
  assert.ok(Math.abs(Math.max(...xs) - 20) < 1e-6, 'depth spans the direction of travel');
  assert.ok(Math.abs(Math.max(...ys) - 10) < 1e-6, 'width spans across it');
  const op = ws.wsManOperatorFp(0, 0, 0, 10, 20, 30);
  assert.ok(op.x < -20, 'the operator zone trails behind the item');
});

// ── kinematics ───────────────────────────────────────────────────────────
test('pivot: legs translate at leg heading; the corner is a rotation in place', () => {
  const { poses, clamped } = ws.wsManPoses([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    { turn: 'pivot', rM: 0 }, { stepPx: 10 });
  assert.equal(clamped.length, 0);
  assert.ok(Math.abs(poses[0].hdg) < 1e-9);
  assert.ok(Math.abs(poses[poses.length - 1].hdg - Math.PI / 2) < 1e-9);
  const corner = poses.filter(p => Math.abs(p.x - 100) < 1e-6 && Math.abs(p.y) < 1e-6);
  assert.ok(corner.length >= 3, 'several poses sit ON the corner while the bin swings');
  const sweep = corner.map(p => p.hdg);
  assert.ok(sweep.some(h => h > 0.3 && h < 1.2), 'intermediate headings are checked, not just before/after');
});

test('wide: the corner is a tangent fillet arc of the turning radius, clamped when the legs are too short', () => {
  const R = 30;
  const { poses, clamped } = ws.wsManPoses([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }],
    { turn: 'wide', rM: R }, { stepPx: 4, rPx: R });
  assert.equal(clamped.length, 0);
  assert.ok(!poses.some(p => Math.hypot(p.x - 100, p.y) < 2), 'the fillet cuts the corner — nothing drives through the vertex');
  const C = { x: 70, y: 30 };                        // tangent points (70,0) and (100,30)
  const arc = poses.filter(p => p.hdg > 0.05 && p.hdg < Math.PI / 2 - 0.05);
  assert.ok(arc.length >= 4);
  arc.forEach(p => assert.ok(Math.abs(Math.hypot(p.x - C.x, p.y - C.y) - R) < 0.5,
    'arc poses sit on the turning circle'));
  const tail = poses[poses.length - 1];
  assert.ok(Math.abs(tail.x - 100) < 1e-6 && Math.abs(tail.hdg - Math.PI / 2) < 1e-9);
  // legs shorter than the fillet demands → clamp, and say so
  const tight = ws.wsManPoses([{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }],
    { turn: 'wide', rM: 200 }, { stepPx: 4, rPx: 200 });
  assert.equal(tight.clamped.length, 1);
  assert.ok(tight.clamped[0].rPx < 200, 'the effective radius is reported, not silently kept');
});

// ── walls and doorways ───────────────────────────────────────────────────
const ROOM = { pts: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 400 }, { x: 0, y: 400 }] };
test('walls: door openings are cut out of the wall, so a doorway is passable and the jamb still counts', () => {
  const walls = ws.wsManWalls([ROOM], [{ x: 200, y: 0, wPx: 80 }], 1);
  assert.equal(walls.length, 5, 'four edges, the top one split around the door');
  const topAtDoor = walls.some(w => w.a.y === 0 && w.b.y === 0 &&
    Math.min(w.a.x, w.b.x) < 200 && Math.max(w.a.x, w.b.x) > 200);
  assert.ok(!topAtDoor, 'no wall segment spans the opening');
  // a bin passing through the opening touches nothing…
  const inDoor = ws.wsFpRect(200, 0, 30, 30, 0);
  assert.equal(ws.wsManWallHit(inDoor, walls), 0);
  // …a bin wider than the opening hits the jambs
  const tooWide = ws.wsFpRect(200, 0, 60, 30, 0);
  assert.ok(ws.wsManWallHit(tooWide, walls) > 0);
});

// ── the run ──────────────────────────────────────────────────────────────
const CORRIDOR = [
  { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
  { a: { x: 0, y: 100 }, b: { x: 400, y: 100 } },
];
test('run: a straight corridor reports the analytic clearance; an obstruction is a located hit', () => {
  const mover = { hwPx: 20, hdPx: 25 };
  const clearEnv = { walls: CORRIDOR, obstacles: [{ fp: ws.wsFpRect(200, 95, 15, 15, 0), why: 'a parked bin' }] };
  const res = ws.wsManRun(clearEnv, mover, [{ x: 50, y: 50 }, { x: 350, y: 50 }],
    { turn: 'pivot', rM: 0 }, { mpp: 1, operatorM: 0, stepPx: 5 });
  assert.equal(res.ok, true);
  assert.ok(Math.abs(res.worst.clr - 10) < 1.5, 'tightest gap = obstacle edge at y=80 minus bin edge at y=70, got ' + res.worst.clr);
  const blocked = { walls: CORRIDOR, obstacles: [{ fp: ws.wsFpRect(200, 60, 15, 15, 0), why: 'a parked bin' }] };
  const res2 = ws.wsManRun(blocked, mover, [{ x: 50, y: 50 }, { x: 350, y: 50 }],
    { turn: 'pivot', rM: 0 }, { mpp: 1, operatorM: 0, stepPx: 5 });
  assert.equal(res2.ok, false);
  assert.equal(res2.hits.length, 1);
  assert.ok(res2.hits[0].depth > 0 && res2.hits[0].what === 'a parked bin');
  assert.ok(Math.abs(res2.hits[0].x - 185) < 30, 'the hit is located where the swept path meets the obstacle');
  assert.equal(res2.traces.length, 4, 'four corner traces for the envelope');
});

test('run: the operator zone is checked separately — a fit for the bin can still squeeze the person pushing it', () => {
  const walls = CORRIDOR.concat([{ a: { x: 0, y: 0 }, b: { x: 0, y: 100 } }]);
  const res = ws.wsManRun({ walls, obstacles: [] }, { hwPx: 20, hdPx: 25 },
    [{ x: 50, y: 50 }, { x: 350, y: 50 }], { turn: 'pivot', rM: 0 },
    { mpp: 1, operatorM: 40, stepPx: 5 });
  assert.equal(res.ok, true, 'the bin itself never touches the end wall');
  assert.equal(res.okOperator, false, 'the person pushing starts jammed against it');
  assert.ok(res.opHits.length >= 1);
});

// ── spin in place ────────────────────────────────────────────────────────
test('spin: open space spins freely; a corridor tighter than the diagonal does not', () => {
  const open = ws.wsManSpin(ws.wsFpRect(200, 200, 20, 20, 0), [], []);
  assert.equal(open.full, true);
  const tight = ws.wsManSpin(ws.wsFpRect(200, 22, 20, 20, 0),
    [{ a: { x: 0, y: 0 }, b: { x: 400, y: 0 } }, { a: { x: 0, y: 44 }, b: { x: 400, y: 44 } }], []);
  assert.equal(tight.full, false);
  assert.ok(tight.free < 90, 'a 40-wide square cannot swing its 56.6 diagonal in a 44 corridor');
});

// ── accessibility peeling ────────────────────────────────────────────────
test('access: a dead-end row peels back to front — rounds of clearing, honestly counted', () => {
  const walls = [
    { a: { x: 0, y: 0 }, b: { x: 400, y: 0 } },
    { a: { x: 0, y: 100 }, b: { x: 400, y: 100 } },
    { a: { x: 0, y: 0 }, b: { x: 0, y: 100 } },      // closed left end; open to the right
  ];
  const items = [50, 150, 250].map((x, i) => ({ id: 'b' + i, fp: ws.wsFpRect(x, 50, 40, 45, 90) }));
  const res = ws.wsManAccess(items, walls, { fixed: [], marginPx: 8 });
  assert.deepEqual(res.map(r => r.tier), [3, 2, 1],
    'front bin first, then the one behind it, then the one at the dead end');
});

// ── two-bin changeover conflict ──────────────────────────────────────────
test('conflict: crossing envelopes must be sequenced, separated ones may run together', () => {
  const mover = { hwPx: 15, hdPx: 20 };
  const env = { walls: [], obstacles: [] };
  const opts = { mpp: 1, operatorM: 0, stepPx: 5 };
  const east = ws.wsManRun(env, mover, [{ x: 0, y: 100 }, { x: 200, y: 100 }], { turn: 'pivot', rM: 0 }, opts);
  const north = ws.wsManRun(env, mover, [{ x: 100, y: 200 }, { x: 100, y: 0 }], { turn: 'pivot', rM: 0 }, opts);
  const far = ws.wsManRun(env, mover, [{ x: 0, y: 300 }, { x: 200, y: 300 }], { turn: 'pivot', rM: 0 }, opts);
  assert.equal(ws.wsManConflict(east, north).overlap, true);
  assert.equal(ws.wsManConflict(east, far).overlap, false);
});

// ── wiring ───────────────────────────────────────────────────────────────
test('wiring: friendly panel, mode plumbing, export hygiene, DXF gating, library fields, migration', () => {
  assert.ok(SOURCE.includes('Can it be wheeled?'), 'the layout tab carries the friendly check panel');
  assert.ok(SOURCE.includes("WS._mode === 'layoutman'"), 'the manoeuvre mode routes through the canvas click handler');
  assert.ok(SOURCE.includes('wsManOverlayRender(mk, gW, mpp, slot)'), 'the overlay renders inside the waste layer render pass');
  assert.ok(SOURCE.includes("clone.querySelector('#ws-man-overlay')"),
    'the sheet export clone strips the overlay — a paused animation must never print');
  const dxf = SOURCE.slice(SOURCE.indexOf('function wsLayoutDXFEntities'), SOURCE.indexOf('// ── CALC → LAYOUT TARGETS'));
  assert.ok(dxf.includes("WS_MAN !== 'undefined' && WS_MAN.show"),
    'the DXF envelope is written only while a check is live on screen — no silent extra content');
  assert.ok(dxf.includes("'A-WASTE-MAN'"), 'envelope on its own layer');
  assert.ok(SOURCE.includes("(it.turn_type === 'pivot' || it.turn_type === 'wide') ? it.turn_type : null"),
    'the equipment save validates the turn tier instead of storing junk');
  assert.ok(SOURCE.includes("['turn_type','Turn (pivot/wide)'"), 'admin table edits the manoeuvrability fields');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-10-manoeuvrability-equipment.sql'), 'utf8');
  assert.ok(/add column if not exists turn_type/.test(mig) && /add column if not exists turn_radius_mm/.test(mig));
  // friendly on the surface, numbers underneath
  assert.ok(SOURCE.includes('stuck here'), 'canvas labels stay plain-language');
  assert.ok(SOURCE.includes('Numbers for the report'), 'engineering values live under the expander');
  assert.ok(SOURCE.includes('Turning behaviour is a standard assumption'),
    'assumed behaviour is flagged, never silently trusted');
  assert.ok(SOURCE.includes('WS_MAN.pend = null;   // an in-progress manoeuvre route dies with its mode'),
    'ending the mode clears a half-drawn route but keeps results');
});
