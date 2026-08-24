'use strict';
// B3 — equipment-aware reconciliation.
//
// These numbers end up as bin counts on an issued compliance drawing, so the
// rules are tested as rules, not as happy paths:
//   densify  — same container, less volume in it; the bin count drops.
//   convert  — the material LEAVES the stream and reappears as a paired output
//              with its own footprint and its own collection line.
//
// The two invariants are refusals, not warnings. A ratio that fires without its
// counterpart silently destroys material on the drawing, so when an invariant
// fails the ratio must NOT be applied and the reason must be reported.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout } = require('./extract.js');

const ws = loadLayout();

// ── library fixtures ────────────────────────────────────────────────────
const LIB = {
  transpacker: { code: 'transpacker', label: '19m³ Transpacker', pairingType: 'densify',
                 compactionRatio: 4, capacityL: 19000, footprintM2: 15.5, collectable: true },
  bin_press:   { code: 'bin_press', label: 'Bin press (1100L)', pairingType: 'densify',
                 compactionRatio: 3, capacityL: 1100, footprintM2: 1.47, collectable: true },
  chute_comp:  { code: 'chute_comp', label: 'Beneath-chute compactor', pairingType: 'densify',
                 compactionRatio: 5, receiverRequired: true, footprintM2: 2.2, collectable: false },
  baler:       { code: 'baler', label: 'Cardboard baler', pairingType: 'convert',
                 compactionRatio: 6, outputEquipmentId: 'bale_storage',
                 footprintM2: 1.8, collectable: false },
  bale_storage:{ code: 'bale_storage', label: 'Bale storage', pairingType: null,
                 capacityL: 500, footprintM2: 1.2, collectable: true },
  orphan_baler:{ code: 'orphan_baler', label: 'Unpaired baler', pairingType: 'convert',
                 compactionRatio: 6, outputEquipmentId: null, footprintM2: 1.8, collectable: false },
};
const inst = (id, equipmentId, stream, extra = {}) => ({ id, equipmentId, stream, qty: 1, ...extra });
const demand = (stream, weeklyVolL, binCapacityL = 1100, perWeek = 1) =>
  ({ stream, weeklyVolL, binCapacityL, perWeek });

// ── compaction maths ────────────────────────────────────────────────────
test('wsCompactedVolume: a ratio divides the weekly volume', () => {
  assert.equal(ws.wsCompactedVolume(1000, 4), 250);
  assert.equal(ws.wsCompactedVolume(1000, 1.5), 1000 / 1.5);
});

test('wsCompactedVolume: a ratio of 1 or less is not compaction and is ignored', () => {
  // A ratio below 1 would INFLATE the requirement — never silently.
  assert.equal(ws.wsCompactedVolume(1000, 1), 1000);
  assert.equal(ws.wsCompactedVolume(1000, 0.5), 1000);
  assert.equal(ws.wsCompactedVolume(1000, 0), 1000);
  assert.equal(ws.wsCompactedVolume(1000, null), 1000);
  assert.equal(ws.wsCompactedVolume(1000, undefined), 1000);
  assert.equal(ws.wsCompactedVolume(0, 4), 0);
});

test('wsBinCount: containers for a weekly volume at a collection frequency', () => {
  assert.equal(ws.wsBinCount(1000, 240, 2), 3, '1000 / (240 x 2) = 2.08 -> 3');
  assert.equal(ws.wsBinCount(480, 240, 2), 1, 'exactly one bin, not rounded up to two');
  assert.equal(ws.wsBinCount(481, 240, 2), 2, 'a litre over needs another bin');
  assert.equal(ws.wsBinCount(0, 240, 2), 0, 'no volume, no bins');
});

test('wsBinCount: an unanswerable question returns null, never a confident zero', () => {
  // A missing capacity or frequency is missing DATA. Returning 0 would print
  // "no bins required" on a drawing that simply has not been filled in.
  assert.equal(ws.wsBinCount(1000, 0, 2), null);
  assert.equal(ws.wsBinCount(1000, 240, 0), null);
  assert.equal(ws.wsBinCount(1000, null, 2), null);
});

test('wsPairedOutputQty: converted volume becomes output units, with a buffer', () => {
  // 5000 L at 6:1 = 833 L of bales; at 500 L per bale that is 2 per week,
  // and a fortnightly collection needs twice that on the floor.
  assert.equal(ws.wsPairedOutputQty(5000, 6, 500, 1), 2);
  assert.equal(ws.wsPairedOutputQty(5000, 6, 500, 2), 4);
  assert.equal(ws.wsPairedOutputQty(0, 6, 500, 2), 0);
});

test('wsPairedOutputQty: a missing output capacity is unanswerable', () => {
  assert.equal(ws.wsPairedOutputQty(5000, 6, 0, 1), null);
  assert.equal(ws.wsPairedOutputQty(5000, 6, null, 1), null);
  // a missing buffer is a sane default, not an unknown
  assert.equal(ws.wsPairedOutputQty(5000, 6, 500), 2);
});

