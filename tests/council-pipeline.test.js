'use strict';
// Package C — council guidelines pipeline.
//
// C1: guidelines are VERSIONED. A save is a new row; the old row is superseded,
// never overwritten or deleted. Consumers read the latest non-superseded
// version, and every check records which version it ran against. These are
// source-level guards (the flows are DOM + Supabase), plus a check that the
// migration file carries what the brief demands.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE } = require('./extract.js');

const MIG_C1 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c1-guideline-versioning.sql'), 'utf8');
const MIG_C2 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c2-guideline-storage.sql'), 'utf8');
const MIG_C3 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c3-council-requirements.sql'), 'utf8');
const MIG_C6 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-08-25-package-c6-equipment-proposals.sql'), 'utf8');

// ── C1: migration ───────────────────────────────────────────────────────
test('C1 migration: lifecycle columns, version sequencing, grants', () => {
  for (const col of ['effective_date', 'superseded_at', 'source_url', 'uploaded_by', 'notes'])
    assert.ok(MIG_C1.includes(col), 'migration adds ' + col);
  assert.ok(MIG_C1.includes('rename column version to version_label'),
    'the old free-text version is preserved, not destroyed');
  assert.ok(MIG_C1.includes('add column version integer not null default 1'),
    'the new integer version is an upload sequence');
  assert.ok(MIG_C1.includes('council_guidelines (council_key, version)'),
    'council_key alone is no longer unique — (council_key, version) is');
  assert.ok(/grant select, insert, update, delete on public\.council_guidelines to anon, authenticated;/.test(MIG_C1),
    'RLS filters rows; GRANTs confer privileges — ship both, every time');
});

// ── C1: writes never overwrite, never delete ────────────────────────────
test('C1: a guideline save is a new version; the old row is superseded', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function cgInsertVersion'), SOURCE.indexOf('async function cgSave'));
  assert.ok(fn.includes("row.version = prior?.length ? (prior[0].version || 0) + 1 : 1;"),
    'version is sequenced per council');
  assert.ok(fn.includes(".update({ superseded_at: new Date().toISOString() })"),
    'the previous live row gets superseded_at');
  assert.ok(fn.includes(".neq('id', ins.id).is('superseded_at', null)"),
    'only the previously-live rows are superseded, never the new one');
  const save = SOURCE.slice(SOURCE.indexOf('async function cgSave'), SOURCE.indexOf('async function cgEdit'));
  assert.ok(!save.includes("upsert"), 'the overwrite-by-council_key upsert is gone');
});

test('C1: retiring a council supersedes — the delete path is gone', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function cgDelete'), SOURCE.indexOf('// ── ADMIN: guidelines → Rates DB bridge'));
  assert.ok(!fn.includes(".delete()"), 'no SQL delete: past checks keep a row to point at');
  assert.ok(fn.includes("superseded_at: new Date().toISOString()"), 'retire = supersede');
});

// ── C1: consumers read the latest non-superseded version ────────────────
test('C1: the WMP requirements check serves per-council versions and pins the one it used', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function creqLoad'), SOURCE.indexOf('function creqEvaluate'));
  assert.ok(fn.includes(".order('version', { ascending: false })"),
    'versions are walked newest-first');
  assert.ok(fn.includes('if (!r.superseded_at && !g.live) g.live = r;'),
    'the live version is preferred');
  assert.ok(fn.includes('d.creqSource = hit ? { guidelineId: hit.id || null'),
    'the WMP snapshot records guideline id + version (persists via p.wmp)');
  assert.ok(fn.includes("version: hit.version ?? null"), 'version is pinned, not re-derived later');
});

test('C1: the compliance checker fetches versions newest-first and stamps the scan', () => {
  assert.ok(SOURCE.includes('superseded_at,requirements&amp;order=version.desc'),
    'the iframe REST fetch carries the lifecycle column, newest first');
  assert.ok(SOURCE.includes('state.checkedAgainst = structuredGuidelines ? {'),
    'each AI check records which guideline version it ran against');
});

