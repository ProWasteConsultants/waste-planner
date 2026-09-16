'use strict';
// ── WMP GENERATOR: TITLE · GUIDELINE AUTO-LOAD · NARRATIVE · OVERRIDES · TEXT LIBRARY ──
// Every fact the generator prints is traceable to where it came from — the
// Design tab, a generator edit, the guidelines library, a council table or a
// state fallback — and the collection narrative is ASSEMBLED from those
// facts, never generated. §1 title + guideline pick · §2 the narrative and
// its cadence · §3 the AI polish guard · §4 bin-row provenance · §5 project
// shape → text-library conditions and presets · §6 pins on the wiring.
// Nothing is copied from index.html — every function is lifted by anchor.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock } = require('./extract.js');

function load() {
  const code = [
    /^const WMPG_STREAMS = /, /^const WMPG_ORDER = /, /^const WMPG_FREQ = /, /^function wmpgFreqLabel\(/,
    /^function wmpgEsc\(/, /^function wmpgTitleDefault\(/, /^function wmpgPickGuideline\(/, /^function wmpgGuidelineLabel\(/,
    /^function glBridgeNorm\(/, /^function wmpgShape\(/, /^function wmpgShapeWords\(/,
    /^const WMPG_METHOD_LABEL = /, /^function wmpgStreamWord\(/, /^function wmpgList\(/, /^function wmpgCycleWords\(/,
    /^function wmpgBinWords\(/, /^function wmpgRoomMethod\(/, /^function wmpgNarrative\(/, /^function wmpgNarrativeText\(/,
    /^function wmpgPolishGuard\(/, /^const WMPG_BIN_FIELDS = /, /^function wmpgBinDiff\(/, /^function wmpgBinEdited\(/,
    /^function wmpgBinDiffWords\(/, /^function wmpgBinSource\(/, /^function wmpgVehicleSource\(/, /^function wmpgUpgradeDraft\(/,
    /^const TB_COND_ALIASES = /, /^const TB_CONDS = /, /^function tbCondMet\(/,
    /^const WMPG_TEXT_PRESETS_BUILTIN = /, /^function tbPresetApply\(/,
  ].map(p => extractBlock(p).text).join('\n\n');
  return new Function('WMPG', code + `
    ;return { wmpgTitleDefault, wmpgPickGuideline, wmpgGuidelineLabel, wmpgShape, wmpgShapeWords, wmpgCycleWords, wmpgBinWords,
              wmpgRoomMethod, wmpgNarrative, wmpgNarrativeText, wmpgPolishGuard, wmpgBinDiff, wmpgBinEdited, wmpgBinDiffWords,
              wmpgBinSource, wmpgVehicleSource, wmpgUpgradeDraft, tbCondMet, TB_CONDS, WMPG_TEXT_PRESETS_BUILTIN, tbPresetApply, WMPG_METHOD_LABEL };`)({ data: null });
}
const room = (over) => Object.assign({ name: 'Bin room', component: 'Residential', alloc: { apt_1br: 4 }, bins: [],
  extras: { bulky: { on: false }, textiles: { on: false }, tug: { on: false }, wash: { on: true } }, chutesOn: false,
  collection: { provider: 'council', vehicle: '', point: '', street: '', narrative: '' } }, over);
const bin = (over) => Object.assign({ stream: 'GW', sizeL: 240, qty: 2, colWk: 1, provider: 'council', method: 'kerbside_shared', cycle: 'W', src: 'calc' }, over);

// ── §1 ──
test('the document title is editable and defaults to the project, never a fixed string', () => {
  const G = load();
  assert.equal(G.wmpgTitleDefault({ name: '12 Smith St' }, {}), '12 Smith St — Waste Management Plan');
  assert.equal(G.wmpgTitleDefault({}, { address: '4 High St' }), '4 High St — Waste Management Plan', 'the address stands in for an unnamed project');
  assert.equal(G.wmpgTitleDefault({}, {}), 'Waste Management Plan', 'and nothing at all is still a title, not undefined');
  const form = extractBlock(/^function wmpgRenderForm\(/).text;
  assert.ok(form.includes("wmpgIn('Document title','title'"), 'the title is an input on the form');
  assert.ok(/\$\{esc\(d\.title \|\| 'Waste Management Plan'\)\}/.test(SOURCE), 'the cover prints it');
  assert.ok(/BM_DocTitle: d\.title/.test(SOURCE), 'and the .docx template gets it as a bookmark');
});

test('the compliance document is the council’s CURRENT guideline from the library', () => {
  const G = load();
  const rows = [
    { id: 1, council_key: 'northernbeaches', council_name: 'Northern Beaches Council', version: 1, superseded_at: '2026-01-01' },
    { id: 2, council_key: 'northernbeaches', council_name: 'Northern Beaches Council', version: 2, version_label: '2025 update', effective_date: '2025-07-01', superseded_at: null },
    { id: 3, council_key: 'northernbeaches', council_name: 'Northern Beaches Council', version: 3, superseded_at: '2026-03-01' },
    { id: 4, council_key: 'waverley', council_name: 'Waverley Council', version: 1, superseded_at: null },
  ];
  const hit = G.wmpgPickGuideline(rows, 'Northern Beaches Council');
  assert.equal(hit.id, 2, 'the newest NON-superseded version wins — not the highest number, which was withdrawn');
  assert.equal(G.wmpgPickGuideline(rows, 'northern beaches').id, 2, 'matched through the shared normaliser, so a value and a label both resolve');
  assert.equal(G.wmpgPickGuideline(rows, 'Yarra City Council'), null, 'no document on file is null — an explicit state, never a guess at a lookalike');
  assert.equal(G.wmpgPickGuideline(rows, ''), null);
  assert.equal(G.wmpgGuidelineLabel(hit), 'Northern Beaches Council — waste management guidelines, v2 2025 update, effective 2025-07-01');
  // the generator: manual entry replaces and is never overwritten
  const lg = extractBlock(/^async function wmpgLoadGuideline\(/).text;
  assert.ok(lg.includes("d.complianceSrc.kind === 'manual') return null"), 'a hand-typed document is never overwritten by the auto-load');
  assert.ok(/kind: 'none'/.test(lg), 'and no document on file is recorded as such');
  assert.ok(/no guideline on file for/.test(SOURCE), 'which the field says in words');
});

// ── §2 ──
test('the cadence sentence comes from the cycle letters the Collection Point reads', () => {
  const G = load();
  assert.equal(G.wmpgCycleWords([bin(), bin({ stream: 'REC', cycle: 'A', colWk: 0.5 }), bin({ stream: 'ORG', cycle: 'B', colWk: 0.5 })]),
    'General waste is collected weekly; commingled recycling and organics are collected fortnightly on alternating weeks.',
    'A against B is stated as alternating — the fact the busiest-week check depends on');
  assert.equal(G.wmpgCycleWords([bin(), bin({ stream: 'REC', cycle: 'F', colWk: 0.5 })]),
    'General waste is collected weekly; commingled recycling is collected fortnightly.');
  assert.equal(G.wmpgCycleWords([bin({ cycle: null, colWk: 0.25 }), bin({ stream: 'GLS', cycle: 'OFF', colWk: 0, qty: 1 })]),
    'General waste is collected monthly; glass is not collected at the kerb.', 'no letter → read from the frequency; OFF is said, not dropped');
  assert.equal(G.wmpgCycleWords([bin({ qty: 0 })]), '', 'a stream with no bins has no cadence to state');
  assert.equal(G.wmpgBinWords([bin(), bin({ stream: 'REC', sizeL: 660, qty: 1 })]), 'The following bins are provided: 2 × 240L general waste and 1 × 660L commingled recycling.');
});

test('the narrative is template-assembled per method, and a missing fact is a visible placeholder', () => {
  const G = load();
  const d = { rooms: [room()], tokens: {} };
  const r = d.rooms[0];
  r.bins = [bin(), bin({ stream: 'REC', cycle: 'A', colWk: 0.5 })];
  let t = G.wmpgNarrative(d, r);
  assert.ok(t.includes('[collection vehicle not yet selected]'), 'no vehicle → placeholder, never a guessed truck');
  assert.ok(t.includes('[collection point not yet set]') && t.includes('[street not yet set]'));
  assert.ok(t.includes('presented at the kerb'), 'kerbside shared wording');
  assert.ok(t.includes('General waste is collected weekly'), 'the cadence is in it');
  assert.ok(t.includes('2 × 240L general waste'), 'and the bins');
  r.collection = { provider: 'council', vehicle: '10.6 m rear loader', point: 'the collection zone', street: 'Smith St', narrative: '' };
  r.extras.tug.on = true;
  t = G.wmpgNarrative(d, r);
  assert.ok(!/\[[^\]]+\]/.test(t), 'every placeholder gone once the facts are in');
  assert.ok(t.includes('using the bin tug') && t.includes('Smith St') && t.includes('10.6 m rear loader'));
  // individual kerbside: residents, not the building manager
  r.bins.forEach(b => b.method = 'kerbside_individual');
  assert.ok(G.wmpgNarrative(d, r).startsWith('Each dwelling is provided with its own bins.'));
  // on-site bulk: the vehicle enters the site; a private contract says so
  r.bins.forEach(b => b.method = 'bulk'); r.collection.provider = 'private contractor';
  t = G.wmpgNarrative(d, r);
  assert.ok(t.includes('collected on site by a private waste contractor') && t.includes('enter the site via Smith St'));
  r.bins.forEach(b => b.method = 'self_haul');
  assert.ok(G.wmpgNarrative(d, r).includes('no bins are presented at the kerb'));
  // the author's own text wins over the assembled draft
  r.collection.narrative = 'My own words.';
  assert.equal(G.wmpgNarrativeText(d, r), 'My own words.');
  r.collection.narrative = '';
  assert.equal(G.wmpgNarrativeText(d, r), G.wmpgNarrative(d, r));
});

test('the room’s method is the bins’ own by majority, else read from the provider', () => {
  const G = load();
  assert.equal(G.wmpgRoomMethod(room({ bins: [bin({ method: 'bulk' }), bin({ method: 'bulk' }), bin({ method: 'kerbside_shared' })] })), 'bulk');
  assert.equal(G.wmpgRoomMethod(room({ bins: [bin({ method: null })] })), 'kerbside_shared', 'council with no method → kerbside');
  assert.equal(G.wmpgRoomMethod(room({ bins: [], collection: { provider: 'private contractor' } })), 'bulk', 'a contractor collects on site');
});

// ── §3 ──
test('AI polish is wording only: a changed figure, a lost placeholder or an invented number is REFUSED', () => {
  const G = load();
  const draft = 'Waste will be collected weekly using a 10.6 m rear loader. 4 × 1100L bins are provided. [street not yet set]';
  assert.ok(G.wmpgPolishGuard(draft, 'Collection occurs weekly with a 10.6 m rear loader; 4 × 1100L bins are provided. [street not yet set]').ok, 'reworded, same facts — accepted');
  let g = G.wmpgPolishGuard(draft, 'Waste will be collected weekly using a 10.6 m rear loader. 5 × 1100L bins are provided. [street not yet set]');
  assert.equal(g.ok, false); assert.deepStrictEqual(g.missing, ['4']); assert.deepStrictEqual(g.invented, ['5']);
  g = G.wmpgPolishGuard(draft, 'Waste will be collected weekly using a 10.6 m rear loader. 4 × 1100L bins are provided.');
  assert.equal(g.ok, false); assert.deepStrictEqual(g.lostPlaceholders, ['[street not yet set]'], 'a placeholder marks a fact not yet known — it must survive');
  g = G.wmpgPolishGuard(draft, 'Bins weekly.');
  assert.equal(g.ok, false); assert.ok(g.shortened);
  assert.equal(G.wmpgPolishGuard(draft, '').ok, false);
  const fn = extractBlock(/^async function wmpgPolishNarrative\(/).text;
  assert.ok(/if \(!g\.ok\)/.test(fn) && /The draft is unchanged/.test(fn), 'the guard runs BEFORE the text is replaced');
  assert.ok(/Keep every number/.test(extractBlock(/^const WMPG_POLISH_SYSTEM = /).text));
});

// ── §4 ──
test('a bin row keeps its Design-tab value, and an edit is visible as one wherever it prints', () => {
  const G = load();
  const b = bin({ design: { sizeL: 240, qty: 2, colWk: 1, provider: 'council', method: 'kerbside_shared' } });
  assert.equal(G.wmpgBinEdited(b), false);
  assert.equal(G.wmpgBinSource(b), 'calc');
  b.qty = 3; b.colWk = 0.5;
  assert.deepStrictEqual(G.wmpgBinDiff(b).map(x => x.field), ['qty', 'colWk']);
  assert.equal(G.wmpgBinDiffWords(b), 'qty 2→3, frequency weekly→fortnightly');
  assert.equal(G.wmpgBinSource(b), 'wmp', 'edited in WMP — differs from Design tab');
  assert.equal(G.wmpgBinSource(bin({ manual: true, design: { qty: 2 } })), 'manual', 'a calculator override is named as one, not as a WMP edit');
  assert.equal(G.wmpgBinSource(bin({ src: 'auto', design: null })), 'auto', 'a generator estimate (no schedule) is never dressed up as the Design tab');
  assert.deepStrictEqual(G.wmpgBinDiff(bin({ src: 'auto', design: null })), [], 'nothing to diverge from');
  // the write-back is explicit and one row at a time
  const ap = extractBlock(/^function wmpgApplyToDesign\(/).text;
  assert.ok(/confirm\(/.test(ap), 'apply-to-design asks first');
  assert.ok(/manualWhy = 'Set in the WMP generator'/.test(ap), 'and lands on the schedule as a named manual override, like a calculator override does');
  assert.ok(/The bin calculator does not keep this override/.test(ap), 'and says the calculator will recalculate');
  assert.ok(/wsLayoutSetTargets\(p\.schedule/.test(ap), 'the open layout is re-fed, so the Design tab shows it at once');
  const form = extractBlock(/^function wmpgRoomBlock\(/).text;
  assert.ok(form.includes('edited in WMP — differs from Design tab'), 'the form says so in those words');
});

test('the vehicle is a database record, never text: from the swept path by default, an edit is a flagged override', () => {
  const G = load();
  const d = { vehicleMeta: { id: 'hino300', name: '10.6 m rear loader' } };
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicleId: 'hino300', vehicle: '10.6 m rear loader' } })), 'swept');
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicleId: 'rl_std', vehicle: 'Rear Loader — Standard' } })), 'wmp');
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicleId: null, vehicle: 'typed name' } })), 'none', 'a name with no record is no vehicle');
  const form = extractBlock(/^function wmpgRoomBlock\(/).text;
  assert.ok(/<select data-path="rooms\.\$\{i\}\.collection\.vehicle" onchange="wmpgVehSelect/.test(form), 'the vehicle is a dropdown');
  assert.ok(!/placeholder="\[collection vehicle not yet selected\]" oninput="wmpgSet\('rooms\.\$\{i\}\.collection\.vehicle'/.test(form), 'the free-text vehicle input is gone');
  assert.ok(/wmpgVehList\(\)/.test(form) && /wsVehAll/.test(extractBlock(/^function wmpgVehList\(/).text), 'populated from the swept path tool’s own list');
  assert.ok(/rec\.minR \? 'min R ' \+ rec\.minR/.test(form), 'vehicle facts come from the selected record, not carried text');
  const sel = extractBlock(/^function wmpgVehSelect\(/).text;
  assert.ok(/room\.collection\.vehicle = v \? v\.name : ''/.test(sel), 'the printed name is only ever set from a record');
  const ap = extractBlock(/^function wmpgApplyVehicleToDesign\(/).text;
  assert.ok(/p\.vehicle = \{ id: v\.id/.test(ap) && /confirm\(/.test(ap) && /must be redrawn/.test(ap), 'nominating on the project is explicit and says the path must be redrawn');
  const qa = extractBlock(/^function wmpgQA\(/).text;
  assert.ok(/wrn\(`\$\{room\.name\}: vehicle edited in WMP/.test(qa), 'a deliberate override is a warning to review, not an error that blocks issue');
});

test('older saved drafts are upgraded in place — title, provenance and compliance source', () => {
  const G = load();
  const d = G.wmpgUpgradeDraft({ rooms: [room({ bins: [bin({ src: undefined, design: undefined })] })], compliance: 'Old doc', council: 'X' }, { name: 'P' });
  assert.equal(d.title, 'P — Waste Management Plan');
  assert.deepStrictEqual(d.complianceSrc, { kind: 'manual', council: 'X' }, 'text an author typed before this existed is treated as theirs, never auto-replaced');
  assert.equal(d.rooms[0].bins[0].src, 'calc');
  assert.deepStrictEqual(d.rooms[0].bins[0].design, { sizeL: 240, qty: 2, colWk: 1, provider: 'council', method: 'kerbside_shared' }, 'the current value becomes the Design baseline');
});

// ── §5 ──
test('wmpgShape reads the project; a preset hint fills only what the project has not said', () => {
  const G = load();
  const d = { rooms: [room({ bins: [bin({ method: 'bulk', provider: 'private contractor' }), bin({ stream: 'ORG', method: 'bulk' })], chutesOn: true })] };
  let sh = G.wmpgShape(d);
  assert.ok(sh.residential && !sh.commercial && sh.bulk && !sh.kerbside && sh.private && sh.organics && !sh.glass && sh.chutes && sh.wash);
  d.shapeHint = { method: 'kerbside_shared', commercial: true };
  sh = G.wmpgShape(d);
  assert.ok(sh.bulk && !sh.kerbside_shared, 'the bins say bulk, so the hint’s method is ignored');
  assert.ok(sh.commercial && sh.mixed, 'the project had not said commercial, so the hint fills it');
  assert.deepStrictEqual(G.wmpgShapeWords(G.wmpgShape({ rooms: [room({ bins: [bin()] })] })), ['residential', 'kerbside shared', 'council collection']);
});

test('conditions hide what does not apply — no chute, no chute text — and a typo never hides a paragraph', () => {
  const G = load();
  const noChute = { rooms: [room({ bins: [bin()] })] }, chute = { rooms: [room({ bins: [bin()], chutesOn: true })] };
  assert.equal(G.tbCondMet('chutes', noChute), false);
  assert.equal(G.tbCondMet('chutes', chute), true);
  assert.equal(G.tbCondMet('!chutes', noChute), true, 'negation');
  assert.equal(G.tbCondMet('kerbside,council', noChute), true, 'all tokens must hold — and legacy aliases resolve');
  assert.equal(G.tbCondMet('kerbside,private', noChute), false);
  assert.equal(G.tbCondMet('commercial', noChute), false);
  assert.equal(G.tbCondMet('helicopter', noChute), true, 'an unknown condition never drops a paragraph from an issued document');
  assert.equal(G.tbCondMet('', noChute), true);
  assert.ok(G.TB_CONDS.some(c => c[0] === 'compaction') && G.TB_CONDS.some(c => c[0] === '!chutes'), 'the library editor offers the new conditions');
  const panel = extractBlock(/^function tbRenderPanel\(/).text;
  assert.ok(/const shown = groups\.filter/.test(panel) && /hidden because the project has no use for them/.test(panel), 'the panel hides empty groups and says how many');
});

test('presets: built-ins are project shapes, saved presets are exact selections; both reset the exceptions', () => {
  const G = load();
  assert.deepStrictEqual(G.WMPG_TEXT_PRESETS_BUILTIN.map(p => p.name),
    ['Standard kerbside residential', 'Commercial bulk bin — private collection', 'Mixed-use with chute']);
  const d = { text: { off: { X: true }, edit: { Y: 'z' } }, rooms: [] };
  G.tbPresetApply(d, G.WMPG_TEXT_PRESETS_BUILTIN[1]);
  assert.deepStrictEqual(d.text, { off: {}, edit: {} }, 'a built-in preset clears the per-WMP exceptions');
  assert.deepStrictEqual(d.shapeHint, { method: 'bulk', provider: 'private contractor', commercial: true });
  G.tbPresetApply(d, { name: 'House', off: { A: true }, edit: { B: 'c' } });
  assert.deepStrictEqual(d.text, { off: { A: true }, edit: { B: 'c' } }, 'a saved preset is the exact selection');
  assert.equal(d.shapeHint, null);
  assert.equal(d.textPreset, 'House');
});

// ── §6 ──
test('the preview is the workspace: sections carry a hover control that reaches the generator; print does not', () => {
  const build = extractBlock(/^function wmpgBuildHtml\(/).text;
  assert.ok(/if \(forPrint\) \{ parts\.push\(h\); return; \}/.test(build), 'print and export see plain nodes');
  assert.ok(/parent\.wmpgSwap\(/.test(build) && /parent\.wmpgNarrativeMenu\(/.test(build) && /parent\.wmpgFocus\(/.test(build));
  assert.ok(/out\.forEach\(n => \{ n\.tb = groupName;/.test(extractBlock(/^function tbNodes\(/).text), 'text-library nodes are tagged with their group');
  ['wmpgSwap', 'wmpgNarrativeMenu', 'wmpgFocus', 'wmpgPopClose', 'tbGroupHtml'].forEach(fn =>
    assert.ok(new RegExp('\\nfunction ' + fn + '\\(').test(SOURCE), fn + ' exists as a function declaration'));
  assert.ok(/tbGroupHtml\(g, d\)/.test(extractBlock(/^function wmpgSwap\(/).text) && /tbGroupHtml\(g, d\)/.test(extractBlock(/^function tbRenderPanel\(/).text),
    'the popover and the panel render the same group HTML — one selection, two places to reach it');
});

test('layout: the generator opens full-screen with larger, higher-contrast controls', () => {
  const modal = extractBlock(/^function wmpgEnsureModal\(/).text;
  assert.ok(/#wmpg-overlay\{[^}]*padding:0;/.test(modal) && /\.wmpg-modal\{[^}]*width:100%;height:100%;/.test(modal), 'full screen, no boxed modal');
  assert.ok(/\.wmpg-f input,\.wmpg-f select,\.wmpg-f textarea\{[^}]*font-size:14px/.test(modal), 'inputs are 14px, up from 12');
  assert.ok(!/ev\.target === el\) closeWmpGenerator/.test(modal), 'no backdrop to click-close on a full-screen tool');
});

test('the presentation block is kept on the project, so apply-to-design can re-feed the layout with its cadence source', () => {
  assert.ok(/if \(e\.data\.presentation\) p\.presentation = e\.data\.presentation;/.test(SOURCE));
});

// ── §7 presets live on the server, scoped to the organisation ──
function loadPresets() {
  const code = [/^const WMPG_TEXT_PRESETS_LEGACY_KEY = /, /^const WMPG_TEXT_PRESETS_BUILTIN = /, /^function tbPresetCanEdit\(/,
    /^function tbPresetApply\(/, /^function tbPresetImportPlan\(/, /^function tbPresetRow\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + ';return { tbPresetCanEdit, tbPresetImportPlan, tbPresetRow, WMPG_TEXT_PRESETS_LEGACY_KEY };')();
}

test('a preset is changed by its creator or an org admin — never by a plain member on a colleague’s', () => {
  const P = loadPresets();
  const org = { id: 'p1', name: 'House', org_id: 'org1', created_by: 'alice' };
  assert.equal(P.tbPresetCanEdit(org, { userId: 'alice', orgId: 'org1', role: 'member' }), true, 'the creator always may');
  assert.equal(P.tbPresetCanEdit(org, { userId: 'bob', orgId: 'org1', role: 'admin' }), true, 'an org admin may');
  assert.equal(P.tbPresetCanEdit(org, { userId: 'bob', orgId: 'org1', role: 'member' }), false, 'a colleague may not silently rewrite the team standard');
  const personal = { id: 'p2', name: 'Mine', org_id: null, created_by: 'alice' };
  assert.equal(P.tbPresetCanEdit(personal, { userId: 'bob', orgId: null, role: 'admin' }), false, 'admin means nothing on a personal preset');
  assert.equal(P.tbPresetCanEdit({ name: 'Built', builtin: true }, { userId: 'alice', role: 'admin' }), false, 'built-ins are code, not rows');
  assert.equal(P.tbPresetCanEdit(org, { userId: null }), false, 'signed out');
});

test('importing per-device presets renames a clash, never merges over it and never drops one', () => {
  const P = loadPresets();
  const plan = P.tbPresetImportPlan(
    [{ name: 'House', off: { A: true } }, { name: 'house', off: { B: true } }, { name: 'Other', edit: { C: 'x' } }, { name: '  ' }, null],
    [{ name: 'House' }]);
  assert.deepStrictEqual(plan.map(p => p.name), ['House (imported)', 'house (imported 2)', 'Other'], 'case-insensitive clashes get numbered names, the author’s casing kept; junk is dropped');
  assert.deepStrictEqual(plan[0].off, { A: true });
  assert.deepStrictEqual(plan[2].edit, { C: 'x' });
  assert.deepStrictEqual(plan[2].off, {}, 'missing maps become empty, not undefined — the column is not null');
});

test('the client never reads or writes preset localStorage except the one-time import', () => {
  // The legacy key appears only in the import offer; nothing else touches it,
  // and no other localStorage key holds presets.
  const uses = SOURCE.split('\n').filter(l => l.includes('WMPG_TEXT_PRESETS_LEGACY_KEY') || l.includes("'pw_wmp_text_presets"));
  const offer = extractBlock(/^async function tbOfferLocalImport\(/).text;
  uses.forEach(l => assert.ok(offer.includes(l.trim()) || /^const WMPG_TEXT_PRESETS_LEGACY_KEY = /.test(l.trim()) || /WMPG_TEXT_PRESETS_LEGACY_KEY;/.test(l.trim()), 'stray preset localStorage use: ' + l.trim()));
  assert.ok(!/WMPG_TEXT_PRESETS_KEY\b/.test(SOURCE), 'the old per-device store is gone');
  assert.ok(/localStorage\.removeItem\(WMPG_TEXT_PRESETS_LEGACY_KEY\)/.test(offer), 'after the offer the key is cleared');
  assert.ok(/_archived/.test(offer), 'a declined import is parked, not destroyed');
  ['tbSavePreset', 'tbDeletePreset', 'tbFetchPresets'].forEach(fn => {
    const t = extractBlock(new RegExp('^async function ' + fn + '\\(')).text;
    assert.ok(/from\('wmp_text_presets'\)/.test(t), fn + ' goes to the server');
    assert.ok(!/localStorage/.test(t), fn + ' never touches localStorage');
  });
  assert.ok(/tbPresetCanEdit\(existing, sc\)/.test(extractBlock(/^async function tbSavePreset\(/).text), 'saving over someone else’s preset is refused client-side too');
  assert.ok(/await tbLoadPresets\(\)/.test(extractBlock(/^async function openWmpGenerator\(/).text), 'presets load per open, for the current org context');
});

test('the migration scopes and gates presets the way the client assumes', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-16-wmp-text-presets.sql'), 'utf8');
  assert.ok(/create table if not exists public\.wmp_text_presets/.test(sql));
  assert.ok(/grant select, insert, update, delete on public\.wmp_text_presets to authenticated/.test(sql), 'RLS filters rows; the GRANT confers the privilege — both ship');
  assert.ok(/enable row level security/.test(sql));
  ['wmp_text_presets_read', 'wmp_text_presets_insert', 'wmp_text_presets_update', 'wmp_text_presets_delete'].forEach(p => assert.ok(sql.includes(p), p));
  assert.ok(/wp_is_org_admin\(org_id\)/.test(sql) && /created_by = auth\.uid\(\)/.test(sql), 'update/delete: creator or org admin, the same rule tbPresetCanEdit mirrors');
  assert.ok(/org_id is null and user_id = auth\.uid\(\)/.test(sql), 'personal presets are the owner’s only');
  assert.ok(/where org_id is not null/.test(sql) && /where org_id is null/.test(sql), 'one name per org, one per personal owner');
});

test('projects are server-authoritative — the free-project cap cannot be reset by clearing the browser', () => {
  const load = extractBlock(/^async function loadProjectsFromDB\(/).text;
  assert.ok(/from\('projects'\)/.test(load) && /byId\[p\.id\] = \{ \.\.\.prev,/.test(load), 'cloud rows are merged OVER the local cache');
  assert.ok(/profiles\.projects_created, kept by trigger\) is authoritative/.test(SOURCE), 'the cap reads the trigger-kept counter, not a local count');
  const ft = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-07-free-tier-enforcement.sql'), 'utf8');
  assert.ok(/projects_created/.test(ft) && /trigger/i.test(ft));
});

// ── §8 the preview follows the field being edited ──
function loadFollow() {
  const code = [/^function wmpgSrcMatch\(/, /^function wmpgFollowPick\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + ';return { wmpgSrcMatch, wmpgFollowPick };')();
}

test('a node tag matches an edited path by segments, with * for any index, and tb: groups exactly', () => {
  const F = loadFollow();
  assert.equal(F.wmpgSrcMatch('rooms.0.bins', 'rooms.0.bins.1.qty'), 3, 'a prefix tag matches everything beneath it, scored by how much it pins');
  assert.equal(F.wmpgSrcMatch('rooms.*.bins.*.colWk', 'rooms.0.bins.1.colWk'), 5, 'wildcards pin a segment without naming it');
  assert.equal(F.wmpgSrcMatch('rooms.*.bins.*.colWk', 'rooms.0.bins.1.qty'), -1);
  assert.equal(F.wmpgSrcMatch('rooms.1.bins', 'rooms.0.bins.1.qty'), -1, 'another room’s table is not this room’s');
  assert.equal(F.wmpgSrcMatch('rooms.0.bins.1.qty', 'rooms.0.bins'), -1, 'a tag more specific than the edit does not match it');
  assert.equal(F.wmpgSrcMatch('tb:1.1 Scope', 'tb:1.1 Scope'), 99, 'group names contain dots — matched whole, never split');
  assert.equal(F.wmpgSrcMatch('tb:1.1 Scope', 'tb:1.1'), -1);
  assert.equal(F.wmpgSrcMatch('', 'x'), -1);
});

test('the primary is the most specific node; the rest are lightly marked, never jumped between', () => {
  const F = loadFollow();
  // In document order: summary table (rooms), §4 storage table (rooms.0.bins,
  // primary), §5 collection table (colWk/provider specific, plus rooms.0.bins),
  // narrative (rooms.0.bins light).
  const doc = [
    { src: ['rooms.*.name', 'rooms'], pri: true },
    { src: ['rooms.0.bins', 'rooms.0.extras'], pri: true },
    { src: ['rooms.0.bins.*.colWk', 'rooms.0.bins.*.provider', 'rooms.0.bins'], pri: true },
    { src: ['rooms.0.collection', 'rooms.0.bins'], pri: true },
  ];
  let pick = F.wmpgFollowPick(doc, 'rooms.0.bins.1.qty');
  assert.equal(pick.primary, 1, 'a bin COUNT lands on the storage table');
  assert.deepStrictEqual(pick.others, [0, 2, 3], 'and glows in the summary, the collection table and the narrative');
  pick = F.wmpgFollowPick(doc, 'rooms.0.bins.1.colWk');
  assert.equal(pick.primary, 2, 'a FREQUENCY lands on the collection table, where it actually prints');
  pick = F.wmpgFollowPick(doc, 'rooms.0.collection.street');
  assert.equal(pick.primary, 3);
  assert.deepStrictEqual(pick.others, [0], 'the summary knows the room, nothing else does');
  assert.equal(F.wmpgFollowPick(doc, 'suppliers.0.phone').primary, -1, 'nothing to follow → the caller keeps the scroll position');
  // equal specificity: a node flagged primary beats an earlier unflagged one
  const tie = [{ src: ['rooms.*.chuteText'], pri: false }, { src: ['rooms.*.chuteText'], pri: true }];
  assert.equal(F.wmpgFollowPick(tie, 'rooms.0.chuteText').primary, 1, 'the §4 chute list, not the summary bullet');
});

test('follow is on EDIT, not focus; it is applied after the reload; otherwise the scroll position is kept', () => {
  const set = extractBlock(/^function wmpgSet\(/).text;
  assert.ok(/^\s*wmpgFollow\(path\);/m.test(set), 'every wmpgSet names the path it edited');
  assert.ok(!/onfocus|focusin/.test(extractBlock(/^function wmpgIn\(/).text), 'inputs never follow on focus — tabbing must not fight the reader');
  assert.ok(/wmpgFollow\(`rooms\.\$\{i\}\.bins\.\$\{j\}\.\$\{field\}`\)/.test(extractBlock(/^function wmpgBinSet\(/).text));
  assert.ok(/wmpgFollow\('tb:' \+/.test(extractBlock(/^function tbToggle\(/).text) && /wmpgFollow\('tb:' \+/.test(extractBlock(/^function tbEdit\(/).text), 'a text-library selection follows to its section');
  const refresh = extractBlock(/^function wmpgRefreshPreview\(/).text;
  assert.ok(/fr\.onload = \(\) =>/.test(refresh) && /prevY = fr\.contentWindow\.scrollY/.test(refresh), 'srcdoc reloads the iframe — the follow runs after load, and a render without a fresh edit restores where the reader was');
  assert.ok(/wmpgFollowOn\(\)/.test(refresh), 'the toggle gates it');
  assert.ok(/WMPG\.followFade = setTimeout/.test(extractBlock(/^function wmpgApplyFollow\(/).text), 'the highlight fades on its own');
  assert.ok(/id="wmpg-follow"/.test(extractBlock(/^function wmpgEnsureModal\(/).text), 'the pause toggle is in the header');
});

test('the preview carries the mapping both ways: data-src on nodes (screen only), click lands on the input', () => {
  const build = extractBlock(/^function wmpgBuildHtml\(/).text;
  assert.ok(/data-src="\$\{esc\(\[\.\.\.new Set\(n\.src\)\]\.join\(' '\)\)\}"/.test(build), 'every tagged node gets data-src');
  assert.ok(/if \(forPrint\) \{ parts\.push\(h\); return; \}/.test(build), 'print sees none of it');
  assert.ok(/parent\.wmpgFocus\(src\[0\]/.test(build), 'clicking a section focuses its input');
  assert.ok(/closest\("button,a"\)\)return;/.test(build), 'the hover controls keep their own jobs');
  assert.ok(/data-src="title" data-pri/.test(build) && /data-src="projId" data-pri/.test(build), 'the cover is mapped too');
  const model = extractBlock(/^function wmpgDocModel\(/).text;
  ['rooms.${ri}.bins', 'rooms.${ri}.bins.*.colWk', 'rooms.${ri}.collection', "'rates'", "'suppliers'", "'contractors'", "'guidelines'", "'compliance'"].forEach(t =>
    assert.ok(model.includes(t), 'doc model tags ' + t));
  assert.ok(/tokens\.add\('tokens\.' \+ t\.slice\(1, -1\)\)/.test(extractBlock(/^function tbNodes\(/).text), 'a text-library section is tagged with every {token} it uses, so editing a token lands on the text that prints it');
  assert.ok(/data-path\^="\$\{path\}\."/.test(extractBlock(/^function wmpgFocus\(/).text), 'a general path (rooms.0.bins) lands on the first input beneath it');
});

// ── §9 bulky waste and chutes read the calculator's own models ──
function loadInputs() {
  const code = [/^const WMPG_STREAMS = /, /^function wmpgEsc\(/, /^const WMPG_ALLOW_CODES = /, /^const WMPG_ALLOW_IDS = /,
    /^function wmpgExtraDiff\(/, /^function wmpgExtraDiffWords\(/, /^const WMPG_CHUTE_STREAMS = /, /^const WMPG_CHUTE_OPENINGS = /,
    /^function wmpgChuteNorm\(/, /^function wmpgChuteKey\(/, /^function wmpgChuteDiff\(/, /^function wmpgChuteText\(/,
    /^const WS_RECV_SPECS = /, /^const WS_RECV_BY_STREAM = /, /^const WS_RECV_STREAM_ID = /, /^function wsRecvLibFromEquip\(/,
    /^function wsRecvOptsFor\(/, /^function wsRecvOf\(/, /^function wsRecvIsCompactor\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + `;const wmpgChuteTypes = () => [{key:'SINGLE',label:'Single chute',openings:1},{key:'TWIN',label:'Twin chute',openings:2},{key:'TRIPLE',label:'Triple chute',openings:3}];
    const wmpgRecvLabel = k => (wsRecvOf(k, {}) || {}).label || k;
    return { wmpgExtraDiff, wmpgExtraDiffWords, wmpgChuteNorm, wmpgChuteKey, wmpgChuteDiff, wmpgChuteText, wsRecvLibFromEquip, wsRecvOptsFor, wsRecvIsCompactor, WS_RECV_BY_STREAM, WS_RECV_STREAM_ID };`)();
}

test('bulky waste defaults from the calculator’s Additional storage, and an edit is a marked override', () => {
  const I = loadInputs();
  const x = { on: true, areaM2: 5, type: 'bulky waste zone', design: { on: true, areaM2: 5 } };
  assert.deepStrictEqual(I.wmpgExtraDiff(x), []);
  x.areaM2 = 8;
  assert.equal(I.wmpgExtraDiffWords(x), '5→8 m²');
  x.on = false;
  assert.equal(I.wmpgExtraDiffWords(x), 'removed in WMP');
  assert.deepStrictEqual(I.wmpgExtraDiff({ on: true, areaM2: 6, design: null }), [], 'no calculator run → nothing to diverge from (house default, flagged as such in the form)');
  const hyd = extractBlock(/^function wmpgHydrateRooms\(/).text;
  assert.ok(/z\.code === WMPG_ALLOW_CODES\[key\]/.test(hyd) && /x\.areaM2 = \+u\.fpM2/.test(hyd), 'the calculator’s ALLOW_HARD unit is the Design value');
  assert.ok(/if \(i === 0 && !room\.extras\.bulky\.design\) room\.extras\.bulky\.on = true;/.test(hyd), 'the house default yields to a calculator figure, on or off');
  const ap = extractBlock(/^function wmpgApplyExtraToDesign\(/).text;
  assert.ok(/br\.allow\[id\] = \{ on: !!x\.on, m2: x\.on \? \+x\.areaM2 : null \}/.test(ap), 'apply-to-design writes the calculator’s own allow shape (m2 null = calculated)');
  assert.ok(/writeProjectSummary\(p\.id, \{ bin_rooms: s\.bin_rooms \}\)/.test(ap) && /confirm\(/.test(ap));
});

test('the chute editor offers exactly the calculator’s options: types × openings × receivers per stream', () => {
  const I = loadInputs();
  // the receiver option set is a MIRROR of the calculator's — pinned here
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const calcRbs = /const RECV_BY_STREAM=\{\s*GW: \[([^\]]+)\],\s*REC:\[([^\]]+)\],\s*ORG:\[([^\]]+)\],/.exec(src);
  assert.ok(calcRbs, 'the calculator’s RECV_BY_STREAM is where it was');
  const parse = s => s.split(',').map(x => x.trim().replace(/'/g, ''));
  assert.deepStrictEqual(I.WS_RECV_BY_STREAM, { GW: parse(calcRbs[1]), REC: parse(calcRbs[2]), ORG: parse(calcRbs[3]) }, 'parent mirror equals the calculator’s list — one edit, two places');
  assert.ok(src.includes("const RECV_STREAM_ID={GW:'garbage',REC:'recycling',ORG:'fogo',GLS:'glass'};"), 'and the stream-id map');
  assert.deepStrictEqual(I.WS_RECV_STREAM_ID, { GW: 'garbage', REC: 'recycling', ORG: 'fogo', GLS: 'glass' });
  // library receivers merge above 'None', compactor is garbage only, streams restrict
  const lib = I.wsRecvLibFromEquip([
    { code: 'car6', label: '6×1100L carousel', category: 'chute_receiver', active: true, streams: [], w: 5, d: 5 },
    { code: 'cmp', label: 'Chute compactor', category: 'chute_receiver', active: true, compactionRatio: 3, streams: [] },
    { code: 'fogo', label: 'FOGO receiver', category: 'chute_receiver', active: true, streams: ['fogo'] },
    { code: 'old', label: 'Retired', category: 'chute_receiver', active: false },
    { code: 'bin', label: 'A bin', category: 'bin', active: true },
  ]);
  assert.deepStrictEqual(Object.keys(lib), ['LIB_car6', 'LIB_cmp', 'LIB_fogo'], 'active chute_receiver records only');
  assert.deepStrictEqual(I.wsRecvOptsFor('GW', lib), ['BIN_660', 'BIN_1100', 'INDEX_2', 'CAROUSEL_4', 'COMPACTOR', 'LIB_car6', 'LIB_cmp', 'NONE']);
  assert.deepStrictEqual(I.wsRecvOptsFor('REC', lib), ['BIN_660', 'BIN_1100', 'INDEX_2', 'CAROUSEL_4', 'LIB_car6', 'NONE'], 'no compactor for recycling — ever');
  assert.deepStrictEqual(I.wsRecvOptsFor('ORG', lib), ['BIN_240', 'LIB_car6', 'LIB_fogo', 'NONE'], 'a stream-restricted record shows only for its stream');
  assert.equal(I.wsRecvIsCompactor('LIB_cmp', lib), true); assert.equal(I.wsRecvIsCompactor('COMPACTOR', lib), true); assert.equal(I.wsRecvIsCompactor('CAROUSEL_4', lib), false);
  // normalisation: openings follow the type; extra fields ride through
  const n = I.wmpgChuteNorm({ on: true, type: 'TWIN', openings: [{ stream: 'GW', recv: 'COMPACTOR' }], ffh_mm: 3100 });
  assert.equal(n.openings.length, 2); assert.deepStrictEqual(n.openings[1], { stream: 'REC', recv: 'NONE' }); assert.equal(n.ffh_mm, 3100);
  assert.equal(I.wmpgChuteNorm({ on: true, type: 'DUAL' }).type, 'SINGLE', 'an unknown type falls to the first real one, never to a made-up one');
});

test('the chute drives the content: arrangement text from the configuration, compaction when a compactor sits beneath it', () => {
  const I = loadInputs();
  const r = { name: 'Bin room', chute: { on: true, type: 'TWIN', openings: [{ stream: 'GW', recv: 'COMPACTOR' }, { stream: 'REC', recv: 'CAROUSEL_4' }] } };
  assert.equal(I.wmpgChuteText(r), 'Bin room — Twin chute (general waste & commingled recycling), servicing all residential levels; general waste terminating into a Compactor, commingled recycling terminating into a 4×1100L carousel within the waste room.');
  assert.equal(I.wmpgChuteText({ name: 'R', chute: { on: false } }), '');
  assert.ok(I.wmpgChuteText({ name: 'R', chute: { on: true, type: 'SINGLE', openings: [{ stream: 'GW', recv: 'NONE' }] } }).endsWith('terminating into spare bins within the waste room.'));
  // diff against the calculator's configuration
  r.chuteDesign = { on: true, type: 'TWIN', openings: [{ stream: 'GW', recv: 'COMPACTOR' }, { stream: 'REC', recv: 'CAROUSEL_4' }] };
  assert.deepStrictEqual(I.wmpgChuteDiff(r), []);
  r.chute.openings[1].recv = 'BIN_1100';
  assert.equal(I.wmpgChuteDiff(r).length, 1, 'a receiver change is a departure from the calculator');
  assert.deepStrictEqual(I.wmpgChuteDiff({ chute: { on: true }, chuteDesign: undefined }), [], 'legacy draft with no baseline: nothing to compare');
  // shape: compaction and its own condition
  const G = load();
  const sh = G.wmpgShape({ rooms: [room({ chutesOn: true, chute: { on: true, type: 'SINGLE', openings: [{ stream: 'GW', recv: 'COMPACTOR' }] }, bins: [bin()] })] });
  assert.ok(sh.chutes && sh.compaction && sh.chute_compactor, 'a compactor at the base of a chute is compaction, and answers its own condition');
  assert.equal(G.wmpgShape({ rooms: [room({ chutesOn: true, chute: { on: true, type: 'SINGLE', openings: [{ stream: 'GW', recv: 'BIN_1100' }] }, bins: [bin()] })] }).compaction, false);
  assert.ok(G.TB_CONDS.some(c => c[0] === 'chute_compactor'), 'the library editor offers it');
  // the form
  const form = extractBlock(/^function wmpgRoomBlock\(/).text;
  assert.ok(!/onchange="wmpgSet\('rooms\.\$\{i\}\.chutesOn'/.test(form), 'the yes/no checkbox is gone');
  assert.ok(/wmpgChuteSet\(\$\{i\},'type'/.test(form) && /wmpgChuteSet\(\$\{i\},'recv'/.test(form) && /wmpgRecvOpts\(o\.stream\)/.test(form), 'type, stream and receiver per opening, from the shared option set');
  const ap = extractBlock(/^function wmpgApplyChuteToDesign\(/).text;
  assert.ok(/br\.chute = Object\.assign\(\{\}, br\.chute \|\| \{\}, \{ on: c\.on, type: c\.type/.test(ap), 'apply-to-design writes the calculator’s own chute shape, keeping its FFH/slab/angle fields');
});

// ── §10 the cover: the master template, filled — with an optional image ──
function loadCover() {
  const code = [/^function tplEsc\(/, /^function tplRuns\(/, /^const WMPG_COVER_BAND_H = /, /^const WMPG_COVER_MAX_BYTES = /, /^const WMPG_COVER_OUT_W = /,
    /^const EMU_PER_TWIP = /, /^function wmpgCoverFit\(/, /^function wmpgTplPageSize\(/, /^function wmpgTplCoverEnd\(/, /^function wmpgTplParagraphs\(/,
    /^function wmpgTplJoinText\(/, /^function wmpgTplRewriteParagraph\(/, /^const WMPG_COVER_PLACEHOLDERS = /, /^function wmpgTplCoverPlaceholders\(/,
    /^function wmpgTplCoverTitle\(/, /^function wmpgTplCoverBand\(/, /^function wmpgTplAddImageRel\(/, /^function wmpgTplEnsureContentType\(/,
    /^function wmpgCoverPictureXml\(/, /^function wmpgCoverCreditXml\(/, /^function wmpgTplCoverImage\(/,
    /^const WMPG_COVER_ROWS = /, /^const WMPG_COVER_LOGO = /, /^function wmpgCoverGeom\(/, /^function wmpgCoverCss\(/,
    /^function wmpgCoverDateDMY\(/, /^function wmpgCoverCreditText\(/, /^function wmpgCoverCreditParse\(/, /^function wmpgTplCoverAddressRpr\(/,
    /^function wmpgCoverPasteFile\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + ';return { wmpgCoverFit, wmpgTplPageSize, wmpgTplParagraphs, wmpgTplCoverPlaceholders, wmpgTplCoverTitle, wmpgTplCoverBand, wmpgTplAddImageRel, wmpgTplEnsureContentType, wmpgTplCoverImage, WMPG_COVER_BAND_H, WMPG_COVER_ROWS, wmpgCoverGeom, wmpgCoverCss, wmpgCoverDateDMY, wmpgCoverCreditText, wmpgCoverCreditParse, wmpgTplCoverAddressRpr, wmpgCoverPasteFile };')();
}
// A synthetic master with the REAL cover's structure: one table of shaded
// cells, self-closing empty paragraphs, the bookmarked corner fields, the
// title band (address bookmark, literal heading, empty line, the dev|address
// placeholder), and the lower band whose exact-height row carries the
// anchored logo. The circles art is the first picture, the logo the second.
const R = t => `<w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
const P = (runs, extra) => `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${extra || ''}${runs.map(R).join('')}</w:p>`;
const TC = (fill, inner, trH) => `<w:tr><w:trPr>${trH ? `<w:cantSplit/><w:trHeight w:hRule="exact" w:val="${trH}"/>` : ''}</w:trPr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="${fill}"/></w:tcPr>${inner}</w:tc></w:tr>`;
const COVER_XML = '<w:document><w:body><w:tbl>' +
  TC('003D3D', '<w:p w:rsidR="00A"/>', 360) +
  TC('003D3D', P(['PREPARED FOR']) + P(['[Client / ', 'Developer Name]'], '<w:bookmarkStart w:id="1" w:name="BM_ClientName"/><w:bookmarkEnd w:id="1"/>') + P(['DATE']) + P(['[Month Year]'])) +
  TC('003D3D', '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="7553325" cy="4267200"/><a:blip r:embed="rId9"/></wp:inline></w:drawing></w:r></w:p>', 4600) +
  TC('4BED12', '<w:p w:rsidR="00B"/>', 55) +
  TC('005F5F', '<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:bookmarkStart w:id="2" w:name="BM_SiteAddress"/><w:bookmarkEnd w:id="2"/><w:r><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="68"/><w:szCs w:val="68"/></w:rPr><w:t>Waste Management Plan</w:t></w:r></w:p>' + '<w:p w:rsidR="00C"/>' + P(['[Development Name]', '   |   ', '[Street Address, Suburb]']), 2600) +
  TC('003D3D', '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:anchor relativeHeight="251683840" behindDoc="0"><wp:positionH relativeFrom="column"><wp:posOffset>1562100</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>2487930</wp:posOffset></wp:positionV><wp:extent cx="4406265" cy="1171575"/><a:blip r:embed="rId10"/></wp:anchor></w:drawing></w:r></w:p>', 5954) +
  TC('003D3D', P(['www.prowaste.au']) + P(['info@prowaste.au'])) +
  '</w:tbl><w:p w:rsidR="00D"/><w:tbl><w:tr><w:tc><w:p><w:bookmarkStart w:id="3" w:name="BM_ProjectID"/><w:r><w:t>Project ID</w:t></w:r><w:bookmarkEnd w:id="3"/></w:p></w:tc></w:tr></w:tbl>' +
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>';

test('the image is cover-fit into the band — cropped and centred, never stretched', () => {
  const C = loadCover();
  assert.deepStrictEqual(C.wmpgCoverFit(4000, 3000, 2, 1), { sx: 0, sy: 500, sw: 4000, sh: 2000 }, 'a tall source loses top and bottom equally');
  assert.deepStrictEqual(C.wmpgCoverFit(1000, 3000, 2, 1), { sx: 0, sy: 1250, sw: 1000, sh: 500 });
  assert.deepStrictEqual(C.wmpgCoverFit(4000, 1000, 2, 1), { sx: 1000, sy: 0, sw: 2000, sh: 1000 }, 'a wide source loses the sides equally');
  assert.equal(C.wmpgCoverFit(0, 10, 1, 1), null);
});

test('the paragraph walker reads the master as Word writes it: cell paragraphs count, self-closing ones are whole, text boxes stay inside their box', () => {
  const C = loadCover();
  const end = COVER_XML.indexOf('BM_ProjectID');
  const ps = C.wmpgTplParagraphs(COVER_XML, 0, end);
  assert.equal(ps.filter(p => p.empty).length, 4, 'every <w:p …/> is one whole empty paragraph, not an opener that skews the depth');
  const texts = ps.filter(p => !p.empty).map(p => C.wmpgTplParagraphs.length && COVER_XML.slice(p.start, p.end)).map(x => (x.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map(t => t.replace(/<[^>]+>/g, '')).join(''));
  assert.ok(texts.includes('PREPARED FOR') && texts.includes('Waste Management Plan') && texts.includes('www.prowaste.au'), 'paragraphs inside table cells are seen');
  const withBox = COVER_XML.replace('<w:r><w:t>Project ID', '<w:r><w:drawing><wps:txbx><w:txbxContent><w:p><w:r><w:t>inside</w:t></w:r></w:p></w:txbxContent></wps:txbx></w:drawing></w:r><w:r><w:t>Project ID');
  const all = C.wmpgTplParagraphs(withBox, 0, withBox.length).map(p => withBox.slice(p.start, p.end));
  assert.ok(!all.some(x => x.startsWith('<w:p><w:r><w:t>inside')), 'a text box’s inner paragraph is not a top-level paragraph');
});

test('bracketed placeholders are filled from the project, or removed — split across runs or not; page 2 untouched', () => {
  const C = loadCover();
  const r = C.wmpgTplCoverPlaceholders(COVER_XML, { client: 'Stasia Property', date: '28/07/2026', projectName: '', address: '117 Flinders St, Surry Hills' });
  assert.equal(r.changed, 3);
  assert.ok(r.xml.includes('>Stasia Property<'), 'a placeholder split across two runs is still found and filled');
  assert.ok(r.xml.includes('>28/07/2026<'), 'the date, in DD/MM/YYYY like the revision table');
  assert.ok(r.xml.includes('>117 Flinders St, Surry Hills<') && !/>\s*\|\s*117/.test(r.xml), 'a blank development name drops its separator, not just its text');
  // with the address printed above the heading, the master's exact-height
  // title band cannot also show the dev|address line — it is emptied, never
  // filled and hidden (the example's artefact)
  const above = C.wmpgTplCoverPlaceholders(COVER_XML, { client: 'S', date: 'd', projectName: 'Flinders Apartments', address: '117 Flinders St', addressLineAbove: true });
  assert.ok(!above.xml.includes('Flinders Apartments') && !/>117 Flinders St<\/w:t>/.test(above.xml), 'the dev|address line is emptied when the address line is above the title');
  assert.equal(above.changed, 3);
  assert.ok(!/\[(Client|Month|Development|Street)[^\]]*\]/.test(r.xml.slice(0, r.xml.indexOf('BM_ProjectID'))), 'no bracketed placeholder survives on the cover — the example’s hidden one is exactly what this prevents');
  assert.ok(r.xml.includes('w:name="BM_ClientName"'), 'bookmarks in a rewritten paragraph survive');
  const gone = C.wmpgTplCoverPlaceholders(COVER_XML, {});
  assert.ok(!gone.xml.slice(0, gone.xml.indexOf('BM_ProjectID')).includes('['), 'with nothing to fill, the placeholders are removed outright');
  assert.ok(/<w:p><w:pPr><w:jc w:val="center"\/><\/w:pPr><\/w:p>/.test(gone.xml), 'the emptied paragraph keeps its mark so the band’s spacing does not move');
  assert.ok(/<w:rPr><w:color w:val="FFFFFF"\/><\/w:rPr>/.test(r.xml.slice(r.xml.indexOf('Stasia') - 200, r.xml.indexOf('Stasia'))), 'filled text inherits the master’s run formatting');
});

test('the editable title replaces the master’s literal heading, keeping its formatting', () => {
  const C = loadCover();
  const out = C.wmpgTplCoverTitle(COVER_XML, '117 Flinders St — Waste Management Plan');
  assert.ok(out.includes('>117 Flinders St — Waste Management Plan<') && !out.includes('>Waste Management Plan<'));
  assert.equal(C.wmpgTplCoverTitle(COVER_XML, 'Waste Management Plan'), COVER_XML, 'the default title leaves the master as it is');
  assert.equal(C.wmpgTplCoverTitle(COVER_XML.replace('BM_ProjectID', 'BM_DocTitle'), 'X'), COVER_XML.replace('BM_ProjectID', 'BM_DocTitle'), 'a template with a title bookmark is filled through the bookmark instead');
});

test('the lower band is the paragraph carrying the logo; its size is the page width by the row’s exact height', () => {
  const C = loadCover();
  const b = C.wmpgTplCoverBand(COVER_XML);
  assert.equal(b.wEmu, 11906 * 635, 'page-wide');
  assert.equal(b.hEmu, 5954 * 635, 'the master’s exact row height (5954 twips), not a guess');
  assert.equal(b.exact, true); assert.equal(b.logoRId, 'rId10', 'the second picture the cover references is the logo');
  assert.ok(COVER_XML.slice(b.insertAt - 8, b.insertAt) === '</w:pPr>', 'the picture goes in after the paragraph properties');
  assert.equal(C.wmpgTplCoverBand(COVER_XML.replace('r:embed="rId10"', 'r:embd="x"')), null, 'no logo → no band → the image is not placed, and the caller says so');
  const noRow = COVER_XML.replace('<w:trHeight w:hRule="exact" w:val="5954"/>', '');
  assert.equal(C.wmpgTplCoverBand(noRow).hEmu, C.WMPG_COVER_BAND_H, 'a row with no stated height takes the example’s picture height');
});

test('the picture goes INLINE into the band paragraph, page-wide, with the credit box up the right edge — the example’s own construction', () => {
  const C = loadCover();
  const r = C.wmpgTplCoverImage(COVER_XML, { rId: 'rIdWmpCover', credit: 'Source: SJB Architects, 24/07/2026', descr: 'photo "one".jpg' });
  assert.equal(r.note, '');
  const cover = r.xml.slice(0, r.xml.indexOf('BM_ProjectID'));
  const pic = cover.indexOf('name="Cover image"'), logo = cover.indexOf('r:embed="rId10"');
  assert.ok(pic > 0 && pic < logo && cover.lastIndexOf('<w:tc>', pic) === cover.lastIndexOf('<w:tc>', logo), 'inline picture in the same cell paragraph as the anchored logo, before it');
  assert.ok(/<wp:inline [^>]*><wp:extent cx="7560310" cy="3780790"\/>/.test(cover), 'page width × row height');
  assert.ok(!/behindDoc/.test(cover.slice(pic, pic + 400)), 'inline — no z-order games; the template’s anchored logo draws above inline content');
  assert.ok(/<a:xfrm rot="16200000">/.test(cover) && cover.includes('Source: SJB Architects, 24/07/2026'), 'the credit is a rotated text box, reading bottom to top');
  assert.ok(/<wp:positionH relativeFrom="column">/.test(cover) && /<wp:positionV relativeFrom="paragraph">/.test(cover), 'anchored to the band paragraph like the example’s Text Box 2');
  assert.ok(/<w:sz w:val="18"\/>/.test(cover) && /w:ascii="Segoe UI"/.test(cover.slice(cover.indexOf('Cover image credit'))), '9pt white Segoe UI, as the example');
  assert.ok(cover.includes('descr="photo &quot;one&quot;.jpg"'), 'attributes are escaped');
  const r2 = C.wmpgTplCoverImage(COVER_XML, { rId: 'rIdWmpCover', credit: '' });
  assert.ok(!r2.xml.includes('Cover image credit'), 'no credit → no text box at all');
  const r3 = C.wmpgTplCoverImage(COVER_XML.replace('r:embed="rId10"', 'r:embd="x"'), { rId: 'x' });
  assert.ok(/NOT placed/.test(r3.note) && r3.xml === COVER_XML.replace('r:embed="rId10"', 'r:embd="x"'), 'an unrecognised template gets no picture and a plain note');
  assert.ok(C.wmpgTplAddImageRel('<Relationships></Relationships>', 'rIdWmpCover', 'media/cover_image.jpeg').includes('Target="media/cover_image.jpeg"'));
  assert.equal(C.wmpgTplAddImageRel('<Relationships><Relationship Id="rIdWmpCover"/></Relationships>', 'rIdWmpCover', 'x'), '<Relationships><Relationship Id="rIdWmpCover"/></Relationships>', 'idempotent');
  assert.ok(C.wmpgTplEnsureContentType('<Types><Default Extension="png" ContentType="image/png"/></Types>', 'jpeg', 'image/jpeg').includes('Extension="jpeg"'));
  assert.equal(C.wmpgTplEnsureContentType('<Types><Default Extension="jpeg" ContentType="image/jpeg"/></Types>', 'jpeg', 'image/jpeg').match(/jpeg/g).length, 2, 'no duplicate default');
});

test('the cover inputs are WMP-local, the bytes live in IndexedDB, and no image means exactly the master', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/cover: \{ image: null, source: '', received: '', scrim: true \}/.test(src), 'the draft carries metadata + source + date received + scrim, no bytes');
  const acc = extractBlock(/^async function wmpgCoverAccept\(/).text;
  assert.ok(/idbPutPdf\(wmpgCoverKey\(WMPG\.projectId\), buf, f\.name\)/.test(acc), 'bytes go to IndexedDB under the project');
  assert.ok(acc.includes('/^image\\/(jpeg|png)$/') && /WMPG_COVER_MAX_BYTES/.test(acc), 'JPEG/PNG only, with a size cap');
  assert.ok(/return wmpgCoverAccept\(f, 'set'\)/.test(extractBlock(/^async function wmpgCoverUpload\(/).text), 'the file picker goes through the one accept path');
  const build = extractBlock(/^async function wmpgBuildTemplateBlob\(/).text;
  assert.ok(/if \(d\.cover && d\.cover\.image && WMPG\.coverImg && WMPG\.coverImg\.buf\)/.test(build), 'no image → the template is untouched: no frame, no placeholder picture');
  assert.ok(/wmpgCoverRender\(WMPG\.coverImg\.buf, WMPG\.coverImg\.type, band\.wEmu, band\.hEmu/.test(build), 'the photo is rendered to the band’s own aspect before it is embedded');
  assert.ok(/wmpgTplCoverPlaceholders\(xml/.test(build) && /wmpgTplCoverTitle\(xml, d\.title\)/.test(build), 'placeholders and title are always handled');
  assert.ok(/credit: wmpgCoverCreditText\(d\.cover\)/.test(build), 'the .docx credit is the composed line, never a raw field');
  assert.ok(/wmpgTplCoverAddressRpr\(xml, 0\.8\)/.test(build) && /payload\.text\.BM_SiteAddress\.rpr = addrRpr/.test(build), 'the address line inherits the master’s run at 80%');
  assert.ok(!/'\[Site address\]'/.test(extractBlock(/^function wmpgTplPayload\(/).text), 'the WMP payload never writes a bracket placeholder');
  const html = extractBlock(/^function wmpgBuildHtml\(/).text;
  assert.ok(/class="band low" data-src="cover"/.test(html) && /class="scrim"/.test(html) && /wmpgCoverCss\(\)/.test(html), 'the preview mirrors the bands, the photo, the scrim, and takes its stylesheet from the geometry');
  assert.ok(/data-src="cover\.source cover\.received"/.test(html) && /coverCredit = wmpgCoverCreditText\(d\.cover\)/.test(html), 'the preview credit is the same composed line');
  assert.ok(!/\[Site address\]/.test(html), 'the preview prints no placeholder either');
});

test('the preview cover is laid out from the master’s own rows and colours', () => {
  const C = loadCover();
  const G = C.wmpgCoverGeom();
  assert.equal(G.top, 360 + 750 + 14 + 4600, 'top band = spacer + fields row + hairline + art row');
  assert.equal(G.footer, 16838 - G.top - 55 - 2820 - 5954, 'the footer is whatever the page has left — Word paints it to the edge');
  assert.ok(Math.abs(G.logo.w - 0.583) < 0.002 && Math.abs(G.logo.x - 0.207) < 0.002, 'the logo is 58% of the page width, centred, as the master anchors it');
  assert.ok(Math.abs(G.logo.y - 0.658) < 0.002 && Math.abs(G.logo.h - 0.310) < 0.002, 'its top sits at two-thirds of the band');
  assert.ok(Math.abs((G.top + 55 + 2820 + 5954) / G.pageH - 0.865) < 0.003, 'the photo bottom lands where the example’s render puts it (86.5% of the page)');
  const css = C.wmpgCoverCss();
  for (const c of ['#003D3D', '#005F5F', '#4BED12', '#B3D9D9']) assert.ok(css.includes(c), 'master colour ' + c);
  for (const c of ['#0E211F', '#15302E', '#9fd9d6', '#bfe3e1', '#d7efee']) assert.ok(!css.includes(c), 'no invented tint ' + c);
  assert.ok(/aspect-ratio:11906\/16838/.test(css) && /container-type:inline-size/.test(css), 'the cover is an A4 page and every length is relative to its width');
  assert.ok(/\.cover \.divider\{[^}]*height:calc\(100cqw \* 0\.00462\)/.test(css), 'the 55-twip divider row');
  assert.ok(/\.cover \.low\{height:calc\(100cqw \* 0\.50008\)/.test(css), 'the 5954-twip photo row');
  assert.ok(/\.cover \.cfoot\{/.test(css) && !/\.cover \.foot\{/.test(css), 'the footer has its own class — the document’s .foot rule (38px top margin) must not leak into the cover');
  assert.ok(/justify-content:safe center/.test(css), 'an over-long title clips at the bottom of the band, as Word’s exact row does, instead of vanishing off the top');
  assert.ok(/rotate\(-90deg\)/.test(css), 'the credit reads bottom to top');
});

test('the credit line is built only from what is filled in — no bare "Source:", no dangling comma', () => {
  const C = loadCover();
  assert.equal(C.wmpgCoverCreditText({ source: 'SJB Architects', received: '2026-07-24' }), 'Source: SJB Architects, 24/07/2026');
  assert.equal(C.wmpgCoverCreditText({ source: ' SJB Architects ', received: '' }), 'Source: SJB Architects', 'source only — no comma');
  assert.equal(C.wmpgCoverCreditText({ source: '', received: '2026-07-24' }), 'Source: 24/07/2026', 'date only — no comma');
  assert.equal(C.wmpgCoverCreditText({ source: '  ', received: '' }), '', 'nothing filled → nothing printed');
  assert.equal(C.wmpgCoverCreditText(null), '');
  assert.equal(C.wmpgCoverDateDMY('2026-07-24'), '24/07/2026', 'the date input’s ISO value prints DD/MM/YYYY like the rest of the document');
  assert.equal(C.wmpgCoverDateDMY('24/07/2026'), '24/07/2026', 'an already-formatted date passes through');
  assert.deepStrictEqual(C.wmpgCoverCreditParse('Source: SJB Architects, 24/07/2026'), { source: 'SJB Architects', received: '2026-07-24' }, 'the free-text era splits back into its two fields');
  assert.deepStrictEqual(C.wmpgCoverCreditParse('SJB Architects'), { source: 'SJB Architects', received: '' });
  assert.deepStrictEqual(C.wmpgCoverCreditParse(''), { source: '', received: '' });
  const up = extractBlock(/^function wmpgUpgradeDraft\(/).text;
  assert.ok(/if \(d\.cover\.source === undefined\)/.test(up) && /wmpgCoverCreditParse\(d\.cover\.credit\)/.test(up) && /delete d\.cover\.credit/.test(up), 'an old draft is migrated once and the legacy field dropped');
  const form = extractBlock(/^function wmpgRenderForm\(/).text;
  assert.ok(/wmpgIn\('Image source','cover\.source'/.test(form) && /wmpgIn\('Date received','cover\.received',[^)]*\{type:'date'\}/.test(form), 'source + date picker');
  assert.ok(/d\.cover && d\.cover\.image \? `<div class="wmpg-grid3"/.test(form), 'the fields only exist while an image does');
  assert.ok(!/cover\.credit'/.test(form), 'no free-text credit field remains');
});

test('the address line inherits the master’s title run at 80% instead of a size typed in code', () => {
  const C = loadCover();
  const rpr = C.wmpgTplCoverAddressRpr(COVER_XML, 0.8);
  assert.ok(/<w:sz w:val="54"\/>/.test(rpr) && /<w:szCs w:val="54"\/>/.test(rpr), '68 → 54 half-points (27pt against the 34pt heading)');
  assert.ok(/<w:b\/>/.test(rpr) && /FFFFFF/.test(rpr) && /Segoe UI/.test(rpr), 'bold, white, the master’s face — read, not restated');
  assert.equal(C.wmpgTplCoverAddressRpr(COVER_XML.replace(/<w:r><w:rPr><w:rFonts w:ascii="Segoe UI" w:hAnsi="Segoe UI"\/><w:b\/><w:bCs\/><w:color w:val="FFFFFF"\/><w:sz w:val="68"\/><w:szCs w:val="68"\/><\/w:rPr><w:t>Waste Management Plan<\/w:t><\/w:r>/, '')), null, 'no run to inherit from → null, and the caller keeps its fallback');
  assert.equal(C.wmpgTplCoverAddressRpr('<w:document/>'), null, 'no bookmark → null');
});

test('Ctrl/Cmd+V pastes a cover image through the same accept path as the file picker', () => {
  const C = loadCover();
  const file = { name: 'image.png' };
  const items = [{ kind: 'string', type: 'text/plain' }, { kind: 'file', type: 'image/gif', getAsFile: () => ({ name: 'x.gif' }) }, { kind: 'file', type: 'image/png', getAsFile: () => file }];
  assert.equal(C.wmpgCoverPasteFile(items), file, 'the first JPEG/PNG file item — text and other formats are skipped');
  assert.equal(C.wmpgCoverPasteFile([{ kind: 'string', type: 'text/plain' }]), null, 'a text paste is not claimed');
  assert.equal(C.wmpgCoverPasteFile(null), null);
  const paste = extractBlock(/^async function wmpgCoverPaste\(/).text;
  assert.ok(/style\.display !== 'flex'/.test(paste), 'only while the generator is open');
  assert.ok(paste.indexOf('if (!f) return;') < paste.indexOf('ev.preventDefault()'), 'the default paste is prevented only once an image is taken');
  assert.ok(/return wmpgCoverAccept\(named, 'pasted'\)/.test(paste), 'same validation, storage, preview and remove as an upload');
  assert.ok(/document\.addEventListener\('paste', wmpgCoverPaste\)/.test(extractBlock(/^function wmpgEnsureModal\(/).text), 'registered once with the modal');
});