// ── densify ─────────────────────────────────────────────────────────────
test('densify: the bin count drops, and the stream survives', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('garbage', 12000, 1100, 1)],
    [inst('i1', 'transpacker', 'garbage')], LIB);
  assert.equal(r.problems.length, 0);
  const row = r.rows[0];
  assert.equal(row.rawWeeklyVolL, 12000);
  assert.equal(row.weeklyVolL, 3000, '4:1 compaction');
  assert.equal(row.compacted, true);
  assert.equal(row.removed, false, 'the material is still general waste');
  assert.equal(row.calcQty, 3, '3000 / 1100 -> 3 bins');
  assert.equal(row.applied.kind, 'densify');
  assert.deepEqual(r.outputs, [], 'densify emits no paired output');
});

test('densify: without the plant, the same room needs far more bins', () => {
  const bare = ws.wsReconcileRoomEquipment([demand('garbage', 12000, 1100, 1)], [], LIB);
  assert.equal(bare.rows[0].calcQty, 11);
  assert.equal(bare.rows[0].compacted, false);
});

test('densify: equipment only acts on the stream it is assigned to', () => {
  // The assignment is explicit on the instance — never inferred from the label.
  const r = ws.wsReconcileRoomEquipment(
    [demand('garbage', 12000, 1100, 1), demand('paper', 8000, 1100, 1)],
    [inst('i1', 'transpacker', 'garbage')], LIB);
  assert.equal(r.rows[0].compacted, true);
  assert.equal(r.rows[1].compacted, false, 'paper is untouched by a garbage compactor');
  assert.equal(r.rows[1].calcQty, 8);
});

// ── convert ─────────────────────────────────────────────────────────────
test('convert: the input stream is emptied and a paired output is emitted', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('paper', 6000, 1100, 1)],
    [inst('i1', 'baler', 'paper')], LIB);
  assert.equal(r.problems.length, 0);
  const row = r.rows[0];
  assert.equal(row.removed, true, 'the cardboard leaves the stream as bales');
  assert.equal(row.weeklyVolL, 0);
  assert.equal(row.calcQty, 0, 'no loose cardboard bins remain');
  assert.equal(r.outputs.length, 1, 'conservation of material — the bales must appear');
  const out = r.outputs[0];
  assert.equal(out.equipmentId, 'bale_storage');
  assert.equal(out.fromStream, 'paper');
  assert.equal(out.qty, 2, '6000 / 6 = 1000 L of bales at 500 L each');
  assert.equal(out.footprintM2, 1.2, 'the output claims its own floor');
  assert.equal(out.collectable, true, 'and its own collection line');
});

test('Invariant A: convert without a paired output does NOT reduce anything', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('paper', 6000, 1100, 1)],
    [inst('i1', 'orphan_baler', 'paper')], LIB);
  assert.equal(r.rows[0].weeklyVolL, 6000, 'the ratio must not fire');
  assert.equal(r.rows[0].compacted, false);
  assert.equal(r.rows[0].calcQty, 6, 'the full bin count stands');
  assert.deepEqual(r.outputs, []);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].code, 'A');
  assert.equal(r.problems[0].severity, 'error');
  assert.match(r.problems[0].message, /output equipment/i);
});

test('Invariant A: a pairing pointing at a missing record is caught too', () => {
  const lib = { ...LIB, ghost: { code: 'ghost', label: 'Ghost baler', pairingType: 'convert',
                                 compactionRatio: 6, outputEquipmentId: 'does_not_exist' } };
  const r = ws.wsReconcileRoomEquipment([demand('paper', 6000, 1100, 1)],
    [inst('i1', 'ghost', 'paper')], lib);
  assert.equal(r.rows[0].calcQty, 6, 'nothing reduced');
  assert.deepEqual(r.outputs, []);
  assert.equal(r.problems[0].code, 'A');
});

// ── receivers ───────────────────────────────────────────────────────────
test('Invariant B: a chute compactor without a receiver does NOT reduce anything', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('garbage', 10000, 1100, 1)],
    [inst('i1', 'chute_comp', 'garbage')], LIB);
  assert.equal(r.rows[0].weeklyVolL, 10000, 'the ratio must not fire');
  assert.equal(r.rows[0].calcQty, 10);
  assert.equal(r.problems.length, 1);
  assert.equal(r.problems[0].code, 'B');
  assert.match(r.problems[0].message, /receiver/i);
});

test('Invariant B: with a receiver allocated, the ratio applies', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('garbage', 10000, 1100, 1)],
    [inst('i1', 'chute_comp', 'garbage'), inst('i2', 'bale_storage', 'garbage', { receiver: true })],
    LIB);
  assert.deepEqual(r.problems, []);
  assert.equal(r.rows[0].weeklyVolL, 2000, '5:1 applied');
  assert.equal(r.rows[0].calcQty, 2);
});

test('a receiver occupies floor but is never collected', () => {
  const t = ws.wsRoomTables(
    [inst('i1', 'chute_comp', 'garbage'), inst('i2', 'bale_storage', 'garbage', { receiver: true })],
    LIB);
  assert.equal(t.storage.length, 2, 'both appear in the storage table');
  assert.equal(t.collection.length, 0, 'the receiver is excluded, the compactor is not collectable');
  assert.ok(Math.abs(t.footprintM2 - (2.2 + 1.2)) < 1e-9, 'both claim floor');
});

