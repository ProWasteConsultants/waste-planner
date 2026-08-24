'use strict';
// B6 provision streams and B7 zone types.
//
// A PROVISION stream is something a development must provide for but which has
// no generation rate — you cannot compute litres of e-waste per dwelling per
// week. So it is deliberately absent from the bin calculator and reconciles as
// a presence check, never a count.
//
// A ZONE is a floor-area claim, not an equipment record: no capacity, no
// compaction ratio, never in a collection table. It reserves space, and it can
// satisfy a provision stream.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadLayout, SOURCE } = require('./extract.js');

const ws = loadLayout();

// ── provision streams ───────────────────────────────────────────────────
test('the predefined provision list is the agreed five', () => {
  assert.deepEqual(ws.WS_PROVISION_STREAMS.map(p => p.id),
    ['uco', 'ewaste', 'hardwaste', 'clinical', 'bulk']);
  for (const p of ws.WS_PROVISION_STREAMS) {
    assert.ok(p.label && p.label.length > 2, p.id + ' needs a readable label');
    assert.match(p.col, /^#[0-9A-Fa-f]{6}$/, p.id + ' needs a drawable colour');
  }
});

test('provision streams are NOT calculator streams', () => {
  // The whole point: no generation rate, so they must never appear in the
  // calculator's stream list or they would be expected to produce litres.
  const calc = ws.WS_STREAMS.map(s => s.id);
  for (const p of ws.WS_PROVISION_STREAMS)
    assert.equal(calc.includes(p.id), false, p.id + ' must not be a calculator stream');
});

test('wsProvisionCustomId: namespaced so a custom entry can never collide', () => {
  assert.equal(ws.wsProvisionCustomId('Battery drop-off'), 'custom:battery-drop-off');
  assert.equal(ws.wsProvisionCustomId('  Mattress   Storage  '), 'custom:mattress-storage');
  assert.equal(ws.wsProvisionCustomId('E-waste'), 'custom:e-waste',
    'even a name matching a predefined one is namespaced apart');
  // a future predefined id can therefore never be shadowed by an old custom one
  for (const p of ws.WS_PROVISION_STREAMS)
    assert.notEqual(ws.wsProvisionCustomId(p.label), p.id);
});

test('wsProvisionList: predefined first, then user-defined', () => {
  const list = ws.wsProvisionList([{ label: 'Battery drop-off' }, { label: 'Mattresses' }]);
  assert.equal(list.length, 7);
  assert.deepEqual(list.slice(0, 5).map(p => p.id), ws.WS_PROVISION_STREAMS.map(p => p.id));
  assert.equal(list[5].custom, true);
  assert.equal(list[5].id, 'custom:battery-drop-off');
  assert.match(list[5].col, /^#[0-9A-Fa-f]{6}$/, 'a custom entry still needs a colour to draw');
  // junk entries are dropped rather than producing a nameless row
  assert.equal(ws.wsProvisionList([{ }, null, { label: '' }]).length, 5);
  assert.equal(ws.wsProvisionList(null).length, 5);
});

test('wsProvisionById: finds predefined and custom alike', () => {
  const custom = [{ label: 'Battery drop-off' }];
  assert.equal(ws.wsProvisionById('uco', custom).label, 'Used cooking oil');
  assert.equal(ws.wsProvisionById('custom:battery-drop-off', custom).label, 'Battery drop-off');
  assert.equal(ws.wsProvisionById('nope', custom), null);
});

test('wsProvisionReconcile: a presence check, not a count', () => {
  const items = [
    { roomId: 'A', provisionStream: 'uco' },
    { roomId: 'A', provisionStream: 'uco' },      // a second one changes nothing
    { roomId: 'B', provisionStream: 'ewaste' },   // another room
  ];
  const r = ws.wsProvisionReconcile('A', ['uco', 'ewaste'], items);
  assert.deepEqual(r.rows, [
    { provision: 'uco', placed: true, count: 2 },
    { provision: 'ewaste', placed: false, count: 0 },
  ]);
  assert.equal(r.ok, false, 'one unprovided stream is enough to fail');
  assert.deepEqual(r.missing, ['ewaste']);
});

test('wsProvisionReconcile: satisfied when everything assigned is provided', () => {
  const r = ws.wsProvisionReconcile('A', ['uco'], [{ roomId: 'A', provisionStream: 'uco' }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test('wsProvisionReconcile: nothing assigned is not "satisfied"', () => {
  // A room with no provision obligations has nothing to report, and must not
  // render a green tick implying it was checked.
  const r = ws.wsProvisionReconcile('A', [], [{ roomId: 'A', provisionStream: 'uco' }]);
  assert.deepEqual(r.rows, []);
  assert.equal(r.ok, false);
  assert.deepEqual(ws.wsProvisionReconcile('A', null, null).rows, []);
});

test('wsProvisionReconcile: only items in THIS room count', () => {
  const r = ws.wsProvisionReconcile('A', ['uco'], [{ roomId: 'B', provisionStream: 'uco' }]);
  assert.equal(r.rows[0].placed, false, 'a vessel in the next room does not provide for this one');
});

// ── zone types ──────────────────────────────────────────────────────────
test('the zone types are the agreed set, each with a footprint default', () => {
  assert.deepEqual(Object.keys(ws.WS_ZONE_TYPES).sort(), ['BALE', 'CUSTOM', 'HARDWASTE', 'UCO']);
  for (const k of Object.keys(ws.WS_ZONE_TYPES)) {
    const t = ws.WS_ZONE_TYPES[k];
    assert.ok(t.w > 0 && t.d > 0, k + ' needs a default size to place');
    assert.match(t.col, /^#[0-9A-Fa-f]{6}$/);
  }
  // the two that exist to satisfy a provision say so
  assert.equal(ws.WS_ZONE_TYPES.HARDWASTE.provision, 'hardwaste');
  assert.equal(ws.WS_ZONE_TYPES.UCO.provision, 'uco');
  assert.equal(ws.WS_ZONE_TYPES.BALE.provision, null, 'bale storage answers to a baler, not a provision');
});

test('wsIsZone: a zone is identified by its type, not by its label', () => {
  assert.equal(ws.wsIsZone({ zoneType: 'UCO' }), true);
  assert.equal(ws.wsIsZone({ zoneType: 'NONSENSE' }), false, 'an unknown type is not a zone');
  assert.equal(ws.wsIsZone({ label: 'UCO vessel' }), false, 'a label alone proves nothing');
  assert.equal(ws.wsIsZone(null), false);
});

test('wsZoneColour / wsZoneLabel: an override wins, else the type default', () => {
  assert.equal(ws.wsZoneColour({ zoneType: 'UCO' }), ws.WS_ZONE_TYPES.UCO.col);
  assert.equal(ws.wsZoneColour({ zoneType: 'UCO', col: '#123456' }), '#123456');
  assert.equal(ws.wsZoneColour({ zoneType: 'NONSENSE' }), ws.WS_ZONE_TYPES.CUSTOM.col);
  assert.equal(ws.wsZoneLabel({ zoneType: 'BALE' }), 'Bale storage');
  assert.equal(ws.wsZoneLabel({ zoneType: 'CUSTOM', label: 'Pallet return' }), 'Pallet return');
  assert.equal(ws.wsZoneLabel(null), '');
});

test('wsZoneDxfLayer: predefined types get stable layers, custom derives from its label', () => {
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'UCO' }), 'A-WASTE-ZONE-UCO');
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'HARDWASTE' }), 'A-WASTE-ZONE-HARDWASTE');
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'CUSTOM', label: 'Pallet return' }),
    'A-WASTE-ZONE-PALLET-RETURN');
  // a CAD layer name must survive punctuation, and long labels are truncated
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'CUSTOM', label: 'Mattress / bulky (level 2)' }),
    'A-WASTE-ZONE-MATTRESS-BULKY-LEVEL-2');
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'CUSTOM', label: 'A very long zone name indeed that keeps going' }),
    'A-WASTE-ZONE-A-VERY-LONG-ZONE-NAME', 'truncated on a word boundary, never mid-word');
  assert.equal(ws.wsZoneDxfLayer({ zoneType: 'CUSTOM', label: '!!!' }), 'A-WASTE-ZONE-CUSTOM',
    'a label with nothing usable still yields a valid layer');
  assert.equal(ws.wsZoneDxfLayer(null), 'A-WASTE-ZONE');
});

