'use strict';
// Layout generator polish — the testable maths behind the interaction work.
//
// Covers the shift-key drag constraints (B1), room edge dimensions (B5), the
// hard-waste zone predicate (B4) and the architectural door symbols (B7). The
// pointer plumbing, SVG rendering and DXF writing sit on top of these and are
// verified by the wiring guards at the bottom rather than by unit tests.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout, SOURCE, extractBlock } = require('./extract.js');

const ws = loadLayout();

// ── B1: shift constraints ───────────────────────────────────────────────
test('wsSnapVertexOrtho: squares the dragged corner to its nearest neighbour axis', () => {
  const prev = { x: 100, y: 0 }, next = { x: 0, y: 100 };
  // dragged just right of `prev`'s X — snapping X is the smaller move
  assert.deepEqual(ws.wsSnapVertexOrtho({ x: 105, y: 8 }, prev, next), { x: 100, y: 8 });
  // dragged just below `next`'s Y — snapping Y is the smaller move
  assert.deepEqual(ws.wsSnapVertexOrtho({ x: 40, y: 96 }, prev, next), { x: 40, y: 100 });
});

test('wsSnapVertexOrtho: the snapped point shares an axis with a neighbour', () => {
  const prev = { x: 10, y: 0 }, next = { x: 0, y: 60 };
  for (const p of [{ x: 55, y: 12 }, { x: 4, y: 51 }, { x: 30, y: 30 }, { x: -20, y: -5 }]) {
    const s = ws.wsSnapVertexOrtho(p, prev, next);
    const squared = s.x === prev.x || s.y === prev.y || s.x === next.x || s.y === next.y;
    assert.ok(squared, `snap of ${JSON.stringify(p)} -> ${JSON.stringify(s)} squares nothing`);
    // exactly one coordinate moves — the other is kept from the pointer
    assert.ok(s.x === p.x || s.y === p.y, 'a snap must not move both axes');
  }
});

test('wsSnapVertexOrtho: picks the smallest correction of the four candidates', () => {
  const prev = { x: 0, y: 0 }, next = { x: 100, y: 100 };
  const p = { x: 3, y: 62 };
  const s = ws.wsSnapVertexOrtho(p, prev, next);
  const cands = [{ x: prev.x, y: p.y }, { x: p.x, y: prev.y }, { x: next.x, y: p.y }, { x: p.x, y: next.y }];
  const best = Math.min(...cands.map(c => Math.hypot(c.x - p.x, c.y - p.y)));
  assert.ok(Math.abs(Math.hypot(s.x - p.x, s.y - p.y) - best) < 1e-9);
  assert.deepEqual(s, { x: 0, y: 62 }, 'x is only 3 px away, y is 38');
});

test('wsSnapVertexOrtho: copes with a missing neighbour', () => {
  // 5 px to square X against the neighbour, 9 px to square Y — X wins
  assert.deepEqual(ws.wsSnapVertexOrtho({ x: 5, y: 9 }, { x: 0, y: 0 }, null), { x: 0, y: 9 });
  assert.deepEqual(ws.wsSnapVertexOrtho({ x: 5, y: 9 }, null, null), { x: 5, y: 9 }, 'no neighbours, no snap');
});

test('wsSnapAxis: locks a whole-room drag to the dominant axis', () => {
  assert.deepEqual(ws.wsSnapAxis(30, -4), { dx: 30, dy: 0 });
  assert.deepEqual(ws.wsSnapAxis(3, -40), { dx: 0, dy: -40 });
  assert.deepEqual(ws.wsSnapAxis(-25, 25), { dx: -25, dy: 0 }, 'a tie goes to horizontal, deterministically');
  assert.deepEqual(ws.wsSnapAxis(0, 0), { dx: 0, dy: 0 });
});

test('wsSnapAxis: the locked axis keeps its full magnitude', () => {
  // Axis-lock must not shorten the drag — only zero the other component.
  for (const [dx, dy] of [[12, 3], [-7, 40], [0, 9], [5, -5]]) {
    const r = ws.wsSnapAxis(dx, dy);
    assert.ok((r.dx === dx && r.dy === 0) || (r.dx === 0 && r.dy === dy));
  }
});

// ── B5: room dimensions ─────────────────────────────────────────────────
test('wsDimText: metres to one decimal', () => {
  assert.equal(ws.wsDimText(200, 0.05), '10.0 m');
  assert.equal(ws.wsDimText(0, 0.05), '0.0 m');
  assert.equal(ws.wsDimText(123, 0.05), '6.2 m', 'rounds, not truncates');
  assert.equal(ws.wsDimText(1, 0.05), '0.1 m');
  assert.equal(ws.wsDimText(100, 0.02), '2.0 m', 'scale-dependent, not pixel-dependent');
});

const RECT = { id: 'A', pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }] };

