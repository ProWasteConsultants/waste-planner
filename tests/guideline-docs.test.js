'use strict';
// ── SEVERAL GUIDELINE DOCUMENTS PER COUNCIL OR STATE (2026-11-02) ───────────
// A council can publish a DCP chapter and a waste guide, separate
// residential and commercial documents, an appendix, a checklist. Each is a
// DOCUMENT with its own versions (doc_slot); rows before the SQL are all
// document 'main', so an un-migrated database behaves as before.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock, extractSrcdocBlock } = require('./extract.js');

const load = (names, extra = '') => new Function(names.map(n => extractBlock(new RegExp('^(?:async )?(?:function|const) ' + n + '\\b')).text).join('\n') + extra + ';return {' + names.join(',') + '};')();
const P = load(['wpGuideSlot', 'wpGuideTs', 'wpGuideDocs', 'wpGuidePrimary', 'wpGuidePickServing', 'wpGuideMergeState', 'wpGuideApplies']);
const C = new Function(['cgPickServing', 'cgMergeState'].map(n => extractSrcdocBlock('compliance-iframe', new RegExp('^function ' + n + '\\(')).text).join('\n') + ';return { cgPickServing, cgMergeState };')();

const rows = [
  { id: 'm1', council_key: 'nb', doc_slot: 'main', version: 1, superseded_at: 'x', created_at: '2026-01-01', requirements: [{ clause: 'old' }] },
  { id: 'm2', council_key: 'nb', doc_slot: 'main', version: 2, superseded_at: null, created_at: '2026-03-01', requirements: [] },
  { id: 'c1', council_key: 'nb', doc_slot: 'dcom', doc_title: 'Commercial guide', doc_kind: 'guideline', applies_to: 'commercial', version: 1, superseded_at: null, created_at: '2026-04-01', requirements: [] },
  { id: 'k1', council_key: 'nb', doc_slot: 'dchk', doc_title: 'Checklist', doc_kind: 'checklist', version: 1, superseded_at: null, created_at: '2026-05-01', requirements: [] },
];

test('documents group by slot, each with its own newest live version and tags', () => {
  const docs = P.wpGuideDocs(rows);
  assert.deepStrictEqual(docs.map(d => d.slot), ['main', 'dcom', 'dchk'], 'main first, then by first upload');
  assert.equal(docs[0].live.id, 'm2'); assert.equal(docs[0].versions.length, 2);
  assert.equal(docs[1].applies, 'commercial'); assert.equal(docs[2].kind, 'checklist');
  // an un-migrated row (no doc_slot) is document 'main'
  assert.deepStrictEqual(P.wpGuideDocs([{ id: 1, version: 1 }, { id: 2, version: 2 }]).map(d => [d.slot, d.live.id]), [['main', 2]]);
});

test('the primary row carries the projected list; readers find it, or the newest row with requirements', () => {
  assert.equal(P.wpGuidePrimary(rows).id, 'm2', 'the live main document, even though another document is newer');
  assert.equal(P.wpGuidePrimary(rows.filter(r => r.doc_slot !== 'main')).id, 'k1', 'no main → the newest live document');
  const served = P.wpGuidePickServing(rows);
  assert.equal(served.id, 'm1'); assert.equal(served.servedFallback, true, 'a fresh primary with no list yet: the newest row with requirements, marked');
  const projected = rows.map(r => r.id === 'm2' ? Object.assign({}, r, { requirements: [{ clause: 'a' }] }) : r);
  assert.equal(P.wpGuidePickServing(projected).id, 'm2');
});

test('the checker iframe’s copies give the same answers as the platform’s', () => {
  const sets = [rows, rows.filter(r => r.doc_slot !== 'main'), [], [{ id: 1, version: 1, requirements: [] }],
    rows.map(r => r.id === 'm2' ? Object.assign({}, r, { requirements: [{ clause: 'a' }] }) : r)];
  sets.forEach((s, i) => assert.deepStrictEqual(C.cgPickServing(s), P.wpGuidePickServing(s), 'pick set ' + i));
  const own = { council_key: 'nb', requirements: [{ clause: 'c1', applies_to: 'commercial' }] };
  const st = { council_key: 'state:NSW', requirements: [{ clause: 's1', applies_to: 'residential' }, { clause: 's2', applies_to: 'commercial' }, { clause: 's3', applies_to: 'all' }] };
  [[own, st], [null, st], [own, null], [{ requirements: [] }, st], [null, null], [{ requirements: [{ clause: 'x' }] }, st]]
    .forEach(([a, b], i) => assert.deepStrictEqual(C.cgMergeState(a, b), P.wpGuideMergeState(a, b), 'merge case ' + i));
});

