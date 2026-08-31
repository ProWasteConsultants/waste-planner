'use strict';
// ── D2/D3: vehicle side-elevation module + swept title-block panel ─────────
// The profiles are GENERATED from dimensions (never traced artwork): one
// geometry, two detail levels, wheels at real axle positions, and a documented
// body-type fallback for null dimensions. The D3 panel appears only when the
// swept layer printed, and states the vehicle's source — a contractor's truck
// must never read as a design standard.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, loadSheet, SOURCE } = require('./extract.js');

const VEH_BLOCKS = [
  ['VEHICLE_PROFILE_DEFAULTS', /^const VEHICLE_PROFILE_DEFAULTS = \{/],
  ['VEHICLES',                 /^const VEHICLES = \{/],
  ['vehicleProfileResolve',    /^function vehicleProfileResolve\(/],
  ['axlePositions',            /^function axlePositions\(/],
  ['vehicleProfileSVG',        /^function vehicleProfileSVG\(/],
  ['vehicleProfileSpecFromVeh', /^function vehicleProfileSpecFromVeh\(/],
  ['wsVehSource',              /^function wsVehSource\(/],
  ['wsVehStandard',            /^function wsVehStandard\(/],
];
const vp = loadEngine({ blocks: VEH_BLOCKS });

// ── axle configurations ─────────────────────────────────────────────────
test('axlePositions: 8x4 twin-steer — four axles where the Scania actually has them', () => {
  // wheelbase runs LEADING steer axle → rear group CENTRE, per the module contract
  const ax = vp.axlePositions(vp.VEHICLES.front_lift_8x4);
  assert.equal(ax.front.length, 2, 'twin steer = two front axles');
  assert.equal(ax.rear.length, 2);
  assert.equal(ax.front[0], 1450, 'leading steer axle at the front overhang');
  assert.equal(ax.front[1], 1450 + 1950);
  const rc = 1450 + 5425;
  assert.deepEqual(ax.rear, [rc - 1775 / 2, rc + 1775 / 2], 'rear pair straddles the group centre');
});

test('axlePositions: 4x2 — one axle each end, rear at frontOverhang + wheelbase', () => {
  const ax = vp.axlePositions({ frontOverhang: 1400, wheelbase: 5000, frontAxles: 1, rearAxles: 1 });
  assert.deepEqual(ax.front, [1400]);
  assert.deepEqual(ax.rear, [6400]);
});

test('axlePositions: a spec with nothing at all still yields sane positions', () => {
  const ax = vp.axlePositions({});
  assert.equal(ax.front.length, 1);
  assert.equal(ax.rear.length, 1);
  assert.ok(ax.rear[0] > ax.front[0]);
});

// ── null fallback is documented behaviour, not an error ─────────────────
test('vehicleProfileResolve: nulls fall back to body-type defaults and are FLAGGED estimated', () => {
  const { spec, estimated } = vp.vehicleProfileResolve({ body: 'rear_lift', wheelbase: 4500 });
  assert.equal(spec.wheelbase, 4500, 'a real value survives');
  assert.equal(spec.overallHeight, vp.VEHICLE_PROFILE_DEFAULTS.rear_lift.overallHeight);
  assert.ok(estimated.includes('overallHeight'), 'the default is flagged, never silently authoritative');
  assert.ok(!estimated.includes('wheelbase'));
});

test('vehicleProfileResolve: an unknown body renders as the generic rigid truck', () => {
  const { spec } = vp.vehicleProfileResolve({ body: 'hovercraft' });
  assert.equal(spec.body, 'rigid', 'no lift gear is invented for a body we do not know');
});

test('the Scania record carries the manufacturer figures and admits its estimates', () => {
  const v = vp.VEHICLES.front_lift_8x4;
  assert.equal(v.overallLength, 9676);
  assert.equal(v.wheelbase, 5425);
  assert.equal(v.rearAxleSpread, 1775);
  assert.equal(v.overallHeight, 4300);
  assert.equal(v.operatingHeight, 6500, 'the GOVERNING case (4.5 m³ bin) is the stored envelope');
  assert.equal(v.operatingHeightMax, 7000, 'the 8 m³ cardboard case is recorded alongside');
  assert.ok(v.estimated.includes('frontOverhang'), 'undimensioned drawing fields stay marked estimated');
});

// ── one geometry, two render levels ─────────────────────────────────────
test('vehicleProfileSVG: detailed fills, schematic outlines — same wheel positions', () => {
  const spec = vp.VEHICLES.front_lift_8x4;
  const det = vp.vehicleProfileSVG(spec, { detail: 'detailed' });
  const sch = vp.vehicleProfileSVG(spec, { detail: 'schematic' });
  assert.ok(det.includes('--vehicle-tyre'), 'detailed paints tyres from the CSS variable');
  assert.ok(sch.includes('fill="none"'), 'schematic is outline only');
  // wheels sit at the REAL axle x positions in both renders
  for (const wx of vp.axlePositions(spec).front.concat(vp.axlePositions(spec).rear)) {
    assert.ok(det.includes(`<circle cx="${wx}"`), 'detailed wheel at ' + wx);
    assert.ok(sch.includes(`<circle cx="${wx}"`), 'schematic wheel at ' + wx);
  }
});

test('vehicleProfileSVG: the operating envelope is drawn dashed, with the height stated', () => {
  const on = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, {});
  assert.ok(on.includes('stroke-dasharray'), 'envelope on by default when a height exists');
  assert.ok(on.includes('6.5 m operating clearance'));
  const off = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, { showEnvelope: false });
  assert.ok(!off.includes('operating clearance'));
  // the generic rigid truck has no operating height and therefore no envelope
  const rigid = vp.vehicleProfileSVG({ body: 'rigid' }, {});
  assert.ok(!rigid.includes('operating clearance'));
});

test('vehicleProfileSVG: opts.palette substitutes concrete colours for print (svg2pdf cannot resolve vars)', () => {
  const svg = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4,
    { detail: 'schematic', palette: { stroke: '#1a1a1a', rim: '#8a8a8a', body: 'none', chassis: 'none', tyre: 'none' } });
  assert.ok(!svg.includes('var(--vehicle'), 'no CSS variable survives into the print render');
  assert.ok(svg.includes('#1a1a1a'));
});

// ── DB record → spec mapping ────────────────────────────────────────────
test('vehicleProfileSpecFromVeh: body from the record’s own words, metres to millimetres', () => {
  const spec = vp.vehicleProfileSpecFromVeh({ cat: 'Front Loader', name: 'FL', wb: 4.8, fo: 3.2, ro: 1.5, bw: 2.55, heightM: 4.3 });
  assert.equal(spec.body, 'front_lift');
  assert.equal(spec.wheelbase, 4800);
  assert.equal(spec.overallLength, 9500);
  assert.equal(spec.overallHeight, 4300);
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Hook Lift / Skip Bin', name: '' }).body, 'hook_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Mini Rear Loader', name: '' }).body, 'rear_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Side Loader', name: '' }).body, 'side_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Austroads AP-G34-23 Design Vehicles', name: 'Service Vehicle' }).body,
    'rigid', 'a generic design vehicle grows no lift gear');
});

// ── source: design vehicle vs one operator's truck ──────────────────────
test('wsVehSource: guideline is the default; only an explicit record is a contractor vehicle', () => {
  assert.equal(vp.wsVehSource({}), 'guideline', 'built-in presets are design vehicles');
  assert.equal(vp.wsVehSource({ source: 'contractor' }), 'contractor');
  assert.equal(vp.wsVehSource({ source: 'manufacturer' }), 'manufacturer');
  assert.equal(vp.wsVehSource(null), 'guideline');
});

test('the selector marks contractor vehicles and the DB mapping honours the source column', () => {
  assert.ok(SOURCE.includes("${wsVehSource(v) === 'contractor' ? ' [contractor]' : ''}"),
    'contractor vehicles are visually distinguishable in the selector');
  assert.ok(SOURCE.includes("source: r.source || (r.council_value || !r.company ? 'guideline' : 'contractor'),"),
    'explicit source column wins; the old inference is only the fallback');
});

// ── the applicable standard comes from the record, never hardcoded ──────
test('wsVehStandard: reads AS 2890 / AP-G34 from the vehicle’s own category or notes', () => {
  assert.equal(vp.wsVehStandard({ cat: 'x', notes: 'per AS 2890.2 commercial facilities' }), 'AS 2890.2');
  assert.equal(vp.wsVehStandard({ cat: 'Austroads AP-G34-23 Design Vehicles', notes: '' }), 'AP-G34-23');
  assert.equal(vp.wsVehStandard({ cat: 'Rear Loader', notes: '' }), null, 'nothing recorded, nothing printed');
});

// ── D3: the panel exists only when swept paths printed ──────────────────
const sheet = loadSheet();
const VIEW = { x: 10, y: 10, w: 400, h: 277 };

test('wsSheetCardRects: opts.swept turns the reservation into a live centred card', () => {
  const r = sheet.wsSheetCardRects(VIEW, { legendRows: 8, swept: true });
  assert.ok(r.swept, 'the panel rect exists');
  assert.equal(r.sweptReserved, undefined, 'reservation and live card never coexist');
  const mid = r.swept.x + r.swept.w / 2;
  assert.ok(Math.abs(mid - (VIEW.x + VIEW.w / 2)) < 1e-6, 'bottom-centre, where the band was reserved');
  assert.ok(r.swept.y + r.swept.h <= VIEW.y + VIEW.h + 1e-9, 'inside the viewport');
  assert.deepEqual(sheet.wsSheetCardCollisions(r), [], 'clear of the title card and legend');
});

test('layer off → export unchanged: the panel is gated on live swept state at export time', () => {
  assert.ok(SOURCE.includes('swept: sweptOn && sweptVehIds.length > 0'),
    'the card rect only exists when swept paths actually printed');
  assert.ok(SOURCE.includes('if (cards.swept) await wsSheetVehPanel(doc, cards.swept, wsVehById(sweptVehIds[0])'),
    'the panel draws the vehicle the paths were driven with');
  const panel = SOURCE.slice(SOURCE.indexOf('async function wsSheetVehPanel'), SOURCE.indexOf('// North arrow'));
  assert.ok(panel.includes("detail: 'schematic', showEnvelope: true"),
    'title block uses the schematic level with the envelope on');
  assert.ok(panel.includes('one operator’s fleet — not a design standard'),
    'a contractor vehicle is labelled as such ON THE DRAWING');
  assert.ok(panel.includes('(v.minR * 2).toFixed(1)') && panel.includes('(v.rww * 2).toFixed(1)'),
    'turning circles are the identity 2×R of the stored radii — no duplicate columns');
});