test('wsRoomDimEdges: one dimension per edge with the right lengths', () => {
  const e = ws.wsRoomDimEdges(RECT, 0.05, { offset: 9, minPx: 26 });
  assert.equal(e.length, 4);
  assert.deepEqual(e.map(x => x.text), ['10.0 m', '5.0 m', '10.0 m', '5.0 m']);
  assert.deepEqual(e.map(x => x.edge), [0, 1, 2, 3]);
  assert.ok(Math.abs(e[0].metres - 10) < 1e-9);
});

test('wsRoomDimEdges: text sits OUTSIDE the room, never over its contents', () => {
  const e = ws.wsRoomDimEdges(RECT, 0.05, { offset: 9, minPx: 26 });
  // the polygon is the unit square scaled; a point inside would be 0<x<200, 0<y<100
  for (const d of e) {
    const inside = d.tx > 0 && d.tx < 200 && d.ty > 0 && d.ty < 100;
    assert.equal(inside, false, `edge ${d.edge} label at ${d.tx},${d.ty} is inside the room`);
  }
});

test('wsRoomDimEdges: text is never upside-down', () => {
  const poly = { id: 'P', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 140, y: 90 },
                                { x: 60, y: 140 }, { x: -30, y: 70 }] };
  for (const d of ws.wsRoomDimEdges(poly, 0.05, {}))
    assert.ok(d.deg > -90 && d.deg <= 90, `edge ${d.edge} reads at ${d.deg}°`);
});

test('wsRoomDimEdges: a reversed edge reads 0°, not 360°', () => {
  const e = ws.wsRoomDimEdges(RECT, 0.05, {});
  assert.ok(Math.abs(e[2].deg) < 1e-9, 'the right-to-left edge must normalise to 0');
});

test('wsRoomDimEdges: edges too short to letter are skipped', () => {
  const spike = { id: 'S', pts: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 202, y: 3 }, { x: 0, y: 100 }] };
  const e = ws.wsRoomDimEdges(spike, 0.05, { minPx: 26 });
  assert.equal(e.length, 3, 'the 3.6 px sliver gets no dimension string');
  assert.equal(e.some(x => x.edge === 1), false);
});

test('wsRoomDimEdges: the offset scales with the label factor', () => {
  const near = ws.wsRoomDimEdges(RECT, 0.05, { offset: 5 })[0];
  const far = ws.wsRoomDimEdges(RECT, 0.05, { offset: 20 })[0];
  const dNear = Math.hypot(near.tx - near.mx, near.ty - near.my);
  const dFar = Math.hypot(far.tx - far.mx, far.ty - far.my);
  assert.ok(Math.abs(dNear - 5) < 1e-9);
  assert.ok(Math.abs(dFar - 20) < 1e-9);
});

// ── B4: hard waste zone ─────────────────────────────────────────────────
test('wsIsHardWasteZone: matches hard waste and bulky items, nothing else', () => {
  for (const item of [{ label: 'Bulky / hard waste zone' }, { label: 'Hard Waste Area' },
                      { code: 'ALLOW_HARD', label: '' }, { label: 'bulky goods store' }])
    assert.equal(ws.wsIsHardWasteZone(item), true, JSON.stringify(item));
  for (const item of [{ label: '240L bin' }, { label: 'Aisle' }, { label: 'Compactor' },
                      { code: 'COLUMN', label: 'Column' }, {}, null])
    assert.equal(ws.wsIsHardWasteZone(item), false, JSON.stringify(item));
});

test('zones and access aisles can never share a colour', () => {
  assert.equal(ws.WS_ZONE_PURPLE, '#7B1FA2');
  // A typed zone carries its own colour, the legacy hard-waste item keeps purple,
  // and an aisle stays red — one expression decides all three.
  assert.ok(SOURCE.includes("const zHex = wsIsZone(e) ? wsZoneColour(e) : (zone ? WS_ZONE_PURPLE : '#DC4646');"),
    'the zone/aisle colour split must come from one place');
});

// ── B7: door symbols ────────────────────────────────────────────────────
test('wsDoorGeometry: single door is one leaf plus one quarter-circle swing', () => {
  const g = ws.wsDoorGeometry('SINGLE', 0.92, 0.10);
  assert.equal(g.leaves.length, 1);
  assert.equal(g.arcs.length, 1);
  assert.equal(g.panels.length, 0, 'a swing door has no panel');
  assert.equal(g.width, 0.92);
  // the leaf is exactly the door width long, drawn open at 90°
  const [p0, p1] = g.leaves[0];
  assert.ok(Math.abs(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) - 0.92) < 1e-9, 'leaf length = door width');
  assert.equal(p0[0], -0.46, 'hinged at the opening edge');
  // the arc radius equals the leaf, and sweeps a quarter turn
  assert.ok(Math.abs(g.arcs[0].r - 0.92) < 1e-9);
  assert.ok(Math.abs(Math.abs(g.arcs[0].a1 - g.arcs[0].a0) - 90) < 1e-9, 'quarter-circle swing');
  assert.equal(g.arcs[0].cx, p0[0], 'the arc is centred on the hinge');
});