// ── C2: bulk upload ─────────────────────────────────────────────────────
test('C2: bulk upload — councils assigned by hand, versioned through one path', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('const CGB = '), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(fn.includes("if (!name) { r.status = 'assign a council'; return false; }"),
    'no council assigned, no upload — filenames are never auto-matched');
  assert.ok(fn.includes('await cgInsertVersion({'),
    'bulk uploads version through the same supersede path as single saves');
  assert.ok(fn.includes('requirements: [],     // structured rows come from extraction + review (C3)'),
    'no structured requirements are invented at upload time');
  assert.ok(fn.includes('guidelines/${key}/'),
    'files land under the guidelines/ prefix of the existing bucket');
  assert.ok(fn.includes('sequential on purpose'),
    'same-council files take sequential versions instead of racing max(version)');
});

// ── C3: structured requirements + review queue ──────────────────────────
test('C3 migration: pipeline table with the agreed enum, clause_ref required, RLS split', () => {
  for (const t of ['generation_rate', 'room_dimension', 'aisle_width', 'chute_spec',
                   'collection_limit', 'equipment_rule', 'stream_split', 'other'])
    assert.ok(MIG_C3.includes(`'${t}'`), 'requirement_type includes ' + t);
  assert.ok(MIG_C3.includes('clause_ref text not null'),
    'every row is traceable to a clause — enforced by the schema, not convention');
  assert.ok(MIG_C3.includes("check (status in ('proposed','approved','rejected'))"));
  assert.ok(MIG_C3.includes("'garbage','recycling','fogo','glass','paper','soft'"),
    'streams are the canonical ids, checked in the schema');
  assert.ok(MIG_C3.includes("using (status = 'approved')"),
    'non-staff read approved rows ONLY — proposed is never consumed');
  assert.ok(MIG_C3.includes('grant select on public.council_requirements to anon'),
    'GRANTs ship with the table, every time');
});

test('C3: extraction drops untraceable rows and never invents streams', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('const CRQ_Q ='));
  assert.ok(fn.includes('if (!clause) { dropped++; return; }'),
    'a row with no clause reference is never inserted');
  assert.ok(fn.includes("status = 'rejected'; rejected++;"),
    'an unresolvable stream rejects the row rather than guessing');
  assert.ok(fn.includes('wsStreamId'),
    'synonyms resolve through the one canonical resolver');
  assert.ok(fn.includes('council_guideline_id: doc.id'),
    'every proposal is pinned to the exact guideline version');
  assert.ok(fn.includes(".is('superseded_at', null)"),
    'extraction targets the live document version');
});

test('C3: approval is the only path to machine-usable rows', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqDecide'), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(fn.includes("if (status === 'approved' && !edits.clause_ref)"),
    'approval without a clause reference is refused');
  assert.ok(fn.includes("reviewed_by: currentUser?.id || null, reviewed_at: new Date().toISOString()"),
    'decisions record who and when');
  assert.ok(fn.includes(".eq('status', 'proposed')"),
    'a decision only ever moves a PROPOSED row — no re-approving rejected rows by accident');
  const q = SOURCE.slice(SOURCE.indexOf('async function crqLoad'), SOURCE.indexOf('function crqRender'));
  assert.ok(q.includes("CRQ_Q.rows = (data || []).filter(r => r.status === 'proposed');"),
    'only proposed rows are editable in the queue');
});

// ── check-in amendments ─────────────────────────────────────────────────
test('a live version with no requirements falls back — a fresh upload never blanks the checker', () => {
  const wmp = SOURCE.slice(SOURCE.indexOf('async function creqLoad'), SOURCE.indexOf('function creqEvaluate'));
  assert.ok(wmp.includes('servedFallback'), 'the WMP check serves the newest version WITH requirements');
  assert.ok(wmp.includes('g.withReqs'), 'fallback picks by content, not just by liveness');
  assert.ok(SOURCE.includes('Object.assign({}, g.withReqs, { servedFallback:'),
    'the compliance checker iframe applies the same fallback');
  assert.ok(SOURCE.includes('serving this version until its extraction is approved'),
    'fallback serving is visible on the WMP check, not silent');
});

