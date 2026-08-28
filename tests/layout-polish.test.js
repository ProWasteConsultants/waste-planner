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

test('a drawn library shape beats the plain circle on the plan', () => {
  // The circle branch is a fallback: a hand-drawn drain or bollard must render
  // its drawn outline on plan, thumbnail and DXF alike (the DXF block writer
  // already prefers shp.outline over the round flag).
  assert.ok(SOURCE.includes("if (e.round && !(eshp && eshp.source === 'drawn'))"),
    'the round branch must yield to a drawn shape');
});

// ── door palette thumbnails ─────────────────────────────────────────────
test('door palette thumbnails are the plan door symbol, not the squashed profile', () => {
  assert.ok(SOURCE.includes('f.door ? wsDoorThumb(f.door, f.w, f.d,'),
    'door fixtures must route to wsDoorThumb');
  const svg = ws.wsDoorThumb('SINGLE', 0.92, 0.10, '#B0BEC5', 26);
  assert.match(svg, /<path d="M[\d.-]+,[\d.-]+ A/, 'the swing arc is drawn');
  assert.ok((svg.match(/<line /g) || []).length >= 3, 'both jambs and the open leaf are drawn');
  const dbl = ws.wsDoorThumb('DOUBLE', 1.84, 0.10, '#B0BEC5', 26);
  assert.equal((dbl.match(/ A[\d.]+,/g) || []).length, 2, 'a double door swings two arcs');
  const roller = ws.wsDoorThumb('ROLLER', 2.4, 0.15, '#B0BEC5', 26);
  assert.match(roller, /<polygon /, 'roller panel sits in the wall');
  assert.match(roller, /stroke-dasharray="2 2"/, 'dashed curtain line');
  assert.ok(!/ A[\d.]+,/.test(roller), 'a roller door has no swing arc');
  // the symbol must fit its box — the swing arc is the part the old profile lost
  for (const sv of [svg, dbl, roller]) {
    const nums = [...sv.matchAll(/(?:x1|y1|x2|y2)="(-?[\d.]+)"/g)].map(m => +m[1]);
    nums.forEach(v => assert.ok(v >= -0.5 && v <= 26.5, 'coordinate inside the box: ' + v));
  }
});

// ── unit-box path parsing (shared by SVG, DXF and palette thumbnails) ───
test('wsPathPolys: Z followed by M starts a clean subpath', () => {
  // The baler detail shape: a closed chamber plus a separate ejection line.
  // Z is consumed at the top of the parse loop — a second advance here used to
  // eat the following M and draw a stray diagonal through the shape.
  const polys = ws.wsPathPolys('M0.10,0.10 L0.90,0.10 L0.90,0.62 L0.10,0.62 Z M0.10,0.78 L0.90,0.78');
  assert.equal(polys.length, 2);
  assert.equal(polys[0].length, 5, 'the closed subpath ends back at its start');
  assert.deepEqual(polys[0][4], { x: 0.10, y: 0.10 });
  assert.deepEqual(polys[1], [{ x: 0.10, y: 0.78 }, { x: 0.90, y: 0.78 }],
    'the second subpath must not inherit the closed one\'s start point');
});

test('wsShapePolys: normalises the unit box to the real footprint, centred', () => {
  const polys = ws.wsShapePolys('M0,0 L1,0 L1,1 L0,1 Z', 2.0, 1.0, 0.05); // 2m × 1m at 20 px/m
  assert.equal(polys.length, 1);
  const xs = polys[0].map(p => p.x), ys = polys[0].map(p => p.y);
  assert.equal(Math.max(...xs), 20); assert.equal(Math.min(...xs), -20);
  assert.equal(Math.max(...ys), 10); assert.equal(Math.min(...ys), -10);
});

// ── wiring guards ───────────────────────────────────────────────────────
test('the tool panel has preset widths per tab, not a drag handle', () => {
  assert.ok(!SOURCE.includes('wsStartResize'), 'free drag-resize is removed');
  assert.ok(!SOURCE.includes('ws-resize-handle'), 'the resize handle element is gone');
  assert.match(SOURCE, /function wsPanelWidthFor\(tab\)/, 'widths are predefined per tab');
  assert.ok(SOURCE.includes("if (tab === 'calculator') return Math.min("),
    'the bin calculator runs wide');
  assert.ok(SOURCE.includes('return 348;   // layout + swept: one room-card-wide column'),
    'layout and swept paths get the single-column width');
  assert.ok(!SOURCE.includes('wsPanelMaxToggle'), 'the Max control is gone — collapse is the only panel verb');
  assert.ok(SOURCE.includes("window.addEventListener('resize', wsPanelApplyWidth);"),
    'the window-relative widths re-derive on resize');
});

test('the tool tabs run vertically in a side rail and fill its height', () => {
  assert.ok(SOURCE.includes('.ws-tool-tab{flex:1 1 0;'),
    'each tab stretches to share the full rail height');
  assert.ok(SOURCE.includes('writing-mode:vertical-rl;padding:13px 0;'),
    'tab labels are vertical');
  assert.ok(SOURCE.includes('.ws-tool-tabs{display:flex;flex-direction:column'),
    'the rail stacks tabs vertically');
  assert.ok(SOURCE.includes('.ws-tool-panel{width:500px;flex-shrink:0;background:#1a1a1a;border-left:1px solid #333;display:flex;flex-direction:row-reverse'),
    'row-reverse pins the tab strip to the far right; the body pops out to its LEFT');
  assert.ok(SOURCE.includes('.ws-tool-tabs{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:44px;flex-shrink:0;border-left:1px solid #333;'),
    'the rail borders face the body on its left');
  assert.ok(SOURCE.includes('.ws-tool-tab.active{background:#167E7E;color:#fff;border-left:2px solid #167E7E;}'),
    'the selected tab is solid teal with white text');
});

test('Actions/Layers/Markups/Set Scale are strip tabs with independent flyouts', () => {
  for (const n of ['actions', 'layers', 'markups', 'scale'])
    assert.ok(SOURCE.includes(`id="ws-strip-${n}"`), n + ' tab exists in the tool strip');
  const fly = SOURCE.slice(SOURCE.indexOf('id="ws-fly-actions"'), SOURCE.indexOf('id="ws-fly-layers"'));
  assert.ok(fly.includes("wsLayoutDo('undo')") && fly.includes("wsLayoutDo('redo')") &&
            fly.includes('id="ws-layout-clr"') && fly.includes('wsLayoutClearPage()'),
    'Actions flyout = Undo / Redo / spacing / Clear');
  assert.ok(!fly.includes('Generate layout'), 'Generate lives ONLY in the Bin Rooms header');
  assert.ok(!SOURCE.includes('ws-gen-btn'), 'the old full-page Generate button is gone');
  assert.equal(SOURCE.split('id="ws-layout-clr"').length, 2, 'the spacing toggle has one home');
  assert.ok(SOURCE.includes('position:absolute;left:45px;'),
    'flyouts overlay the canvas — opening or closing never moves the plan');
  // the Layers/Markups cards and scale controls MOVE (same ids) into flyouts
  for (const pair of [["'ws-layer-panel', 'ws-fly-layers'"], ["'ws-markup-panel', 'ws-fly-markups'"], ["'ws-scale-wrap', 'ws-scale-slot'"]])
    assert.ok(SOURCE.includes('mv(' + pair[0] + ')'), pair[0] + ' docked into its flyout');
  assert.ok(SOURCE.includes('_wsPillDragMoved'), 'remaining pills still drag-suppress clicks');
});

// ── design-canvas UI patch (Lachy, 25 Aug) ──────────────────────────────
test('the screens nav is a thin LHS rail with vertical labels; NO top header bar', () => {
  const nav = SOURCE.slice(SOURCE.indexOf('<div class="side-nav" id="side-nav">'), SOURCE.indexOf('<!-- MAIN CONTENT'));
  assert.ok(nav.length > 0, 'the rail exists before the content column');
  for (const id of ['nav-workspace', 'nav-compliance', 'nav-costcheck', 'nav-orgqueue', 'nav-wmp-queue', 'nav-admin'])
    assert.ok(nav.includes(`id="${id}"`), id + ' lives in the rail');
  assert.ok(SOURCE.includes('.side-nav{\n  width:52px;'), 'widened for legible labels and a larger mark');
  assert.ok(SOURCE.includes('.side-nav .nav-item{\n  writing-mode:vertical-rl;'), 'vertical labels, same style');
  assert.ok(nav.includes('class="rail-account"') && nav.includes('id="user-avatar-initials"'),
    'the account chip is pinned in the rail');
  assert.ok(SOURCE.includes('.rail-account{margin-top:auto;'), 'pinned at the BOTTOM of the rail');
  assert.ok(SOURCE.includes('.side-nav .nav-item.active{background:#167E7E;color:#fff;') &&
            SOURCE.includes('.ws-strip-tab.active{background:#167E7E;color:#fff;'),
    'selected tabs on both LHS rails are solid teal with white text');
  assert.ok(SOURCE.includes('.rail-account:hover .rail-account-info{display:block;}'),
    'name and role appear on hover');
  assert.ok(!SOURCE.includes('<div class="topbar">'), 'no top header bar exists at all');
  const chip = SOURCE.slice(SOURCE.indexOf('<div class="ws-top-chip" id="ws-top-chip">'), SOURCE.indexOf('<!-- PROJECTS SCREEN -->'));
  assert.ok(chip.includes('id="breadcrumb"') && chip.includes('id="ws-pill-council"'),
    'the pill = project name + read-only council');
  assert.ok(!chip.includes('org-switcher'), 'the ORGANISATION is never in the project pill');
  assert.ok(SOURCE.includes('function wsTopChipToggle()'), 'the chip collapses out of the way');
  assert.match(SOURCE, /\.ws-top-chip\{[^}]*--text:#fff;--muted:#D7E2E2;color:#fff;/s,
    'the chip carries its own dark-theme tokens — the page :root is the light theme');
  assert.ok(SOURCE.includes('.ws-embed .side-nav{display:none!important}'), 'embed mode hides the rail too');
});

// ── design-canvas UI patch 3 (Lachy, 25 Aug) ────────────────────────────
test('rail tabs distribute over the full height and labels are legible', () => {
  assert.ok(SOURCE.includes('.side-nav .nav-item{\n  writing-mode:vertical-rl;padding:12px 0;border-radius:0;\n  flex:1 1 0;'),
    'nav tabs stretch to share the rail height');
  assert.match(SOURCE, /\.side-nav \.nav-item\{[^}]*font-size:13px/s, 'rail text enlarged for legibility');
  assert.ok(SOURCE.includes('.ws-strip-tab{\n  flex:1 1 0;min-height:0;'),
    'tool-strip tabs distribute too');
  const brand = SOURCE.slice(SOURCE.indexOf('id="topbar-brand"'), SOURCE.indexOf('id="nav-tools"'));
  assert.ok(brand.includes('src="favicon.svg"'), 'the rail-top monogram IS the favicon asset');
  assert.ok(brand.includes('title="WastePlanner"'), 'full name on hover');
});

test('tool strip flyouts open independently, each at its own tab height', () => {
  assert.equal((SOURCE.match(/<div class="ws-flyout" id="ws-fly-/g) || []).length, 4,
    'each tab owns its own flyout element');
  assert.ok(!SOURCE.includes('_wsStripOpen'), 'no shared one-at-a-time state — the four toggle independently');
  assert.ok(SOURCE.includes("const open = fly.style.display === 'none';"),
    'a click toggles just that flyout');
  assert.ok(SOURCE.includes('Math.min(tab.offsetTop, h - fly.offsetHeight - 8)'),
    "the flyout opens at its tab's height, clamped to the shell");
  assert.match(SOURCE, /\.ws-flyout\{[^}]*font-size:12px/s, 'flyout text enlarged for legibility');
  assert.match(SOURCE, /\.ws-flyout\{[^}]*width:290px/s, 'flyout panels widened');
});

test('project pill: council is a read-only project setting; organisation lives on the account chip', () => {
  const acct = SOURCE.slice(SOURCE.indexOf('<div class="rail-account"'), SOURCE.indexOf('<!-- MAIN CONTENT'));
  assert.ok(acct.includes('id="org-switcher"'), 'the org switcher moved to the account chip');
  assert.ok(SOURCE.includes('function wsUpdateProjectPill()'), 'pill follows the working project');
  assert.ok(SOURCE.includes('function wsPillCouncilOpen()') && SOURCE.includes('openProjectDetail(id)'),
    'clicking the council text opens project settings — it is never a chrome dropdown');
  assert.ok(SOURCE.includes("p && p.council"), 'the council comes from the PROJECT record');
});

test('zoom floor = fit; fullscreen keeps the layout and recalculates the floor', () => {
  assert.ok(SOURCE.includes('function wsFitScale()'), 'fit is derived once, from the available canvas');
  assert.ok(SOURCE.includes('WS.fitScale = fit;'), 'the fitted zoom is remembered as the floor');
  assert.equal((SOURCE.match(/Math\.max\(WS\.fitScale \|\| 0\.1, Math\.min\(5,/g) || []).length, 2,
    'both zoom paths (buttons + wheel) clamp at the floor');
  assert.ok(SOURCE.includes('function wsZoomFloorRecalc()'), 'the floor re-derives when the canvas changes');
  assert.ok(SOURCE.includes("window.addEventListener('resize', wsZoomFloorRecalc);"), 'on resize');
  assert.ok(SOURCE.includes("document.addEventListener('fullscreenchange'"), 'and on fullscreen toggle');
  assert.ok(SOURCE.includes('function wsFullscreenToggle()') &&
            SOURCE.includes('document.documentElement.requestFullscreen()'),
    'fullscreen = the whole app (rails and panels included), not a bare canvas');
  assert.ok(SOURCE.includes('id="ws-fs-btn"'), 'the fullscreen button exists and is wired');
});

test('panel changes never move the plan: fit is rail-to-tab, the expanded body just overlays', () => {
  assert.ok(SOURCE.includes('area.clientWidth - 46 - 24'),
    'fit is computed against rail-to-tab space — the minimised strip, never the expanded body');
  const setw = SOURCE.slice(SOURCE.indexOf('function wsPanelSetW'), SOURCE.indexOf('function wsPanelWidthFor'));
  assert.ok(!setw.includes('WS.panX') && !setw.includes('wsFitPage') && !setw.includes('WS.scale'),
    'panel width changes touch NO view state — the body overlays the sheet');
  assert.ok(!SOURCE.includes('wsPanelOccupies'), 'the panel-tracking fit is gone');
});

test('bin calculator: white headings, collapsed advisory notes, narrower panel', () => {
  assert.match(SOURCE, /\.ws-vol-title\{[^}]*color:#fff/s, 'DEV SUMMARY / DWELLING MIX headings are white');
  assert.match(SOURCE, /\.wsr-title\{font-size:12px;font-weight:700;color:#fff;/, 'RESIDENTIAL / ADDITIONAL STORAGE headings are white and larger');
  assert.ok(SOURCE.includes('id=&quot;notesToggle&quot;'), 'advisory notes sit behind a one-line toggle');
  assert.ok(SOURCE.includes('&lt;ul id=&quot;notesList&quot; style=&quot;display:none;&quot;&gt;'),
    'the bullet list starts collapsed');
  assert.ok(SOURCE.includes("ul.style.display='none';"), 'and re-collapses on every recalculation');
  assert.ok(SOURCE.includes("if (tab === 'calculator') return Math.min(Math.round(shellW * 0.55), 920);"),
    'the calculator panel is narrower — the table no longer sprawls');
  // round 2: larger type throughout, and a per-room footprint strip
  assert.ok(SOURCE.includes('.wsr-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13.5px;}'),
    'result table type is 13.5px — height is abundant, use it');
  // direction (a): stream rows read as colour-edged cards, numbers right-aligned
  assert.ok(SOURCE.includes('class=&quot;wsr-srow&quot;'), 'stream rows carry the card class');
  for (const pair of [['GW','#b91c1c'],['REC','#f5b400'],['ORG','#22c55e'],['GLS','#8b5cf6'],['CARD','#2563eb'],['SOFT','#06b6d4']])
    assert.ok(SOURCE.includes(`tr[data-stream=${pair[0]}]&gt;td:first-child{border-left-color:${pair[1]};}`),
      pair[0] + ' row wears its stream colour on the leading edge');
  assert.ok(SOURCE.includes('text-align:right;font-variant-numeric:tabular-nums;'),
    'numeric columns right-align in tabular figures');
  assert.ok(SOURCE.includes('function unitHtml(v)'), 'units render small and quiet next to the value');
  assert.ok(SOURCE.includes('class=&quot;wsr-roomtotal&quot; id=&quot;roomfp_${rr.id}&quot;'),
    'every room block carries a footprint strip');
  assert.ok(SOURCE.includes('if(allowOn(room,id))aF+=Number(allowanceArea(room,id,prof).m2)||0;'),
    'room footprint = bin footprints + enabled additional-storage areas');
  assert.ok(SOURCE.includes('Total room footprint'), 'and says so in plain words');
});

test('swept panel is sectioned with a live vehicle diagram', () => {
  const tab = SOURCE.slice(SOURCE.indexOf('id="ws-tab-swept"'), SOURCE.indexOf('<div class="screen fill" id="screen-calculator">'));
  for (const hd of ['>Vehicle<', '>Path<', '>Options<', '>Output<'])
    assert.ok(tab.includes(hd), hd + ' section exists — no more one flat button row');
  assert.ok(tab.includes('id="ws-veh-diagram"'), 'the selected vehicle renders as a diagram');
  assert.ok(tab.includes('onchange="wsSweptVehDiagram()"'), 'the diagram follows the selection');
  assert.ok(SOURCE.includes('function wsSweptVehDiagram()'), 'renderer exists');
  const fn = SOURCE.slice(SOURCE.indexOf('function wsSweptVehDiagram()'), SOURCE.indexOf('function wsSweptPopulateVehicles'));
  assert.ok(fn.includes('const L = (v.fo || 0) + (v.wb || 0) + (v.ro || 0);'),
    'drawn from the record\'s true dimensions — the same numbers the kinematics use');
  assert.ok(fn.includes("(v.rww * 2).toFixed(1) + ' m w2w'"),
    'turn diameter states wall-to-wall when present (it governs), kerb-to-kerb otherwise');
  // every path/option/output control keeps its id and handler
  for (const c of ['wsSweptDriveStart()', 'wsAutoPathStart()', 'wsSweptGenerate()', 'wsUndoLastNode()', 'wsClearSweptPath()',
                   'id="ws-swept-gear"', 'id="ws-swept-clr"', 'id="ws-swept-smooth"', 'id="ws-swept-lock"',
                   'wsCalibrationCircle()', 'id="ws-swept-dxf"', 'id="ws-swept-status"', 'id="ws-swept-metrics"'])
    assert.ok(tab.includes(c), c + ' survives the restructure');
});

test('status pill is the one status home; Design uploads plans and runs AI extract', () => {
  const tab = SOURCE.slice(SOURCE.indexOf('id="ws-tab-layout"'), SOURCE.indexOf('id="ws-tab-swept"'));
  assert.ok(!tab.includes('id="ws-layout-status"'), 'no status line at the panel foot beneath Zones');
  assert.ok(SOURCE.includes('id="ws-float-status-txt"') && SOURCE.includes('<span id="ws-layout-stats" class="wsl-stats" style="display:block;margin-left:0;"></span>'),
    'the pill carries instructions AND the live stats line');
  const fx = SOURCE.slice(SOURCE.indexOf('function wsFloatStatus'), SOURCE.indexOf('function wsLayoutAutosave'));
  assert.ok(!fx.includes('_wsPanelCollapsed'), 'the pill shows regardless of the panel state');
  assert.ok(SOURCE.includes('.wsl-cta-teal{background:#00A5A5;'), 'Generate layout is bright teal');
  assert.ok(SOURCE.includes('id="ws-plan-file"') && SOURCE.includes('onchange="wsLoadPdfFile(this.files[0]);'),
    'plans upload straight from Design (attaching to the project, or starting a draft)');
  assert.ok(SOURCE.includes("if (e.data && e.data.type === 'ws-ai-extract') wsRunAiExtract();") &&
            SOURCE.includes('function wsRunAiExtract()'),
    'the calculator Dev Summary triggers AI extraction against the open plan');
  assert.ok(SOURCE.includes("parent.postMessage({type:'ws-ai-extract'},'*')"),
    'via a button in the Dev Summary pane');
  // extraction feedback must land IN the pane: the canvas pill sits under the
  // expanded panel, which made a silent success/failure look like a dead button
  assert.ok(SOURCE.includes('function wsCalcExtractSay(text, busy)'), 'one reporter for every stage');
  assert.ok(SOURCE.includes("f.contentWindow.postMessage({ type: 'ws-ai-extract-status', text, busy: !!busy }, '*')"),
    'stages post back into the calculator iframes');
  assert.ok(SOURCE.includes('id=&quot;aiExtractMsg&quot;'), 'the pane has a status line under the button');
  assert.ok(SOURCE.includes("e.data.type === 'ws-ai-extract-status'"), 'and the calc bridge renders it');
  const fn2 = SOURCE.slice(SOURCE.indexOf('async function wsRunAiExtract()'), SOURCE.indexOf('function wsPushSummaryToCalc'));
  assert.ok(!/wsFloatStatus\(/.test(fn2.replace(/wsCalcExtractSay/g, '')),
    'every wsRunAiExtract message goes through the pane reporter');
  assert.ok(!SOURCE.includes('<div class="dc-title">Project Tools</div>'),
    'the Project Tools card is gone from the project page');
});

test('Cost Check is off the nav until it ships; the queue tabs carry pending badges', () => {
  assert.match(SOURCE, /id="nav-costcheck" style="display:none;"/, 'Cost Check hidden until the feature ships');
  const list = SOURCE.slice(SOURCE.indexOf("['nav-tools', 'nav-upload'"), SOURCE.indexOf("'btn-new-project-empty']"));
  assert.ok(!list.includes('nav-costcheck'),
    'and OUT of the council-view toggle, whose un-hide branch would re-reveal it');
  assert.ok(SOURCE.includes('id="orgqueue-badge"') && SOURCE.includes('function updateOrgQueueBadge(n)'),
    'Review Queue pending badge exists and is wired');
  assert.ok(SOURCE.includes('id="wmpqueue-badge"') && SOURCE.includes('function updateWmpQueueBadge(n)'),
    'WMP Queue pending badge exists and is wired');
});

test('the Design tab runs fullscreen as its standing mode', () => {
  const ss = SOURCE.slice(SOURCE.indexOf("function showScreen(name, navEl)"), SOURCE.indexOf('function openNewProject'));
  assert.ok(ss.includes("if (name === 'workspace') {\n    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});"),
    'entering Design requests fullscreen (inside the click gesture)');
  assert.ok(ss.includes('} else if (document.fullscreenElement) {\n    document.exitFullscreen().catch(() => {});'),
    'leaving Design exits fullscreen');
  assert.ok(SOURCE.includes('id="ws-fs-btn"'), 'the ⛶ button re-enters after the browser Esc');
});

test('page filmstrip: real page previews with page numbers along the canvas bottom', () => {
  assert.ok(SOURCE.includes('function wsRenderThumbs()') || SOURCE.includes('async function wsRenderThumbs()'),
    'thumbnails render the actual page images');
  assert.ok(SOURCE.includes("thumbBar.style.display = 'none';"),
    'the filmstrip starts COLLAPSED — the Page pill expands it');
  assert.ok(SOURCE.includes('function wsThumbsToggle(force)'), 'the Page x of y pill toggles it');
  assert.ok(SOURCE.includes('onclick="wsThumbsToggle()"'), 'wired on the page label');
  assert.ok(SOURCE.includes('wsGoToPage(i); wsThumbsToggle(false);'), 'picking a page collapses it');
  assert.ok(SOURCE.includes('wsThumbsToggle(false);   // touching the canvas collapses the filmstrip'),
    'touching the canvas collapses it too');
  assert.match(SOURCE, /\.ws-page-thumb-bar\{[^}]*bottom:44px/s, 'it runs along the canvas bottom');
  assert.match(SOURCE, /\.ws-page-thumb-bar\{[^}]*flex-direction:row/s, 'as a horizontal strip');
  assert.ok(SOURCE.includes("n.className = 'ws-thumb-n'; n.textContent = i;"),
    'every preview is badged with its page number');
  assert.ok(SOURCE.includes('if (WS.pdfDoc !== doc) return;'),
    'a replaced document stops the old render loop');
  assert.ok(SOURCE.includes('Page ${pageNum} of ${WS.totalPages}'), 'the Page x of y label stays');
});

test('Bin Rooms CTA pair: Draw and Generate are twins — one white, one teal, side by side', () => {
  const row = SOURCE.slice(SOURCE.indexOf('<div class="wsl-group-hd">Bin rooms</div>'), SOURCE.indexOf('id="ws-layout-targets"'));
  assert.ok(row.includes('class="wsl-cta wsl-cta-white" onclick="wsLayoutRoomMode()"'),
    'Draw bin room is the white CTA');
  assert.ok(row.includes('class="wsl-cta wsl-cta-teal" id="ws-room-gen-btn"'),
    'Generate layout is the teal CTA');
  assert.ok(SOURCE.includes('.wsl-cta{flex:1 1 0;'), 'both share one size: flex twins in a row');
  assert.ok(!SOURCE.includes('wsl-btn-lead" onclick="wsLayoutRoomMode()"'), 'the old dashed lead button is gone');
  assert.ok(!SOURCE.includes('ws-save-btn') && !SOURCE.includes('wsSaveProject'),
    'the legacy Save button is gone — autosave (wsFlushState debounce) owns persistence');
  assert.ok(SOURCE.includes('setTimeout(wsFlushState, 30000)'), 'the autosave it relies on exists');
});

test('panning is bounded: a fitted axis is locked centred, a zoomed axis stays within the sheet', () => {
  assert.ok(SOURCE.includes('function wsClampPan()'), 'one clamp for every pan/zoom/fit path');
  const fn = SOURCE.slice(SOURCE.indexOf('function wsClampPan()'), SOURCE.indexOf('function wsApplyTransform()'));
  assert.ok(fn.includes('WS.panX = w <= availW ? Math.max(0, (availW - w) / 2)'),
    'sheet fits horizontally -> locked centred, no horizontal pan (the fit-width floor)');
  assert.ok(fn.includes('Math.min(12, Math.max(availW - w - 12, WS.panX))') &&
            fn.includes('Math.min(12, Math.max(availH - h - 12, WS.panY))'),
    'zoomed axes pan only within the sheet edges — never off into dead space');
  const at = SOURCE.slice(SOURCE.indexOf('function wsApplyTransform()'), SOURCE.indexOf('function wsSweptAction'));
  assert.ok(at.includes('wsClampPan();'), 'applied in wsApplyTransform, the single choke point');
});

test('the RHS panel starts minimised to its tab strip; a tab click expands it', () => {
  assert.ok(SOURCE.includes('// DEFAULT ON LOAD: minimised to the tab strip'), 'documented default');
  assert.ok(SOURCE.includes('wsPanelToggle();\n</script>') || /window\.addEventListener\('resize', wsPanelApplyWidth\);[\s\S]{0,200}wsPanelToggle\(\);/.test(SOURCE),
    'the panel is collapsed once at startup');
  assert.ok(!SOURCE.includes('ws-panel-expand'), 'no full-cover expand button — the tabs stay visible when minimised');
  assert.ok(SOURCE.includes("panel.style.width = '45px';"), 'minimised width = the tab strip alone');
  assert.ok(SOURCE.includes('if (_wsPanelCollapsed) wsPanelToggle();   // a tab click expands the minimised panel'),
    'clicking a tool tab expands the panel');
});

test('the tool panel OVERLAYS the plan — panel changes can never resize or shift the PDF', () => {
  assert.ok(SOURCE.includes('position:absolute;right:0;top:0;bottom:0;z-index:14;'),
    'the panel floats over the canvas instead of sharing the flex row');
  // the DEFAULT shows the whole sheet — nothing cropped at rest — and that
  // fit is the zoom-out floor; ⊡ toggles to fit-width for working
  assert.ok(SOURCE.includes('await wsRenderPage(WS.currentPage);\n  wsFitPage();'),
    'default view is the whole sheet on load');
  const fs = SOURCE.slice(SOURCE.indexOf('function wsFitScale()'), SOURCE.indexOf('function wsFitPage()'));
  assert.ok(fs.includes('Math.min(aW / canvas.width, aH / canvas.height, 1)'),
    'the floor is the whole-sheet fit — both dimensions visible');
  assert.ok(SOURCE.includes('function wsFitWidth()') && SOURCE.includes('function wsFitToggle()'),
    'fit-width stays one click away on the fit toggle');
  const fw = SOURCE.slice(SOURCE.indexOf('function wsFitWidth()'), SOURCE.indexOf('function wsFitToggle()'));
  assert.ok(fw.includes('Math.max(fit, Math.min((area.clientWidth - 46 - 24) / canvas.width, 1))'),
    'fit-width never drops below the whole-sheet floor');
});

test('section headings are enlarged teal; room cards are wide, short and minimal', () => {
  assert.ok(SOURCE.includes('.wsl-group-hd{font-size:11.5px;') && SOURCE.includes('color:#00d4d4;margin-bottom:6px'),
    'one heading style for BIN ROOMS / BINS / EQUIPMENT / OBSTACLES & FIXTURES / ZONES');
  assert.ok(SOURCE.includes('class="wsl-card-nm" style="color:#fff;'), 'room names are white');
  assert.ok(SOURCE.includes('.wsl-card:hover .wsl-card-more{display:block;}'),
    'secondary lines (area note, drag hint, extras) reveal on hover');
  assert.ok(SOURCE.includes('flex:1 1 100%;min-width:0;cursor:grab'), 'cards run full panel width');
});

test('equipment and fixture pickers are compact square labelled tiles', () => {
  assert.ok(SOURCE.includes('.wsl-fx.wsl-tile{flex-direction:column'), 'tile layout: thumb above, label below');
  assert.ok(SOURCE.includes(`'#78909C', 36)`) && SOURCE.includes(`'#B0BEC5', 36)`),
    'fixture thumbs at the round-2 size — round 1 overshot');
  assert.ok(SOURCE.includes('wsShapeThumb(code, w, d, round, col, 36)'), 'picker tiles too');
  assert.ok((SOURCE.match(/minmax\(88px,1fr\)/g) || []).length >= 2,
    'tile grids give each tile room — no crowding or icon overlap');
  assert.match(SOURCE, /\.wsl-fx\.wsl-tile\{[^}]*min-height:62px;overflow:hidden;/s,
    'tiles reserve their height and clip — icons can never bleed into a neighbour');
});

test('one BINS & EQUIPMENT picker: searchable, scrollable, select-then-place', () => {
  assert.ok(SOURCE.includes('id="ws-picker-search"'), 'search box at the top of the section');
  assert.ok(SOURCE.includes('id="ws-layout-bin"') && SOURCE.includes('onchange="wsRenderBinThumb();wsPickerSyncSel();" style="display:none;"'),
    'the bins dropdown is HIDDEN — it remains the selection state holder only');
  const fn = SOURCE.slice(SOURCE.indexOf('function wsEquipPaletteMode'), SOURCE.indexOf('function wsPickerStreamVis'));
  assert.ok(!fn.includes('wsLayoutPlaceMode()'), 'a tile click SELECTS — it never arms placement by itself');
  assert.ok(SOURCE.includes('function wsPickerPlace()'), 'Place on plan (or double-click) arms placement');
  assert.ok(SOURCE.includes("ss.style.display = WS_LAYOUT._pickerKind === 'fixture' ? 'none' : '';"),
    'the stream selector shows only for stream-carrying items');
  assert.ok(SOURCE.includes('id="ws-layout-equipment" style="flex:1 1 auto;min-height:40px;'),
    'the picker scrolls internally within its flex share of the panel');
  // patch 3: picker artwork is NEUTRAL — stream colour is for the plan only
  assert.ok(SOURCE.includes("tile(b.id, 'bin', b.code || b.id, b.w, b.d, false, '#90A4AE'"),
    'bin tiles never recolour with the selected stream');
  assert.ok(!SOURCE.includes('stSel.col, b.label'), 'the stream-coloured tile path is gone');
  assert.ok(SOURCE.includes('id="ws-stream-swatch"'),
    'a small swatch beside the stream selector shows the colour the placed object will get');
  assert.ok(SOURCE.includes('sw.style.background = st.col;'), 'the swatch tracks the selected stream');
});

test('RHS section order and no-panel-scroll layout', () => {
  const tab = SOURCE.slice(SOURCE.indexOf('id="ws-tab-layout"'), SOURCE.indexOf('id="ws-tab-swept"'));
  const order = ['Bin rooms', 'Obstacles &amp; fixtures', 'Bins &amp; equipment', 'Zones']
    .map(h => tab.indexOf('>' + h));
  assert.ok(order.every(i => i >= 0), 'all four section headers present');
  for (let i = 1; i < order.length; i++)
    assert.ok(order[i] > order[i - 1], 'order is Bin Rooms → Obstacles → Bins & Equipment → Zones');
  assert.ok(tab.includes('overflow:hidden;padding:6px 10px;'),
    'the panel itself never scrolls — Zones is always reachable');
  assert.ok((tab.match(/wsl-scroll/g) || []).length >= 4, 'sections scroll internally instead');
  // patch 3 regression fix: fixed vh caps could sum past the panel height and
  // clip ZONES off the bottom — sections now share the height by flex weight,
  // which always sums to the space available.
  assert.ok(!/max-height:\d+vh/.test(tab), 'no fixed vh caps anywhere in the layout tab');
  assert.equal((tab.match(/flex:\d+ 1 0;/g) || []).length, 4, 'all four sections carry a flex weight');
  assert.ok((tab.match(/min-height:\d{2,3}px/g) || []).length >= 4,
    'each section reserves room for its header plus a row');
});

test('DXF/PDF exports live in the Layers pill', () => {
  const layers = SOURCE.slice(SOURCE.indexOf('id="ws-layer-panel"'), SOURCE.indexOf('id="ws-markup-panel"'));
  assert.ok(layers.includes('id="ws-export-btn"') && layers.includes('id="ws-exportpdf-btn"'),
    'both export actions sit with the layer controls');
  const rail = SOURCE.slice(SOURCE.indexOf('<div class="ws-tool-tabs">'), SOURCE.indexOf('<div class="ws-tool-body">'));
  assert.ok(!rail.includes('ws-export-btn'), 'and they are gone from the right rail');
});

test('Generate layout (room-scoped): gated, locked-respecting, one undo step, never auto-run', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function wsGenRoomEligible'), SOURCE.indexOf('function wsGenerateLayout()'));
  assert.ok(fn.includes("return { ok: false, why: 'Select a bin room' };"), 'disabled without a selected room');
  assert.ok(fn.includes("return { ok: false, why: 'Room has no items' };"), 'disabled for an empty room');
  assert.ok(fn.includes('slot.bins.some(inRoom) || slot.equip.some(inRoom)'),
    'eligibility counts bins, equipment and fixtures — attributed or manually placed');
  assert.equal((fn.match(/wsLayoutSnapshot\(\)/g) || []).length, 1,
    'exactly one snapshot — one click, one undo step');
  assert.ok(fn.includes('const kept = slot.bins.filter(b => b.locked || !wsPointInPoly(pts, b.x, b.y));'),
    'locked items and everything outside the room are never touched');
  assert.ok(fn.includes("WS_LAYOUT._roomGenBase"), 're-running rotates the seed for a fresh arrangement');
  // never auto-run: the only call site is the button
  assert.equal((SOURCE.match(/wsGenerateRoomLayout\(\)/g) || []).length, 2,
    'one definition-adjacent reference and one button onclick — nothing else runs it');
});

test('every canvas pill is draggable — float bar, zoom controls, room pill included', () => {
  for (const id of ['ws-float-bar', 'ws-zoom-ctrl', 'ws-room-pill'])
    assert.ok(SOURCE.includes(`wsPillDragStart(event,'${id}')`), id + ' is draggable');
  // the room pill is re-anchored by code on every render, so a drag must PIN it
  assert.ok(SOURCE.includes('if (pin && pin.key === WS_LAYOUT.sel)'),
    'a dragged room pill stays where it was put until another room is selected');
  assert.ok(SOURCE.includes("if (moved && id === 'ws-room-pill')"),
    'the pin is stored only when the drag actually moved');
  // pills must never start a canvas pan under their controls
  assert.ok(SOURCE.includes("e.target.closest('#ws-float-bar')) return;"),
    'the pan guard covers the float bar');
});


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