test('wsDoorGeometry: double door is two mirrored leaves, each half the width', () => {
  const g = ws.wsDoorGeometry('DOUBLE', 1.84, 0.10);
  assert.equal(g.leaves.length, 2);
  assert.equal(g.arcs.length, 2);
  g.leaves.forEach(([a, b]) =>
    assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 0.92) < 1e-9, 'each leaf is half the opening'));
  // hinged at opposite jambs and swinging opposite ways
  assert.deepEqual(g.leaves.map(l => l[0][0]).sort((x, y) => x - y), [-0.92, 0.92]);
  assert.notEqual(g.arcs[0].dir, g.arcs[1].dir, 'the leaves must mirror');
  assert.ok(Math.abs(g.arcs[0].r - g.arcs[1].r) < 1e-9);
});

test('wsDoorGeometry: roller door is a panel with no swing arc', () => {
  const g = ws.wsDoorGeometry('ROLLER', 2.40, 0.15);
  assert.equal(g.arcs.length, 0, 'a roller door does not swing');
  assert.equal(g.leaves.length, 0);
  assert.equal(g.panels.length, 1);
  assert.ok(g.rollDashed, 'the curtain roll is shown dashed');
  assert.equal(g.width, 2.40);
  // the panel spans the full opening and sits in the wall thickness
  const xs = g.panels[0].map(p => p[0]), ys = g.panels[0].map(p => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2.40) < 1e-9);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.15) < 1e-9);
});

test('wsDoorGeometry: widths are editable and the geometry follows', () => {
  const wide = ws.wsDoorGeometry('SINGLE', 1.20, 0.10);
  assert.equal(wide.width, 1.20);
  assert.ok(Math.abs(wide.arcs[0].r - 1.20) < 1e-9, 'a wider leaf sweeps a wider arc');
  const roller = ws.wsDoorGeometry('ROLLER', 3.60, 0.20);
  const xs = roller.panels[0].map(p => p[0]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3.60) < 1e-9);
});

test('wsDoorGeometry: falls back to sane defaults', () => {
  const d = ws.wsDoorGeometry('SINGLE', 0, 0);
  assert.equal(d.width, 0.92, 'default single leaf is 920 mm');
  assert.equal(d.wall, 0.10);
  assert.equal(ws.wsDoorGeometry('DOUBLE', 0, 0).width, 1.84, 'default double is 2 x 920');
  assert.equal(ws.wsDoorGeometry('ROLLER', 0, 0).width, 2.40, 'default roller is 2400 mm');
  assert.equal(ws.wsDoorGeometry('NONSENSE', 0.92, 0.1).leaves.length, 1, 'unknown kind falls back to single');
});

test('wsDoorGeometry: every door has jambs marking the opening', () => {
  for (const k of ['SINGLE', 'DOUBLE', 'ROLLER']) {
    const g = ws.wsDoorGeometry(k, 0, 0);
    assert.equal(g.jambs.length, 2, k + ' must show both reveals');
    assert.deepEqual(g.opening.map(p => p[0]), [-g.width / 2, g.width / 2]);
  }
});

test('the door kinds offered match the fixtures list', () => {
  assert.deepEqual(Object.keys(ws.WS_DOOR_KINDS).sort(), ['DOUBLE', 'ROLLER', 'SINGLE']);
  for (const code of ['DOOR', 'DOOR2', 'ROLLER'])
    assert.ok(SOURCE.includes("code: '" + code + "'"), 'fixture ' + code + ' missing from WS_FIXTURES');
  assert.match(SOURCE, /door: 'SINGLE'/);
  assert.match(SOURCE, /door: 'DOUBLE'/);
  assert.match(SOURCE, /door: 'ROLLER'/);
});

