'use strict';
// Layout generator — drawn-room containment tagging and schedule reconciliation.
//
// Three things interact in the layout tool:
//   • bin-calculator room cards (WS_CALC_ROOMS)  — what a room REQUIRES
//   • drawn polygon rooms (slot.rooms)           — where it lives on the plan
//   • bins (slot.bins)                           — what has actually been PLACED
//
// The link between them is containment: a bin belongs to the drawn room whose
// polygon contains its centre (bin.roomId), the drawn room carries an assigned
// calculator schedule (room.calcRoom) optionally narrowed to a stream subset
// (room.streams), and reconciliation compares the two per stream.
//
// These are the pure functions behind that; the rendering and pill wiring on top
// of them is DOM work and is not covered here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout } = require('./extract.js');

const ws = loadLayout();

// ── fixtures ────────────────────────────────────────────────────────────
const rect = (id, x1, y1, x2, y2, extra = {}) => ({
  id, pts: [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }],
  x1, y1, x2, y2, ...extra,
});
const bin = (x, y, stream, extra = {}) => ({ id: 'b' + x + '_' + y, x, y, stream, type: 'b1100', ...extra });

const CALC_ROOMS = [
  { id: 'R1', name: 'Residential bin room', kind: 'res', areaM2: 24, targets: [
    { stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 3 },
    { stream: 'recycling', typeId: 'b1100', sizeL: 1100, qty: 2 },
    { stream: 'fogo', typeId: 'b240', sizeL: 240, qty: 1 },
  ] },
  { id: 'R2', name: 'Commercial bin room', kind: 'com', areaM2: 12, targets: [
    { stream: 'garbage', typeId: 'b660', sizeL: 660, qty: 2 },
  ] },
];

// ── containment tagging ─────────────────────────────────────────────────
test('wsRoomAtPt: a point resolves to the room whose polygon contains it', () => {
  const rooms = [rect('A', 0, 0, 100, 100), rect('B', 200, 0, 300, 100)];
  assert.equal(ws.wsRoomAtPt(rooms, 50, 50).id, 'A');
  assert.equal(ws.wsRoomAtPt(rooms, 250, 50).id, 'B');
  assert.equal(ws.wsRoomAtPt(rooms, 150, 50), null, 'the gap between rooms is not inside either');
  assert.equal(ws.wsRoomAtPt(rooms, 50, 500), null);
  assert.equal(ws.wsRoomAtPt([], 50, 50), null);
  assert.equal(ws.wsRoomAtPt(null, 50, 50), null);
});

test('wsRoomAtPt: overlapping rooms resolve to the one drawn last', () => {
  // Matches the hit-test order used for bins and equipment: topmost wins.
  const rooms = [rect('under', 0, 0, 100, 100), rect('over', 50, 50, 150, 150)];
  assert.equal(ws.wsRoomAtPt(rooms, 75, 75).id, 'over');
  assert.equal(ws.wsRoomAtPt(rooms, 25, 25).id, 'under');
  assert.equal(ws.wsRoomAtPt(rooms, 125, 125).id, 'over');
});

test('wsRoomAtPt: non-convex rooms exclude their concave notch', () => {
  // An L-shaped room — a bin parked in the missing quadrant is NOT in the room.
  const L = { id: 'L', pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 },
                             { x: 50, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 100 }] };
  assert.equal(ws.wsRoomAtPt([L], 25, 25).id, 'L', 'inside the corner arm');
  assert.equal(ws.wsRoomAtPt([L], 90, 25).id, 'L', 'inside the horizontal arm');
  assert.equal(ws.wsRoomAtPt([L], 25, 90).id, 'L', 'inside the vertical arm');
  assert.equal(ws.wsRoomAtPt([L], 75, 75), null, 'the notch is outside the polygon');
});

test('wsRoomAtPt: rectangle-only rooms from legacy saves still resolve', () => {
  // Older saves have x1/y1/x2/y2 and no pts; wsRoomPts derives the corners.
  const legacy = { id: 'old', x1: 0, y1: 0, x2: 100, y2: 100 };
  assert.equal(ws.wsRoomAtPt([legacy], 50, 50).id, 'old');
  assert.equal(ws.wsRoomAtPt([legacy], 150, 50), null);
});

