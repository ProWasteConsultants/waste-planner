'use strict';
// Room editing data operations and reconciliation-chip visibility.
//
// Rooms are editable polygons: drag the interior to move the whole thing (and
// everything tagged to it), drag a corner to reshape, click an edge midpoint to
// add a corner. The pointer plumbing lives in wsLayoutBind and is not covered
// here; these are the pure operations underneath it, plus the pure placement and
// visibility rules for the reconciliation chip.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout, SOURCE, extractBlock } = require('./extract.js');

const ws = loadLayout();

const square = (id, x1 = 0, y1 = 0, x2 = 100, y2 = 100, extra = {}) => ({
  id,
  pts: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
  x1, y1, x2, y2, ...extra,
});
const item = (id, x, y, roomId) => ({ id, x, y, roomId, stream: 'garbage', type: 'b1100' });

// ── bounding box ────────────────────────────────────────────────────────
test('wsRoomSyncBBox: derives x1/y1/x2/y2 from the point list', () => {
  const r = { id: 'A', pts: [{ x: 10, y: 20 }, { x: 90, y: 5 }, { x: 60, y: 140 }] };
  ws.wsRoomSyncBBox(r);
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [10, 5, 90, 140]);
});

test('wsRoomEnsurePts: a legacy rectangle gains real corners before editing', () => {
  const legacy = { id: 'old', x1: 0, y1: 0, x2: 100, y2: 50 };
  ws.wsRoomEnsurePts(legacy);
  assert.equal(legacy.pts.length, 4);
  assert.deepEqual(legacy.pts[0], { x: 0, y: 0 });
  assert.deepEqual(legacy.pts[2], { x: 100, y: 50 });
  // and it is a copy, not a live view onto the bbox numbers
  legacy.pts[0].x = 999;
  assert.equal(legacy.x1, 0);
});

test('wsRoomEnsurePts: an existing point list is left alone', () => {
  const r = square('A');
  const before = r.pts;
  ws.wsRoomEnsurePts(r);
  assert.equal(r.pts, before, 'must not clone a polygon that already has points');
});

// ── whole-room translate ────────────────────────────────────────────────
test('wsRoomTranslate: moves every corner and resyncs the bbox', () => {
  const r = square('A');
  ws.wsRoomTranslate(r, 25, -10);
  assert.deepEqual(r.pts[0], { x: 25, y: -10 });
  assert.deepEqual(r.pts[2], { x: 125, y: 90 });
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [25, -10, 125, 90]);
});

test('wsRoomTranslate: a zero move is a no-op', () => {
  const r = square('A');
  ws.wsRoomTranslate(r, 0, 0);
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 100, 100]);
});

test('wsRoomAttached: collects only the items tagged to this room', () => {
  const bins = [item('b1', 10, 10, 'A'), item('b2', 20, 20, 'B'), item('b3', 30, 30, null)];
  const equip = [item('e1', 40, 40, 'A'), item('e2', 50, 50, 'B')];
  const got = ws.wsRoomAttached('A', bins, equip).map(i => i.id);
  assert.deepEqual(got, ['b1', 'e1']);
  assert.deepEqual(ws.wsRoomAttached('A', null, null), []);
});

test('wsRoomDragMove: bins and equipment tagged to the room travel with it', () => {
  const r = square('A');
  const bins = [item('b1', 50, 50, 'A'), item('b2', 500, 500, null)];
  const equip = [item('e1', 60, 60, 'A')];
  const moved = ws.wsRoomDragMove(r, 10, 20, bins, equip);
  assert.equal(moved, 2, 'one bin and one equipment item moved');
  assert.deepEqual([bins[0].x, bins[0].y], [60, 70]);
  assert.deepEqual([equip[0].x, equip[0].y], [70, 80]);
  assert.deepEqual([bins[1].x, bins[1].y], [500, 500], 'an untagged bin must not move');
  assert.deepEqual([r.x1, r.y1], [10, 20]);
});

test('wsRoomDragMove: items keep their position relative to the room', () => {
  const r = square('A');
  const bins = [item('b1', 25, 75, 'A')];
  const offset = { x: bins[0].x - r.x1, y: bins[0].y - r.y1 };
  ws.wsRoomDragMove(r, -40, 33, bins, []);
  assert.deepEqual({ x: bins[0].x - r.x1, y: bins[0].y - r.y1 }, offset,
    'a whole-room drag must be a rigid translation');
  // and the bin is still inside the room afterwards
  assert.equal(ws.wsBinRoomId([r], bins[0]), 'A');
});

