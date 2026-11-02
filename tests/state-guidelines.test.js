'use strict';
// ── STATE-LEVEL GUIDELINE DOCUMENTS (2026-11-02) ────────────────────────────
// A state's own guideline document is saved in the library with Scope on
// "State defaults". Its requirements and rates stay the STATE's — never a
// council's — and a council reaches them only through a stated fallback
// when it has no requirements of its own. Rates already fall back to the
// state rows (council_value null); a state document's extraction writes
// those rows and nothing else.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock, extractSrcdocBlock, loadEngine } = require('./extract.js');

const fns = new Function(
  ['wpStateGuideKey', 'wpGuideStateOf', 'wpStateGuideName', 'wpGuideServing']
    .map(n => extractBlock(new RegExp('^function ' + n + '\\(')).text).join('\n') +
  ';return { wpStateGuideKey, wpGuideStateOf, wpStateGuideName, wpGuideServing };')();
const cgSlug = new Function(extractBlock(/^function cgSlug\(/).text + ';return cgSlug;')();

test('a state document has a key no council can ever have', () => {
  assert.equal(fns.wpStateGuideKey('nsw'), 'state:NSW');
  assert.equal(fns.wpStateGuideKey(''), null);
  assert.equal(fns.wpGuideStateOf({ council_key: 'state:VIC' }), 'VIC');
  assert.equal(fns.wpGuideStateOf({ council_key: 'northern_beaches' }), null);
  assert.equal(fns.wpGuideStateOf(null), null);
  // a council's key is cgSlug(name): only [a-z0-9_], so never 'state:…'
  for (const name of ['State NSW', 'NSW state guidelines', 'state: NSW', 'NSW — state guidelines'])
    assert.equal(fns.wpGuideStateOf({ council_key: cgSlug(name) }), null, name + ' cannot pose as a state document');
  assert.equal(fns.wpStateGuideName('nsw'), 'NSW — state guidelines');
});

test('which document serves a council: its own, else — stated — the state’s', () => {
  const council = { id: 'c', requirements: [{ clause: '1' }] };
  const councilPdfOnly = { id: 'c0', requirements: [] };
  const st = { id: 's', council_key: 'state:NSW', requirements: [{ clause: 'A' }] };
  const stEmpty = { id: 's0', council_key: 'state:NSW', requirements: [] };
  assert.deepStrictEqual(fns.wpGuideServing(council, st), { row: council, scope: 'council' }, 'the council’s own requirements win');
  assert.deepStrictEqual(fns.wpGuideServing(null, st), { row: st, scope: 'state', councilDoc: null }, 'no council document → the state’s');
  assert.deepStrictEqual(fns.wpGuideServing(councilPdfOnly, st), { row: st, scope: 'state', councilDoc: councilPdfOnly },
    'a council PDF with no requirements yet → the state’s requirements, and the pending council PDF is carried so it can be said');
  assert.deepStrictEqual(fns.wpGuideServing(councilPdfOnly, stEmpty), { row: councilPdfOnly, scope: 'council' }, 'neither serves requirements → the council’s document stays');
  assert.deepStrictEqual(fns.wpGuideServing(null, stEmpty), { row: stEmpty, scope: 'state', councilDoc: null });
  assert.equal(fns.wpGuideServing(null, null), null);
});

test('a state document’s rates write the state rows only; a council’s never do', () => {
  const w = loadEngine({ blocks: [['CRX_STREAM_TO_RATES', /^const CRX_STREAM_TO_RATES = /], ['crxNorm', /^function crxNorm\(/],
    ['crxResUnit', /^function crxResUnit\(/], ['CRQ_UNIT_BASIS', /^const CRQ_UNIT_BASIS = /], ['crqUseBasis', /^function crqUseBasis\(/],
    ['crqComBasis', /^function crqComBasis\(/], ['CRQ_GENERIC_WORDS', /^const CRQ_GENERIC_WORDS = /],
    ['crqUseFromText', /^function crqUseFromText\(/], ['crqRateToTable', /^function crqRateToTable\(/]] });
  const uses = [{ use_code: 'cafe', label: 'Cafe / restaurant' }];
  const gr = o => ({ requirement_type: 'generation_rate', clause_ref: 'cl 4', ...o });
  const res = gr({ use_class: '2 bedroom apartments', stream: 'garbage', value_num: 80, unit: 'L/dwelling/week' });
  const com = gr({ use_class: 'Cafe / restaurant', stream: 'garbage', value_num: 50, unit: 'L/100m2/day' });
  // state document: council_value null, the state rows
  const s1 = w.crqRateToTable(res, { state: 'NSW', councilValue: null, uses, stateScope: true });
  assert.ok(s1.ok); assert.equal(s1.row.council_value, null); assert.equal(s1.row.state, 'NSW');
  const s2 = w.crqRateToTable(com, { state: 'NSW', councilValue: null, uses, stateScope: true });
  assert.ok(s2.ok); assert.equal(s2.table, 'com_rates'); assert.equal(s2.row.council_value, null);
  // a council document with no council value never falls through to the state rows
  const c1 = w.crqRateToTable(res, { state: 'NSW', councilValue: null, uses });
  assert.equal(c1.ok, false); assert.match(c1.why, /not in the councils list/);
  // and a state document can never be handed a council
  const x = w.crqRateToTable(res, { state: 'NSW', councilValue: 'camden', uses, stateScope: true });
  assert.equal(x.ok, false); assert.match(x.why, /state document cannot write a council/);
});

test('the rate writer: state from the key, no council lookup, state list never trimmed', () => {
  const wr = extractBlock(/^async function crqWriteRates\(/).text;
  assert.ok(wr.includes('const stateScope = wpGuideStateOf(doc);') && wr.includes('if (!stateScope) try {'),
    'a state document skips the council lookup entirely');
  assert.ok(wr.includes("let councilValue = null, state = stateScope || doc.state || null;"), 'its state is its key');
  assert.ok(wr.includes("const scoped = q => councilValue ? q.eq('council_value', councilValue) : q.is('council_value', null);"),
    'existing state rows are read with IS NULL, not = NULL');
  const ap = extractBlock(/^async function crqComSyncApply\(/).text;
  assert.ok(ap.includes('crqComSyncMayDelete({ stateScope: x.stateScope'),
    'a state read adds and updates; it never removes or clears the list councils fall back to');
  assert.ok(ap.includes('const own = x.stateScope ? null :'), 'and never touches a council’s com_own flag');
});

test('every council reader refuses a state document; the state one is reached by key', () => {
  const sr = extractBlock(/^async function glBridgeServingRow\(/).text;
  assert.ok(sr.includes('if (wpGuideStateOf(r)) return false;'), 'the platform bridge');
  assert.ok(extractBlock(/^async function glBridgeStateRow\(/).text.includes('r.council_key === key'));
  const pg = new Function('glBridgeNorm', extractBlock(/^function wmpgPickGuideline\(/).text + ';return wmpgPickGuideline;')(
    new Function(extractBlock(/^function glBridgeNorm\(/).text + ';return glBridgeNorm;')());
  const ps = new Function(extractBlock(/^function wmpgPickStateGuideline\(/).text + ';return wmpgPickStateGuideline;')();
  const rows = [
    { id: 1, council_key: 'state:NSW', council_name: 'NSW — state guidelines', version: 2 },
    { id: 2, council_key: 'state:NSW', council_name: 'NSW — state guidelines', version: 1, superseded_at: 'x' },
    { id: 3, council_key: 'randwick', council_name: 'Randwick City Council', version: 1 },
  ];
  assert.equal(pg(rows, 'NSW'), null, 'a council called anything like the state never picks the state document');
  assert.equal(pg(rows, 'Randwick').id, 3);
  assert.equal(ps(rows, 'nsw').id, 1, 'the state’s newest live version');
  assert.equal(ps(rows, 'VIC'), null);
  const choices = new Function(extractBlock(/^function wmpgCouncilChoices\(/).text + ';return wmpgCouncilChoices;')();
  assert.deepStrictEqual(choices(null, rows, 'NSW'), ['Randwick City Council'], 'the WMP council picker never offers a state document');
  // the checker iframe's own anon fetch
  const cf = extractSrcdocBlock('compliance-iframe', /^async function cgFetchStructured\(/).text;
  assert.ok(cf.includes("if (/^state:/.test(r.council_key || '')) return false;"), 'the checker never reads a state row as a council’s');
  assert.ok(cf.includes('stateFallback: true'), 'and marks the state fallback');
  // the admin picker, the requirements list, the sync and the layout warnings
  assert.ok(SOURCE.includes(".filter(r => !wpGuideStateOf(r)).forEach(r => add(r.council_name, r.state));"), 'the council picker');
  assert.ok(extractBlock(/^async function crqSyncServe\(/).text.includes('!wpGuideStateOf(d) && want'), 'the name fallback of the sync');
  assert.ok(extractBlock(/^async function wsCouncilReqsRefresh\(/).text.includes('if (!d || wpGuideStateOf(d)) return false;'), 'layout warnings');
});

test('the fallback is stated wherever it is used', () => {
  // WMP compliance document
  const lg = extractBlock(/^async function wmpgLoadGuideline\(/).text;
  assert.ok(lg.includes("const stList = hit ? [] : wmpgPickGuidelines(rows, null, kinds, d.state);") && lg.includes("kind: 'state'"));
  assert.ok(extractBlock(/^function wmpgComplianceNote\(/).text.includes('state fallback'));
  // WMP requirements pack
  const cl = extractBlock(/^async function creqLoad\(/).text;
  assert.ok(cl.includes('wpGuideMergeState(own,') && cl.includes('scope: pick.scope'), 'the WMP pins which scope it checked against');
  // checker: the bridge reply, the source card, the prompt
  assert.ok(SOURCE.includes("reply.scope = 'state';"));
  const gi = extractSrcdocBlock('compliance-iframe', /^function guidelineSourceInfo\(/).text;
  assert.ok(gi.includes("tag: 'State fallback — no council requirements on file'"));
  const rq = extractSrcdocBlock('compliance-iframe', /^function glRequestLib\(/).text;
  assert.ok(rq.includes('councilState: cgCouncilState()'), 'the checker tells the platform the council’s state');
  assert.ok(SOURCE.includes('STRUCTURED STATE REQUIREMENTS'), 'the scan prompt says whose requirements they are');
  // layout
  assert.ok(extractBlock(/^function wsCouncilWarnRender\(/).text.includes('state requirements (state fallback)'));
});

test('State defaults is a scope: documents, list and extraction stay the state’s', () => {
  const store = extractBlock(/^async function cgStoreDocument\(/).text;
  assert.ok(store.includes("const stateKey = document.getElementById('cg-name').value.trim() ? null : wpStateGuideKey(stScope);"),
    'no council in Scope saves the state’s own document');
  assert.ok(store.includes("cgScopeChanged(stateKey ? '' : name);"), 'and stays on State defaults after saving');
  const up = extractBlock(/^async function cgbUploadOne\(/).text;
  assert.ok(up.includes("const folder = wpGuideStateOf({ council_key: key }) ? '_state/'"), 'a storage-safe folder');
  const m = new Function('wpGuideStateOf', 'CG_SCOPE', 'cgScopeIsState', 'cgScopeMatches',
    extractBlock(/^function cgScopeMatchesRow\(/).text + ';return cgScopeMatchesRow;');
  const sc = { name: '', state: 'NSW' };
  const matchState = m(fns.wpGuideStateOf, sc, () => true, () => true);
  assert.equal(matchState({ council_key: 'state:NSW' }), true);
  assert.equal(matchState({ council_key: 'state:VIC' }), false, 'another state’s document is not this state’s');
  assert.equal(matchState({ council_key: 'randwick', council_name: 'Randwick' }), false, 'a council’s document never lists under the state');
  const matchCouncil = m(fns.wpGuideStateOf, { name: 'Randwick', state: 'NSW' }, () => false, () => true);
  assert.equal(matchCouncil({ council_key: 'state:NSW', council_name: 'Randwick' }), false, 'the state’s document never lists under a council');
  assert.equal(matchCouncil({ council_key: 'randwick', council_name: 'Randwick' }), true);
  assert.ok(extractBlock(/^async function crqServingDoc\(/).text.includes("if (stateKey) return wpGuidePrimary((data || []).filter(d => d.council_key === stateKey));"),
    'a hand-typed state requirement is pinned to the state document only');
  assert.ok(extractBlock(/^async function rdbResExtract\(/).text.includes('await glBridgeStateRow(st)'),
    'the residential table can be read from the state document too');
});

test('guard: an extraction removes only what it may — the only document, or its own rates', () => {
  const may = new Function(extractBlock(/^function crqComSyncMayDelete\(/).text + ';return crqComSyncMayDelete;')();
  const base = { stateScope: false, otherDocs: 0, cleanRead: true, read: 5, placed: 5, provenance: false };
  assert.deepStrictEqual(may(base), { clearAll: false, canDelete: true, owned: false }, 'the only document, read in full: the list follows it');
  assert.deepStrictEqual(may({ ...base, read: 0, placed: 0 }), { clearAll: true, canDelete: true, owned: false }, '…and a document with no commercial rates clears it, as before');
  assert.deepStrictEqual(may({ ...base, otherDocs: 1 }), { clearAll: false, canDelete: false, owned: false }, 'another document, no record of where rates came from: nothing removed');
  assert.deepStrictEqual(may({ ...base, otherDocs: 1, provenance: true }), { clearAll: false, canDelete: true, owned: true },
    'another document, rates tagged: only this document’s own rates may go');
  assert.deepStrictEqual(may({ ...base, otherDocs: 2, read: 0, placed: 0, provenance: true }), { clearAll: false, canDelete: true, owned: true },
    'never a clear with other documents on record');
  assert.deepStrictEqual(may({ ...base, otherDocs: -1, provenance: true }), { clearAll: false, canDelete: false, owned: false }, 'an uncountable library removes nothing');
  assert.deepStrictEqual(may({ ...base, cleanRead: false }), { clearAll: false, canDelete: false, owned: false }, 'an incomplete read never removes');
  assert.deepStrictEqual(may({ ...base, stateScope: true }), { clearAll: false, canDelete: false, owned: false }, 'a state read never removes');
  const wr = extractBlock(/^async function crqWriteRates\(/).text;
  assert.ok(wr.includes('new Set((data || []).map(wpGuideSlot).filter(sl => sl !== wpGuideSlot(doc))).size') && wr.includes('} catch (e) { otherDocs = -1; }'),
    'with the per-document schema, other DOCUMENTS count (a new version of this one does not)');
  assert.ok(wr.includes(": (data || []).filter(d => d.id !== doc.id).length;"), 'before it, every other row counts, as before');
  const ap = extractBlock(/^async function crqComSyncApply\(/).text;
  assert.ok(ap.includes('plan.remove = plan.remove.filter(e => e.source_doc === x.mine);'), 'owned: only this document’s rates are removed');
  assert.ok(ap.includes('they may come from another document') && ap.includes('from another document or were entered by hand'), 'and it says what it kept and why');
});