test('wsBinRoomId: tags a bin by its centre, null when it sits outside every room', () => {
  const rooms = [rect('A', 0, 0, 100, 100)];
  assert.equal(ws.wsBinRoomId(rooms, bin(50, 50, 'garbage')), 'A');
  assert.equal(ws.wsBinRoomId(rooms, bin(500, 500, 'garbage')), null);
  assert.equal(ws.wsBinRoomId(rooms, null), null);
  assert.equal(ws.wsBinRoomId([rect(undefined, 0, 0, 100, 100)], bin(50, 50, 'garbage')), null,
    'a room without an id tags to null rather than undefined');
});

test('wsTagBinsToRooms: tags every bin and reports how many changed', () => {
  const rooms = [rect('A', 0, 0, 100, 100), rect('B', 200, 0, 300, 100)];
  const bins = [bin(50, 50, 'garbage'), bin(250, 50, 'recycling'), bin(600, 600, 'fogo')];
  assert.equal(ws.wsTagBinsToRooms(rooms, bins), 3);
  assert.deepEqual(bins.map(b => b.roomId), ['A', 'B', null]);
  // idempotent — a second pass changes nothing
  assert.equal(ws.wsTagBinsToRooms(rooms, bins), 0);
});

test('wsTagBinsToRooms: a bin dragged out of a room is untagged, not left stale', () => {
  const rooms = [rect('A', 0, 0, 100, 100)];
  const b = bin(50, 50, 'garbage');
  ws.wsTagBinsToRooms(rooms, [b]);
  assert.equal(b.roomId, 'A');
  b.x = 500; b.y = 500;                       // dragged outside
  assert.equal(ws.wsTagBinsToRooms(rooms, [b]), 1);
  assert.equal(b.roomId, null, 'stale tag would keep counting toward the old room chip');
});

test('wsTagBinsToRooms: a bin dragged between rooms moves its tag', () => {
  const rooms = [rect('A', 0, 0, 100, 100), rect('B', 200, 0, 300, 100)];
  const b = bin(50, 50, 'garbage');
  ws.wsTagBinsToRooms(rooms, [b]);
  b.x = 250;
  ws.wsTagBinsToRooms(rooms, [b]);
  assert.equal(b.roomId, 'B');
});

test('wsTagBinsToRooms: deleting a room untags the bins that were inside it', () => {
  const rooms = [rect('A', 0, 0, 100, 100)];
  const bins = [bin(50, 50, 'garbage')];
  ws.wsTagBinsToRooms(rooms, bins);
  assert.equal(bins[0].roomId, 'A');
  ws.wsTagBinsToRooms([], bins);              // room outline removed
  assert.equal(bins[0].roomId, null, 'bins stay on the plan but belong to no room');
});

test('wsEnsureRoomIds: assigns ids only where missing, and they are unique', () => {
  const rooms = [rect('keep', 0, 0, 10, 10), rect(undefined, 0, 0, 10, 10), rect(undefined, 0, 0, 10, 10)];
  ws.wsEnsureRoomIds(rooms);
  assert.equal(rooms[0].id, 'keep', 'an existing id must not be reassigned');
  assert.ok(rooms[1].id && rooms[2].id, 'missing ids were filled in');
  assert.notEqual(rooms[1].id, rooms[2].id, 'ids collided');
  const before = rooms.map(r => r.id);
  ws.wsEnsureRoomIds(rooms);
  assert.deepEqual(rooms.map(r => r.id), before, 'a second pass must be stable');
});

// ── schedule assignment ─────────────────────────────────────────────────
test('wsRoomTargets: an unassigned room has no targets', () => {
  assert.deepEqual(ws.wsRoomTargets(rect('A', 0, 0, 10, 10), CALC_ROOMS), []);
  assert.deepEqual(ws.wsRoomTargets(null, CALC_ROOMS), []);
  assert.deepEqual(ws.wsRoomTargets(rect('A', 0, 0, 10, 10, { calcRoom: 'nope' }), CALC_ROOMS), [],
    'a schedule that no longer exists reconciles to nothing');
});

