'use strict';
// ── D2/D3: vehicle side-elevation module + swept title-block panel ─────────
// The supplied vehicle-profiles.js is inlined verbatim inside the VP_MODULE
// IIFE; these tests exercise the REAL inlined code via extraction — never a
// copy. Profiles are generated from dimensions (no traced artwork), wheels at
// real axle positions, four body types and a hard throw on a fifth. The D3
// panel appears only when the swept layer printed, and states the vehicle's
// source — a contractor's truck must never read as a design standard.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, loadSheet, SOURCE } = require('./extract.js');

const VEH_BLOCKS = [
  ['VP_MODULE',                 /^const VP_MODULE = \(\(\) => \{/],
  ['vehicleProfileSVG',         /^const vehicleProfileSVG = VP_MODULE/],
  ['axlePositions',             /^const axlePositions = VP_MODULE/],
  ['VEHICLES',                  /^const VEHICLES = VP_MODULE/],
  ['VEHICLE_PROFILE_DEFAULTS',  /^const VEHICLE_PROFILE_DEFAULTS = VP_MODULE/],
  ['vehicleProfileEstimatedFields', /^function vehicleProfileEstimatedFields\(/],
  ['vehicleProfileSpecFromVeh', /^function vehicleProfileSpecFromVeh\(/],
  ['wsVehSource',               /^function wsVehSource\(/],
  ['wsVehStandard',             /^function wsVehStandard\(/],
];
const vp = loadEngine({ blocks: VEH_BLOCKS });

// ── axle configurations ─────────────────────────────────────────────────
test('axlePositions: 8x4 twin-steer — four axles where the Scania actually has them', () => {
  // wheelbase runs LEADING steer axle → rear group CENTRE, per the module contract
  const s = vp.VEHICLES.front_lift_8x4;
  const ax = vp.axlePositions(s);
  assert.equal(ax.length, 4, 'twin steer + tandem drive = four axles');
  assert.equal(ax[0], 1450, 'leading steer axle at the front overhang');
  assert.equal(ax[1], 1450 + 1800, 'second steer axle one spread behind');
  const rc = 1450 + 5425;
  assert.deepEqual(ax.slice(2), [rc - 1775 / 2, rc + 1775 / 2], 'rear pair straddles the group centre');
});

test('axlePositions: 4x2 — one axle each end, rear at frontOverhang + wheelbase', () => {
  const ax = vp.axlePositions({ frontOverhang: 1400, wheelbase: 5000, frontAxles: 1, rearAxles: 1 });
  assert.deepEqual(ax, [1400, 6400]);
});

test('axlePositions: the 6x4 default — tandem drive centred on the wheelbase point', () => {
  const ax = vp.axlePositions({ frontOverhang: 1400, wheelbase: 4800, rearAxleSpread: 1350 });
  assert.deepEqual(ax, [1400, 6200 - 675, 6200 + 675]);
});

// ── defaults and the estimated flag ─────────────────────────────────────
test('a sparse spec draws from the documented defaults, and the gaps are reportable', () => {
  const est = vp.vehicleProfileEstimatedFields({ bodyType: 'rear_lift', wheelbase: 4500 });
  assert.ok(est.includes('overallHeight'), 'a missing height is flagged');
  assert.ok(est.includes('cabHeight'));
  assert.ok(!est.includes('wheelbase'), 'a real value is not flagged');
  assert.equal(vp.VEHICLE_PROFILE_DEFAULTS.wheelRadius, 530, 'defaults are the module’s own');
});

test('an unknown body type throws — the module supports exactly four bodies', () => {
  assert.throws(() => vp.vehicleProfileSVG({ bodyType: 'hovercraft' }, {}), /Unknown body type/);
});

test('the VEHICLES map: guideline front lift is the planning default; the Scania admits its estimates', () => {
  const g = vp.VEHICLES.front_lift;
  assert.equal(g.source, 'guideline');
  assert.equal(g.overallLength, 10520);
  assert.equal(g.operatingHeight, 6100, 'guideline front-lift envelope');
  assert.equal(g.turningCircleKerb, 22100);
  const m = vp.VEHICLES.front_lift_8x4;
  assert.equal(m.source, 'manufacturer');
  assert.equal(m.overallLength, 9676);
  assert.equal(m.wheelbase, 5425);
  assert.equal(m.rearAxleSpread, 1775);
  assert.equal(m.operatingHeight, 6500, 'governing case: 4.5 m³ industrial bin');
});

// ── one geometry, two render levels ─────────────────────────────────────
test('vehicleProfileSVG: detailed fills via CSS variables, schematic is outline only', () => {
  const det = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, { detail: 'detailed' });
  const sch = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, { detail: 'schematic' });
  assert.ok(det.includes('var(--vehicle-body'), 'detailed paints from the variables');
  assert.ok(det.includes('var(--vehicle-tyre'));
  assert.ok(sch.includes('.shell, .tyre, .rim, .chassis { fill: none; }'), 'schematic fills nothing');
  assert.ok(!sch.includes('var(--vehicle-body'), 'no fill variables in schematic output');
  // wheels sit at the REAL axle x positions in both renders
  for (const wx of vp.axlePositions({ ...vp.VEHICLE_PROFILE_DEFAULTS, ...vp.VEHICLES.front_lift_8x4 })) {
    const at = `cx="${wx}"`;
    assert.ok(det.includes(at), 'detailed wheel at ' + wx);
    assert.ok(sch.includes(at), 'schematic wheel at ' + wx);
  }
});

test('vehicleProfileSVG: the operating envelope is opt-in, dashed, at operatingHeight', () => {
  const on = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, { showEnvelope: true });
  assert.ok(on.includes('class="env"'), 'envelope drawn when asked');
  assert.ok(on.includes(',6500'), 'at the stored operating height');
  const off = vp.vehicleProfileSVG(vp.VEHICLES.front_lift_8x4, {});
  assert.ok(!off.includes('class="env"'), 'off by default — the title block asks for it');
  // no operating height on the record → no envelope even when asked
  const none = vp.vehicleProfileSVG(vp.VEHICLES.rear_lift, { showEnvelope: true });
  assert.ok(!none.includes('class="env"'));
});

// ── DB record → spec mapping ────────────────────────────────────────────
test('vehicleProfileSpecFromVeh: body from the record’s own words, metres to millimetres', () => {
  const spec = vp.vehicleProfileSpecFromVeh({ cat: 'Front Loader', name: 'FL', wb: 4.8, fo: 3.2, ro: 1.5, bw: 2.55, heightM: 4.3 });
  assert.equal(spec.bodyType, 'front_lift');
  assert.equal(spec.wheelbase, 4800);
  assert.equal(spec.overallLength, 9500);
  assert.equal(spec.overallHeight, 4300);
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Hook Lift / Skip Bin', name: '' }).bodyType, 'hook_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Mini Rear Loader', name: '' }).bodyType, 'rear_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Side Loader', name: '' }).bodyType, 'side_lift');
  assert.equal(vp.vehicleProfileSpecFromVeh({ cat: 'Austroads AP-G34-23 Design Vehicles', name: 'Service Vehicle' }).bodyType,
    'rear_lift', 'unrecognised kinds draw as the generic collection vehicle — the module throws on a fifth body');
});

test('vehicleProfileSpecFromVeh: absent values are ABSENT, so clone() keeps the defaults', () => {
  // {...DEFAULTS, ...spec} copies own undefined properties, which would shadow
  // a default with undefined — the mapper must delete rather than pass through.
  const spec = vp.vehicleProfileSpecFromVeh({ cat: 'Rear Loader', name: '', wb: 4.5 });
  assert.ok(!('overallHeight' in spec), 'no height on the record, no key in the spec');
  assert.ok(!('frontAxles' in spec));
  const merged = { ...vp.VEHICLE_PROFILE_DEFAULTS, ...spec };
  assert.equal(merged.overallHeight, vp.VEHICLE_PROFILE_DEFAULTS.overallHeight);
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
  const panel = SOURCE.slice(SOURCE.indexOf('function wsVehPanelFlattenSvg'), SOURCE.indexOf('// North arrow'));
  assert.ok(panel.includes("detail: 'schematic', showEnvelope: true"),
    'title block uses the schematic level with the envelope on');
  assert.ok(panel.includes('one operator’s fleet — not a design standard'),
    'a contractor vehicle is labelled as such ON THE DRAWING');
  assert.ok(panel.includes('(v.minR * 2).toFixed(1)') && panel.includes('(v.rww * 2).toFixed(1)'),
    'turning circles are the identity 2×R of the stored radii — no duplicate columns');
  // svg2pdf cannot resolve the module's <style> + variables: the print path
  // must bake computed styles into attributes and drop the stylesheet.
  assert.ok(panel.includes('wsVehPanelFlattenSvg(') && panel.includes("querySelectorAll('style').forEach(st => st.remove())"),
    'flattening is in the print path, not skipped');
});
