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
  assert.ok(fn.includes("await sb.from('council_requirements').insert(rows);") &&
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
    ['crxResUnit', /^function crxResUnit\(/], ['crqComBasis', /^function crqComBasis\(/], ['crqUseFromText', /^function crqUseFromText\(/], ['crqRateToTable', /^function crqRateToTable\(/]] });
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
  assert.ok(ex.includes('const rr = await crqWriteRates(rows.filter(crqIsRate), doc);'), 'extraction writes the rates into the tables');
  assert.ok(ex.includes('rates → tables:') && ex.includes('not placed — '), 'and reports added / kept / not placed with the reason');
  assert.ok(ex.includes('⬆ Publish to live to push them to the calculator'), 'going live stays the explicit publish, as for a hand-typed rate');
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

test('the one extraction call carries the raised cap and reports truncation to the admin', () => {
  // cgExtract (the upload-row extractor) is gone — crqExtract on the Library
  // row is the one extract action on the page, so one call carries the cap
  assert.equal((SOURCE.match(/max_tokens: 16000,/g) || []).length, 1, 'crqExtract carries the raised cap');
  assert.ok(!SOURCE.includes('max_tokens: 8192'), 'no extraction is left on the old cap');
  assert.ok(SOURCE.includes("wsParseExtractionRows(resp, 'rows')"), 'the queue extraction parses through the salvage path');
  const warns = SOURCE.match(/he reply hit the length cap — complete rows were recovered/g) || [];
  assert.ok(warns.length >= 1, 'truncation is reported, never silent');
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