test('wsRoomTargets: an assigned room takes its whole schedule by default', () => {
  const room = rect('A', 0, 0, 10, 10, { calcRoom: 'R1' });
  assert.deepEqual(ws.wsRoomTargets(room, CALC_ROOMS).map(t => t.stream), ['garbage', 'recycling', 'fogo']);
  // an empty subset means "everything", not "nothing"
  room.streams = [];
  assert.equal(ws.wsRoomTargets(room, CALC_ROOMS).length, 3);
  room.streams = null;
  assert.equal(ws.wsRoomTargets(room, CALC_ROOMS).length, 3);
});

test('wsRoomTargets: a stream subset narrows the schedule', () => {
  const room = rect('A', 0, 0, 10, 10, { calcRoom: 'R1', streams: ['garbage', 'fogo'] });
  const got = ws.wsRoomTargets(room, CALC_ROOMS);
  assert.deepEqual(got.map(t => t.stream), ['garbage', 'fogo']);
  assert.equal(got.reduce((a, t) => a + t.qty, 0), 4);
});

test('wsRoomTargets: two rooms can split one schedule between them', () => {
  // The residential/commercial split the feature is for.
  const resRoom = rect('A', 0, 0, 10, 10, { calcRoom: 'R1', streams: ['garbage', 'recycling'] });
  const orgRoom = rect('B', 20, 0, 30, 10, { calcRoom: 'R1', streams: ['fogo'] });
  const a = ws.wsRoomTargets(resRoom, CALC_ROOMS), b = ws.wsRoomTargets(orgRoom, CALC_ROOMS);
  assert.equal(a.reduce((s, t) => s + t.qty, 0) + b.reduce((s, t) => s + t.qty, 0), 6,
    'the split must account for every bin in the schedule exactly once');
  assert.equal(a.filter(t => b.some(u => u.stream === t.stream)).length, 0, 'subsets overlap');
});

// ── reconciliation counts ───────────────────────────────────────────────
test('wsRoomReconcile: counts placed against required per stream', () => {
  const targets = ws.wsRoomTargets(rect('A', 0, 0, 10, 10, { calcRoom: 'R1' }), CALC_ROOMS);
  const bins = [
    bin(1, 1, 'garbage', { roomId: 'A' }), bin(2, 1, 'garbage', { roomId: 'A' }),
    bin(3, 1, 'recycling', { roomId: 'A' }),
  ];
  const rec = ws.wsRoomReconcile('A', targets, bins);
  assert.deepEqual(rec.rows, [
    { stream: 'garbage', required: 3, placed: 2, ok: false, over: false },
    { stream: 'recycling', required: 2, placed: 1, ok: false, over: false },
    { stream: 'fogo', required: 1, placed: 0, ok: false, over: false },
  ]);
  assert.equal(rec.required, 6);
  assert.equal(rec.placed, 3);
  assert.equal(rec.ok, false);
});

test('wsRoomReconcile: green only when every stream is satisfied', () => {
  const targets = ws.wsRoomTargets(rect('A', 0, 0, 10, 10, { calcRoom: 'R1' }), CALC_ROOMS);
  const full = [];
  for (let i = 0; i < 3; i++) full.push(bin(i, 1, 'garbage', { roomId: 'A' }));
  for (let i = 0; i < 2; i++) full.push(bin(i, 2, 'recycling', { roomId: 'A' }));
  full.push(bin(0, 3, 'fogo', { roomId: 'A' }));
  assert.equal(ws.wsRoomReconcile('A', targets, full).ok, true);

  // one short on a single stream is still not satisfied
  const oneShort = full.filter((b, i) => i !== full.length - 1);
  const rec = ws.wsRoomReconcile('A', targets, oneShort);
  assert.equal(rec.ok, false);
  assert.equal(rec.rows.find(r => r.stream === 'fogo').ok, false);
  assert.equal(rec.rows.find(r => r.stream === 'garbage').ok, true, 'other streams still report satisfied');
});

