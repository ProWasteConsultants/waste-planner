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
test('C2: bulk upload — every file saves to the SCOPED council, versioned through one path', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('const CGB = '), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(fn.includes("if (!name) { r.status = 'pick a council in Scope above'; return false; }"),
    'no scoped council, no upload — filenames are never auto-matched and nothing is picked per file');
  assert.ok(!fn.includes('function cgbSetCouncil(') && !SOURCE.includes('list="cgb-councils"') && !SOURCE.includes('<datalist id="cgb-councils">'),
    'the per-file council picker is gone');
  const store = SOURCE.slice(SOURCE.indexOf('async function cgStoreDocument()'), SOURCE.indexOf('async function cgSave()'));
  assert.ok(store.includes("Object.assign(r, { council: name }, meta);") && store.includes('if (await cgbUploadOne(r)) ok++;'),
    'Save document stamps the Scope council + the shared fields on every queued file and runs them through the one upload path');
  assert.ok(!SOURCE.includes("id=\"cg-file\"") && !SOURCE.includes('⇪ Upload assigned files') && !SOURCE.includes('id="cgb-actions"'),
    'the second upload path (single file picker + Upload assigned files) is gone');
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

test('C3 (list): extraction APPENDS straight into the live list, drops untraceable rows, never invents streams', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('// ── list rows → the checker'));
  assert.ok(fn.includes('if (!clause) { dropped++; return; }'),
    'a row with no clause reference is never inserted');
  assert.ok(fn.includes("status: 'approved',      // = in the list, live") && fn.includes("source: 'extraction',"),
    'extracted rows go straight into the list — no proposed state, no approval step');
  assert.ok(fn.includes('did not resolve to a canonical stream — set it') && !fn.includes("status = 'rejected'"),
    'an unresolvable stream joins the list blank and flagged — never guessed, never silently dropped');
  assert.ok(fn.includes('wsStreamId'), 'synonyms resolve through the one canonical resolver');
  assert.ok(fn.includes('council_guideline_id: doc.id'), 'every row is pinned to the exact guideline version');
  assert.ok(fn.includes(".is('superseded_at', null)"), 'extraction targets the live document version');
  assert.ok(fn.includes("await sb.from('council_requirements').insert(rows).select();") &&
            !/council_requirements'\)\s*\.(update|delete|upsert)/.test(fn),
    'extraction only ever INSERTs — existing rows (earlier runs, older versions, hand-typed) are never touched');
  assert.ok(fn.includes('const serving = await crqSyncServe(doc.council_key, doc.council_name);'),
    'the whole council list is re-served the moment rows land');
});