// ── the two output tables ───────────────────────────────────────────────
test('wsInstanceCollectable: instance override beats the library default, and there is no third tier', () => {
  assert.equal(ws.wsInstanceCollectable(inst('a', 'baler', 'paper'), LIB), false, 'library default');
  assert.equal(ws.wsInstanceCollectable(inst('a', 'baler', 'paper', { collectable: true }), LIB), true, 'override wins');
  assert.equal(ws.wsInstanceCollectable(inst('a', 'transpacker', 'garbage', { collectable: false }), LIB), false);
  // an unknown record is not collectable — no keyword guess from the label
  assert.equal(ws.wsInstanceCollectable(inst('a', 'nope', 'garbage'), LIB), false);
  assert.equal(ws.wsInstanceCollectable(null, LIB), false);
});

test('wsRoomTables: table 1 is everything, table 2 is only what is collected', () => {
  const t = ws.wsRoomTables([
    inst('i1', 'transpacker', 'garbage'),
    inst('i2', 'baler', 'paper'),
    inst('i3', 'bale_storage', 'paper'),
  ], LIB);
  assert.deepEqual(t.storage.map(r => r.instanceId), ['i1', 'i2', 'i3']);
  assert.deepEqual(t.collection.map(r => r.instanceId), ['i1', 'i3'], 'the baler is plant, not a container');
  assert.ok(Math.abs(t.footprintM2 - (15.5 + 1.8 + 1.2)) < 1e-9);
});

test('wsRoomTables: a display label overrides the library label without changing identity', () => {
  const t = ws.wsRoomTables([inst('i1', 'baler', 'paper', { label: 'Bramidan B5 Wide' })], LIB);
  assert.equal(t.storage[0].label, 'Bramidan B5 Wide', 'the drawing shows the specified unit');
  assert.equal(t.storage[0].equipmentId, 'baler', 'identity is still the library record');
});

test('wsRoomTables: quantity multiplies the footprint', () => {
  const t = ws.wsRoomTables([inst('i1', 'bale_storage', 'paper', { qty: 3 })], LIB);
  assert.ok(Math.abs(t.footprintM2 - 3.6) < 1e-9);
});

test('wsShowCompactionColumn: dropped entirely when nothing in the room compacts', () => {
  // The workbook omits the column rather than printing a column of N/A.
  const none = ws.wsReconcileRoomEquipment([demand('garbage', 5000)], [], LIB);
  assert.equal(ws.wsShowCompactionColumn(none.rows), false);
  const some = ws.wsReconcileRoomEquipment([demand('garbage', 5000)],
    [inst('i1', 'transpacker', 'garbage')], LIB);
  assert.equal(ws.wsShowCompactionColumn(some.rows), true);
  // a convert row counts too — the volume left the stream
  const conv = ws.wsReconcileRoomEquipment([demand('paper', 5000)],
    [inst('i1', 'baler', 'paper')], LIB);
  assert.equal(ws.wsShowCompactionColumn(conv.rows), true);
  assert.equal(ws.wsShowCompactionColumn([]), false);
});

// ── calc vs adopted ─────────────────────────────────────────────────────
test('wsAdoptedQty: the adopted value wins, and calc is only the fallback', () => {
  assert.equal(ws.wsAdoptedQty({ calcQty: 3 }), 3, 'no adoption yet');
  assert.equal(ws.wsAdoptedQty({ calcQty: 3, adoptedQty: 4 }), 4);
  assert.equal(ws.wsAdoptedQty({ calcQty: 3, adoptedQty: 0 }), 0, 'a deliberate zero is not "unset"');
  assert.equal(ws.wsAdoptedQty(null), null);
});

test('wsQtyDivergence: a recalculation reports disagreement instead of overwriting', () => {
  assert.equal(ws.wsQtyDivergence({ stream: 'garbage', calcQty: 3, adoptedQty: 3 }), null, 'agreement is silent');
  const d = ws.wsQtyDivergence({ stream: 'garbage', calcQty: 3, adoptedQty: 5 });
  assert.deepEqual(d, { stream: 'garbage', calcQty: 3, adoptedQty: 5, delta: 2 });
  assert.equal(ws.wsQtyDivergence({ stream: 'garbage', calcQty: 3 }), null, 'nothing adopted, nothing to diverge');
});

// ── whole-room behaviour ────────────────────────────────────────────────
test('a room with a baler and a compactor reconciles both streams independently', () => {
  const r = ws.wsReconcileRoomEquipment(
    [demand('garbage', 12000, 1100, 1), demand('paper', 6000, 1100, 1), demand('glass', 2000, 240, 1)],
    [inst('i1', 'transpacker', 'garbage'), inst('i2', 'baler', 'paper'),
     inst('i3', 'bale_storage', 'paper')],
    LIB);
  assert.deepEqual(r.problems, []);
  const by = Object.fromEntries(r.rows.map(x => [x.stream, x]));
  assert.equal(by.garbage.calcQty, 3, 'densified');
  assert.equal(by.paper.calcQty, 0, 'converted away');
  assert.equal(by.glass.calcQty, 9, 'untouched, 2000 / 240');
  assert.equal(r.outputs.length, 1);
});