test('wsZoneDxfLayer: every generated layer is a legal CAD name', () => {
  for (const label of ['Pallet return', 'UCO', 'x', 'A'.repeat(60), 'e-waste & batteries'])
    assert.match(ws.wsZoneDxfLayer({ zoneType: 'CUSTOM', label }), /^A-WASTE-ZONE-[A-Z0-9-]+$/);
});

test('wsZoneLegendItems: only the zones actually on the page, deduped', () => {
  const items = [
    { zoneType: 'UCO' },
    { zoneType: 'UCO' },                                   // same type, one row
    { zoneType: 'CUSTOM', label: 'Pallet return', col: '#112233' },
    { zoneType: 'HARDWASTE' },
    { label: 'not a zone' },
  ];
  const rows = ws.wsZoneLegendItems(items);
  assert.equal(rows.length, 3, 'deduped, and the non-zone excluded');
  assert.deepEqual(rows.map(r => r.label).sort(), ['Hard waste zone', 'Pallet return', 'UCO vessel']);
  for (const r of rows) {
    assert.equal(r.style, 'hatch', 'zones read as a floor claim, like the keep-clear convention');
    assert.match(r.col, /^#[0-9A-Fa-f]{6}$/);
  }
  assert.deepEqual(ws.wsZoneLegendItems([]), []);
  assert.deepEqual(ws.wsZoneLegendItems(null), []);
});

test('two custom zones with different labels get separate legend rows', () => {
  const rows = ws.wsZoneLegendItems([
    { zoneType: 'CUSTOM', label: 'Pallet return' },
    { zoneType: 'CUSTOM', label: 'Mattress store' },
  ]);
  assert.equal(rows.length, 2, 'a custom zone is identified by its label, not its type');
});

// ── wiring ──────────────────────────────────────────────────────────────
test('zones draw with the keep-clear hatch, in their own colour', () => {
  assert.ok(SOURCE.includes('if (e.aisle || wsIsZone(e) || wsIsHardWasteZone(e)) {'),
    'typed zones must reach the zone renderer');
  assert.ok(SOURCE.includes("const zHex = wsIsZone(e) ? wsZoneColour(e) : (zone ? WS_ZONE_PURPLE : '#DC4646');"));
});

test('zones export to DXF on their own layer and to the PDF legend', () => {
  assert.ok(SOURCE.includes("const zl = zone ? wsZoneDxfLayer(e) : 'A-WASTE-AISLES'"),
    'a zone must not share the aisle layer');
  assert.ok(SOURCE.includes('zones: wsZoneLegendItems(equip),'), 'the legend must see them');
  assert.ok(SOURCE.includes('c.zones.forEach(z => out.push(z));'));
});

test('the WMP room link uses the calculator room id, not the room name', () => {
  // Name matching failed silently on a rename. Both sides already carried the
  // calculator id: the generator as room.srcId, the drawn room as room.calcRoom.
  assert.ok(SOURCE.includes('(room.srcId && x.calcRoomId === room.srcId)'),
    'the exact key must be preferred');
  assert.ok(SOURCE.includes('(!room.srcId && x.roomName && room.name &&'),
    'a manually added room with no srcId still falls back to the name');
});
