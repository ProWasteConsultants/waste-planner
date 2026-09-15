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

test('the vehicle: from the swept path by default, an edit is flagged against the drawing, no write-back', () => {
  const G = load();
  const d = { vehicleSrc: 'swept', vehicleMeta: { name: '10.6 m rear loader' }, defaults: { vehicle: '10.6 m rear loader' } };
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicle: '10.6 m rear loader' } })), 'swept');
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicle: '8.8 m rear loader' } })), 'wmp');
  assert.equal(G.wmpgVehicleSource(d, room({ collection: { vehicle: '' } })), 'none');
  assert.ok(!/wmpgApplyToDesign/.test(extractBlock(/^function wmpgVehicleReset\(/).text));
  assert.ok(/No apply-to-design for a vehicle/.test(SOURCE), 'the swept path was DRAWN for a vehicle; renaming it would not redraw the path');
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