test('the raw requirement is always preserved alongside the reconciled one', () => {
  // Without the raw figure there is no way to show what the plant bought you.
  const r = ws.wsReconcileRoomEquipment([demand('garbage', 12000, 1100, 1)],
    [inst('i1', 'transpacker', 'garbage')], LIB);
  assert.equal(r.rows[0].rawWeeklyVolL, 12000);
  assert.equal(r.rows[0].weeklyVolL, 3000);
});

test('empty inputs produce empty output, not a crash', () => {
  const r = ws.wsReconcileRoomEquipment([], [], {});
  assert.deepEqual(r.rows, []);
  assert.deepEqual(r.outputs, []);
  assert.deepEqual(r.problems, []);
  const n = ws.wsReconcileRoomEquipment(null, null, null);
  assert.deepEqual(n.rows, []);
  assert.deepEqual(ws.wsRoomTables(null, null).storage, []);
});

test('equipment with no pairing type never changes a requirement', () => {
  // Most equipment is just furniture: it takes floor space and nothing else.
  const r = ws.wsReconcileRoomEquipment([demand('paper', 6000, 1100, 1)],
    [inst('i1', 'bale_storage', 'paper')], LIB);
  assert.equal(r.rows[0].calcQty, 6);
  assert.equal(r.rows[0].compacted, false);
  assert.deepEqual(r.problems, []);
});

// ── targets → demand, and the room view ─────────────────────────────────
const target = (stream, qty, sizeL, weeklyVolL, perWeek) =>
  ({ stream, typeId: 'b' + sizeL, sizeL, qty, weeklyVolL, perWeek });

test('wsTargetsToDemand: sums volume per stream and keeps the largest bin/frequency', () => {
  const d = ws.wsTargetsToDemand([
    target('garbage', 6, 1100, 7000, 1),
    target('garbage', 2, 660, 1500, 2),
    target('paper', 3, 1100, 3000, 1),
  ]);
  const by = Object.fromEntries(d.map(r => [r.stream, r]));
  assert.equal(by.garbage.weeklyVolL, 8500);
  assert.equal(by.garbage.qty, 8);
  assert.equal(by.garbage.binCapacityL, 1100, 'the largest container sets the basis');
  assert.equal(by.garbage.perWeek, 2, 'the most frequent collection wins');
  assert.equal(by.paper.weeklyVolL, 3000);
});

test('wsTargetsToDemand: a target with no volume marks the basis as count', () => {
  // Older saved projects predate the volume basis. Saying so is the point —
  // compaction must not be applied to a number it cannot verify.
  const d = ws.wsTargetsToDemand([target('garbage', 6, 1100, 0, 1)]);
  assert.equal(d[0].basis, 'count');
  const ok = ws.wsTargetsToDemand([target('garbage', 6, 1100, 7000, 1)]);
  assert.equal(ok[0].basis, 'volume');
  // one bad target in a stream taints that stream's basis
  const mixed = ws.wsTargetsToDemand([target('garbage', 6, 1100, 7000, 1), target('garbage', 1, 660, 0, 1)]);
  assert.equal(mixed[0].basis, 'count');
});