test('wsRoomDragMove: an item dragged out earlier stays out', () => {
  // Tagging, not live containment, is what travels — so a bin the user
  // deliberately parked outside is not yanked back by a room move.
  const r = square('A');
  const bins = [item('b1', 500, 500, null)];
  ws.wsRoomDragMove(r, 10, 10, bins, []);
  assert.deepEqual([bins[0].x, bins[0].y], [500, 500]);
});

// ── vertices ────────────────────────────────────────────────────────────
test('wsRoomMoveVertex: moves one corner and resyncs the bbox', () => {
  const r = square('A');
  ws.wsRoomMoveVertex(r, 2, 180, 140);
  assert.deepEqual(r.pts[2], { x: 180, y: 140 });
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 180, 140]);
});

test('wsRoomMoveVertex: an out-of-range index is ignored, not thrown', () => {
  const r = square('A');
  ws.wsRoomMoveVertex(r, 9, 5, 5);
  ws.wsRoomMoveVertex(r, -1, 5, 5);
  assert.equal(r.pts.length, 4);
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 100, 100]);
});

test('wsRoomEdgeMidpoints: one midpoint per edge, including the closing edge', () => {
  const mids = ws.wsRoomEdgeMidpoints(square('A'));
  assert.equal(mids.length, 4, 'a quad has four edges, the last wrapping to the first corner');
  assert.deepEqual(mids.map(m => [m.x, m.y]), [[50, 0], [100, 50], [50, 100], [0, 50]]);
  assert.deepEqual(mids.map(m => m.edge), [0, 1, 2, 3]);
});

test('wsRoomInsertVertex: splits the chosen edge and returns the new index', () => {
  const r = square('A');
  const i = ws.wsRoomInsertVertex(r, 0, 50, 0);
  assert.equal(i, 1, 'the new corner lands immediately after the edge it split');
  assert.equal(r.pts.length, 5);
  assert.deepEqual(r.pts[1], { x: 50, y: 0 });
  // the polygon is still the same shape — a point on an edge changes nothing
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 100, 100]);
});

test('wsRoomInsertVertex: defaults to the edge midpoint when no point is given', () => {
  const r = square('A');
  ws.wsRoomInsertVertex(r, 1, null, null);
  assert.deepEqual(r.pts[2], { x: 100, y: 50 });
});

test('wsRoomInsertVertex: splitting the closing edge appends rather than corrupting', () => {
  const r = square('A');
  const i = ws.wsRoomInsertVertex(r, 3, 0, 50);
  assert.equal(i, 4);
  assert.equal(r.pts.length, 5);
  assert.deepEqual(r.pts[4], { x: 0, y: 50 });
});

test('wsRoomInsertVertex: rejects an edge index that does not exist', () => {
  const r = square('A');
  assert.equal(ws.wsRoomInsertVertex(r, 9, 1, 1), -1);
  assert.equal(ws.wsRoomInsertVertex(r, -1, 1, 1), -1);
  assert.equal(r.pts.length, 4);
});

test('wsRoomDeleteVertex: removes a corner but never below three', () => {
  const r = square('A');
  ws.wsRoomInsertVertex(r, 0, 50, 0);
  assert.equal(r.pts.length, 5);
  assert.equal(ws.wsRoomDeleteVertex(r, 1), true);
  assert.equal(r.pts.length, 4);
  assert.equal(ws.wsRoomDeleteVertex(r, 0), true);
  assert.equal(r.pts.length, 3);
  assert.equal(ws.wsRoomDeleteVertex(r, 0), false, 'a triangle is the floor');
  assert.equal(r.pts.length, 3);
});

test('wsRoomDeleteVertex: an out-of-range index is refused', () => {
  const r = square('A');
  ws.wsRoomInsertVertex(r, 0, 50, 0);
  assert.equal(ws.wsRoomDeleteVertex(r, 9), false);
  assert.equal(ws.wsRoomDeleteVertex(r, -1), false);
  assert.equal(r.pts.length, 5);
});

test('add then remove a corner returns the room to its original shape', () => {
  const r = square('A');
  const before = JSON.stringify(r.pts);
  const i = ws.wsRoomInsertVertex(r, 2, 40, 100);
  ws.wsRoomDeleteVertex(r, i);
  assert.equal(JSON.stringify(r.pts), before);
  assert.deepEqual([r.x1, r.y1, r.x2, r.y2], [0, 0, 100, 100]);
});

