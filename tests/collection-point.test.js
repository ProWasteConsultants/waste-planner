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
  ['wsKerbHit',           /^function wsKerbHit\(/],
  ['wsKerbTranslate',     /^function wsKerbTranslate\(/],
  ['wsKerbMoveVertex',    /^function wsKerbMoveVertex\(/],
  ['wsKerbInsertVertex',  /^function wsKerbInsertVertex\(/],
  ['wsKerbDeleteVertex',  /^function wsKerbDeleteVertex\(/],
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

// ── kerb editing: select, move, reshape, delete ──────────────────────────
// A committed kerb edits like a route markup. The engine is pure; the wiring
// pins below make sure the canvas actually reaches it.
const KERBS = () => [
  { id: 'kA', kind: 'line', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }] },
  { id: 'kB', kind: 'line', pts: [{ x: 300, y: 0 }, { x: 400, y: 0 }] },
];

test('kerb hit: the line body, a corner, and nothing off the line', () => {
  const ks = KERBS();
  assert.deepEqual(ws.wsKerbHit(ks, 50, 3, 6, 8, null), { id: 'kA', part: 'seg', vi: 0 }, 'near the first segment');
  assert.deepEqual(ws.wsKerbHit(ks, 101, 40, 6, 8, null), { id: 'kA', part: 'seg', vi: 1 }, 'near the second segment');
  assert.deepEqual(ws.wsKerbHit(ks, 99, 2, 6, 8, null), { id: 'kA', part: 'vertex', vi: 1 }, 'a corner wins over the segment it joins');
  assert.deepEqual(ws.wsKerbHit(ks, 350, 5, 6, 8, null), { id: 'kB', part: 'seg', vi: 0 }, 'the other kerb');
  assert.equal(ws.wsKerbHit(ks, 50, 30, 6, 8, null), null, 'well off every line: nothing');
  assert.equal(ws.wsKerbHit([], 0, 0, 6, 8, null), null);
  assert.equal(ws.wsKerbHit([{ id: 'x', kind: 'line', pts: [{ x: 0, y: 0 }] }], 0, 0, 6, 8, null), null, 'a one-point kerb is not editable');
});

test('kerb hit: the selected kerb offers its ⊕ midpoints and its corners first', () => {
  const ks = KERBS();
  assert.deepEqual(ws.wsKerbHit(ks, 50, 0, 6, 8, 'kA'), { id: 'kA', part: 'mid', vi: 0 }, 'the midpoint of segment 0, only when selected');
  assert.deepEqual(ws.wsKerbHit(ks, 50, 0, 6, 8, null), { id: 'kA', part: 'seg', vi: 0 }, 'unselected: the same spot is just the line');
  assert.deepEqual(ws.wsKerbHit(ks, 100, 40, 6, 8, 'kA'), { id: 'kA', part: 'mid', vi: 1 });
  // a corner handle with zero line tolerance — how the pre-contents pass asks
  assert.deepEqual(ws.wsKerbHit(ks, 2, 2, 6, 0, 'kA'), { id: 'kA', part: 'vertex', vi: 0 });
  assert.equal(ws.wsKerbHit(ks, 50, 3, 6, 0, 'kA') && ws.wsKerbHit(ks, 50, 3, 6, 0, 'kA').part, 'mid', 'with zero line tolerance only handles hit');
  assert.equal(ws.wsKerbHit(ks, 20, 3, 6, 0, 'kA'), null, 'off the handles, zero tolerance: nothing (so a bin there can take the grab)');
});

test('kerb translate carries the bins placed along THAT kerb and nothing else', () => {
  const ks = KERBS();
  const bins = [
    { id: 'b1', kerb: 'kA', x: 50, y: -10 }, { id: 'b2', kerb: 'kA', x: 110, y: 40 },
    { id: 'b3', kerb: 'kB', x: 350, y: -10 }, { id: 'b4', x: 5, y: 5 },
  ];
  const n = ws.wsKerbTranslate(ks[0], 10, -5, bins);
  assert.equal(n, 2);
  assert.deepEqual(ks[0].pts, [{ x: 10, y: -5 }, { x: 110, y: -5 }, { x: 110, y: 75 }]);
  assert.deepEqual(bins.map(b => [b.x, b.y]), [[60, -15], [120, 35], [350, -10], [5, 5]], 'kA bins moved; kB bin and the free bin did not');
  assert.equal(ws.wsKerbLen(ks[0].pts), 180, 'a translation keeps the arc length exactly');
  assert.equal(ws.wsKerbTranslate(null, 1, 1, bins), 0);
});

test('kerb reshape: move, insert and delete corners with a two-point floor', () => {
  const k = KERBS()[0];
  assert.equal(ws.wsKerbMoveVertex(k, 1, 120, 10), true);
  assert.deepEqual(k.pts[1], { x: 120, y: 10 });
  assert.equal(ws.wsKerbMoveVertex(k, 7, 0, 0), false, 'no such corner');
  assert.equal(ws.wsKerbInsertVertex(k, 0), 1, 'the new corner index');
  assert.deepEqual(k.pts[1], { x: 60, y: 5 }, 'inserted at the segment midpoint');
  assert.equal(k.pts.length, 4);
  assert.equal(ws.wsKerbInsertVertex(k, 3), -1, 'no segment after the last corner');
  assert.equal(ws.wsKerbDeleteVertex(k, 1), true);
  assert.equal(ws.wsKerbDeleteVertex(k, 1), true);
  assert.equal(k.pts.length, 2);
  assert.equal(ws.wsKerbDeleteVertex(k, 0), false, 'a kerb keeps its two ends');
  assert.equal(k.pts.length, 2, 'and is left untouched at the floor');
});

test('wiring: the canvas selects, drags and deletes a kerb through the pure engine', () => {
  const md = SOURCE.slice(SOURCE.indexOf("area.addEventListener('mousedown'"), SOURCE.indexOf("area.addEventListener('contextmenu'"));
  assert.ok(md.includes("wsSelSet([k.id], 'kerb')"), 'a kerb hit selects the kerb, kind kerb');
  assert.ok(md.includes("kind: 'kerbbody'") && md.includes("kind: 'kerbvert'"), 'body and corner drags');
  assert.ok(md.includes('wsKerbInsertVertex(k, hk.vi)') && md.includes('wsKerbDeleteVertex(k, hk.vi)'), 'midpoint adds, Alt/right-click removes');
  assert.ok(/selKind === 'kerb' && WS_LAYOUT\.sel && WS\.layers\.binroom !== false[\s\S]{0,200}wsKerbHit\([^\n]*WS_LAYOUT\.sel\);\s*if \(hk && hk\.id === WS_LAYOUT\.sel && hk\.part !== 'seg'/.test(md),
    "the selected kerb's handles are tested BEFORE contents, the line body after");
  const mm = SOURCE.slice(SOURCE.indexOf("area.addEventListener('mousemove'"), SOURCE.indexOf('const endDrag = () =>'));
  assert.ok(mm.includes('wsKerbTranslate(k, tx, ty, slot2.bins)'), 'a body drag moves the kerb with its bins');
  assert.ok(mm.includes('wsKerbMoveVertex(k, dg.vi, vx, vy)'), 'a corner drag reshapes');
  const end = SOURCE.slice(SOURCE.indexOf('const endDrag = () =>'), SOURCE.indexOf("area.addEventListener('mouseup', endDrag)"));
  assert.ok(end.includes("dg.kind === 'kerbvert'") && end.includes('wsCollectPlaceBins([dg.id], { noSnap: true })'),
    'a reshape re-packs the bins along the new line, without a second undo step');
  const del = SOURCE.slice(SOURCE.indexOf("} else if (a === 'delete') {"), SOURCE.indexOf("selKind === 'markup' && WS_LAYOUT.sel) {", SOURCE.indexOf("} else if (a === 'delete') {")));
  assert.ok(del.includes("WS_LAYOUT.selKind === 'kerb' && WS_LAYOUT.sel") && del.includes('wsCollectKerbDelete(ki)'),
    'Del on a selected kerb goes through the same path as the panel ✕ (bins go too, Ctrl+Z restores both)');
  const sel = SOURCE.slice(SOURCE.indexOf('function wsLayoutSelectAt('), SOURCE.indexOf('function wsLayoutEvt('));
  assert.ok(sel.indexOf('wsKerbHit(') > 0 && sel.indexOf('wsKerbHit(') < sel.indexOf('const rm = wsRoomAt(x, y);'),
    'the click that follows mousedown keeps the kerb selected instead of falling through to the room or clearing');
  const render = SOURCE.slice(SOURCE.indexOf('function wsCollectRender('), SOURCE.indexOf('/* ── Manoeuvrability UI'));
  assert.ok(render.includes("const selK = WS_LAYOUT.selKind === 'kerb' && WS_LAYOUT.sel === ki.k.id;"), 'the selected kerb is drawn with its handles');
  const mat = SOURCE.slice(SOURCE.indexOf('function wsCollectMaterialise('), SOURCE.indexOf('function wsCollectPlaceBins('));
  assert.ok(mat.includes('if (!(opts && opts.noSnap)) wsLayoutSnapshot();'), 'materialise can skip its own snapshot inside a drag');
});