test('C3 (list): the list is live and freely editable — add, inline edit, remove; every change re-serves', () => {
  const list = SOURCE.slice(SOURCE.indexOf('// ── the requirements list'), SOURCE.indexOf('// C1: guidelines are VERSIONED'));
  assert.ok(list.includes(".select('*').eq('status', 'approved').order('created_at')"), 'the list IS the live rows');
  assert.ok(!list.includes("'proposed'"), 'no proposed state anywhere in the list');
  for (const fn of ['async function crqSave(id)', 'async function crqAdd()', 'async function crqRemove(id)'])
    assert.ok(list.includes(fn), fn + ' exists');
  assert.ok(list.includes("if (!edits.clause_ref) { crqMsg('Every row needs a source"), 'a row cannot lose its source');
  assert.ok(list.includes(".update(patch).eq('id', id).eq('status', 'approved')"), 'an edit saves in place with no approval step');
  assert.ok(list.includes("clause_ref: 'Manual — ' + new Date().toISOString().slice(0, 10), status: 'approved', source: 'manual'"),
    'a hand-typed row is live at once and marked manual — it survives every future extraction');
  assert.ok(list.includes("has no guideline document on file — ⇪ Save one above first"), 'a manual row needs a document version to belong to — stated, not silent');
  assert.ok(list.includes(".update({ status: 'rejected', reviewed_by"), 'remove is a soft delete — kept for audit, never served');
  assert.equal((list.match(/await crqSyncServe\(/g) || []).length, 2, 'save and remove re-serve the council list');
  assert.ok(SOURCE.includes("onclick=\"crqAdd()\"") && SOURCE.includes("onclick=\"crqRemove('${r.id}')\""), 'add and remove are on the panel');
  // generation rates are never listed — they go straight into the rate tables
  assert.deepStrictEqual(require('./extract.js').loadEngine({ blocks: [['CRQ_RATE_TYPES', /^const CRQ_RATE_TYPES = /], ['crqIsRate', /^function crqIsRate\(/]] }).CRQ_RATE_TYPES, ['generation_rate']);
  const render = SOURCE.slice(SOURCE.indexOf('function crqRender()'), SOURCE.indexOf('function crqCollect'));
  assert.ok(render.includes('const listed = CRQ_L.rows.filter(r => !crqIsRate(r));'), 'the list never shows a generation rate');
  assert.ok(render.includes('const types = CRQ_TYPES.filter(t => !CRQ_RATE_TYPES.includes(t));'), 'nor offers the type');
  assert.ok(!SOURCE.includes('id="crq-rates-wrap"') && !SOURCE.includes('crxExport'), 'no separate rates list, no diff/publish button');
  assert.ok(!SOURCE.includes('async function crqDecide') && !SOURCE.includes('async function crqBulkApprove') && !SOURCE.includes('async function crqServe('),
    'approve / reject / bulk-approve / explicit Serve are gone with the queue');
  assert.ok(!SOURCE.includes('⇧ Serve') && !SOURCE.includes('Extract to queue') && SOURCE.includes('🧾 Extract to list'),
    'no queue-era actions remain on the page');
});

test('C3 (list): duplicates are flagged, never merged; the latest extraction is filterable', () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['crqDupFlags', /^function crqDupFlags\(/], ['crqLatestBatch', /^function crqLatestBatch\(/]] });
  const rows = [
    { id: 'a', requirement_type: 'generation_rate', stream: 'garbage', use_class: 'residential', value_num: 80, unit: 'L/dwelling/week', value_text: '80 L per dwelling per week', clause_ref: 'cl 4.2, p.12', council_guideline_id: 'v1', created_at: '2026-09-01T00:00:00Z', source: 'extraction' },
    { id: 'b', requirement_type: 'generation_rate', stream: 'garbage', use_class: 'Residential', value_num: 80, unit: 'L/dwelling/week', value_text: 'Garbage generation 80L/dwelling/week', clause_ref: 'cl 4.2.1, p.13', council_guideline_id: 'v2', created_at: '2026-09-14T00:00:00Z', source: 'extraction' },
    { id: 'c', requirement_type: 'aisle_width', stream: null, use_class: null, value_num: 1500, unit: 'mm', value_text: 'Aisles minimum 1500 mm clear', clause_ref: 'cl 5.1', council_guideline_id: 'v1', created_at: '2026-09-01T00:00:01Z', source: 'extraction' },
    { id: 'd', requirement_type: 'aisle_width', stream: null, use_class: null, value_num: null, unit: null, value_text: 'Aisles must be a minimum of 1500 mm clear width', clause_ref: 'cl 5.1', council_guideline_id: 'v2', created_at: '2026-09-14T00:00:01Z', source: 'extraction' },
    { id: 'e', requirement_type: 'collection_limit', stream: 'garbage', value_num: 140, unit: 'L', value_text: 'Garbage supplied in 140L bins', clause_ref: 'cl 7', council_guideline_id: 'v1', created_at: '2026-09-01T00:00:02Z' },
    { id: 'f', requirement_type: 'collection_limit', stream: 'garbage', value_num: 1, unit: 'per week', value_text: 'Garbage collected weekly', clause_ref: 'cl 7', council_guideline_id: 'v1', created_at: '2026-09-01T00:00:03Z' },
    { id: 'g', requirement_type: 'other', stream: null, value_num: null, unit: null, value_text: 'Council advised by email that bins are presented on Tuesdays', clause_ref: 'Manual — 2026-09-14', council_guideline_id: 'v2', created_at: '2026-09-14T09:00:00Z', source: 'manual' },
  ];
  const flags = w.crqDupFlags(rows);
  assert.equal(flags.b && flags.b.of, 'a', 'same figure, unit and use class → flagged against the earlier row');
  assert.equal(flags.b.why, 'same figure as');
  assert.equal(flags.d && flags.d.of, 'c', 'mostly the same wording → flagged');
  assert.equal(flags.d.why, 'similar wording to');
  assert.ok(!flags.f, 'two facts under one clause in the SAME document are not duplicates of each other');
  assert.ok(!flags.a && !flags.c && !flags.e, 'the earlier row never carries the flag');
  assert.ok(!flags.g, 'a hand-typed row about something else is left alone');
  assert.deepStrictEqual(w.crqDupFlags([]), {});
  const latest = w.crqLatestBatch(rows);
  assert.deepStrictEqual([...latest].sort(), ['b', 'd'], 'the latest extraction = the newest extraction batch; manual rows are not an extraction');
  assert.equal(w.crqLatestBatch([]).size, 0);
  const render = SOURCE.slice(SOURCE.indexOf('function crqRender()'), SOURCE.indexOf('function crqCollect'));
  assert.ok(render.includes('≈ possible duplicate') && !/crqMerge|\.delete\(/.test(render), 'flag on the row, nothing merged or deleted automatically');
  assert.ok(render.includes("opt('latest', 'Added by the latest extraction', latest.size)") && render.includes("opt('manual', 'Added by hand', manual.length)"),
    'filter by what the last extraction added, and by hand-typed rows');
});

test('the list migration: source column, proposed rows promoted, read policy unchanged', () => {
  const fs = require('node:fs'), path = require('node:path');
  const mig = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-15-requirements-list.sql'), 'utf8');
  assert.ok(mig.includes("add column if not exists source text not null default 'extraction'"), 'source is additive with a default — no restructure');
  assert.ok(mig.includes("check (source in ('extraction','manual'))"));
  assert.ok(mig.includes("update public.council_requirements set status = 'approved' where status = 'proposed';"),
    'the old queue becomes visible list rows rather than being thrown away');
  assert.ok(!mig.includes('drop policy') && !mig.includes('alter policy'), 'the approved-read policy is untouched — every consumer keeps working');
  assert.ok(mig.includes("notify pgrst, 'reload schema';"));
});

// ── check-in amendments ─────────────────────────────────────────────────
test('a live version with no requirements falls back — a fresh upload never blanks the checker', () => {
  const wmp = SOURCE.slice(SOURCE.indexOf('async function creqLoad'), SOURCE.indexOf('function creqEvaluate'));
  assert.ok(wmp.includes('servedFallback'), 'the WMP check serves the newest version WITH requirements');
  assert.ok(wmp.includes('g.withReqs'), 'fallback picks by content, not just by liveness');
  assert.ok(SOURCE.includes('Object.assign({}, g.withReqs, { servedFallback:'),
    'the compliance checker iframe applies the same fallback');
  assert.ok(SOURCE.includes('serving this version until the new one has requirements in its list'),
    'fallback serving is visible on the WMP check, not silent');
});

test('the list reaches consumers automatically — crqSyncServe projects the WHOLE council list onto the serving version', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function crqToLegacy'), SOURCE.indexOf('// ── EXTRACTED GENERATION RATES'));
  assert.ok(fn.includes('async function crqSyncServe(councilKey, councilName)'), 'the bridge exists');
  assert.ok(!fn.includes('if (!confirm('), 'serving is automatic — the list is the live data');
  assert.ok(fn.includes(".in('council_guideline_id', docs.map(d => d.id)).eq('status', 'approved')"),
    'every version of the council document contributes — older-version rows and hand-typed rows survive a new upload');
  assert.ok(fn.includes("const serving = byVersion.find(d => !d.superseded_at) || byVersion[0];"), 'projected onto the live version');
  assert.ok(fn.includes(".update({ requirements: legacy, updated_at: new Date().toISOString() }).eq('id', serving.id)"));
});