test('wsRoomEquipInstances: only this room, only records the library knows', () => {
  const lib = { tp: { code: 'tp', label: 'Transpacker', pairingType: 'densify', compactionRatio: 4 } };
  const equip = [
    { id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' },
    { id: 'e2', roomId: 'B', equipmentId: 'tp', stream: 'garbage' },
    { id: 'e3', roomId: 'A', equipmentId: 'unknown', stream: 'garbage' },
    { id: 'e4', roomId: 'A' },
  ];
  const got = ws.wsRoomEquipInstances('A', equip, lib);
  assert.deepEqual(got.map(g => g.id), ['e1'], 'other rooms and unknown records are excluded');
  assert.equal(got[0].stream, 'garbage', 'the assigned stream comes from the instance');
  assert.deepEqual(ws.wsRoomEquipInstances('A', null, lib), []);
});

const LIB2 = {
  tp:    { code: 'tp', label: 'Transpacker', pairingType: 'densify', compactionRatio: 4, collectable: true },
  baler: { code: 'baler', label: 'Baler', pairingType: 'convert', compactionRatio: 6,
           outputEquipmentId: 'bale', collectable: false },
  bale:  { code: 'bale', label: 'Bale storage', capacityL: 500, footprintM2: 1.2, collectable: true },
  chute: { code: 'chute', label: 'Chute compactor', pairingType: 'densify', compactionRatio: 5,
           receiverRequired: true, collectable: false },
};
const binIn = (room, stream) => ({ id: 'b' + Math.random(), roomId: room, stream });

test('the room view reduces the REQUIRED count when plant is present', () => {
  const targets = [target('garbage', 11, 1100, 12000, 1)];
  const bins = [binIn('A', 'garbage'), binIn('A', 'garbage'), binIn('A', 'garbage')];
  const equip = [{ id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' }];
  const bare = ws.wsRoomReconcileWithEquipment('A', targets, bins, [], LIB2);
  assert.equal(bare.rows[0].required, 11);
  assert.equal(bare.rows[0].ok, false, '3 of 11 without the compactor');
  assert.equal(bare.reconciled, false);

  const r = ws.wsRoomReconcileWithEquipment('A', targets, bins, equip, LIB2);
  assert.equal(r.rows[0].required, 3, '12000 / 4 / 1100 -> 3');
  assert.equal(r.rows[0].rawRequired, 11, 'the un-compacted figure is kept for context');
  assert.equal(r.rows[0].ok, true);
  assert.equal(r.rows[0].via, 'Transpacker');
  assert.equal(r.reconciled, true);
});

test('the room view exposes paired outputs and invariant breaches', () => {
  const targets = [target('paper', 6, 1100, 6000, 1)];
  const equip = [{ id: 'e1', roomId: 'A', equipmentId: 'baler', stream: 'paper' }];
  const r = ws.wsRoomReconcileWithEquipment('A', targets, [], equip, LIB2);
  assert.equal(r.rows[0].required, 0, 'converted away');
  assert.equal(r.outputs.length, 1);
  assert.equal(r.outputs[0].label, 'Bale storage');

  // a chute compactor with no receiver must not reduce anything, and must say so
  const bad = ws.wsRoomReconcileWithEquipment('A', [target('garbage', 10, 1100, 10000, 1)], [],
    [{ id: 'e1', roomId: 'A', equipmentId: 'chute', stream: 'garbage' }], LIB2);
  assert.equal(bad.rows[0].required, 10, 'requirement untouched');
  assert.equal(bad.problems.length, 1);
  assert.equal(bad.problems[0].code, 'B');
});

test('a count-basis target is never compacted, and is flagged instead', () => {
  // The honest failure: we cannot verify the volume, so we do not touch the number.
  const targets = [target('garbage', 11, 1100, 0, 1)];
  const equip = [{ id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' }];
  const r = ws.wsRoomReconcileWithEquipment('A', targets, [], equip, LIB2);
  assert.equal(r.rows[0].required, 11, 'left exactly as the calculator gave it');
  assert.equal(r.rows[0].needsVolume, true, 'and the reason is surfaced');
  assert.notEqual(r.rows[0].compacted, true);
});

test('no equipment in the room means the plain reconciliation, unchanged', () => {
  const targets = [target('garbage', 4, 1100, 4000, 1)];
  const bins = [binIn('A', 'garbage'), binIn('A', 'garbage')];
  const r = ws.wsRoomReconcileWithEquipment('A', targets, bins, [], LIB2);
  const plain = ws.wsRoomReconcile('A', targets, bins);
  assert.deepEqual(r.rows, plain.rows);
  assert.equal(r.ok, plain.ok);
  assert.deepEqual(r.problems, []);
});

test('the layout panel gets counts only — no litres leak into the room view', () => {
  const r = ws.wsRoomReconcileWithEquipment('A', [target('garbage', 11, 1100, 12000, 1)], [],
    [{ id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' }], LIB2);
  for (const row of r.rows)
    for (const k of Object.keys(row))
      assert.equal(/vol|litre|weekly/i.test(k), false, 'row exposes ' + k + ' to the panel');
});

// ── B1/B2: stream association and the picker ────────────────────────────
const ALL = ['garbage', 'recycling', 'fogo', 'glass', 'paper', 'soft'];
const rec = (id, extra = {}) => ({ id, code: id, label: id, kind: 'equipment', ...extra });

test('wsEquipAllowedStreams: an empty set is unrestricted, a populated one restricts', () => {
  // Semantic agreed with the migration: [] = generic, populated = physically limited.
  assert.deepEqual(ws.wsEquipAllowedStreams(rec('generic', { streams: [] }), ALL), ALL);
  assert.deepEqual(ws.wsEquipAllowedStreams(rec('generic'), ALL), ALL, 'missing is the same as empty');
  assert.deepEqual(ws.wsEquipAllowedStreams(rec('baler', { streams: ['paper', 'soft'] }), ALL),
    ['paper', 'soft']);
  // the equipment pseudo-stream is never assignable
  assert.equal(ws.wsEquipAllowedStreams(rec('x'), ALL.concat('equip')).includes('equip'), false);
});

test('wsEquipAllowedStreams: an allowable stream that is not a calculator stream is dropped', () => {
  assert.deepEqual(ws.wsEquipAllowedStreams(rec('odd', { streams: ['paper', 'unobtainium'] }), ALL),
    ['paper'], 'only real streams survive');
});

test('wsEquipAssignStream: the user choice wins when the item allows it', () => {
  const baler = rec('baler', { streams: ['paper', 'soft'] });
  assert.equal(ws.wsEquipAssignStream(baler, 'paper', ALL), 'paper');
  assert.equal(ws.wsEquipAssignStream(baler, 'soft', ALL), 'soft');
});

test('wsEquipAssignStream: an impossible choice falls back, it never silently accepts', () => {
  const baler = rec('baler', { streams: ['paper', 'soft'] });
  assert.equal(ws.wsEquipAssignStream(baler, 'glass', ALL), 'paper',
    'a baler cannot serve glass, so it takes its first allowable stream instead');
  // an unrestricted item takes whatever was asked for
  assert.equal(ws.wsEquipAssignStream(rec('bin', { streams: [] }), 'glass', ALL), 'glass');
  // nothing assignable at all is null, so the caller can refuse
  assert.equal(ws.wsEquipAssignStream(rec('weird', { streams: ['unobtainium'] }), 'glass', ALL), null);
});

test('wsEquipLibrary: keyed by id, so a rename cannot break a reference', () => {
  const lib = ws.wsEquipLibrary([rec('a'), rec('b'), null, { label: 'no id' }]);
  assert.deepEqual(Object.keys(lib).sort(), ['a', 'b']);
  assert.equal(lib.a.id, 'a');
  assert.deepEqual(ws.wsEquipLibrary(null), {});
});

test('wsEquipPickerGroups: grouped by category, with dimensions and stream badges', () => {
  const db = [
    rec('baler', { category: 'Compaction', label: 'Baler', w: 1.8, d: 1.0,
                   streams: ['paper', 'soft'], pairingType: 'convert' }),
    rec('tp', { category: 'Compaction', label: 'Transpacker', w: 6.2, d: 2.4, pairingType: 'densify' }),
    rec('cage', { category: 'Storage', label: 'Cage', w: 1.2, d: 1.0 }),
    { id: 'bin', kind: 'bin', label: 'A bin', category: 'Bins' },
  ];
  const g = ws.wsEquipPickerGroups(db, ALL);
  assert.deepEqual(g.map(x => x.category), ['Compaction', 'Storage'], 'sorted, bins excluded');
  const baler = g[0].items.find(i => i.id === 'baler');
  assert.equal(baler.dims, '1800×1000');
  assert.deepEqual(baler.streams, ['paper', 'soft']);
  assert.equal(baler.restricted, true, 'a badge is warranted');
  assert.equal(baler.pairingType, 'convert');
  const tp = g[0].items.find(i => i.id === 'tp');
  assert.equal(tp.restricted, false, 'unrestricted items get no badge');
  assert.deepEqual(tp.streams, ALL);
});

test('wsEquipPickerGroups: an item with no dimensions still lists', () => {
  const g = ws.wsEquipPickerGroups([rec('x', { category: 'Compaction', label: 'X' })], ALL);
  assert.equal(g[0].items[0].dims, null, 'no size rather than a fabricated one');
  assert.deepEqual(ws.wsEquipPickerGroups(null, ALL), []);
});

// ── B5: legacy migration ────────────────────────────────────────────────
test('wsMigrateEquipInstance: maps a legacy fixture code onto its library record', () => {
  const db = [rec('eq_baler', { code: 'BALER', label: 'Baler' })];
  const item = { id: 'i1', code: 'BALER', label: 'Baler' };
  ws.wsMigrateEquipInstance(item, db);
  assert.equal(item.equipmentId, 'eq_baler');
  assert.equal(item.legacy, undefined, 'a mapped item is not legacy');
});

test('wsMigrateEquipInstance: an unmatched code is PRESERVED and flagged, never re-pointed', () => {
  // The alternative, guessing at the nearest record, would silently change what
  // an old drawing says. Keeping it as-is is the only safe answer.
  const db = [rec('eq_baler', { code: 'BALER' })];
  const item = { id: 'i1', code: 'ANCIENT_THING', label: 'Ancient thing', w: 1, d: 1 };
  ws.wsMigrateEquipInstance(item, db);
  assert.equal(item.equipmentId, undefined, 'not pointed at anything');
  assert.equal(item.legacy, true);
  assert.equal(item.label, 'Ancient thing', 'and still draws exactly as before');
  assert.equal(item.w, 1);
});

test('wsMigrateEquipInstance: an already-migrated item is left alone', () => {
  const db = [rec('eq_other', { code: 'BALER' })];
  const item = { id: 'i1', code: 'BALER', equipmentId: 'eq_original' };
  ws.wsMigrateEquipInstance(item, db);
  assert.equal(item.equipmentId, 'eq_original', 'migration must be idempotent');
});

test('wsMigrateEquipInstance: matching is case-insensitive on the code', () => {
  const db = [rec('eq_baler', { code: 'baler' })];
  const item = { id: 'i1', code: 'BALER' };
  ws.wsMigrateEquipInstance(item, db);
  assert.equal(item.equipmentId, 'eq_baler');
});

test('wsMigrateEquipList: reports what it mapped and what it kept', () => {
  const db = [rec('eq_baler', { code: 'BALER' })];
  const list = [
    { id: 'a', code: 'BALER' },
    { id: 'b', code: 'MYSTERY' },
    { id: 'c', equipmentId: 'eq_baler' },
    { id: 'd' },
  ];
  const r = ws.wsMigrateEquipList(list, db);
  assert.equal(r.mapped, 1);
  assert.equal(r.legacy, 1);
  assert.equal(list[3].legacy, undefined, 'an item with no code at all is plain, not legacy');
  // running it twice changes nothing
  assert.deepEqual(ws.wsMigrateEquipList(list, db), { mapped: 0, legacy: 1 });
  assert.deepEqual(ws.wsMigrateEquipList(null, db), { mapped: 0, legacy: 0 });
});

test('a migrated instance is immediately usable by the reconciler', () => {
  // The point of B5: an old plan starts reconciling once the library loads.
  const db = [rec('eq_tp', { code: 'TRANSPACKER', label: 'Transpacker',
                             pairingType: 'densify', compactionRatio: 4 })];
  const item = { id: 'i1', code: 'TRANSPACKER', roomId: 'A', stream: 'garbage' };
  ws.wsMigrateEquipList([item], db);
  const lib = ws.wsEquipLibrary(db);
  const insts = ws.wsRoomEquipInstances('A', [item], lib);
  assert.equal(insts.length, 1, 'the reconciler can see it now');
  const r = ws.wsReconcileRoomEquipment(
    [{ stream: 'garbage', weeklyVolL: 12000, binCapacityL: 1100, perWeek: 1 }], insts, lib);
  assert.equal(r.rows[0].calcQty, 3);
});

test('placement records library identity and an explicit stream', () => {
  const { SOURCE } = require('./extract.js');
  assert.match(SOURCE, /const assigned = libRec \? wsEquipAssignStream\(libRec, st\.id, order\) : st\.id;/,
    'the stream must be resolved against the allowable set at placement time');
  assert.match(SOURCE, /equipmentId: libRec \? libRec\.id : null,/, 'identity by id, never by name');
  assert.match(SOURCE, /receiver: libRec \? !!libRec\.receiver : false,/);
  assert.match(SOURCE, /if \(libRec && !assigned\)/, 'an unassignable item must be refused, not guessed');
});

// ── snapshot for the WMP generator ──────────────────────────────────────
const SLIB = {
  tp:    { code: 'tp', label: 'Transpacker', pairingType: 'densify', compactionRatio: 4,
           footprintM2: 15.5, collectable: true },
  baler: { code: 'baler', label: 'Cardboard baler', pairingType: 'convert', compactionRatio: 6,
           outputEquipmentId: 'bale', footprintM2: 1.8, collectable: false },
  bale:  { code: 'bale', label: 'Bale storage', capacityL: 500, footprintM2: 1.2, collectable: true },
  spare: { code: 'spare', label: 'Spare 1100L bin', capacityL: 1100, footprintM2: 1.47, collectable: true },
};
const sRoom = (id, name, calcRoom) => ({ id, name, calcRoom });
const sTarget = (stream, qty, sizeL, volL) =>
  ({ stream, typeId: 'b' + sizeL, sizeL, qty, weeklyVolL: volL, perWeek: 1 });

test('wsReconcileSnapshot: one record per room, with reconciled and raw counts', () => {
  const rooms = [sRoom('A', 'Residential bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Residential bin room', kind: 'res',
                  targets: [sTarget('garbage', 11, 1100, 12000)] }];
  const slot = { bins: [], equip: [{ id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' }] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, SLIB);
  assert.equal(snap.length, 1);
  const r = snap[0];
  assert.equal(r.roomId, 'A');
  assert.equal(r.roomName, 'Residential bin room');
  assert.equal(r.streams[0].required, 3, 'the document must see the reconciled count');
  assert.equal(r.streams[0].rawRequired, 11, 'and the figure it replaced');
  assert.equal(r.streams[0].compacted, true);
  assert.equal(r.showCompactionColumn, true);
  assert.ok(Math.abs(r.footprintM2 - 15.5) < 1e-9);
});

test('wsReconcileSnapshot: paired outputs and receivers are carried, not implied', () => {
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room', targets: [sTarget('paper', 6, 1100, 6000)] }];
  const slot = { bins: [], equip: [
    { id: 'e1', roomId: 'A', equipmentId: 'baler', stream: 'paper' },
    { id: 'e2', roomId: 'A', equipmentId: 'spare', stream: 'garbage', receiver: true },
  ] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, SLIB)[0];
  assert.equal(snap.outputs.length, 1, 'the bales must reach the document');
  assert.equal(snap.outputs[0].label, 'Bale storage');
  assert.equal(snap.receivers.length, 1);
  assert.equal(snap.receivers[0].label, 'Spare 1100L bin');
  // the receiver is in storage but never in the collection table
  assert.ok(snap.storage.some(x => x.instanceId === 'e2'));
  assert.equal(snap.collection.some(x => x.instanceId === 'e2'), false);
});

test('wsReconcileSnapshot: a room with no schedule is omitted entirely', () => {
  const snap = ws.wsReconcileSnapshot([sRoom('A', 'Unassigned room', null)], [], { bins: [], equip: [] }, SLIB);
  assert.deepEqual(snap, [], 'nothing to reconcile means nothing to hand over');
  assert.deepEqual(ws.wsReconcileSnapshot(null, null, null, null), []);
});

test('wsReconcileSnapshot: invariant breaches travel with the record', () => {
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room', targets: [sTarget('paper', 6, 1100, 6000)] }];
  const lib = { ...SLIB, orphan: { code: 'orphan', label: 'Unpaired baler',
                                   pairingType: 'convert', compactionRatio: 6 } };
  const slot = { bins: [], equip: [{ id: 'e1', roomId: 'A', equipmentId: 'orphan', stream: 'paper' }] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, lib)[0];
  assert.equal(snap.streams[0].required, 6, 'nothing reduced');
  assert.equal(snap.problems.length, 1);
  assert.equal(snap.problems[0].code, 'A');
});

// ── WMP text obligations ────────────────────────────────────────────────
test('wsWmpEquipmentText: a baler earns its paragraph, with the bale count', () => {
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room', targets: [sTarget('paper', 6, 1100, 6000)] }];
  const slot = { bins: [], equip: [{ id: 'e1', roomId: 'A', equipmentId: 'baler', stream: 'paper' }] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, SLIB)[0];
  const text = ws.wsWmpEquipmentText(snap, SLIB);
  const baler = text.find(t => /baler/i.test(t));
  assert.ok(baler, 'the baler paragraph is an obligation, not an option');
  assert.match(baler, /maximum of 2 bales/, 'the stored quantity comes from the reconciliation');
  assert.match(baler, /Bin room/, 'and says where');
  assert.match(baler, /dedicated recycler/i);
  assert.match(baler, /not presented with the general waste/i, 'the separation must be explicit');
});

test('wsWmpEquipmentText: a receiver earns the permanent-allocation note', () => {
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room', targets: [sTarget('garbage', 4, 1100, 4000)] }];
  const slot = { bins: [], equip: [
    { id: 'e2', roomId: 'A', equipmentId: 'spare', stream: 'garbage', receiver: true }] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, SLIB)[0];
  const note = ws.wsWmpEquipmentText(snap, SLIB).find(t => /permanently allocated/i.test(t));
  assert.ok(note);
  assert.match(note, /excluded from the collection schedule/i);
});

test('wsWmpEquipmentText: no compaction means NO compaction language at all', () => {
  // The workbook drops the column; the narrative must drop the sentence, rather
  // than hedging with "compaction, if provided...".
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room', targets: [sTarget('garbage', 4, 1100, 4000)] }];
  const snap = ws.wsReconcileSnapshot(rooms, calc, { bins: [], equip: [] }, SLIB)[0];
  const text = ws.wsWmpEquipmentText(snap, SLIB);
  assert.deepEqual(text, [], 'a plain room reads exactly as it did before');
  assert.equal(ws.wsWmpShowCompaction(snap), false);
});

test('wsWmpEquipmentText: compaction language appears only for compacted streams', () => {
  const rooms = [sRoom('A', 'Bin room', 'R1')];
  const calc = [{ id: 'R1', name: 'Bin room',
                  targets: [sTarget('garbage', 11, 1100, 12000), sTarget('glass', 3, 240, 700)] }];
  const slot = { bins: [], equip: [{ id: 'e1', roomId: 'A', equipmentId: 'tp', stream: 'garbage' }] };
  const snap = ws.wsReconcileSnapshot(rooms, calc, slot, SLIB)[0];
  const line = ws.wsWmpEquipmentText(snap, SLIB).find(t => /Compaction is provided/i.test(t));
  assert.ok(line);
  assert.match(line, /garbage/);
  assert.equal(/glass/.test(line), false, 'an uncompacted stream must not be claimed as compacted');
  assert.match(line, /Transpacker/, 'the unit doing the work is named');
  assert.equal(ws.wsWmpShowCompaction(snap), true);
});

test('wsWmpEquipmentText: tolerates a missing record without breaking the document', () => {
  assert.deepEqual(ws.wsWmpEquipmentText(null, SLIB), []);
  assert.deepEqual(ws.wsWmpEquipmentText({}, null), []);
});

test('the WMP narrative only speaks when the layout has something to say', () => {
  const { SOURCE } = require('./extract.js');
  assert.match(SOURCE, /wsWmpEquipmentText\(snap, wsEquipLibrary\(WS_EQUIP_DB\)\)/,
    'the obligations must be generated from the reconciliation, not retyped');
  assert.match(SOURCE, /catch \(e\) \{ \/\* the document must still build without the layout \*\//,
    'a missing layout must never block the document');
});

test('the project snapshot publishes the reconciliation for the generator', () => {
  const { SOURCE } = require('./extract.js');
  assert.match(SOURCE, /reconciliation: \(\(\) => \{/, 'the draft must carry it');
  assert.match(SOURCE, /wsReconcileSnapshot\(wsLayoutSlot\(\)\.rooms, WS_CALC_ROOMS/);
  assert.match(SOURCE, /reconciliation snapshot skipped/, 'and must never break saving if it fails');
});