// ── reshape changes containment ─────────────────────────────────────────
test('reshaping a room retags the bins it gains and loses', () => {
  const r = square('A', 0, 0, 100, 100);
  const bins = [item('inside', 50, 50, null), item('outside', 150, 50, null)];
  ws.wsTagBinsToRooms([r], bins);
  assert.deepEqual(bins.map(b => b.roomId), ['A', null]);

  // stretch the right edge out past the second bin
  ws.wsRoomMoveVertex(r, 1, 200, 0);
  ws.wsRoomMoveVertex(r, 2, 200, 100);
  ws.wsTagBinsToRooms([r], bins);
  assert.deepEqual(bins.map(b => b.roomId), ['A', 'A'], 'the widened room adopted the loose bin');

  // pull it back in past the first bin too
  ws.wsRoomMoveVertex(r, 1, 20, 0);
  ws.wsRoomMoveVertex(r, 2, 20, 100);
  ws.wsTagBinsToRooms([r], bins);
  assert.deepEqual(bins.map(b => b.roomId), [null, null], 'shrinking releases both');
});

test('reconciliation follows a reshape without any extra bookkeeping', () => {
  const r = square('A', 0, 0, 100, 100, { calcRoom: 'R1' });
  const calc = [{ id: 'R1', name: 'Bin room', targets: [{ stream: 'garbage', typeId: 'b1100', qty: 2 }] }];
  const bins = [item('b1', 25, 25, null), item('b2', 150, 25, null)];
  ws.wsTagBinsToRooms([r], bins);
  const targets = ws.wsRoomTargets(r, calc);
  assert.equal(ws.wsRoomReconcile('A', targets, bins).placed, 1);

  ws.wsRoomMoveVertex(r, 1, 200, 0);
  ws.wsRoomMoveVertex(r, 2, 200, 100);
  ws.wsTagBinsToRooms([r], bins);
  const rec = ws.wsRoomReconcile('A', targets, bins);
  assert.equal(rec.placed, 2);
  assert.equal(rec.ok, true, 'the reshaped room is now satisfied');
});

test('a whole-room drag leaves reconciliation unchanged', () => {
  const r = square('A', 0, 0, 100, 100, { calcRoom: 'R1' });
  const calc = [{ id: 'R1', name: 'Bin room', targets: [{ stream: 'garbage', typeId: 'b1100', qty: 2 }] }];
  const bins = [item('b1', 25, 25, null), item('b2', 75, 75, null)];
  ws.wsTagBinsToRooms([r], bins);
  const targets = ws.wsRoomTargets(r, calc);
  const before = ws.wsRoomReconcile('A', targets, bins);

  ws.wsRoomDragMove(r, 640, -220, bins, []);
  ws.wsTagBinsToRooms([r], bins);
  const after = ws.wsRoomReconcile('A', targets, bins);
  assert.deepEqual(after.rows, before.rows, 'moving a room must not change what it contains');
  assert.equal(after.ok, true);
});

// ── chip placement ──────────────────────────────────────────────────────
test('wsRoomChipAnchor: sits clear above the room top edge', () => {
  const a = ws.wsRoomChipAnchor({ x1: 10, y1: 100, x2: 200, y2: 300 }, 80, 20, { margin: 6, minY: 0 });
  assert.equal(a.placement, 'above');
  assert.equal(a.x, 10, 'left-aligned with the room');
  assert.equal(a.y, 74);
  assert.ok(a.y + a.height <= 100, 'the chip must not overlap the room interior');
});

test('wsRoomChipAnchor: flips below when there is no room above', () => {
  const a = ws.wsRoomChipAnchor({ x1: 10, y1: 5, x2: 200, y2: 300 }, 80, 20, { margin: 6, minY: 0 });
  assert.equal(a.placement, 'below');
  assert.equal(a.y, 306);
  assert.ok(a.y >= 300, 'the flipped chip must still clear the room interior');
});

test('wsRoomChipAnchor: never overlaps the room in either placement', () => {
  for (const y1 of [0, 3, 20, 26, 27, 200]) {
    const bb = { x1: 0, y1, x2: 100, y2: y1 + 150 };
    const a = ws.wsRoomChipAnchor(bb, 80, 20, { margin: 6, minY: 2 });
    const clearsAbove = a.y + a.height <= bb.y1;
    const clearsBelow = a.y >= bb.y2;
    assert.ok(clearsAbove || clearsBelow, `chip overlapped the room at y1=${y1}`);
  }
});