test('state fallback per development type: the council’s own, the state’s for the type it lacks', () => {
  const st = { council_key: 'state:NSW', requirements: [{ clause: 's1', applies_to: 'residential' }, { clause: 's2', applies_to: 'commercial' }, { clause: 's3', applies_to: 'all' }] };
  const comOnly = { council_key: 'nb', requirements: [{ clause: 'c1', applies_to: 'commercial' }] };
  const m = P.wpGuideMergeState(comOnly, st);
  assert.equal(m.scope, 'council'); assert.deepStrictEqual(m.filled, ['residential']);
  assert.deepStrictEqual(m.row.requirements.map(q => q.clause), ['c1', 'NSW state · s1', 'NSW state · s3'],
    'the state’s residential and general items, each marked as the state’s — never its commercial ones');
  assert.ok(m.row.requirements.slice(1).every(q => q.stateFallback));
  const all = { council_key: 'nb', requirements: [{ clause: 'a1', applies_to: 'all' }] };
  assert.deepStrictEqual(P.wpGuideMergeState(all, st), { row: all, scope: 'council', filled: [] }, 'a council covering both types takes nothing');
  assert.equal(P.wpGuideMergeState({ requirements: [] }, st).scope, 'state', 'none of its own → all the state’s');
  assert.equal(P.wpGuideMergeState(null, null), null);
});