test('wsRoomReconcile: only bins tagged to this room count', () => {
  const targets = ws.wsRoomTargets(rect('A', 0, 0, 10, 10, { calcRoom: 'R2' }), CALC_ROOMS);
  const bins = [
    bin(1, 1, 'garbage', { roomId: 'A' }),
    bin(2, 1, 'garbage', { roomId: 'B' }),      // next room over
    bin(3, 1, 'garbage', { roomId: null }),     // loose on the plan
    bin(4, 1, 'garbage'),                        // never tagged
  ];
  const rec = ws.wsRoomReconcile('A', targets, bins);
  assert.equal(rec.placed, 1, 'bins in other rooms or outside every room must not count');
  assert.equal(rec.rows[0].required, 2);
});

test('wsRoomReconcile: surplus bins satisfy but are flagged as over', () => {
  const targets = [{ stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 1 }];
  const bins = [bin(1, 1, 'garbage', { roomId: 'A' }), bin(2, 1, 'garbage', { roomId: 'A' })];
  const rec = ws.wsRoomReconcile('A', targets, bins);
  assert.equal(rec.rows[0].placed, 2);
  assert.equal(rec.rows[0].ok, true);
  assert.equal(rec.rows[0].over, true);
  assert.equal(rec.ok, true);
});

test('wsRoomReconcile: a stream placed but not scheduled shows as required 0', () => {
  const targets = [{ stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 1 }];
  const bins = [bin(1, 1, 'garbage', { roomId: 'A' }), bin(2, 1, 'glass', { roomId: 'A' })];
  const rec = ws.wsRoomReconcile('A', targets, bins);
  const glass = rec.rows.find(r => r.stream === 'glass');
  assert.ok(glass, 'an unscheduled stream must still be visible on the chip');
  assert.equal(glass.required, 0);
  assert.equal(glass.placed, 1);
  assert.equal(glass.ok, true);
});

test('wsRoomReconcile: equipment placed in a room is not counted as a bin', () => {
  const targets = [{ stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 1 }];
  const bins = [bin(1, 1, 'garbage', { roomId: 'A' }), bin(2, 1, 'equip', { roomId: 'A' })];
  const rec = ws.wsRoomReconcile('A', targets, bins);
  assert.equal(rec.rows.length, 1, 'the equipment pseudo-stream must not appear on the chip');
  assert.equal(rec.ok, true);
});

test('wsRoomReconcile: a room with no schedule reconciles to nothing', () => {
  const rec = ws.wsRoomReconcile('A', [], []);
  assert.deepEqual(rec.rows, []);
  assert.equal(rec.ok, false, 'no schedule is not the same as satisfied — the chip is skipped');
  assert.equal(rec.required, 0);
  assert.equal(rec.placed, 0);
});

test('wsRoomReconcile: rows follow the canonical stream order, not insertion order', () => {
  const targets = [
    { stream: 'fogo', typeId: 'b240', sizeL: 240, qty: 1 },
    { stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 1 },
    { stream: 'recycling', typeId: 'b1100', sizeL: 1100, qty: 1 },
  ];
  const order = ws.WS_STREAMS.map(s => s.id);
  const rows = ws.wsRoomReconcile('A', targets, []).rows.map(r => r.stream);
  assert.deepEqual(rows, ['garbage', 'recycling', 'fogo']);
  assert.ok(order.indexOf(rows[0]) < order.indexOf(rows[1]), 'chip order must be stable across renders');
});

test('wsRoomReconcile: repeated targets for one stream sum rather than overwrite', () => {
  const targets = [
    { stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 2 },
    { stream: 'garbage', typeId: 'b660', sizeL: 660, qty: 3 },
  ];
  assert.equal(ws.wsRoomReconcile('A', targets, []).rows[0].required, 5);
});

test('wsRoomReconcile: tolerates missing arguments', () => {
  assert.equal(ws.wsRoomReconcile('A', null, null).required, 0);
  assert.equal(ws.wsRoomReconcile('A', undefined, undefined).ok, false);
});