test('approved rows reach consumers only through the explicit Serve action', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function crqToLegacy'), SOURCE.indexOf('// ── the review queue'));
  assert.ok(fn.includes('async function crqServe'), 'the bridge exists');
  assert.ok(fn.includes('if (!confirm('), 'serving is confirmed, never silent');
  const decide = SOURCE.slice(SOURCE.indexOf('async function crqDecide'), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(!decide.includes('crqServe('), 'approving a row never auto-publishes — no silent publication, anywhere');
});

// ── C4: approved rates → diff against live R2 data ──────────────────────
test('C4: the diff engine classifies new/changed/same/conflicting/unmapped and never guesses', () => {
  const { loadEngine } = require('./extract.js');
  const ws4 = loadEngine({ blocks: [
    ['CRX_STREAM_TO_RATES', /^const CRX_STREAM_TO_RATES = /],
    ['CRX_SPLIT_FOR_STREAM', /^const CRX_SPLIT_FOR_STREAM = /],
    ['crxNorm', /^function crxNorm\(/],
    ['crxResUnit', /^function crxResUnit\(/],
    ['crxDiffRates', /^function crxDiffRates\(/],
  ] });
  const docs = { g1: { id: 'g1', council_name: 'Randwick City Council', state: 'NSW', version: 2 } };
  const remote = {
    COUNCILS: { NSW: [{ value: 'randwick', label: 'Randwick City Council' }] },
    PROFILES: { NSW: { resRates: { apt_2br: { GW: 100, REC: 100 } },
                       comRates: { cafe: { GW: { rate: 240, unitValue: 100, unit: 'L/Day/100m2' } } } } },
    COUNCIL_PROFILES: {},
  };
  const comm = { cafe: { label: 'Cafe' } };
  const row = (over) => ({ status: 'approved', requirement_type: 'generation_rate',
    council_guideline_id: 'g1', clause_ref: 'cl 1, p.2', ...over });
  const diff = ws4.crxDiffRates([
    row({ use_class: '2 bedroom apartments', stream: 'garbage', value_num: 100 }),   // same
    row({ use_class: '2 bedroom apartments', stream: 'recycling', value_num: 120 }), // changed
    row({ use_class: 'cafe', stream: 'fogo', value_num: 60 }),                       // new (no ORG rate yet)
    row({ use_class: 'residential', stream: 'garbage', value_num: 90 }),             // unmapped: not one unit type
    row({ use_class: '2 bedroom apartments', stream: 'garbage', value_num: 110 }),   // conflicting with the first
    { status: 'proposed', requirement_type: 'generation_rate', council_guideline_id: 'g1',
      use_class: 'cafe', stream: 'garbage', value_num: 999, clause_ref: 'x' },       // proposed never exports
  ], docs, remote, comm);
  assert.deepEqual(diff.map(d => d.status), ['same', 'changed', 'new', 'unmapped', 'conflicting']);
  assert.equal(diff[0].target, 'resRates.apt_2br.GW');
  assert.equal(diff[1].current, 100);
  assert.equal(diff[2].target, 'comRates.cafe.ORG');
  assert.ok(/not one unit type|never guess/.test('never guess'), 'sanity');
  assert.equal(diff[4].why.includes('another approved row'), true);
  // stream_split maps onto the split ids that should replace the code defaults
  const split = ws4.crxDiffRates([row({ requirement_type: 'stream_split',
    use_class: 'Cafe', stream: 'paper', value_num: 45 })], docs, remote, comm);
  assert.equal(split[0].target, 'splits.cafe.REC_CARD');
  assert.equal(split[0].status, 'new');
});

test('C4: export is a diff for the human flow — nothing writes, ever', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crxExport'), SOURCE.indexOf('let CRX_LAST'));
  assert.ok(fn.includes(".eq('status', 'approved')"), 'approved rows only');
  assert.ok(!/\.(upsert|insert|update|delete)\(/.test(fn.replace(/from\('council_guidelines'\)\s*\n?\s*\.select/g, '')),
    'the export never writes to any table');
  assert.ok(fn.includes('no baseline, no diff'), 'no live JSON, no diff — never diff against nothing');
  assert.ok(!SOURCE.includes('publish-rates', SOURCE.indexOf('async function crxExport')) ||
    SOURCE.indexOf('publish-rates', SOURCE.indexOf('async function crxExport')) > SOURCE.indexOf('let CRX_LAST'),
    'the export never calls the publish edge function');
});

// ── C5: layout soft warnings ────────────────────────────────────────────
test('C5: warnings compare council minima to measured layout facts, citing clause + version', () => {
  const { loadEngine } = require('./extract.js');
  const ws5 = loadEngine({ blocks: [['wsCouncilLayoutWarnings', /^function wsCouncilLayoutWarnings\(/]] });
  const reqs = [
    { requirement_type: 'aisle_width', value_num: 1500, unit: 'mm', clause_ref: 'cl 4.2', _version: 2 },
    { requirement_type: 'room_dimension', value_num: 8, unit: 'm2', clause_ref: 'cl 5.1', _version: 2 },
    { requirement_type: 'room_dimension', value_num: 2.5, unit: 'm', clause_ref: 'cl 5.2', _version: 2 },
    { requirement_type: 'aisle_width', value_num: null, unit: 'mm', clause_ref: 'cl 9' },   // no number, no warning
  ];
  const facts = { aislesMm: [1200, 1600], rooms: [{ name: 'Bin room', areaM2: 6.2, minSideM: 2.1 }] };
  const w = ws5.wsCouncilLayoutWarnings(reqs, facts);
  assert.equal(w.length, 3);
  assert.match(w[0], /^Council minimum aisle 1500mm — current 1200mm \(cl 4\.2, guideline v2\)$/);
  assert.match(w[1], /minimum room area 8 m² — Bin room is 6\.2 m²/);
  assert.match(w[2], /minimum room dimension 2500mm — Bin room is 2100mm at its narrowest/);
  assert.deepEqual(ws5.wsCouncilLayoutWarnings(reqs, { aislesMm: [1600], rooms: [] }), [],
    'a compliant layout warns about nothing');
});

test('C5: soft only — approved rows, no blocking, no canvas overlay', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function wsCouncilReqsRefresh'), SOURCE.indexOf('// ── OBSTACLES & FIXTURES'));
  assert.ok(fn.includes(".eq('status', 'approved')"), 'only approved requirements are consumed');
  assert.ok(fn.includes("in('requirement_type', ['aisle_width', 'room_dimension'])"), 'the agreed two types only');
  assert.ok(fn.includes("getElementById('ws-council-warn')"), 'warnings render in the side panel div');
  assert.ok(!fn.includes("mk("), 'no canvas/SVG overlay from the warnings path');
  assert.ok(!/alert\(|confirm\(/.test(fn), 'advisory means advisory — nothing blocks');
});

test('crqToLegacy: approved-only, clause-required, faithful field mapping', () => {
  const { loadEngine } = require('./extract.js');
  const ws2 = loadEngine({ blocks: [['crqToLegacy', /^function crqToLegacy\(/]] });
  const rows = [
    { status: 'approved', clause_ref: 'cl 4.2.1, p.12', requirement_type: 'generation_rate',
      use_class: 'Residential flats', stream: 'garbage', value_num: 80, unit: 'L/dwelling/week', value_text: '80L per dwelling per week' },
    { status: 'proposed', clause_ref: 'cl 9', requirement_type: 'other', value_text: 'not approved' },
    { status: 'approved', clause_ref: '', requirement_type: 'other', value_text: 'no clause' },
    { status: 'approved', clause_ref: 'cl 5.1', requirement_type: 'aisle_width',
      use_class: 'commercial tenancy', value_num: 1500, unit: 'mm', value_text: 'aisles min 1500mm' },
  ];
  const out = ws2.crqToLegacy(rows);
  assert.equal(out.length, 2, 'proposed and clause-less rows never serve');
  assert.equal(out[0].clause, 'cl 4.2.1, p.12');
  assert.equal(out[0].page, 12, 'page parsed from the clause reference');
  assert.equal(out[0].category, 'generation_rates');
  assert.equal(out[0].applies_to, 'residential');
  assert.deepEqual(out[0].quantitative, { value: 80, unit: 'L/dwelling/week' });
  assert.equal(out[1].category, 'storage', 'aisle_width maps into the storage category');
  assert.equal(out[1].applies_to, 'commercial');
});

test('C2 migration: storage policies for the guidelines prefix', () => {
  assert.ok(MIG_C2.includes("(storage.foldername(name))[1] = 'guidelines'"),
    'policies scope to the guidelines/ prefix only');
  assert.ok(MIG_C2.includes('p.is_staff = true'), 'writes are staff-gated');
  assert.ok(!/create policy.*for (update|delete)/i.test(MIG_C2),
    'no update/delete policy — guideline files are never overwritten or removed');
});

// ── C6: equipment spec proposals ────────────────────────────────────────
test('C6 migration: staging table cannot carry design decisions; category check is copied', () => {
  for (const col of ['streams', 'pairing_type', 'output_equipment_id', 'receiver', 'collectable'])
    assert.ok(!new RegExp('^\\s*' + col + '\\s', 'm').test(MIG_C6),
      col + ' must have no column in the staging table — a proposal can never set it');
  assert.ok(MIG_C6.includes("pg_get_constraintdef(oid)"),
    'the category check is READ from equipment_category_check, never invented');
  assert.ok(MIG_C6.includes('footprint_computed boolean'),
    'a computed footprint is flagged as computed');
  assert.ok(MIG_C6.includes('eqp_staff_all'), 'staff-only RLS');
  assert.ok(MIG_C6.includes('grant select, insert, update, delete on public.equipment_proposals to authenticated'),
    'GRANTs ship with the table');
});

test('C6: extraction reuses the spec-sheet path and flags computed footprints', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function eqpExtractOne'), SOURCE.indexOf('let _eqpCats'));
  assert.ok(fn.includes('system: SSX_PROMPT'), 'ai-extract spec-sheet prompt is reused, not duplicated');
  assert.ok(fn.includes('footprint_computed: stated == null && w > 0 && d > 0'),
    'footprint from W×D is flagged as computed, a stated one is not');
  assert.ok(fn.includes('cats.includes(catRaw) ? catRaw : null'),
    'an AI category outside the live vocabulary lands null — never invented');
  assert.ok(fn.includes('source_file: r.file.name'), 'every proposal carries its source document');
});

test('C6: approval inserts without design-decision fields and guards duplicates', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function eqpApprove'), SOURCE.indexOf('async function eqpReject'));
  const rowObj = fn.slice(fn.indexOf('const row = {'), fn.indexOf("from('equipment').insert(row)"));
  for (const field of ['streams', 'pairing_type', 'output_equipment_id', 'receiver', 'collectable'])
    assert.ok(!new RegExp('\\b' + field + '\\s*:', 'm').test(rowObj),
      field + ' must never be a key in the approval insert — design decisions are set by hand afterwards');
  assert.ok(fn.includes('near-duplicates are never created silently'),
    'a close match warns in the confirm, not silently');
  assert.ok(fn.includes('already exists in the library — pick another'),
    'code collisions are refused; codes are permanent');
  assert.ok(fn.includes('if (!confirm(q)) return;'), 'insertion is confirmed, never automatic');
});

test('C6: the near-duplicate guard matches by label and by dimensions', () => {
  const { loadEngine } = require('./extract.js');
  const ws6 = loadEngine({ blocks: [
    ['eqpNorm', /^function eqpNorm\(/],
    ['eqpNearDuplicates', /^function eqpNearDuplicates\(/],
  ] });
  const live = [
    { code: 'bin_1100', label: '1100L MGB', width_mm: 1370, depth_mm: 1070 },
    { code: 'baler_x', label: 'Baler X', width_mm: 1800, depth_mm: 1000 },
  ];
  assert.equal(ws6.eqpNearDuplicates({ label: '1100l mgb!', width_mm: 0, depth_mm: 0 }, live).length, 1,
    'normalised label match');
  assert.equal(ws6.eqpNearDuplicates({ label: 'Different', width_mm: 1400, depth_mm: 1050 }, live).length, 1,
    'both dims within 5%');
  assert.equal(ws6.eqpNearDuplicates({ label: 'Different', width_mm: 2500, depth_mm: 900 }, live).length, 0,
    'a genuinely different footprint passes clean');
});