// ── wiring guards ───────────────────────────────────────────────────────
test('shift is read during both room drags', () => {
  assert.match(SOURCE, /if \(e\.shiftKey\)\s*\{\s*\r?\n\s*const lock = wsSnapAxis\(p\.x - dg\.startX, p\.y - dg\.startY\);/,
    'whole-room drag does not axis-lock on shift');
  assert.match(SOURCE, /if \(e\.shiftKey\)[\s\S]{0,220}wsSnapVertexOrtho\(/,
    'vertex drag does not square on shift');
  assert.match(SOURCE, /startX: p\.x, startY: p\.y/,
    'the axis lock must measure from the drag origin, not the previous frame');
});

test('B2: callouts stay legible at any plan scale AND any zoom', () => {
  assert.match(SOURCE, /const WS_CALLOUT_MIN_F = 0\.85;/);
  // wsLblF() alone only tracks the drawing scale — zooming out to a whole-site
  // view shrinks everything on screen regardless, so the floor is expressed in
  // screen units via wsCanvasPerScreen and clamped against runaway zoom-out.
  assert.match(SOURCE, /function wsCalloutF\(\)\s*\{[\s\S]{0,240}wsCanvasPerScreen\(\)/,
    'the callout floor must be measured on screen, not only in plan units');
  assert.match(SOURCE, /Math\.min\(4, Math\.max\(1, wsCanvasPerScreen\(\)\)\)/,
    'the on-screen floor must be clamped');
  assert.match(SOURCE, /return Math\.max\(onScreen, wsLblF\(\)\);/,
    'it is a floor, never a ceiling — a large plan scale still wins');
  // both the renderer and the hit-test must use it, or the box and its target disagree
  const uses = SOURCE.split('wsCalloutF()').length - 1;
  assert.ok(uses >= 3, 'wsCalloutF is used in only ' + uses + ' place(s)');
});

test('B3: bin outlines are drawn at 1 px, not 2', () => {
  assert.match(SOURCE, /stroke: ghost \? st\.col : wsShade\(st\.col\), 'stroke-width': ghost \? 1 : 1/);
  assert.equal(SOURCE.includes("wsShade(st.col), 'stroke-width': ghost ? 1.5 : 2"), false,
    'the heavy 2 px bin outline is still present');
});

test('B5: the Dimensions layer group is actually populated', () => {
  assert.match(SOURCE, /const gd = document\.getElementById\('ws-layer-dims'\);/);
  assert.match(SOURCE, /wsRoomDimEdges\(r, mpp, \{ offset: 9 \* WSF, minPx: 26 \}\)/,
    'dimension offsets must scale with wsLblF');
  // ...and exported to DXF only when the layer is visible
  assert.match(SOURCE, /if \(WS\.layers\.dims !== false\) slot\.rooms\.forEach/);
  assert.match(SOURCE, /'A-ANNO-DIMS'/);
});

test('B6: aisle end handles use the zoom-aware radius and show while selected', () => {
  assert.match(SOURCE, /if \(Math\.hypot\(p\.x - hx, p\.y - hy\) <= wsHandleHitR\(\)\)/,
    'the aisle grab radius is still a fixed canvas-pixel value');
  // zones are resizable too — the claimed area is the whole point of a zone
  assert.ok(SOURCE.includes('if (selected && (e.aisle || wsIsZone(e))) {'),
    'aisles AND zones must show screen-sized end handles while selected');
  assert.ok(SOURCE.includes('(x.aisle || wsIsZone(x))'),
    'the stretch drag must accept a zone, not only an aisle');
});

test('B7: the DXF door linework comes from the same geometry as the screen', () => {
  assert.match(SOURCE, /const G = wsDoorGeometry\(dk, e\.w, e\.d\);/, 'DXF must reuse wsDoorGeometry');
  assert.match(SOURCE, /'A-DOOR'/);
  assert.match(SOURCE, /'A-WASTE-ZONE'/, 'hard waste zones need their own DXF layer');
});

// ── layout UI fixes (items 1–7) ─────────────────────────────────────────
test('every placed item has a minimum SCREEN-sized grab band', () => {
  // A 100 mm door is 2 canvas px deep — about 1 px on screen at 53% zoom — so
  // its true footprint was impossible to click. That is why doors could not be
  // selected, moved, rotated or deleted: nothing else was wrong with them.
  const fn = SOURCE.slice(SOURCE.indexOf('function wsLayoutHitEquip'), SOURCE.indexOf('// ── OBB GEOMETRY'));
  assert.match(fn, /const grab = wsHandleHitR\(\) \* 0\.55;/, 'the grab band must be zoom-aware');
  assert.match(fn, /Math\.max\(e\.w \/ 2 \/ mpp, grab\)/);
  assert.match(fn, /Math\.max\(e\.d \/ 2 \/ mpp, grab\)/);
  assert.doesNotMatch(fn, /Math\.abs\(ly\) <= e\.d \/ 2 \/ mpp\) return e;/, 'the raw footprint test is still there');
});

test('doors render in black, and selection still overrides it', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('const drawDoor = '), SOURCE.indexOf('// ── equipment ──'));
  assert.match(fn, /const col = sel \? '#FFD54F' : '#111111'/, 'unselected doors must be black');
  assert.doesNotMatch(fn, /'#B9C4C4'/, 'the old grey door colour is still present');
  assert.match(fn, /rgba\(17,17,17,0\.10\)/, 'the roller panel fill should follow the black linework');
});