test('an upload lands in the right document: new, or the next version of one', () => {
  const plan = new Function(extractBlock(/^function cgDocFieldsPlan\(/).text + ';return cgDocFieldsPlan;')();
  assert.deepStrictEqual(plan([], { docTitle: 'Waste guide', docKind: 'guideline', docApplies: 'all' }),
    { doc_slot: 'main', doc_title: 'Waste guide', doc_kind: 'guideline', applies_to: 'all' }, 'the scope’s first document is the primary one');
  const docs = P.wpGuideDocs(rows);
  const fresh = plan(docs, { docTitle: 'Appendix A', docKind: 'appendix', docApplies: 'residential' });
  assert.match(fresh.doc_slot, /^d[0-9a-z]+$/); assert.equal(fresh.doc_kind, 'appendix');
  assert.deepStrictEqual(plan(docs, { docTarget: 'dcom', docKind: 'guideline', docApplies: 'commercial' }),
    { doc_slot: 'dcom', doc_title: 'Commercial guide', doc_kind: 'guideline', applies_to: 'commercial' }, 'a new version keeps its document and name');
  const ins = extractBlock(/^async function cgInsertVersion\(/).text;
  assert.ok(ins.includes("const scoped = q => perDoc ? q.eq('doc_slot', row.doc_slot) : q;") && (ins.match(/scoped\(/g) || []).length >= 2,
    'versions number and supersede within the document only');
  assert.ok(ins.includes('delete row.doc_slot;'), 'before the SQL, the document columns are not sent');
  assert.ok(extractBlock(/^async function crqExtract\(/).text.includes("dq = dq.eq('doc_slot', slot || 'main');"), 'extraction reads the chosen document');
  assert.ok(/cgDelete\(key, slot\)[\s\S]*q = q\.eq\('doc_slot', slot \|\| 'main'\)/.test(extractBlock(/^async function cgDelete\(/).text), 'retiring a document leaves the others');
});

test('a checklist joins the requirements list and is never read for rates', () => {
  const ex = extractBlock(/^async function crqExtract\(/).text;
  assert.ok(ex.includes("const isChecklist = doc.doc_kind === 'checklist';"));
  assert.ok(ex.includes('const sweep = isChecklist ? { rows: [], labels: [], missing: [], error: null }'), 'no rate sweep');
  assert.ok(ex.includes('const rr = isChecklist ? {'), 'no write to the rate tables');
});

test('rows carry their document: its "applies to", and its name on the clause when there are several', () => {
  const f = new Function(extractBlock(/^function wpUseClassScope\(/).text + '\n' + extractBlock(/^function crqToLegacy\(/).text + ';return crqToLegacy;')();
  const docs = { g1: { id: 'g1', doc_slot: 'main', doc_title: 'Waste guide', applies_to: 'all' }, g2: { id: 'g2', doc_slot: 'dcom', doc_title: 'Commercial guide', applies_to: 'commercial' },
    g3: { id: 'g3', doc_slot: 'dchk', doc_title: 'Checklist', doc_kind: 'checklist', applies_to: 'all' } };
  const row = (id, g, use) => ({ id, council_guideline_id: g, status: 'approved', clause_ref: 'cl ' + id, requirement_type: 'other', use_class: use || null, value_text: 'x' });
  const out = f([row(1, 'g1'), row(2, 'g2'), row(3, 'g3')], docs);
  assert.deepStrictEqual(out.map(o => o.clause), ['Waste guide · cl 1', 'Commercial guide · cl 2', 'Checklist · cl 3']);
  assert.equal(out[1].applies_to, 'commercial', 'a commercial-only document’s rows are commercial');
  assert.equal(out[2].checklist, true);
  assert.deepStrictEqual(f([row(1, 'g1')], docs).map(o => o.clause), ['cl 1'], 'one document: clauses unchanged');
  assert.deepStrictEqual(f([row(1, 'g1')]).map(o => o.clause), ['cl 1'], 'no documents passed: as before');
});

test('rates follow the document: its type, its own tag, and only its own rates removed', () => {
  const g = load(['crqDocAppliesBlock', 'crqDocSource']);
  assert.match(g.crqDocAppliesBlock('residential', 'com_rates'), /residential developments/);
  assert.match(g.crqDocAppliesBlock('commercial', 'res_rates'), /commercial developments/);
  assert.equal(g.crqDocAppliesBlock('all', 'com_rates'), null);
  assert.equal(g.crqDocAppliesBlock('residential', 'res_rates'), null);
  assert.equal(g.crqDocSource({ council_key: 'nb', doc_slot: 'dcom' }), 'nb#dcom');
  assert.equal(g.crqDocSource({ council_key: 'nb' }), 'nb#main');
  const wr = extractBlock(/^async function crqWriteRates\(/).text;
  assert.ok(wr.includes('const why = crqDocAppliesBlock(doc.applies_to, x.plan.table);'));
  assert.ok(wr.includes("&& doc.applies_to !== 'residential';"), 'a residential-only document never syncs the commercial list');
  assert.ok(wr.includes('if (prov) want.forEach(x => { (x.plan.rows || [x.plan.row]).forEach(row => { row.source_doc = mine; }); });'), 'every written rate is tagged');
  assert.ok(extractBlock(/^async function crqComSyncApply\(/).text.includes('x.provenance ? { source_doc: x.mine } : {}'), 'an updated rate becomes this document’s');
});

test('the WMP names every document that applies; §1.5 lists each; checklists are not guidelines', () => {
  const W = new Function(['glBridgeNorm', 'wmpgPickGuidelines', 'wmpgGuidelineLabel', 'wmpgCouncilGuidelineLine', 'wmpgCouncilGuidelineLines', 'wmpgGuidelinesMark', 'wmpgGuidelineListed', 'wmpgGuidelinesSync']
    .map(n => extractBlock(new RegExp('^function ' + n + '\\(')).text).join('\n') + ';return { wmpgPickGuidelines, wmpgGuidelineLabel, wmpgCouncilGuidelineLines, wmpgGuidelinesSync };')();
  const lib = rows.concat([{ id: 's1', council_key: 'state:NSW', council_name: 'NSW — state guidelines', version: 1, superseded_at: null }]).map(r => Object.assign({ council_name: 'Northern Beaches Council' }, r));
  lib[lib.length - 1].council_name = 'NSW — state guidelines';
  assert.deepStrictEqual(W.wmpgPickGuidelines(lib, 'Northern Beaches', { residential: true, commercial: true }).map(r => r.id), ['m2', 'c1'], 'the checklist is left out');
  assert.deepStrictEqual(W.wmpgPickGuidelines(lib, 'Northern Beaches', { residential: true, commercial: false }).map(r => r.id), ['m2'], 'a residential project: the commercial guide is left out');
  assert.deepStrictEqual(W.wmpgPickGuidelines(lib.filter(r => r.id !== 'm2' && r.id !== 'm1'), 'Northern Beaches', { residential: true }).map(r => r.id), ['c1'], 'never filtered down to nothing');
  assert.deepStrictEqual(W.wmpgPickGuidelines(lib, null, null, 'nsw').map(r => r.id), ['s1']);
  assert.deepStrictEqual(W.wmpgPickGuidelines(lib, 'NSW'), [], 'a state document is never a council’s');
  assert.match(W.wmpgGuidelineLabel(lib[2]), /^Northern Beaches Council — Commercial guide, v1/);
  const d = { council: 'Northern Beaches Council', compliance: 'A; B', complianceSrc: { kind: 'library', docs: ['A', 'B'] }, guidelines: ['AS 4123'], guidelinesCouncil: 'Old line' };
  d.guidelines.push('Old line');
  assert.deepStrictEqual(W.wmpgCouncilGuidelineLines(d), ['A', 'B']);
  W.wmpgGuidelinesSync(d);
  assert.deepStrictEqual(d.guidelines, ['AS 4123', 'A', 'B'], 'one line per document; the previous council line is swapped out');
  assert.deepStrictEqual(d.guidelinesCouncil, ['A', 'B']);
  d.compliance = 'Typed by hand'; d.complianceSrc = { kind: 'manual' };
  W.wmpgGuidelinesSync(d);
  assert.deepStrictEqual(d.guidelines, ['AS 4123', 'Typed by hand'], 'a typed entry replaces both lines');
  const lg = extractBlock(/^async function wmpgLoadGuideline\(/).text;
  assert.ok(lg.includes("d.compliance = labels.join('; ');") && lg.includes('docs: labels'), 'the compliance field names every document');
});

test('the migration: per-document versions, tags, and rate provenance; nothing existing changes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-11-02-guideline-documents.sql'), 'utf8');
  assert.match(sql, /add column if not exists doc_slot\s+text not null default 'main'/);
  assert.match(sql, /check \(doc_kind in \('guideline','dcp','appendix','checklist','reference'\)\)/);
  assert.match(sql, /check \(applies_to in \('all','residential','commercial'\)\)/);
  assert.match(sql, /create unique index if not exists council_guidelines_key_slot_version_uidx\s+on public\.council_guidelines \(council_key, doc_slot, version\)/);
  assert.match(sql, /drop index if exists public\.council_guidelines_key_version_uidx/);
  assert.match(sql, /alter table public\.com_rates add column if not exists source_doc text/);
  assert.match(sql, /notify pgrst, 'reload schema'/);
  // the app reads every column, so it works before and after
  assert.ok(extractBlock(/^async function cgDocsSchema\(/).text.includes(".select('doc_slot').limit(1)"));
  assert.ok(extractBlock(/^async function crqRateProvenance\(/).text.includes(".select('source_doc').limit(1)"));
});

test('the library shows one card per document, and the upload row picks new or replace', () => {
  assert.ok(SOURCE.includes('<select id="cg-doc-target" onchange="cgDocTargetPicked()"'));
  for (const id of ['cg-doc-title', 'cg-doc-kind', 'cg-doc-applies']) assert.ok(SOURCE.includes('id="' + id + '"'), id);
  const lib = extractBlock(/^function cgRenderLibrary\(/).text;
  assert.ok(lib.includes('const docs = cgScopeDocs();') && lib.includes("onclick=\"crqExtract('${k}', null, '${slot}')\""), 'each document has its own Extract');
  assert.ok(lib.includes("cgDocMetaSave('${k}','${slot}','applies_to',this.value)"), 'and its own tags');
  assert.ok(extractBlock(/^async function cgDocMetaSave\(/).text.includes(".eq('council_key', key).eq('doc_slot', slot)"), 'a rename re-tags every version of that document');
});
