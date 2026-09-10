'use strict';
// Ramp section mode — the longitudinal grade-clearance engine.
//
// The vehicle underside is three flat lines (front-overhang, belly, rear-
// overhang heights above ground on the flat), held rigid perpendicular to the
// wheelbase chord while both wheel contacts ride the profile. Clearance is
// vertical, so a negative number is millimetres of interference. These tests
// pin the engine to closed-form cases and pin the deliberate refusals: a
// too-short profile is reported rather than padded, guessed underside heights
// are flagged assumed, and the AS 2890.1 grade-change rule stays a labelled
// light-vehicle REFERENCE — the clearance scan is the truck verdict.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, loadEngine } = require('./extract.js');

const BLOCKS = [
  ['WS_RAMP_SEC_DEFAULTS', /^const WS_RAMP_SEC_DEFAULTS = \{/],
  ['WS_RAMP_WHEEL_R',      /^const WS_RAMP_WHEEL_R = /],
  ['WS_RAMP_RULES',        /^const WS_RAMP_RULES = \{/],
  ['wsRampSecOf',          /^function wsRampSecOf\(/],
  ['wsRampProfilePts',     /^function wsRampProfilePts\(/],
  ['wsRampSegsFromTrace',  /^function wsRampSegsFromTrace\(/],
  ['wsRampZAt',            /^function wsRampZAt\(/],
  ['wsRampPose',           /^function wsRampPose\(/],
  ['wsRampClearanceAt',    /^function wsRampClearanceAt\(/],
  ['wsRampScan',           /^function wsRampScan\(/],
  ['wsRampVertices',       /^function wsRampVertices\(/],
  ['wsRampTransitionCheck',/^function wsRampTransitionCheck\(/],
  ['wsRampAngles',         /^function wsRampAngles\(/],
];
const ws = loadEngine({ blocks: BLOCKS });

// ── profile model ────────────────────────────────────────────────────────
test('profile: segments → vertices, and tracing that profile reads the same segments back', () => {
  const segs = [{ grade: 0, len: 6 }, { grade: 20, len: 10 }, { grade: 0, len: 6 }];
  const pts = ws.wsRampProfilePts(segs);
  assert.equal(pts.length, 4);
  assert.deepEqual(pts[0], { x: 0, z: 0 });
  assert.equal(pts[3].x, 22);
  assert.ok(Math.abs(pts[3].z - 2) < 1e-9, '10 m at 20% climbs 2 m');
  const back = ws.wsRampSegsFromTrace(pts);
  assert.equal(back.length, 3);
  assert.ok(Math.abs(back[1].grade - 20) < 0.01 && Math.abs(back[1].len - 10) < 0.01);
});

test('trace: nearly-collinear clicks merge into one segment, grade recomputed over the whole run', () => {
  const pts = [{ x: 0, z: 0 }, { x: 2, z: 0.401 }, { x: 4.1, z: 0.818 }, { x: 6, z: 1.2 }, { x: 8, z: 0.9 }];
  const segs = ws.wsRampSegsFromTrace(pts, 1.5);
  assert.equal(segs.length, 2, 'four ~20% clicks are one segment; the downhill turn is another');
  assert.ok(Math.abs(segs[0].grade - 20) < 0.5, 'grade over the merged run, not an average of noisy pairs');
  assert.ok(Math.abs(segs[0].len - 6) < 0.01);
  assert.ok(segs[1].grade < 0);
  // zero/backward runs are unusable and skipped, never inverted
  assert.equal(ws.wsRampSegsFromTrace([{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 3, z: 0.3 }]).length, 1);
});

// ── pose ─────────────────────────────────────────────────────────────────
test('pose: flat ground and constant grade give exact geometry', () => {
  const flat = ws.wsRampProfilePts([{ grade: 0, len: 30 }]);
  let p = ws.wsRampPose(flat, 5, 4.5);
  assert.ok(Math.abs(p.xf - 9.5) < 1e-3 && Math.abs(p.theta) < 1e-6);
  const slope = ws.wsRampProfilePts([{ grade: 25, len: 40 }]);
  p = ws.wsRampPose(slope, 5, 4.5);
  assert.ok(Math.abs(Math.hypot(p.xf - p.xr, p.zf - p.zr) - 4.5) < 1e-3, 'chord = wheelbase');
  assert.ok(Math.abs(p.theta - Math.atan(0.25)) < 1e-3, 'pitch = ramp angle');
});

// ── clearance ────────────────────────────────────────────────────────────
test('clearance: on flat ground each feature reads exactly its entered height', () => {
  const flat = ws.wsRampProfilePts([{ grade: 0, len: 40 }]);
  const sec = { wb: 4.5, fo: 1.35, ro: 2.15, gcf: 0.4, gcm: 0.25, gcr: 0.3 };
  const c = ws.wsRampClearanceAt(flat, ws.wsRampPose(flat, 10, 4.5), sec);
  assert.ok(Math.abs(c.front.min - 0.4) < 1e-6);
  assert.ok(Math.abs(c.belly.min - 0.25) < 1e-6);
  assert.ok(Math.abs(c.rear.min - 0.3) < 1e-6);
});

test('crest: a 20%/−20% summit grounds a 4.5 m wheelbase belly by the analytic amount', () => {
  const pts = ws.wsRampProfilePts([{ grade: 20, len: 12 }, { grade: -20, len: 12 }]);
  const sec = { wb: 4.5, fo: 1.35, ro: 2.15, gcf: 0.6, gcm: 0.25, gcr: 0.6 };
  const res = ws.wsRampScan(pts, sec, 0.05);
  const belly = res.scrapes.filter(s => s.feature === 'belly');
  assert.equal(belly.length, 1, 'the belly grounds at the summit');
  // symmetric pose: the peak protrudes 0.1 × wb = 0.45 m above the chord; 0.25 m belly → ≈ −0.20 m
  assert.ok(belly[0].min < -0.17 && belly[0].min > -0.23, 'interference ≈ 200 mm, got ' + belly[0].min);
  assert.ok(Math.abs((belly[0].x0 + belly[0].x1) / 2 - 12) < 0.6, 'centred on the vertex');
  assert.equal(res.ok, false);
  // lift the belly above the analytic protrusion and the same crest passes
  const ok = ws.wsRampScan(pts, { ...sec, gcm: 0.5 }, 0.05);
  assert.equal(ok.scrapes.length, 0);
  assert.equal(ok.ok, true);
});

test('sag: driving flat onto a 25% upgrade spears a long front overhang by grade × overhang − height', () => {
  const pts = ws.wsRampProfilePts([{ grade: 0, len: 14 }, { grade: 25, len: 14 }]);
  const sec = { wb: 4.8, fo: 3.2, ro: 1.5, gcf: 0.35, gcm: 0.6, gcr: 0.6 };   // front-loader shape
  const res = ws.wsRampScan(pts, sec, 0.05);
  const front = res.scrapes.filter(s => s.feature === 'front');
  assert.equal(front.length, 1);
  // worst near front-wheel-at-toe: tip reaches 3.2 m onto the 25% face → 0.80 m rise vs 0.35 m underside
  assert.ok(front[0].min < -0.40 && front[0].min > -0.50, 'got ' + front[0].min);
  assert.ok(!ws.wsRampScan(pts, { ...sec, gcf: 1.2 }, 0.05).scrapes.some(s => s.feature === 'front'),
    'enough underside height clears the same sag');
});

test('departure: rolling off a −25% grade onto flat drags a low rear overhang', () => {
  const pts = ws.wsRampProfilePts([{ grade: -25, len: 14 }, { grade: 0, len: 14 }]);
  const sec = { wb: 4.5, fo: 1.35, ro: 2.15, gcf: 0.9, gcm: 0.6, gcr: 0.30 };
  const res = ws.wsRampScan(pts, sec, 0.05);
  const rear = res.scrapes.filter(s => s.feature === 'rear');
  assert.equal(rear.length, 1);
  // rear wheel at the foot: tip 2.15 m back up the 25% face → ≈ 0.54 m rise vs 0.30 m underside
  assert.ok(rear[0].min < -0.16 && rear[0].min > -0.30, 'got ' + rear[0].min);
});

test('scan: a profile shorter than the wheelbase is reported, never padded with invented ground', () => {
  const pts = ws.wsRampProfilePts([{ grade: 20, len: 3 }]);
  const r = ws.wsRampScan(pts, { wb: 4.5, fo: 1.35, ro: 2.15, gcf: 0.4, gcm: 0.25, gcr: 0.3 });
  assert.equal(r.short, true);
  assert.equal(r.ok, false);
  assert.equal(r.samples.length, 0);
});

// ── transitions ──────────────────────────────────────────────────────────
test('transitions: vertices classify crest/sag; the AS 2890.1 reference rule is data, and its own remedy passes', () => {
  const segs = [{ grade: 0, len: 6 }, { grade: 25, len: 10 }, { grade: 0, len: 6 }];
  const v = ws.wsRampVertices(segs);
  assert.equal(v.length, 2);
  assert.equal(v[0].kind, 'sag');
  assert.equal(v[1].kind, 'crest');
  assert.equal(v[0].change, 25);
  const chk = ws.wsRampTransitionCheck(segs, ws.WS_RAMP_RULES.as2890_1);
  assert.equal(chk.ok, false);
  assert.match(chk.rows[0].why, /transition ≥ 2 m at ≈ 12\.5%/);
  // the standard's remedy — a half-grade transition segment ≥ 2 m — makes both of its vertices pass
  const fixed = [{ grade: 0, len: 6 }, { grade: 12.5, len: 2.5 }, { grade: 25, len: 10 },
                 { grade: 12.5, len: 2.5 }, { grade: 0, len: 6 }];
  assert.equal(ws.wsRampTransitionCheck(fixed, ws.WS_RAMP_RULES.as2890_1).ok, true);
  // the rule is labelled a light-vehicle reference, never the truck verdict
  assert.match(ws.WS_RAMP_RULES.as2890_1.note, /reference only for trucks/);
});

test('angles: approach / breakover / departure derive from the entered geometry', () => {
  const a = ws.wsRampAngles({ wb: 4.5, fo: 3.2, ro: 2.15, gcf: 0.35, gcm: 0.25, gcr: 0.3 });
  assert.equal(a.approach, +(Math.atan2(0.35, 3.2) * 180 / Math.PI).toFixed(1));
  assert.equal(a.breakover, +(2 * Math.atan2(0.25, 2.25) * 180 / Math.PI).toFixed(1));
  assert.equal(a.departure, +(Math.atan2(0.3, 2.15) * 180 / Math.PI).toFixed(1));
});

// ── vehicle underside data ───────────────────────────────────────────────
test('vehicle underside: library values win; missing values fall back to ASSUMED category defaults', () => {
  const lib = ws.wsRampSecOf({ cat: 'Rear Loader', wb: 4.5, fo: 1.35, ro: 2.15, gcFrontM: 0.42, gcRearM: 0.31, gcMidM: 0.27 });
  assert.deepEqual([lib.gcf, lib.gcr, lib.gcm, lib.assumed], [0.42, 0.31, 0.27, false]);
  const def = ws.wsRampSecOf({ cat: 'Rear Loader', wb: 4.5, fo: 1.35, ro: 2.15 });
  assert.equal(def.assumed, true, 'defaults are flagged, never silently trusted');
  assert.equal(def.gcm, ws.WS_RAMP_SEC_DEFAULTS['Rear Loader'].gcm);
  const unk = ws.wsRampSecOf({ cat: 'Something New', wb: 4, fo: 1, ro: 2 });
  assert.equal(unk.gcf, ws.WS_RAMP_SEC_DEFAULTS.default.gcf);
  assert.equal(ws.wsRampSecOf(null), null);
});

// ── wiring ───────────────────────────────────────────────────────────────
test('wiring: modal, launcher, DB mapping, admin columns, migration, persistence, export', () => {
  assert.ok(SOURCE.includes('id="ws-ramp-modal"'), 'the section workspace modal exists');
  assert.ok(SOURCE.includes('onclick="wsRampOpen()"'), 'the swept tab carries the Ramp section launcher');
  assert.ok(SOURCE.includes('gcFrontM: r.gc_front_m'), 'DB vehicles carry the front underside height');
  assert.ok(SOURCE.includes('gcMidM: r.ground_clearance_m'), 'belly clearance reads the existing column');
  assert.ok(SOURCE.includes("['gc_front_m','Under frt m'"), 'the admin contractors table edits the new columns');
  assert.ok(SOURCE.includes('gc_front_m: it.gc_front_m'), 'and the save path writes them');
  assert.ok(SOURCE.includes('operating_height_m: it.operating_height_m'),
    'the D2 elevation columns reach the save too — they were editable but silently unsaved');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-10-ramp-section-vehicles.sql'), 'utf8');
  assert.ok(/add column if not exists gc_front_m/.test(mig) && /add column if not exists gc_rear_m/.test(mig),
    'migration adds both underside columns idempotently');
  assert.ok(SOURCE.includes('sl.ramp = {'), 'the segment model persists in the layout slot');
  assert.ok(SOURCE.includes('wsRampSnapshot'), 'PNG snapshot export is wired');
  assert.ok(SOURCE.includes('assumed: gcf == null || gcr == null || gcm == null'),
    'guessed underside heights are flagged at the source, never silent');
  const scan = SOURCE.slice(SOURCE.indexOf('function wsRampScan('), SOURCE.indexOf('function wsRampVertices('));
  assert.ok(scan.includes('short: true'), 'a too-short profile is reported, not padded');
  // the underlay is a tracing backdrop only — the persisted model is the segments
  assert.ok(SOURCE.includes('The drawing is a tracing backdrop'), 'reference-only contract stated in the UI');
});