test('wsRoomChipAnchor: defaults are sane when no options are passed', () => {
  const a = ws.wsRoomChipAnchor({ x1: 0, y1: 100, x2: 50, y2: 200 }, 40, 18);
  assert.equal(a.placement, 'above');
  assert.equal(a.y, 100 - 18 - 6);
});

// ── chip visibility ─────────────────────────────────────────────────────
const REC_OK = { rows: [{ stream: 'garbage', required: 1, placed: 1, ok: true }], ok: true };
const REC_SHORT = { rows: [{ stream: 'garbage', required: 2, placed: 1, ok: false }], ok: false };
const REC_NONE = { rows: [], ok: false };

test('wsRoomChipState: a room with no schedule renders no chip at all', () => {
  assert.equal(ws.wsRoomChipState(REC_NONE, false, true).render, false);
  assert.equal(ws.wsRoomChipState(null, false, true).render, false);
  assert.equal(ws.wsRoomChipState(undefined, true, true).render, false);
});

test('wsRoomChipState: the Labels layer toggle hides chips', () => {
  assert.equal(ws.wsRoomChipState(REC_SHORT, false, false).render, false,
    'an unsatisfied chip must still hide with Labels off');
  assert.equal(ws.wsRoomChipState(REC_OK, true, false).render, false,
    'selection must not override the Labels toggle');
  assert.equal(ws.wsRoomChipState(REC_SHORT, false, true).render, true);
});

test('wsRoomChipState: a satisfied room collapses to a badge', () => {
  const s = ws.wsRoomChipState(REC_OK, false, true);
  assert.equal(s.render, true);
  assert.equal(s.ok, true);
  assert.equal(s.collapsed, true);
  assert.match(s.cls, /\bws-chip\b/);
  assert.match(s.cls, /\bok\b/);
  assert.doesNotMatch(s.cls, /\bsel\b/);
});

test('wsRoomChipState: selecting the room expands it again', () => {
  const s = ws.wsRoomChipState(REC_OK, true, true);
  assert.equal(s.collapsed, false);
  assert.match(s.cls, /\bsel\b/);
});

test('wsRoomChipState: an unsatisfied room never collapses', () => {
  for (const selected of [false, true]) {
    const s = ws.wsRoomChipState(REC_SHORT, selected, true);
    assert.equal(s.render, true);
    assert.equal(s.collapsed, false, 'an outstanding shortfall must stay visible');
    assert.doesNotMatch(s.cls, /\bok\b/);
  }
});

test('the CSS backing the collapse rule exists and keys off the same classes', () => {
  // wsRoomChipState only emits class names; CSS does the collapsing, so the two
  // have to agree or a satisfied chip silently renders both states at once.
  assert.match(SOURCE, /\.ws-chip \.ws-chip-badge\{display:none;\}/);
  assert.match(SOURCE, /\.ws-chip\.ok \.ws-chip-badge\{display:inline;\}/);
  assert.match(SOURCE, /\.ws-chip\.ok \.ws-chip-full\{display:none;\}/);
  assert.match(SOURCE, /\.ws-chip\.ok:hover \.ws-chip-full,\.ws-chip\.ok\.sel \.ws-chip-full\{display:inline;\}/);
  assert.match(SOURCE, /#ws-overlay-svg\.ws-hide-labels \.ws-chip\{display:none;\}/,
    'chips must hide with the Labels layer');
});

// ── room outline style ──────────────────────────────────────────────────
test('wsRoomStroke: commercial rooms read gold, everything else teal', () => {
  assert.equal(ws.wsRoomStroke({ kind: 'com' }), '#B38600');
  assert.equal(ws.wsRoomStroke({ kind: 'res' }), '#008080');
  assert.equal(ws.wsRoomStroke({}), '#008080');
  assert.equal(ws.wsRoomStroke(null), '#008080');
});

test('rooms render as a solid 1.5px outline on a flat white floor', () => {
  assert.match(SOURCE, /fill: 'rgba\(255,255,255,0\.6\)'/, 'room fill is not the flat white floor');
  assert.match(SOURCE, /stroke: selRoom \? '#00d4d4' : wsRoomStroke\(r\), 'stroke-width': selRoom \? 2\.5 : 1\.5/,
    'room outline is not a solid 1.5px stroke in the room colour');
  // the dashed outline is gone from the room polygon (the in-progress polyline keeps its dashes)
  const roomBlock = SOURCE.slice(SOURCE.indexOf('slot.rooms.forEach((r, i) => {'), SOURCE.indexOf('// polygon in progress'));
  assert.doesNotMatch(roomBlock, /'stroke-dasharray': '10 6'/, 'the finished room outline is still dashed');
});