test('dimensions are royal blue everywhere they are drawn', () => {
  assert.equal(ws.WS_DIM_COLOUR, '#4169E1');
  const dims = SOURCE.slice(SOURCE.indexOf("const gd = document.getElementById('ws-layer-dims')"),
                            SOURCE.indexOf('// polygon in progress'));
  // ticks, the dimension line and the text all key off the one constant
  assert.equal((dims.match(/WS_DIM_COLOUR/g) || []).length, 3,
    'ticks, line and text must all use the shared colour');
  assert.doesNotMatch(dims, /#9AA6A6|#C7D2D2/, 'the old grey dimension colours are still present');
});

test('the DXF dimension layer is unaffected by the screen colour change', () => {
  // DXF carries an ACI index, not a hex colour — the royal blue is screen-only.
  assert.match(SOURCE, /d \+= text\('A-ANNO-DIMS', 8,/);
  assert.doesNotMatch(SOURCE.slice(SOURCE.indexOf('function wsLayoutDXFEntities')), /#4169E1/);
});

// ── placement hand-back and clipboard ───────────────────────────────────
test('fixture placement is single-shot and hands the pointer back', () => {
  // Root cause of "doors cannot be selected/moved/rotated/deleted": placement
  // mode stayed armed, so the click meant to SELECT the door placed another one.
  const fn = extractBlock(/^function wsFixtureAt\(/).text;
  assert.match(fn, /wsLayoutEndMode\(\);/, 'placement must exit its mode');
  assert.match(fn, /WS_LAYOUT\.sel = id; WS_LAYOUT\.selKind = 'equip';/,
    'the item just placed should come back selected');
  // the first wsLayoutEndMode() is the "no fixture armed" guard — check the last
  assert.ok(fn.lastIndexOf('wsLayoutEndMode()') > fn.indexOf('equip.push('),
    'the mode must end AFTER the item is pushed');
});

test('wsCloneItem: a copy is a fresh, unlocked, untagged duplicate', () => {
  const src = { id: 'fx_1', x: 100, y: 200, rot: 90, code: 'DOOR', label: 'Door — single 920',
                w: 0.92, d: 0.1, door: 'SINGLE', locked: true, roomId: 'A', calcRoom: 'R1' };
  const c = ws.wsCloneItem(src, 7, -3, 'fx_2');
  assert.equal(c.id, 'fx_2');
  assert.deepEqual([c.x, c.y], [107, 197], 'offset applied');
  assert.equal(c.rot, 90, 'rotation carries over');
  assert.equal(c.door, 'SINGLE', 'the door kind carries over');
  assert.equal(c.w, 0.92);
  assert.equal(c.locked, undefined, 'a copy is never born locked');
  assert.equal(c.roomId, null, 'room tags are cleared until it is placed');
  assert.equal(c.calcRoom, null);
});

test('wsCloneItem: the copy is detached from the original', () => {
  const src = { id: 'a', x: 0, y: 0, openings: [{ rx: 1, ry: 2 }] };
  const c = ws.wsCloneItem(src, 0, 0, 'b');
  c.openings[0].rx = 99;
  assert.equal(src.openings[0].rx, 1, 'a deep copy, not a shared reference');
  assert.equal(ws.wsCloneItem(null, 1, 1, 'x'), null);
});

test('wsCloneItem: a missing offset is treated as zero', () => {
  const c = ws.wsCloneItem({ id: 'a', x: 5, y: 6 }, undefined, undefined, 'b');
  assert.deepEqual([c.x, c.y], [5, 6]);
});

test('copy, paste and duplicate are wired to the keyboard and to wsLayoutDo', () => {
  assert.match(SOURCE, /\(e\.key === 'c' \|\| e\.key === 'C'\)\) \{ wsLayoutDo\('copy'\)/);
  assert.match(SOURCE, /\(e\.key === 'v' \|\| e\.key === 'V'\)\) \{ wsLayoutDo\('paste'\)/);
  assert.match(SOURCE, /\(e\.key === 'd' \|\| e\.key === 'D'\)\) \{ wsLayoutDo\('duplicate'\)/);
  // ...and they must be tested BEFORE the blanket "don't hijack Ctrl" bail-out
  const kd = SOURCE.slice(SOURCE.indexOf("wsLayoutDo('copy')"));
  assert.ok(kd.indexOf("if (e.ctrlKey || e.metaKey) return;") > 0, 'the Ctrl bail-out must come after');
  // cut and grouping share the shortcut block
  assert.match(SOURCE, /\(e\.key === 'x' \|\| e\.key === 'X'\)\) \{ wsLayoutDo\('cut'\)/);
  assert.match(SOURCE, /\(e\.key === 'g' \|\| e\.key === 'G'\)\) \{ wsLayoutDo\(e\.shiftKey \? 'ungroup' : 'group'\)/);
  // copy acts on the SELECTION SET, which spans bins, equipment and chutes
  const doFn = SOURCE.slice(SOURCE.indexOf("} else if (a === 'copy'"), SOURCE.indexOf("  } else if (a === 'group'"));
  assert.match(doFn, /const rows = wsSelected\(slot\);/, 'copy must read the selection set');
  assert.doesNotMatch(doFn, /slot\.rooms/, 'rooms are drawn, not copied');
});

// ── grouping and marquee (pure) ─────────────────────────────────────────
const gi = (id, x, y, extra = {}) => ({ id, x, y, w: 1, d: 1, ...extra });

test('wsExpandGroups: selecting one member selects the whole group', () => {
  const items = [gi('a', 0, 0, { groupId: 'g1' }), gi('b', 1, 1, { groupId: 'g1' }),
                 gi('c', 2, 2), gi('d', 3, 3, { groupId: 'g2' })];
  assert.deepEqual(ws.wsExpandGroups(items, ['a']), ['a', 'b'], 'the whole group comes along');
  assert.deepEqual(ws.wsExpandGroups(items, ['c']), ['c'], 'an ungrouped item stays alone');
  assert.deepEqual(ws.wsExpandGroups(items, ['a', 'd']), ['a', 'b', 'd'], 'two groups both expand');
  assert.deepEqual(ws.wsExpandGroups(items, []), []);
  assert.deepEqual(ws.wsExpandGroups(null, ['a']), []);
});

test('wsExpandGroups: the result is unique and in item order', () => {
  const items = [gi('a', 0, 0, { groupId: 'g' }), gi('b', 1, 1, { groupId: 'g' })];
  const out = ws.wsExpandGroups(items, ['b', 'a', 'b']);
  assert.deepEqual(out, ['a', 'b'], 'no duplicates, source order');
});

test('wsGroupItems: needs two or more, and stamps one shared id', () => {
  const items = [gi('a', 0, 0), gi('b', 1, 1), gi('c', 2, 2)];
  assert.equal(ws.wsGroupItems(items, ['a']), null, 'one item is not a group');
  assert.equal(ws.wsGroupItems(items, []), null);
  const gid = ws.wsGroupItems(items, ['a', 'b']);
  assert.ok(gid, 'a group id is returned');
  assert.equal(items[0].groupId, gid);
  assert.equal(items[1].groupId, gid);
  assert.equal(items[2].groupId, undefined, 'an unselected item is untouched');
});

test('wsGroupItems: regrouping moves members to the new group', () => {
  const items = [gi('a', 0, 0, { groupId: 'old' }), gi('b', 1, 1, { groupId: 'old' }), gi('c', 2, 2)];
  const gid = ws.wsGroupItems(items, ['b', 'c']);
  assert.equal(items[1].groupId, gid);
  assert.equal(items[2].groupId, gid);
  assert.equal(items[0].groupId, 'old', 'the member left behind keeps the old group');
  assert.notEqual(gid, 'old');
});

test('wsUngroupItems: removes the tag and reports how many', () => {
  const items = [gi('a', 0, 0, { groupId: 'g' }), gi('b', 1, 1, { groupId: 'g' }), gi('c', 2, 2)];
  assert.equal(ws.wsUngroupItems(items, ['a', 'b', 'c']), 2, 'only grouped items count');
  assert.equal('groupId' in items[0], false);
  assert.equal(ws.wsUngroupItems(items, ['a']), 0, 'idempotent');
});

test('wsMarqueeRect: normalises a drag in any direction', () => {
  const want = { x1: 10, y1: 20, x2: 50, y2: 60 };
  assert.deepEqual(ws.wsMarqueeRect({ x: 10, y: 20 }, { x: 50, y: 60 }), want);
  assert.deepEqual(ws.wsMarqueeRect({ x: 50, y: 60 }, { x: 10, y: 20 }), want, 'dragged up-left');
  assert.deepEqual(ws.wsMarqueeRect({ x: 50, y: 20 }, { x: 10, y: 60 }), want);
});

test('wsMarqueeHits: catches anything the band overlaps, by footprint', () => {
  const rows = [
    { item: gi('inside', 50, 50, { w: 1, d: 1 }) },
    { item: gi('outside', 500, 500, { w: 1, d: 1 }) },
    { item: gi('edge', 105, 50, { w: 1, d: 1 }) },   // centre outside, footprint overlaps
  ];
  const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };
  const hits = ws.wsMarqueeHits(rows, rect, 0.05);   // 1 m at 0.05 m/px = 10 px half-width
  assert.ok(hits.includes('inside'));
  assert.ok(hits.includes('edge'), 'a half-caught item must select — it is visibly in the band');
  assert.ok(!hits.includes('outside'));
});

test('wsMarqueeHits: a zero-size item still has a grabbable footprint', () => {
  const rows = [{ item: { id: 'dot', x: 50, y: 50 } }];
  assert.deepEqual(ws.wsMarqueeHits(rows, { x1: 0, y1: 0, x2: 100, y2: 100 }, 0.05), ['dot']);
  assert.deepEqual(ws.wsMarqueeHits(rows, { x1: 200, y1: 200, x2: 300, y2: 300 }, 0.05), []);
  assert.deepEqual(ws.wsMarqueeHits(null, { x1: 0, y1: 0, x2: 1, y2: 1 }, 0.05), []);
});

test('wsMarqueeHits: honours a caller-supplied size (bins carry theirs on the type)', () => {
  const rows = [{ item: gi('bin', 120, 50), kind: 'bins' }];
  const rect = { x1: 0, y1: 0, x2: 100, y2: 100 };
  assert.deepEqual(ws.wsMarqueeHits(rows, rect, 0.05, () => ({ w: 0.2, d: 0.2 })), [], 'small bin misses');
  assert.deepEqual(ws.wsMarqueeHits(rows, rect, 0.05, () => ({ w: 3, d: 3 })), ['bin'], 'large bin overlaps');
});

test('the black selection pill is gone from the markup', () => {
  assert.equal(SOURCE.includes('id="ws-sel-pill"'), false, 'the floating pill must be removed');
  assert.equal(SOURCE.includes('ws-pill-rotate'), false);
  assert.equal(SOURCE.includes('ws-pill-del'), false);
  // the ROOM pill is a side panel and stays
  assert.ok(SOURCE.includes('id="ws-room-pill"'));
});

test('the canvas shows a select arrow, and pans only on middle-drag or space', () => {
  assert.match(SOURCE, /\.ws-canvas-area\{[^}]*cursor:default;\}/, 'default cursor must be the arrow');
  assert.match(SOURCE, /\.ws-canvas-area\.ws-panning\{cursor:grabbing;\}/);
  assert.equal(/\.ws-canvas-area\{[^}]*cursor:grab;\}/.test(SOURCE), false, 'the always-on hand is gone');
  assert.match(SOURCE, /const panBtn = e\.button === 1 \|\| WS_SPACE_PAN/, 'left-drag must not pan');
});

test('a left-drag on empty canvas starts a marquee, not a pan', () => {
  const bind = SOURCE.slice(SOURCE.indexOf('function wsLayoutBind'), SOURCE.indexOf("area.addEventListener('mousemove'"));
  assert.match(bind, /kind: 'marquee'/);
  assert.match(bind, /!WS_SPACE_PAN && e\.button !== 1/, 'space or middle-button must fall through to pan');
  assert.match(bind, /if \(!e\.shiftKey\) wsSelSet\(\[\]\);/, 'a plain drag replaces the selection, shift extends');
});

// ── marquee inside rooms, and shift-click ───────────────────────────────
test('a marquee can be drawn INSIDE a room', () => {
  // The old rule bailed on wsRoomAt(), so rubber-band select was impossible over
  // room floor — which is where most of the plan is. Dragging a room now
  // requires it to be selected first; otherwise the drag marquee-selects.
  const bind = SOURCE.slice(SOURCE.indexOf('function wsLayoutBind'), SOURCE.indexOf("area.addEventListener('mousemove'"));
  assert.match(bind, /!\(roomUnder && wsSelHas\(roomUnder\.id\)\)/,
    'only an already-selected room should swallow the drag');
  assert.doesNotMatch(bind, /e\.button !== 1 && !wsRoomAt\(p\.x, p\.y\)\)/,
    'the blanket "not inside a room" bail-out must be gone');
  // and the room grab reuses the same lookup rather than testing again
  assert.match(bind, /const room = roomUnder;/);
});