// ── C4: approved rates → diff against live R2 data ──────────────────────
test('extracted generation rates map onto the rate tables in their exact row format — or say why not', () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['CRX_STREAM_TO_RATES', /^const CRX_STREAM_TO_RATES = /], ['crxNorm', /^function crxNorm\(/],
    ['crxResUnit', /^function crxResUnit\(/], ['CRQ_UNIT_BASIS', /^const CRQ_UNIT_BASIS = /], ['crqUseBasis', /^function crqUseBasis\(/],
    ['crqComBasis', /^function crqComBasis\(/], ['CRQ_GENERIC_WORDS', /^const CRQ_GENERIC_WORDS = /],
    ['crqUseFromText', /^function crqUseFromText\(/], ['crqRateToTable', /^function crqRateToTable\(/]] });
  const ctx = { state: 'NSW', councilValue: 'camden', uses: [{ use_code: 'cafe', label: 'Cafe / restaurant' }, { use_code: 'hotel_beds', label: 'Hotel (per bed)' }] };
  const gr = o => ({ requirement_type: 'generation_rate', clause_ref: 'cl 4', ...o });
  // residential → res_rates, L/week per dwelling
  let t = w.crqRateToTable(gr({ use_class: '2 bedroom apartments', stream: 'garbage', value_num: 80, unit: 'L/dwelling/week' }), ctx);
  assert.equal(t.ok && t.table, 'res_rates'); assert.equal(t.key, 'apt_2br|GW');
  assert.deepStrictEqual(t.row, { state: 'NSW', council_value: 'camden', unit_type: 'apt_2br', stream: 'GW', l_per_week: 80 });
  assert.deepStrictEqual(t.rows, [t.row], 'a typed dwelling rate is one row');
  assert.equal(w.crqRateToTable(gr({ use_class: 'townhouse', stream: 'recycling', value_num: 10, unit: 'L/day/dwelling' }), ctx).row.l_per_week, 70, 'per day → ×7');
  assert.equal(w.crqRateToTable(gr({ use_class: '1 bed', stream: 'fogo', value_num: 40, unit: 'L per dwelling per fortnight' }), ctx).row.l_per_week, 20, 'per fortnight → ÷2');
  // commercial → com_rates, in the calculator's exact unit keys
  t = w.crqRateToTable(gr({ use_class: 'cafe', stream: 'garbage', value_num: 240, unit: 'L/100m²/day' }), ctx);
  assert.deepStrictEqual(t.row, { state: 'NSW', council_value: 'camden', use_code: 'cafe', stream: 'GW', rate: 240, unit_value: 100, unit: 'L/Day/100m2' });
  assert.deepStrictEqual(w.crqRateToTable(gr({ use_class: 'Cafe', stream: 'recycling', value_num: 2, unit: 'L/m2/day' }), ctx).row.rate, 200, 'per m² → per 100 m² (×100)');
  assert.equal(w.crqRateToTable(gr({ use_class: 'hotel', stream: 'garbage', value_num: 5, unit: 'L/bed/day' }), ctx).row.unit, 'L/Bed/Day');
  assert.equal(w.crqRateToTable(gr({ use_class: 'cafe', stream: 'garbage', value_num: 100, unit: 'L/100m2/week' }), ctx).row.unit, 'L/Week/100m2');
  // refusals name the reason — nothing is guessed
  // a per-dwelling rate with no type is the council's rule for every type — it fills all four rows
  const all = w.crqRateToTable(gr({ use_class: 'residential', stream: 'garbage', value_num: 80, unit: 'L/dwelling/week' }), ctx);
  assert.ok(all.ok && all.allTypes && all.rows.length === 4 && all.rows.every(x => x.l_per_week === 80), 'generic residential → every dwelling type');
  assert.deepStrictEqual(w.crqRateToTable(gr({ use_class: 'apartments', stream: 'garbage', value_num: 60, unit: 'L/unit/week' }), ctx).rows.map(x => x.unit_type), ['apt_1br', 'apt_2br', 'apt_3br'], 'apartments → the three apartment types');
  assert.match(w.crqRateToTable(gr({ use_class: 'residential', stream: 'garbage', value_num: 30, unit: 'L/bedroom/week' }), ctx).why, /per bedroom/);
  assert.equal(w.crqRateToTable(gr({ use_class: 'Café / restaurant', stream: 'garbage', value_num: 240, unit: 'L/100m2/day' }), { ...ctx, uses: [{ use_code: 'cafe', label: 'Café / restaurant' }] }).row.use_code, 'cafe', 'accent-insensitive use matching');
  assert.match(w.crqRateToTable(gr({ use_class: 'cafe', stream: 'garbage', value_num: 5, unit: 'L/employee/day' }), ctx).why, /no formula/);
  assert.match(w.crqRateToTable(gr({ use_class: 'nail salon', stream: 'garbage', value_num: 5, unit: 'L/100m2/day' }), ctx).why, /matches no commercial use/);
  // a broad class with the real use in the wording — the case the Northern Beaches table produced
  const viaText = w.crqRateToTable(gr({ use_class: 'commercial', stream: 'garbage', value_num: 50, unit: 'L/100m² floor area/day', value_text: 'Cafe / restaurant: 50 L per 100 m² floor area per day' }), ctx);
  assert.ok(viaText.ok && viaText.viaText && viaText.row.use_code === 'cafe', 'the use is recovered from the wording');
  assert.match(w.crqRateToTable(gr({ use_class: 'commercial', stream: 'garbage', value_num: 50, unit: 'L/100m2/day', value_text: '50 L per 100 m² per day' }), ctx).why, /broad class.*pick the use below/);
  assert.equal(w.crqUseFromText('Hotel rooms generate 5 L per bed per day', ctx.uses).use_code, 'hotel_beds');
  assert.equal(w.crqUseFromText('nothing here', ctx.uses), null);
  // a floor-area rate must never land on the per-bed variant of the same premises
  const variants = [{ use_code: 'backpackers', label: 'Backpackers accommodation (per bed)' },
                    { use_code: 'backpackers_sydney', label: 'Backpackers accommodation (per m²)' }];
  const area = w.crqRateToTable(gr({ use_class: 'Backpackers accommodation', stream: 'garbage', value_num: 6, unit: 'L/100m² floor area/day' }), { ...ctx, uses: variants });
  assert.equal(area.ok && area.row.use_code, 'backpackers_sydney', 'a per-100m² rate picks the per-m² variant');
  const bed = w.crqRateToTable(gr({ use_class: 'Backpackers accommodation', stream: 'garbage', value_num: 5, unit: 'L/bed/day' }), { ...ctx, uses: variants });
  assert.equal(bed.ok && bed.row.use_code, 'backpackers', 'a per-bed rate picks the per-bed variant');
  assert.match(w.crqRateToTable(gr({ use_class: 'Backpackers accommodation', stream: 'garbage', value_num: 6, unit: 'L/100m2/day' }), { ...ctx, uses: [variants[0]] }).why,
    /measured per bed but the rate is per area/, 'with no matching variant it refuses and says why, rather than mis-measuring');
  assert.equal(w.crqUseBasis('Hotel / motel (by bed count)'), 'bed');
  assert.equal(w.crqUseBasis('Office'), null, 'a use with no variant suffix takes any basis');
  // a combined garbage+recycling figure is named as such, never silently halved
  assert.match(w.crqRateToTable(gr({ use_class: 'cafe', stream: null, value_num: 3350, unit: 'L/100m2/day', value_text: 'Automotive: 3350 (one figure covers combined garbage and recycling)' }), ctx).why,
    /one figure covers garbage and recycling together/);
  assert.ok(SOURCE.includes('async function crqPlaceFixed(rowId)') && SOURCE.includes("onclick=\"crqPlaceFixed('${u.r.id}')\""), 'an unplaced row can be given its use / stream in the report and placed');
  assert.ok(SOURCE.includes('never a broad class like "commercial" or "residential" unless the document itself gives one rate for the whole class'), 'the prompt asks for the specific use');
  assert.match(w.crqRateToTable(gr({ use_class: '2 bed', stream: 'paper', value_num: 5, unit: 'L/dwelling/week' }), ctx).why, /no column/);
  assert.match(w.crqRateToTable(gr({ use_class: '2 bed', stream: 'garbage', value_num: 5, unit: 'L/dwelling/week' }), { ...ctx, councilValue: null }).why, /not in the councils list/);
  assert.match(w.crqRateToTable(gr({ use_class: '2 bed', stream: 'garbage', value_num: null, unit: 'L/dwelling/week' }), ctx).why, /no numeric value/);
  assert.equal(w.crqComBasis('L/staff/day'), null);
  assert.deepStrictEqual(w.crqComBasis('L / student / week'), { unit: 'L/Student/Week', unit_value: 1, mult: 1 });
  // the writer is ADD-ONLY and the extraction calls it
  const wr = SOURCE.slice(SOURCE.indexOf('async function crqWriteRates('), SOURCE.indexOf('// ── the requirements list'));
  assert.ok(wr.includes("if (existing[plan.table].has(keys[i])) { kept++; return; }   // add-only: the table's value stands"), 'a rate the table already holds is kept, never overwritten');
  assert.ok(SOURCE.includes('async function crqPullRatesForScope()') && SOURCE.includes('onclick="crqPullRatesForScope()"'), 'rates already extracted can be pulled into the tables without re-extracting');
  assert.ok(SOURCE.includes('function crqRatesReport(rr)') && SOURCE.includes('id="rdb-rates-note"'), 'the outcome is reported in the rates section, where the rows land');
  assert.ok(wr.includes('.insert(batch[table])') && !wr.includes('upsert'), 'insert only — never an upsert');
  const ex = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('// ── list rows → the checker'));
  assert.ok(ex.includes('const rr = await crqWriteRates(saved.filter(crqIsRate), doc);'), 'extraction writes the rates into the tables');
  assert.ok(ex.includes(".insert(rows).select();") && ex.includes('const saved = (ins && ins.length === rows.length) ? ins : rows;'),
    'the report is built from the SAVED rows, so its pick-a-use and split buttons address real row ids');
  assert.ok(ex.includes('rates → tables:') && ex.includes('not placed — '), 'and reports added / kept / not placed with the reason');
  assert.ok(ex.includes('⬆ Publish to live to push them to the calculator'), 'going live stays the explicit publish, as for a hand-typed rate');
});

// ── pattern 4: a premises must never be silently relabelled onto another ──
test('a rate seats only on the use the document names — generic words never match, and a contested cell is named', () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['crxNorm', /^function crxNorm\(/], ['CRQ_UNIT_BASIS', /^const CRQ_UNIT_BASIS = /],
    ['crqUseBasis', /^function crqUseBasis\(/], ['crqComBasis', /^function crqComBasis\(/],
    ['CRQ_GENERIC_WORDS', /^const CRQ_GENERIC_WORDS = /], ['crqUseFromText', /^function crqUseFromText\(/],
    ['CRX_STREAM_TO_RATES', /^const CRX_STREAM_TO_RATES = /], ['crxResUnit', /^function crxResUnit\(/],
    ['crqRateToTable', /^function crqRateToTable\(/]] });
  // the app's own commercial uses — several share the words "retail", "store", "goods"
  const uses = [{ use_code: 'retail_bulky', label: 'Bulky goods / department store' },
                { use_code: 'retail_general', label: 'General retail (non-food)' },
                { use_code: 'supermarket', label: 'Supermarket' }];
  const ctx = { state: 'NSW', councilValue: 'nbc', uses };
  const gr = o => ({ requirement_type: 'generation_rate', clause_ref: 'cl 5.4', unit: 'L/100m²/day', ...o });
  // "Retail store (non-food)" shares only generic words with both retail uses —
  // it is refused by name rather than seated on whichever was tried first
  const r = w.crqRateToTable(gr({ use_class: 'Retail store (non-food)', stream: 'garbage', value_num: 50 }), ctx);
  assert.ok(!r.ok, 'a premises the table does not carry is never absorbed by a lookalike');
  assert.match(r.why, /Retail store \(non-food\).*matches no commercial use/);
  assert.equal(w.crqUseFromText('Retail store (non-food): 50L per 100m² per day', uses), null,
    '"retail" and "store" are kinds of premises, not premises — a generic word never carries a match');
  assert.equal(w.crqUseFromText('Supermarket: 100L/100m²/day', uses).use_code, 'supermarket',
    'a distinctive word still matches');
  assert.equal(w.crqUseFromText('Department stores: 100L/100m²/day', uses).use_code, 'retail_bulky',
    'and a distinctive phrase inside the app\'s own label still matches the premises it names');
  // the wording is read only for a row that names no premises of its own
  const named = w.crqRateToTable(gr({ use_class: 'Newsagent', stream: 'garbage', value_num: 80, value_text: 'Supermarket is nearby' }), ctx);
  assert.ok(!named.ok, 'a row that names its own premises is judged on that name, not on stray wording');
  assert.equal(w.crqRateToTable(gr({ use_class: 'commercial', stream: 'garbage', value_num: 80, value_text: 'Supermarket: 80L' }), ctx).row.use_code, 'supermarket');
  // two premises landing in one cell are BOTH named — first-wins is not silence
  const wr = SOURCE.slice(SOURCE.indexOf('async function crqWriteRates('), SOURCE.indexOf('function crqRatesReport('));
  assert.ok(wr.includes('if (seen.has(k)) { clash[k] = (clash[k] || []).concat(r.use_class || \'?\'); return; }'),
    'a second premises for the same cell is recorded, not dropped');
  assert.ok(wr.includes("out.clashes.push({ cell: k.split('|').slice(1).join(' · '), kept: first[k], also: [...new Set(clash[k])] })"));
  assert.ok(SOURCE.includes('two premises want the same cell') && SOURCE.includes('Check which is right.'),
    'and the contest is shown in the rates report');
});

// ── GUARDRAIL 1: a combined figure is never force-fit into GW/REC ─────────
test('guardrail: a combined garbage+recycling figure is HELD, never split by the system', () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['crxNorm', /^function crxNorm\(/], ['CRQ_UNIT_BASIS', /^const CRQ_UNIT_BASIS = /],
    ['crqUseBasis', /^function crqUseBasis\(/], ['crqComBasis', /^function crqComBasis\(/],
    ['CRQ_GENERIC_WORDS', /^const CRQ_GENERIC_WORDS = /], ['crqUseFromText', /^function crqUseFromText\(/],
    ['CRX_STREAM_TO_RATES', /^const CRX_STREAM_TO_RATES = /], ['crxResUnit', /^function crxResUnit\(/],
    ['crqRateToTable', /^function crqRateToTable\(/], ['crqIsCombined', /^function crqIsCombined\(/]] });
  const ctx = { state: 'NSW', councilValue: 'nbc', uses: [{ use_code: 'automotive', label: 'Automotive repair and service' }] };
  // the real Northern Beaches case: one figure, no stream column
  const r = { requirement_type: 'generation_rate', clause_ref: 'cl 5.4', use_class: 'Automotive repair and service',
    stream: null, value_num: 3350, unit: 'L/100m² floor area/day',
    value_text: 'Automotive repair and service: 3350 L/100m² floor area/day (one figure covers combined garbage and recycling)' };
  const out = w.crqRateToTable(r, ctx);
  assert.ok(!out.ok, 'a combined figure never becomes a rate row on the engine\'s own initiative');
  assert.match(out.why, /one figure covers garbage and recycling together/);
  assert.ok(w.crqIsCombined({ why: out.why }), 'and it is recognisable as held, not as an ordinary failure');
  assert.equal(w.crqIsCombined({ why: 'use class “Book shop” matches no commercial use in the table — pick the use below' }), false);
  assert.equal(w.crqIsCombined(null), false);
  // no code path derives, apportions or halves a combined value
  const eng = SOURCE.slice(SOURCE.indexOf('function crqRateToTable('), SOURCE.indexOf('async function crqWriteRates('));
  assert.ok(!/value_num\s*[\/*]\s*2|rate\s*[\/*]\s*2|\*\s*0\.[0-9]/.test(eng), 'nothing halves or apportions a figure');
  // the report HOLDS them in their own section rather than offering a split inline
  const rep = SOURCE.slice(SOURCE.indexOf('function crqRatesReport('), SOURCE.indexOf('async function crqPlaceSplit('));
  assert.ok(rep.includes('const held = rr.unplaced.filter(crqIsCombined), rest = rr.unplaced.filter(u => !crqIsCombined(u));'),
    'combined rows are partitioned out of the ordinary not-placed list');
  assert.ok(rep.includes("if (crqIsCombined(u)) return '';"), 'no split box is offered inline as if it were an ordinary fix');
  assert.ok(rep.includes('The rate tables have no combined type, so this is held rather than split.'),
    'the row says it is held and why');
  assert.ok(rep.includes('representing one needs a combined-rate type in the rate tables, which is a pending decision'),
    'the pending schema decision is surfaced, not buried');
  assert.ok(rep.includes('Nothing is written for these until it lands.'), 'and nothing is written meanwhile');
  // the hand split survives only as an explicit, labelled override
  assert.ok(rep.includes('<details') && rep.includes('record a split myself'), 'a split is a disclosure, not the default offer');
  assert.ok(rep.includes("your numbers, not the council's"), 'the UI says whose numbers these are');
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqPlaceSplit('), SOURCE.indexOf('async function crqPullRatesForScope('));
  assert.ok(fn.includes('if (isNaN(gw) || isNaN(rec))'), 'both halves are required — no default, no prefilled guess');
  assert.ok(fn.includes("stream: 'garbage'") && fn.includes("stream: 'recycling'") && fn.includes("source: 'manual'"),
    'a recorded split is marked as a human addition, not an extraction');
  assert.ok(fn.includes('clause_ref: src.clause_ref') && fn.includes('combined figure split by hand: '),
    'both halves cite the council\'s clause and record that the split was made here');
});

// ── GUARDRAIL 2: the taxonomy never grows on its own ──────────────────────
test('guardrail: a commercial use is only ever created by a deliberate human act', () => {
  const inserts = SOURCE.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /from\('com_uses'\)\s*\.insert/.test(l));
  assert.equal(inserts.length, 1, 'exactly one place in the whole app creates a commercial use');
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqPlaceFixed('), SOURCE.indexOf('async function crqPullRatesForScope('));
  assert.ok(fn.includes("from('com_uses').insert("), 'and it is the report\'s pick-a-use action');
  assert.ok(fn.includes("if (useSel.value === '__new')"), 'reached only by choosing “+ new use…” explicitly');
  assert.ok(fn.includes("if (!label) { rdbMsg('Name the new use first.', false); return; }"), 'the human names it — never derived and inserted silently');
  // the automatic paths never create one
  const wr = SOURCE.slice(SOURCE.indexOf('async function crqWriteRates('), SOURCE.indexOf('function crqIsCombined('));
  assert.ok(!/com_uses'\)\s*\.(insert|upsert|update)/.test(wr), 'crqWriteRates only READS the uses list');
  const ex = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('// ── list rows → the checker'));
  assert.ok(!/com_uses/.test(ex), 'extraction never touches the uses table at all');
  // a premises with no matching use is reported with its source value intact, awaiting that act
  const rep = SOURCE.slice(SOURCE.indexOf('function crqRatesReport('), SOURCE.indexOf('async function crqPlaceSplit('));
  assert.ok(rep.includes("'✕ not placed · ' + cgbEsc([u.r.use_class, u.r.stream, (u.r.value_num != null ? u.r.value_num + ' ' + (u.r.unit || '') : '')]"),
    'the unplaced row carries the council\'s own use, stream and figure, ready to place once the use exists');
  assert.ok(rep.includes('<option value="__new">+ new use…</option>'), 'with the create-a-use action on the row itself');
});

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
  const ws2 = loadEngine({ blocks: [['wpUseClassScope', /^function wpUseClassScope\(/], ['crqToLegacy', /^function crqToLegacy\(/]] });
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

// ── C3: extraction survives the response length cap ─────────────────────
// Regression: a 64-requirement guideline overran max_tokens 8192 and the raw
// "Unterminated string in JSON" surfaced as the whole error. Rows land in a
// human review queue verified before approval — so the complete rows of a
// truncated reply are recoverable by design, and the truncation is reported.
const { loadEngine } = require('./extract.js');
const px = loadEngine({ blocks: [
  ['wsSalvageJsonRows', /^function wsSalvageJsonRows\(/],
  ['wsParseExtractionRows', /^function wsParseExtractionRows\(/],
] });

test('wsSalvageJsonRows: recovers every complete row from a truncated payload', () => {
  const whole = '{"rows":[{"a":1},{"b":"x{y}"},{"c":"esc\\"brace{"}]}';
  assert.deepEqual(px.wsSalvageJsonRows(whole, 'rows'), [{ a: 1 }, { b: 'x{y}' }, { c: 'esc"brace{' }]);
  // cut mid-string, exactly the failure mode from the screenshot
  const cut = '{"rows":[{"clause_ref":"3.2","value_text":"ok"},{"clause_ref":"4.1","value_text":"cut off he';
  assert.deepEqual(px.wsSalvageJsonRows(cut, 'rows'), [{ clause_ref: '3.2', value_text: 'ok' }]);
  // nested objects inside a row survive intact
  const nested = '{"rows":[{"a":{"b":{"c":1}}},{"d":2},{"e":';
  assert.deepEqual(px.wsSalvageJsonRows(nested, 'rows'), [{ a: { b: { c: 1 } } }, { d: 2 }]);
  // no key / no array → not salvageable, never a guess
  assert.equal(px.wsSalvageJsonRows('plain prose reply', 'rows'), null);
  assert.equal(px.wsSalvageJsonRows('{"rows": 4}', 'rows'), null);
});

test('wsParseExtractionRows: clean parse, salvage, or an error that names the cap', () => {
  const ok = px.wsParseExtractionRows({ content: [{ text: '```json\n{"rows":[{"a":1}]}\n```' }], stop_reason: 'end_turn' }, 'rows');
  assert.deepEqual(ok.rows, [{ a: 1 }]);
  assert.equal(ok.truncated, false);
  const cut = px.wsParseExtractionRows({ content: [{ text: '{"rows":[{"a":1},{"b":"unterminat' }], stop_reason: 'max_tokens' }, 'rows');
  assert.deepEqual(cut.rows, [{ a: 1 }]);
  assert.equal(cut.truncated, true);
  assert.throws(() => px.wsParseExtractionRows({ content: [{ text: 'not json at all' }], stop_reason: 'max_tokens' }, 'rows'),
    /length cap/, 'an unsalvageable capped reply names the cap, not just the parse error');
});

test('extraction CONTINUES past the length cap — a 100-row rate table is read in full', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('// ── list rows → the checker'));
  assert.equal((SOURCE.match(/max_tokens: 16000,/g) || []).length, 2, 'the general pass and the rate-table sweep both carry the raised cap');
  assert.ok(!SOURCE.includes('max_tokens: 8192'), 'no extraction is left on the old cap');
  assert.ok(fn.includes("for (let pass = 0; pass < 6; pass++)"), 'a capped reply is continued, with a safety limit');
  assert.ok(fn.includes('do not repeat any of these clause/use/stream combinations'),
    'each continuation is told what has already been captured');
  assert.ok(fn.includes('if (seen.has(k)) return; seen.add(k);'), 'rows repeated across passes are dropped, never double-inserted');
  assert.ok(fn.includes('if (!capped || !fresh) break;'), 'it stops when done, or when a pass adds nothing');
  assert.ok(fn.includes("catch (e) { if (!pass) throw e; truncated = true; break; }"),
    'a failed continuation keeps what was read and reports it, rather than losing the run');
  assert.ok(fn.includes("wsParseExtractionRows(resp, 'rows')"), 'every pass parses through the salvage path');
  assert.ok(fn.includes('still hit the length cap after ') && fn.includes('read in ${passes} passes'),
    'the outcome says how many passes ran, and whether anything may still be missing');
});

test('the rate table is TRANSCRIBED and parsed in code — every row, verified against an independent manifest', async () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['CRQ_SWEEP_LIST', /^const CRQ_SWEEP_LIST = /], ['CRQ_SWEEP_TRANSCRIBE', /^const CRQ_SWEEP_TRANSCRIBE = /],
    ['crqRateCell', /^function crqRateCell\(/], ['crqRateLines', /^function crqRateLines\(/],
    ['crqRateSweep', /^async function crqRateSweep\(/]] });

  // ── the parser, against the shape the real Northern Beaches table prints ──
  // Every failure pattern from the bug brief is one line of this table.
  const table = [
    'Type of premises | Garbage | Recycling',
    'Assembly Rooms | |',
    '- Social | 50L/100m² floor area/day | 25L/100m² floor area/day',
    '- Religious | 10L/100m² floor area/day | 5L/100m² floor area/day',
    'Automotive repair and service | 3350L/100m² floor area/day (combined garbage and recycling) |',
    'Book shop | 50L/100m² floor area/day | 50L/100m² floor area/day',
    'Car parks | 0 | 0L/100m² floor area/day',
    'Hotels/Motels | 5L/bed/per day | 5L/bed/per day',
    'Theatres | 25L/seats/screening | 5L/seats/screening',
    'Retail store (non-food) | 50L/100m² floor area/day | 50L/100m² floor area/day',
    'Boarding houses | |',
    'Dry cleaners | – | –',
  ].join('\n');
  const p = w.crqRateLines(table, 'cl 5.4, p.4');
  const by = l => p.rows.filter(r => r.label === l);
  // pattern 3: a plainly-formatted row is a row — nothing is skipped for being ordinary
  assert.deepStrictEqual(by('Book shop').map(r => [r.stream, r.value_num]), [['garbage', 50], ['recycling', 50]]);
  assert.deepStrictEqual(by('Retail store (non-food)').map(r => r.value_num), [50, 50],
    'the source label is kept verbatim — never relabelled onto a nearby use');
  // pattern 1: one figure covering both streams is carried as combined, never split or dropped
  const auto = by('Automotive repair and service');
  assert.equal(auto.length, 1);
  assert.equal(auto[0].stream, null, 'a combined figure claims no stream');
  assert.ok(auto[0].combined && auto[0].value_num === 3350);
  // pattern 2: an unusual unit is transcribed as printed, not forced into a known one
  assert.equal(by('Theatres')[0].unit, 'L/seats/screening');
  assert.equal(by('Hotels/Motels')[0].unit, 'L/bed/day');
  assert.equal(by('Assembly Rooms — Social')[0].unit, 'L/100m² floor area/day');
  // sub-rows carry their heading; the heading itself is not a rate row
  assert.deepStrictEqual(p.headings, ['Assembly Rooms', 'Boarding houses']);
  assert.equal(by('Assembly Rooms').length, 0);
  assert.deepStrictEqual(by('Assembly Rooms — Religious').map(r => r.value_num), [10, 5]);
  // a rate of 0 is a rate; a blank/dashed row is not
  assert.equal(by('Car parks').length, 2, 'zero is a figure the council stated');
  assert.equal(by('Dry cleaners').length, 0);
  assert.equal(by('Boarding houses').length, 0);
  assert.ok(p.rows.every(r => r.clause_ref === 'cl 5.4, p.4'), 'every parsed row keeps the clause');
  assert.equal(w.crqRateCell('n/a'), null);
  assert.equal(w.crqRateCell(''), null);
  assert.deepStrictEqual(w.crqRateCell('120 litres / 100m2 / week'), { value: 120, unit: 'L/100m2/week', combined: false });

  // ── the sweep: transcription is the source of truth, the manifest verifies it ──
  const manifest = [{ label: 'Book shop', clause_ref: 'cl 5.4, p.4' }, { label: 'Car parks', clause_ref: 'cl 5.4, p.4' },
    { label: 'Warehouses', clause_ref: 'cl 5.4, p.4' }];
  const seen = { systems: [], asked: [] };
  const call = async (system, text, key) => {
    seen.systems.push(key || 'transcribe');
    if (key === 'labels') return manifest;
    if (/ONLY these rows/.test(text)) { seen.asked.push(text); return 'Warehouses | 20L/100m²/day | 10L/100m²/day'; }
    return 'Book shop | 50L/100m²/day | 50L/100m²/day\nCar parks | 0L/100m²/day |';
  };
  const out = await w.crqRateSweep(call);
  assert.deepStrictEqual(seen.systems, ['transcribe', 'labels', 'transcribe'],
    'transcribe, verify against an independent read, then re-ask for what is missing');
  assert.match(seen.asked[0], /· Warehouses/, 'the retry names the rows that did not come through — never a blind “continue”');
  assert.deepStrictEqual(out.rows.map(r => r.label), ['Book shop', 'Book shop', 'Car parks', 'Warehouses', 'Warehouses']);
  assert.deepStrictEqual(out.missing, [], 'a row recovered by the retry is no longer missing');
  assert.ok(out.rows.every(r => r.clause_ref === 'cl 5.4, p.4'), 'the manifest supplies the clause the transcription lacks, retried rows included');
  assert.ok(out.transcript.includes('Book shop') && out.transcript.includes('Warehouses'), 'the raw transcription is kept for inspection');
  // still missing after the retry → named, never assumed read, and never asked a third time
  const stub = { n: 0 };
  const short = await w.crqRateSweep(async (sys, text, key) => {
    if (key === 'labels') return manifest;
    stub.n++; return 'Book shop | 50L/100m²/day | 50L/100m²/day\nCar parks | 0L/100m²/day |';
  });
  assert.deepStrictEqual(short.missing, ['Warehouses']);
  assert.equal(stub.n, 2, 'one retry, then it is reported rather than looped');
  // a manifest that fails leaves the transcription standing — a verifier that is down is not a lost table
  const noList = await w.crqRateSweep(async (sys, text, key) => {
    if (key === 'labels') throw new Error('proxy down');
    return 'Office | 10L/100m²/day |';
  });
  assert.equal(noList.rows.length, 1);
  assert.deepStrictEqual(noList.missing, []);
  assert.equal(noList.error, null, 'only a failed transcription is a failed sweep');
  // duplicate manifest labels collapse; a failed transcription is reported, not thrown
  const dup = await w.crqRateSweep(async (sys, t, key) => key === 'labels' ? [{ label: 'Office' }, { label: 'office' }] : 'Office | 10L/100m²/day |');
  assert.equal(dup.labels.length, 1);
  const bad = await w.crqRateSweep(async () => { throw new Error('proxy down'); });
  assert.equal(bad.error, 'proxy down');
  assert.deepStrictEqual(bad.rows, []);
  // the prompts ask for a copy, not a summary
  assert.match(w.CRQ_SWEEP_TRANSCRIBE, /TRANSCRIBE every table[\s\S]*verbatim/);
  assert.match(w.CRQ_SWEEP_TRANSCRIBE, /Do not skip, merge, rename, reorder or summarise any row/);
  // wiring: the sweep runs in the extraction, its rows join the same dedupe, coverage is reported
  const fn = SOURCE.slice(SOURCE.indexOf('async function crqExtract'), SOURCE.indexOf('// ── list rows → the checker'));
  assert.ok(fn.includes('const sweep = await crqRateSweep(call,'), 'the extraction sweeps the rate table');
  assert.ok(fn.includes('if (!key) return (resp.content?.[0]?.text || \'\').trim();'), 'the transcription pass reads raw text, not JSON');
  assert.ok(fn.includes('const k = seenKey(row);') && fn.includes('seen.add(k); cand.push(row);'), 'sweep rows go through the same dedupe as the general pass');
  assert.ok(fn.includes('rate table: ${sweep.rows.length} rate rows transcribed'), 'coverage is stated, not assumed');
  assert.ok(fn.includes('⚠ NOT transcribed: ${sweep.missing.slice(0, 8)'), 'and anything missed is named');
  assert.ok(fn.includes("' (one figure covers combined garbage and recycling)'"), 'a combined figure is labelled as such rather than split');
});

test('an unplaced rate can be given a NEW commercial use from the report', () => {
  const { loadEngine } = require('./extract.js');
  const w = loadEngine({ blocks: [['crqUseCode', /^function crqUseCode\(/]] });
  assert.equal(w.crqUseCode('Café / restaurant'), 'cafe_restaurant', 'accents and punctuation collapse into the existing code shape');
  assert.equal(w.crqUseCode('Domestic hardware and houseware'), 'domestic_hardware_and_houseware');
  assert.equal(w.crqUseCode('  ???  '), '', 'a name with nothing to key on yields no code — refused, never guessed');
  const fix = SOURCE.slice(SOURCE.indexOf('async function crqPlaceFixed(rowId)'), SOURCE.indexOf('// Place the rates already extracted'));
  assert.ok(fix.includes("if (useSel.value === '__new')"), 'the picker offers a new use');
  assert.ok(fix.includes("await sb.from('com_uses').insert({ use_code: code, label })"), 'which is created in com_uses');
  assert.ok(fix.includes("if (uErr && !/duplicate|unique/i.test(uErr.message))"), 'a name that already exists is reused, not an error');
  assert.ok(fix.includes("RDB.uses.push({ use_code: code, label })") && fix.includes("rdb-com-new-use"),
    'and appears at once in the commercial table’s own use picker');
  assert.ok(SOURCE.includes("<option value=\"__new\">+ new use…</option>") && SOURCE.includes('function crqFixUseChanged(rowId)'),
    'the option and its name field are wired in the report');
});

// ── admin page consolidation: one scope, one extract, one-click publish ──
test('one scope selector drives the whole council & rates page', () => {
  const rates = SOURCE.slice(SOURCE.indexOf('id="stab-rates"'), SOURCE.indexOf('<!-- ANALYTICS TAB -->'));
  assert.equal(rates.split('id="rdb-council"').length, 2, 'exactly one council selector on the page');
  assert.equal(rates.split('id="rdb-state"').length, 2, 'exactly one state selector on the page');
  assert.ok(rates.indexOf('id="rdb-council"') < rates.indexOf('adm-group adm-setup'),
    'the Scope bar sits above every section');
  assert.ok(rates.includes('onchange="admScopeChanged()"'), 'changing it re-scopes everything below');
  const sync = SOURCE.slice(SOURCE.indexOf('function admScopeSync()'), SOURCE.indexOf('async function rdbAddCouncil()'));
  assert.ok(sync.includes("document.getElementById('cg-name')") && sync.includes('cgScopeChanged(label)'),
    'the sync is the single writer of the hidden guideline-scope fields');
});

test('extraction has exactly one entry point, and it requires a saved document', () => {
  assert.ok(!SOURCE.includes('async function cgExtract()') && !SOURCE.includes('onclick="cgExtract()"'),
    'the upload-row extractor is gone — Save document is the row\'s only action');
  assert.ok(!SOURCE.includes('const CG_PROMPT'), 'its prompt went with it');
  assert.ok(SOURCE.includes("onclick=\"crqExtract('${k}')\""),
    'Extract to queue on the Library row is the one extract action');
  assert.ok(SOURCE.includes('function cgRenderReview()') && SOURCE.includes('async function cgEdit('),
    'the review pane survives for hand-editing stored versions');
});

test('onboarding copy moved behind (?) popovers; the dev table browser left the main flow', () => {
  assert.ok(SOURCE.includes('.adm-help-pop{display:none;'), 'help popovers are hidden until asked');
  assert.ok(SOURCE.includes('How a number in a guideline PDF becomes live:'),
    'the pipeline walkthrough survives inside a popover');
  const rates = SOURCE.slice(SOURCE.indexOf('id="stab-rates"'), SOURCE.indexOf('<!-- ANALYTICS TAB -->'));
  const viewer = rates.indexOf('id="rdb-view-table"');
  const details = rates.indexOf('Developer tools — read-only table browser');
  assert.ok(details >= 0 && viewer > details, 'the table browser lives inside the collapsed Developer tools section');
  assert.ok(rates.indexOf('adm-group adm-db') < details, 'after the admin flow, not inline with it');
});