// ── DXF ─────────────────────────────────────────────────────────────────
test('DXF room polylines carry no linetype, so the screen dash change does not reach CAD', () => {
  // wsLayoutDXFEntities writes layer (8) and colour (62) only — no linetype (6)
  // group code — so rooms have always exported as CONTINUOUS. Nothing to update.
  const fn = extractBlock(/^function wsLayoutDXFEntities\(/).text;
  assert.ok(fn.length > 0, 'could not locate wsLayoutDXFEntities');
  assert.match(fn, /0\\nPOLYLINE\\n8\\n\$\{layer\}\\n62\\n\$\{aci\}/, 'DXF polyline preamble changed');
  assert.doesNotMatch(fn, /\\n6\\n/, 'a linetype group code appeared — room line style now IS exported, so it must track the screen style');
  assert.doesNotMatch(fn, /DASHED/i);
});

// ── wiring guards ───────────────────────────────────────────────────────
test('room interior grab is tested after bins, chutes, equipment and callouts', () => {
  const bind = SOURCE.slice(SOURCE.indexOf('function wsLayoutBind'), SOURCE.indexOf("area.addEventListener('mousemove'"));
  const iRoomHandles = bind.indexOf("kind: 'roomvert'");
  const iBin = bind.indexOf('const hit = wsLayoutHit(');
  const iCallout = bind.indexOf('wsLayoutHitCallout(');
  const iRoomBody = bind.indexOf('const room = wsRoomAt(p.x, p.y);');
  assert.ok(iRoomHandles > 0 && iBin > 0 && iCallout > 0 && iRoomBody > 0, 'hit-test order markers missing');
  assert.ok(iRoomHandles < iBin, 'selected-room handles must be grabbed before contents');
  assert.ok(iRoomBody > iBin, 'bins take priority over the room interior');
  assert.ok(iRoomBody > iCallout, 'callouts take priority over the room interior');
  assert.match(bind.slice(iRoomBody), /WS\.isPanning = false;/, 'a room grab must stop the pan');
});

test('room edits retag contents and re-render when the drag settles', () => {
  assert.match(SOURCE, /if \(dg\.kind === 'room' \|\| dg\.kind === 'roomvert'\)[\s\S]{0,220}wsTagBinsToRooms\(slot3\.rooms, slot3\.bins\)/,
    'ending a room drag does not retag its contents');
});

test('markup modes suspend and restore the tool that was already armed', () => {
  assert.match(SOURCE, /function wsMarkSuspend\(\)/);
  assert.match(SOURCE, /function wsMarkExit\(\)/);
  assert.match(SOURCE, /function wsMarkMode\(kind\)[\s\S]{0,400}wsMarkSuspend\(\);/,
    'wsMarkMode does not park the current tool');
  // both exits restore rather than hard-ending the mode
  assert.match(SOURCE, /wsMarkExit\(\); wsRenderLayoutLayer\(\); return;/, 'callout finish does not restore');
  assert.match(SOURCE, /if \(WS\._mode === 'layoutmark'\) \{ wsMarkExit\(\); return; \}/, 'Escape does not restore');
  assert.match(SOURCE, /if \(!WS_LAYOUT\.tabActive && WS\._mode !== 'layoutmark'\) return;/,
    'markup keys do not work outside the layout tab');
});

test('the markups card lives in the side stack below the layers card', () => {
  const stack = SOURCE.slice(SOURCE.indexOf('<div class="ws-side-stack"'), SOURCE.indexOf('<!-- Zoom controls -->'));
  const iLayers = stack.indexOf('id="ws-layer-panel"');
  const iMark = stack.indexOf('id="ws-markup-panel"');
  assert.ok(iLayers > 0 && iMark > 0, 'both cards must be inside the side stack');
  assert.ok(iMark > iLayers, 'the markups card belongs below the layers card');
  for (const kind of ['text', 'measure', 'area', 'disposal', 'transfer'])
    assert.match(stack, new RegExp(`wsMarkMode\\('${kind}'\\)`), `${kind} markup button missing from the card`);
  // and they are gone from the layout tab's toolbar
  const panel = SOURCE.slice(SOURCE.indexOf('<div class="wsl-group-hd">Markups</div>'));
  assert.equal(SOURCE.indexOf('<div class="wsl-group-hd">Markups</div>'), -1,
    'the old Markups group is still in the layout panel');
  void panel;
  assert.match(SOURCE, /e\.target\.closest\('#ws-side-stack'\)/, 'the pan guard still only covers the layers panel');
});