test('a marquee that never moved leaves the selection to the click handler', () => {
  const bind = SOURCE.slice(SOURCE.indexOf('const endDrag = ()'), SOURCE.indexOf("area.addEventListener('mouseup'"));
  assert.match(bind, /if \(!dg\.moved\) \{[\s\S]{0,120}return;/,
    'a plain click must fall through to wsLayoutSelectAt, not clear the selection');
});

test('click selection honours the selection set and shift', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function wsLayoutSelectAt'), SOURCE.indexOf('function wsLayoutEvt'));
  assert.match(fn, /function wsLayoutSelectAt\(x, y, additive\)/, 'the click handler needs the shift flag');
  assert.match(fn, /const pick = \(id, kind\) =>/);
  assert.match(fn, /wsExpandGroups\(all, \[id\]\)/, 'clicking a grouped item takes the group');
  assert.match(fn, /cur\.indexOf\(id\) >= 0 \? cur\.filter/, 'shift-clicking a selected item deselects it');
  // the old single-item assignments are gone from every branch
  assert.doesNotMatch(fn, /WS_LAYOUT\.sel = hit\.id; WS_LAYOUT\.selKind = 'bin';/);
  assert.doesNotMatch(fn, /WS_LAYOUT\.sel = eq\.id; WS_LAYOUT\.selKind = 'equip';/);
  assert.doesNotMatch(fn, /WS_LAYOUT\.sel = ch\.chute\.id;/);
  // shift over bare room floor must not wipe a multi-item selection
  assert.match(fn, /if \(additive\) return;/);
  assert.match(SOURCE, /wsLayoutSelectAt\(x, y, e\.shiftKey\);/, 'the router must pass shift through');
});

