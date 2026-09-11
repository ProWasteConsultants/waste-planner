'use strict';
// Collection Point — kerbside presentation capacity.
//
// The kerb is a traced polyline parameterised by arc length: obstructions
// project onto it as exclusion intervals (default width + working clearance,
// both flagged assumptions), sight-splay zones cut the stretch they cover,
// bins pack first-fit into the clear stretches, and the verdict is metres,
// not just pass/fail. The design case is the busiest collection week from
// the council cycle pattern — never the sum of every stream the site owns.

const test = require('node:test');
const assert = require('node:assert/strict');
const { SOURCE, loadEngine } = require('./extract.js');

const ws = loadEngine({ blocks: [
  ['WS_BIN_TYPES',        /^const WS_BIN_TYPES = \[/],
  ['wsPointInPoly',       /^function wsPointInPoly\(/],
  ['WS_COLLECT_DEFAULTS', /^const WS_COLLECT_DEFAULTS = \{/],
  ['wsCollectSchedule',   /^function wsCollectSchedule\(/],
  ['wsCollectScenarios',  /^function wsCollectScenarios\(/],
  ['wsCollectBins',       /^function wsCollectBins\(/],
  ['wsKerbLen',           /^function wsKerbLen\(/],
  ['wsKerbAt',            /^function wsKerbAt\(/],
  ['wsKerbProject',       /^function wsKerbProject\(/],
  ['wsKerbZoneIntervals', /^function wsKerbZoneIntervals\(/],
  ['wsIntervalsMerge',    /^function wsIntervalsMerge\(/],
  ['wsIntervalsFree',     /^function wsIntervalsFree\(/],
  ['wsCollectExclusions', /^function wsCollectExclusions\(/],
  ['wsCollectPack',       /^function wsCollectPack\(/],
  ['wsCollectAssess',     /^function wsCollectAssess\(/],
] });

// ── collection scenarios ─────────────────────────────────────────────────
test('scenarios: the standard alternating pattern splits weeks; weekly streams sit in both', () => {
  const sched = ws.wsCollectSchedule(['garbage', 'recycling', 'fogo'], null);
  assert.deepEqual(sched, { garbage: 'W', recycling: 'A', fogo: 'B' });
  const sc = ws.wsCollectScenarios(sched);
  assert.equal(sc.length, 2);
  assert.deepEqual(sc[0].streams, ['garbage', 'recycling']);
  assert.deepEqual(sc[1].streams, ['garbage', 'fogo']);
});

test('scenarios: glass joins whichever week it lands in; all-weekly collapses; OFF never presents', () => {
  const sc = ws.wsCollectScenarios({ garbage: 'W', recycling: 'A', fogo: 'B', glass: 'A' });
  assert.deepEqual(sc[0].streams, ['garbage', 'recycling', 'glass'], 'glass lands IN week A, not in a phantom third week');
  const all = ws.wsCollectScenarios({ garbage: 'W', recycling: 'W', fogo: 'W' });
  assert.equal(all.length, 1);
  assert.equal(all[0].label, 'Every week');
  assert.deepEqual(all[0].streams, ['garbage', 'recycling', 'fogo']);
  const off = ws.wsCollectScenarios({ garbage: 'W', glass: 'OFF' });
  assert.ok(!off.some(s => s.streams.includes('glass')), 'a stream not collected kerbside never presents');
  // a manual override is respected — no forced fortnightly default
  const manual = ws.wsCollectSchedule(['garbage', 'fogo'], { fogo: 'W' });
  assert.equal(manual.fogo, 'W');
});

test('bins: a scenario expands the calculator targets into individual bin widths', () => {
  const targets = [
    { stream: 'garbage', typeId: 'b240', qty: 3 },
    { stream: 'recycling', typeId: 'b240', qty: 2 },
    { stream: 'fogo', typeId: 'b240', qty: 1 },
  ];
  const bins = ws.wsCollectBins(targets, ['garbage', 'recycling']);
  assert.equal(bins.length, 5);
  assert.ok(bins.every(b => Math.abs(b.wM - 0.585) < 1e-9), '240L width from the one bin-type table');
  assert.equal(ws.wsCollectBins(targets, ['fogo']).length, 1);
});

// ── kerb polyline geometry ───────────────────────────────────────────────
const LKERB = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }];
test('kerb: arc length, point-at and projection follow the traced polyline around corners', () => {
  assert.equal(ws.wsKerbLen(LKERB), 150);
  const p = ws.wsKerbAt(LKERB, 120);
  assert.ok(Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 20) < 1e-9);
  assert.ok(Math.abs(p.tx) < 1e-9 && Math.abs(p.ty - 1) < 1e-9, 'tangent turns with the corner');
  const pr = ws.wsKerbProject(LKERB, 50, 10);
  assert.ok(Math.abs(pr.s - 50) < 1e-9 && Math.abs(pr.d - 10) < 1e-9);
  const pr2 = ws.wsKerbProject(LKERB, 110, 25);
  assert.ok(Math.abs(pr2.s - 125) < 1e-9 && Math.abs(pr2.d - 10) < 1e-9, 'projection lands on the second leg');
});

test('kerb: a drawn splay polygon cuts exactly the stretch of kerb it covers', () => {
  const poly = [{ x: 40, y: -10 }, { x: 60, y: -10 }, { x: 60, y: 10 }, { x: 40, y: 10 }];
  const iv = ws.wsKerbZoneIntervals([{ x: 0, y: 0 }, { x: 100, y: 0 }], poly, 1);
  assert.equal(iv.length, 1);
  assert.ok(Math.abs(iv[0].s0 - 40) < 2 && Math.abs(iv[0].s1 - 60) < 2);
});

// ── exclusions and free stretches ────────────────────────────────────────
test('exclusions: obstruction width + working clearance both sides, far objects ignored, overlaps merged', () => {
  const kerb = [{ x: 0, y: 0 }, { x: 400, y: 0 }];   // 20 m at mpp 0.05
  const iv = ws.wsCollectExclusions(kerb, [
    { x: 200, y: 5, exclM: 3, label: 'crossover' },       // half = (1.5 + 0.3)/0.05 = 36 px
    { x: 220, y: 5, exclM: 0.6, label: 'pole' },          // overlaps the crossover — merges
    { x: 100, y: 300, exclM: 3, label: 'far away' },      // > 2.5 m from the kerb — ignored
  ], [], 0.05, {});
  assert.equal(iv.length, 1, 'overlapping exclusions merge; distant objects never count');
  assert.ok(Math.abs(iv[0].s0 - 164) < 0.5 && Math.abs(iv[0].s1 - 236) < 0.5,
    'the pole’s [208,232] sits inside the crossover’s [164,236]');
  assert.match(iv[0].why, /crossover/);
  assert.match(iv[0].why, /pole/);
  const free = ws.wsIntervalsFree(400, iv);
  assert.equal(free.length, 2);
  assert.ok(Math.abs(free[0].s1 - iv[0].s0) < 1e-6 && Math.abs(free[1].s0 - iv[0].s1) < 1e-6);
});

// ── packing ──────────────────────────────────────────────────────────────
test('pack: first-fit along the clear stretches, spilling across segments — corner lots split bins', () => {
  const kerbs = [
    { L: 100, free: [{ s0: 0, s1: 30 }] },
    { L: 80, free: [{ s0: 10, s1: 60 }] },
  ];
  const bins = [{ wPx: 20 }, { wPx: 20 }, { wPx: 20 }];
  const { placed, unplaced } = ws.wsCollectPack(kerbs, bins, 5);
  assert.equal(unplaced.length, 0);
  assert.equal(placed[0].kerb, 0, 'first bin on the first frontage');
  assert.equal(placed[1].kerb, 1, 'no room for a second on kerb A (20+5+20 > 30) — spills to kerb B');
  assert.equal(placed[2].kerb, 1);
  assert.ok(Math.abs(placed[2].s0 - (10 + 20 + 5)) < 1e-9, 'gap kept between neighbours in the same stretch');
});

// ── the verdict, in metres ───────────────────────────────────────────────
const mkKerb = (Lpx, excl) => ({ L: Lpx, free: ws.wsIntervalsFree(Lpx, excl || []) });
const B240 = n => Array.from({ length: n }, () => ({ stream: 'garbage', wM: 0.585, dM: 0.735 }));
test('verdict: fits with metres to spare; short by metres; both stated, never bare pass/fail', () => {
  const mpp = 0.05;
  const ok = ws.wsCollectAssess([mkKerb(400, [{ s0: 164, s1: 236 }])], B240(4), mpp, 0.15);
  assert.equal(ok.ok, true);
  assert.ok(Math.abs(ok.reqM - 2.79) < 0.01, '4 × 0.585 + 3 gaps of 0.15');
  assert.ok(Math.abs(ok.netM - 16.4) < 0.01);
  const short = ws.wsCollectAssess([mkKerb(70, [{ s0: 0, s1: 20 }])], B240(4), mpp, 0.15);
  assert.equal(short.ok, false);
  assert.ok(Math.abs(short.shortM - (2.79 - 2.5)) < 0.02, 'the shortfall is surfaced in metres');
});

test('verdict: a frontage too short even when empty is a SITE constraint, not a layout problem', () => {
  const a = ws.wsCollectAssess([mkKerb(40, [])], B240(4), 0.05, 0.15);   // 2.0 m gross vs 2.79 m
  assert.equal(a.siteConstraint, true);
  assert.equal(a.ok, false);
});

test('verdict: enough total kerb but broken into short stretches reads as fragmented, not short', () => {
  // three 0.8 m gaps (2.4 m clear) vs one 1100L bin (1.245 m): plenty of
  // total length, nowhere it actually fits
  const kerb = mkKerb(100, [{ s0: 16, s1: 20 }, { s0: 36, s1: 40 }, { s0: 56, s1: 100 }]);
  const a = ws.wsCollectAssess([kerb], [{ stream: 'garbage', wM: 1.245, dM: 1.075 }], 0.05, 0.15);
  assert.equal(a.fragmented, true);
  assert.equal(a.ok, false);
  assert.equal(a.shortM, 0, 'not short on total metres — the stretches are the problem');
});

// ── wiring ───────────────────────────────────────────────────────────────
test('wiring: tab order, panel, mode plumbing, shared render/DXF assembler, library items', () => {
  const strip = SOURCE.slice(SOURCE.indexOf('Layout Generator</button>'), SOURCE.indexOf('Swept Paths</button>'));
  assert.ok(strip.includes("wsShowTab('collect'"), 'Collection Point sits between Layout and Swept Path');
  assert.ok(SOURCE.includes('id="ws-tab-collect"'), 'the tab has its own panel');
  assert.ok(SOURCE.includes("['calculator','layout','collect','swept']"), 'wsShowTab knows the tab');
  assert.ok(SOURCE.includes("WS._mode === 'layoutkerb'"), 'kerb tracing routes through the shared canvas mode plumbing');
  assert.ok(SOURCE.includes('wsCollectRender(mk, gW, mpp, slot)'), 'the kerb diagram renders in the layer pass (real content, exports on the sheet)');
  const dxf = SOURCE.slice(SOURCE.indexOf('function wsLayoutDXFEntities'), SOURCE.indexOf('// ── CALC → LAYOUT TARGETS'));
  assert.ok(dxf.includes("'A-KERB'") && dxf.includes('wsCollectCompute(slot, mpp)'),
    'DXF reads the SAME assembler as the panel and canvas — the three can never disagree');
  assert.ok(dxf.includes('DESIGN CASE'), 'the export names which scenario drove the result');
  // street furniture lives in the shared fixtures library, not a tool-private list
  for (const code of ['POLE', 'TREE', 'XOVER', 'PIT', 'HYDRANT', 'SIGN'])
    assert.ok(new RegExp("code: '" + code + "'.*excl:").test(SOURCE), code + ' is a shared library fixture with a default exclusion width');
  assert.ok(SOURCE.includes("SPLAY:     { id: 'SPLAY'"), 'sight splays are a drawn zone type — they scale with the frontage');
  // plain words on screen; assumptions flagged; area mode left open
  assert.ok(SOURCE.includes('On your busiest collection week'), 'the verdict speaks plain language');
  assert.ok(SOURCE.includes('Standard alternating pattern assumed'), 'the default cycle is flagged as an assumption');
  assert.ok(SOURCE.includes('verify against the council’s collection guidelines'), 'clearance defaults are flagged in the report numbers');
  assert.ok(SOURCE.includes("kind: 'line'"), 'kerb entries carry their kind — holding bays pack an AREA later, not this line logic');
});