// ── the three together ──────────────────────────────────────────────────
test('end to end: draw two rooms, place bins, reconcile each independently', () => {
  const rooms = [
    rect('res', 0, 0, 100, 100, { calcRoom: 'R1', name: 'Residential bin room' }),
    rect('com', 200, 0, 300, 100, { calcRoom: 'R2', name: 'Commercial bin room' }),
  ];
  const bins = [];
  for (let i = 0; i < 3; i++) bins.push(bin(10 + i * 10, 20, 'garbage'));
  for (let i = 0; i < 2; i++) bins.push(bin(10 + i * 10, 50, 'recycling'));
  bins.push(bin(10, 80, 'fogo'));
  bins.push(bin(210, 20, 'garbage'));            // one of two commercial bins
  ws.wsTagBinsToRooms(rooms, bins);

  const res = ws.wsRoomReconcile('res', ws.wsRoomTargets(rooms[0], CALC_ROOMS), bins);
  const com = ws.wsRoomReconcile('com', ws.wsRoomTargets(rooms[1], CALC_ROOMS), bins);
  assert.equal(res.ok, true, 'the residential room is fully placed');
  assert.equal(com.ok, false, 'the commercial room is one bin short');
  assert.equal(com.placed, 1);
  assert.equal(com.required, 2);

  // dragging the commercial bin into the residential room breaks both chips
  bins[bins.length - 1].x = 50; bins[bins.length - 1].y = 20;
  ws.wsTagBinsToRooms(rooms, bins);
  const res2 = ws.wsRoomReconcile('res', ws.wsRoomTargets(rooms[0], CALC_ROOMS), bins);
  const com2 = ws.wsRoomReconcile('com', ws.wsRoomTargets(rooms[1], CALC_ROOMS), bins);
  assert.equal(com2.placed, 0, 'the bin no longer counts toward the room it left');
  assert.equal(res2.rows.find(r => r.stream === 'garbage').over, true, 'it now counts as surplus where it landed');
});

test('end to end: a room split by stream subset reconciles only its own share', () => {
  const rooms = [
    rect('a', 0, 0, 100, 100, { calcRoom: 'R1', streams: ['garbage', 'recycling'] }),
    rect('b', 200, 0, 300, 100, { calcRoom: 'R1', streams: ['fogo'] }),
  ];
  const bins = [];
  for (let i = 0; i < 3; i++) bins.push(bin(10 + i * 10, 20, 'garbage'));
  for (let i = 0; i < 2; i++) bins.push(bin(10 + i * 10, 50, 'recycling'));
  bins.push(bin(210, 20, 'fogo'));
  ws.wsTagBinsToRooms(rooms, bins);

  const a = ws.wsRoomReconcile('a', ws.wsRoomTargets(rooms[0], CALC_ROOMS), bins);
  const b = ws.wsRoomReconcile('b', ws.wsRoomTargets(rooms[1], CALC_ROOMS), bins);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.required, 5, 'room A owns only the garbage and recycling targets');
  assert.equal(b.required, 1, 'room B owns only the FOGO target');
  assert.equal(a.rows.some(r => r.stream === 'fogo'), false, 'FOGO is not room A\'s responsibility');
});

// ── wiring guards: the call sites that keep the tags fresh ──────────────
test('the layout wiring tags bins on place, on drag, and on generate', () => {
  const { SOURCE } = require('./extract.js');
  assert.match(SOURCE, /roomId: wsBinRoomId\(slotA\.rooms/, 'placing a bin does not tag it to a room');
  assert.match(SOURCE, /b\.roomId = wsBinRoomId\(slot2\.rooms, b\)/, 'dragging a bin does not retag it');
  assert.match(SOURCE, /calcRoom: j\.room\.calcRoom \|\| null, roomId: j\.room\.id \|\| null/, 'Generate does not tag its bins');
  assert.match(SOURCE, /wsEnsureRoomIds\(s\.rooms\)/, 'legacy rooms are not given ids on load');
});