// ── removing a room corner ──────────────────────────────────────────────
test('wsRoomNearestVertex: finds the corner under a point, within radius', () => {
  const r = { id: 'A', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  assert.equal(ws.wsRoomNearestVertex(r, 3, 3, 14), 0);
  assert.equal(ws.wsRoomNearestVertex(r, 98, 102, 14), 2);
  assert.equal(ws.wsRoomNearestVertex(r, 50, 50, 14), -1, 'the middle is not a corner');
  assert.equal(ws.wsRoomNearestVertex(r, 20, 0, 14), -1, 'outside the radius');
});

test('wsRoomNearestVertex: picks the CLOSEST when two are in range', () => {
  const r = { id: 'A', pts: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 40 }] };
  assert.equal(ws.wsRoomNearestVertex(r, 4, 0, 14), 0, '4 px from corner 0, 6 from corner 1');
  assert.equal(ws.wsRoomNearestVertex(r, 7, 0, 14), 1);
});

test('wsRoomNearestVertex: the radius is a parameter, so it can track zoom', () => {
  const r = { id: 'A', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
  assert.equal(ws.wsRoomNearestVertex(r, 18, 0, 14), -1, 'too far at a small radius');
  assert.equal(ws.wsRoomNearestVertex(r, 18, 0, 25), 0, 'caught once the radius grows');
  assert.equal(ws.wsRoomNearestVertex(r, 3, 3, undefined), 0, 'defaults to something usable');
});

test('a corner can be removed without the keyboard, and every route shares one helper', () => {
  // Alt+click alone was not enough: Windows and Chrome both claim Alt, so it
  // never reached the page. Right-click is modifier-free and is the standard
  // gesture for removing a vertex in map and CAD editors.
  const bind = SOURCE.slice(SOURCE.indexOf('function wsLayoutBind'), SOURCE.indexOf("area.addEventListener('mousemove'"));
  assert.ok(bind.includes("area.addEventListener('contextmenu'"), 'right-click must be handled');
  assert.ok(bind.includes('if (!hit) return;'), 'the browser menu must survive off a corner');
  assert.ok(bind.includes('e.altKey || e.button === 2'), 'Alt still works where it survives');
  const calls = SOURCE.split('wsRoomRemoveCornerAt(').length - 1;
  assert.ok(calls >= 3, 'each route should call the shared helper, found ' + calls);
  assert.ok(SOURCE.includes('const bi = wsRoomNearestVertex(room, hv.x, hv.y, wsHandleHitR());'));
  assert.equal(SOURCE.includes('let bi = -1, bd = 14;'), false, 'the fixed 14 px radius is gone');
  assert.ok(SOURCE.includes('right-click a corner removes it'), 'the working gesture must be advertised');
});

test('wsRoomRemovableCorner: encodes the removal rules, purely', () => {
  const quad = { id: 'Q', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }] };
  assert.equal(ws.wsRoomRemovableCorner(quad, 98, 3, 14), 1, 'the corner under the point');
  assert.equal(ws.wsRoomRemovableCorner(quad, 500, 500, 14), -1, 'a miss');
  // -2 is the floor, kept distinct from a miss so the caller can explain it
  const tri = { id: 'T', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
  assert.equal(ws.wsRoomRemovableCorner(tri, 0, 0, 14), -2, 'a triangle is the floor');
  const locked = { id: 'L', locked: true, pts: quad.pts.slice() };
  assert.equal(ws.wsRoomRemovableCorner(locked, 0, 0, 14), -1, 'a locked room is not editable');
  assert.equal(ws.wsRoomRemovableCorner(null, 0, 0, 14), -1);
});

test('wsRoomRemovableCorner: the floor is checked before the hit test', () => {
  // Otherwise clicking nowhere near a triangle would report a miss and the user
  // would never learn why the corner will not go.
  const tri = { id: 'T', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }] };
  assert.equal(ws.wsRoomRemovableCorner(tri, 9999, 9999, 14), -2);
});

test('the shared helper reports the floor rather than failing silently', () => {
  assert.ok(SOURCE.includes("if (vi === -2) { wsLayoutStatus('A room needs at least three corners.'); return false; }"),
    'the floor must be explained to the user');
});
