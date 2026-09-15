'use strict';
// ── RESIDENTIAL METHOD: RATE · STEPPED TABLE · STATE FALLBACK ────────────────
// A council's residential method is a TYPE, not a number. Most publish a
// generation rate and nothing here changes them; some publish a stepped
// lookup table (dwelling bands → bin counts by stream) which is a different
// SHAPE of answer, and a council with neither falls back to its state row and
// must say so. §1 the platform's pure core · §2 the calculator running the
// table for real · §3 the transcription parser · §4 pins on the wiring and on
// the two copies of the lookup staying identical. Nothing is copied from
// index.html — every function is lifted by anchor.

const test = require('node:test');
const assert = require('node:assert');
const { extractBlock, extractSrcdocBlock } = require('./extract.js');

// ── §1: platform side ──
function loadPlatform() {
  const code = [
    /^const WP_KERB_CYCLES = /, /^const WP_RES_STREAMS = /, /^const WP_RES_METHOD_TYPES = /,
    /^function wpResMethodTypeIds\(/, /^function wpResTableParse\(/,
    /^const WP_RES_FREQ = /, /^function wpResStreamId\(/, /^function wpResTableLines\(/,
    /^function wpResMethodParse\(/, /^function wpResTableLookup\(/, /^function wpResMethodPick\(/,
    /^function glBridgeNorm\(/,
  ].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + `
    ;return { WP_RES_METHOD_TYPES, wpResMethodTypeIds, wpResTableParse, wpResTableLines, wpResStreamId,
              wpResMethodParse, wpResTableLookup, wpResMethodPick, glBridgeNorm };`)();
}

const BANDS = [
  { min: 1, max: 2, bins: { GW: { n: 1, sizeL: 140, cycle: 'W' }, REC: { n: 1, sizeL: 240, cycle: 'F' } } },
  { min: 3, max: 10, bins: { GW: { n: 2, sizeL: 240, cycle: 'W' }, REC: { n: 2, sizeL: 240, cycle: 'F' } } },
  { min: 11, max: null, bins: { GW: { n: 4, sizeL: 660, cycle: 'W' } } },
];

test('the method is an extensible TYPE, and an unknown type is never coerced onto a known one', () => {
  const P = loadPlatform();
  assert.ok(P.wpResMethodTypeIds().includes('rate'), 'the rate method stays the default path');
  assert.ok(P.wpResMethodTypeIds().includes('table'), 'the stepped table is a type of its own');
  // Adding a shape later must not restructure what is already stored: every
  // type carries its payload under its OWN key, and `rate` carries none.
  assert.equal(P.WP_RES_METHOD_TYPES.rate.payload, null);
  assert.equal(P.WP_RES_METHOD_TYPES.table.payload, 'table');
  // A council served by a method this build does not understand falls back
  // and says so — it must never read as a rate by accident.
  assert.equal(P.wpResMethodParse({ type: 'hybrid_2027', status: 'live' }), null,
    'an unknown method type parses to null, so the caller falls back rather than guessing');
  assert.equal(P.wpResMethodParse({ type: 'table', status: 'live' }), null,
    'a table method with no readable table is not a method');
  assert.equal(P.wpResMethodParse('not json'), null);
  assert.equal(P.wpResMethodParse(null), null);
});

test('status is the review gate: anything not explicitly live parses as draft', () => {
  const P = loadPlatform();
  assert.equal(P.wpResMethodParse({ type: 'rate', status: 'live' }).status, 'live');
  assert.equal(P.wpResMethodParse({ type: 'rate' }).status, 'draft', 'no status means draft, never live');
  assert.equal(P.wpResMethodParse({ type: 'rate', status: 'approved' }).status, 'draft',
    'only the exact word live is live — a near-miss must not open the gate');
});

test('wpResTableParse: bands sort, open-ended tops survive, half a figure is not a figure', () => {
  const P = loadPlatform();
  const t = P.wpResTableParse({ steps: [BANDS[2], BANDS[0], BANDS[1]] });
  assert.deepStrictEqual(t.steps.map(s => s.min), [1, 3, 11], 'bands come back in order whatever order they were stored');
  assert.equal(t.steps[2].max, null, 'the open-ended top band keeps its null max');
  // A count without a size (or the reverse) is not a bin the calculator can
  // draw — it is dropped rather than half-stored.
  const half = P.wpResTableParse({ steps: [{ min: 1, max: 2, bins: { GW: { n: 2 }, REC: { n: 1, sizeL: 240 } } }] });
  assert.equal(half.steps[0].bins.GW, undefined, 'a count with no size is dropped, never defaulted to a size');
  assert.deepStrictEqual(half.steps[0].bins.REC, { n: 1, sizeL: 240, cycle: 'W' });
  // A band with nothing in it is not "the council requires nothing here".
  assert.equal(P.wpResTableParse({ steps: [{ min: 1, max: 2, bins: {} }] }), null);
  assert.equal(P.wpResTableParse({ steps: [{ max: 5, bins: { GW: { n: 1, sizeL: 240 } } }] }), null,
    'a band with no floor cannot be looked up, so it is not stored');
  assert.equal(P.wpResTableParse({ steps: [] }), null);
});

test('wpResTableLookup: a project outside the published bands is REPORTED, never rounded in', () => {
  const P = loadPlatform();
  const t = P.wpResTableParse({ steps: BANDS });
  assert.equal(P.wpResTableLookup(t, 1).bins.GW.sizeL, 140, 'the 140L case this brief was written for');
  assert.equal(P.wpResTableLookup(t, 2).bins.GW.n, 1);
  assert.equal(P.wpResTableLookup(t, 3).bins.GW.n, 2, 'the band boundary belongs to the band that starts there');
  assert.equal(P.wpResTableLookup(t, 10).bins.GW.sizeL, 240);
  assert.equal(P.wpResTableLookup(t, 400).bins.GW.n, 4, 'an open-ended top band answers for any size above it');
  // The refusal: a council that tabled 3–20 dwellings did not table 40.
  const closed = P.wpResTableParse({ steps: [BANDS[0], BANDS[1]] });
  const over = P.wpResTableLookup(closed, 40);
  assert.equal(over.ok, false);
  assert.equal(over.reason, 'above');
  assert.equal(over.bound, 10, 'the miss names where the table actually stopped, so the note can say it');
  const under = P.wpResTableLookup(P.wpResTableParse({ steps: [BANDS[1]] }), 1);
  assert.equal(under.reason, 'below');
  assert.equal(under.bound, 3);
  assert.equal(P.wpResTableLookup(t, 0).reason, 'none', 'an empty room is not a lookup miss to report');
});

test('wpResMethodPick: council beats state, state is FLAGGED as a fallback, drafts never serve', () => {
  const P = loadPlatform();
  const mk = (over) => Object.assign({ state: 'NSW', value: null, name: null, key: null, valueKey: null }, over);
  const live = m => Object.assign({ status: 'live', source: null }, m);
  const rows = [
    mk({ value: 'northern_beaches', name: 'Northern Beaches Council', key: P.glBridgeNorm('Northern Beaches Council'),
         valueKey: P.glBridgeNorm('northern beaches'), method: live({ type: 'table', table: P.wpResTableParse({ steps: BANDS }) }) }),
    mk({ method: live({ type: 'rate' }) }),   // the NSW state row
  ];
  const hit = P.wpResMethodPick(rows, 'NSW', 'northern_beaches', 'Northern Beaches Council');
  assert.equal(hit.scope, 'council');
  assert.equal(hit.method.type, 'table');
  // A council with no method of its own gets the state row — and the caller
  // is told it is a fallback, so a WMP never shows a state figure under a
  // council's name in silence.
  const fb = P.wpResMethodPick(rows, 'NSW', 'waverley', 'Waverley Council');
  assert.equal(fb.scope, 'state');
  assert.equal(fb.method.type, 'rate');
  // Nothing at all.
  assert.equal(P.wpResMethodPick(rows, 'VIC', 'yarra', 'Yarra City Council').scope, 'none');
  // The review gate holds at the point of service, not just in the UI.
  const drafted = [mk({ value: 'northern_beaches', valueKey: P.glBridgeNorm('northern beaches'),
                        method: { type: 'table', status: 'draft', table: P.wpResTableParse({ steps: BANDS }) } })];
  assert.equal(P.wpResMethodPick(drafted, 'NSW', 'northern_beaches', 'Northern Beaches Council').scope, 'none',
    'a draft method is invisible to the calculator, however complete it looks');
});

// ── §2: the calculator, running the table for real ──
function loadCalc({ rooms = [], councilLabel = '', councilValue = '', state = 'NSW' } = {}) {
  const blocks = [
    /^const ALLOWED_SIZES=/, /^const LIB_STREAM_KEY=/, /^let BIN_LIB=/,
    /^const COLLECT_METHODS=\{/, /^const DEFAULT_METHOD=/, /^function normMethod\(/,
    /^function defaultMethod\(/, /^function methodOf\(/, /^const DWELL=/, /^function roomDwellings\(/,
    /^function perDwellingUnits\(/, /^let COUNCIL_SCHEDULES=/, /^function councilKey\(/,
    /^function activeCouncilLabel\(/, /^function activeScheduleEntry\(/, /^function activeSchedule\(/,
    /^function scheduleFor\(/, /^function cycleCw\(/,
    /^let RES_METHODS=/, /^function resTableLookup\(/, /^function activeResMethodEntry\(/,
    /^function resTableFor\(/, /^function resTableBin\(/, /^function resTableCount\(/,
    /^const BIN_EQUIPMENT=/, /^function binFP\(/, /^function rebuildBinLib\(/,
    /^function binSizesRaw\(/, /^function binSizesFor\(/,
    /^let _szOv=\{\},_cwOv=\{\};/, /^function ovKey\(/, /^const DEFAULT_BINSIZES=/, /^const DEFAULT_COLWK=/,
    /^function defSize\(/, /^function defCw\(/, /^function normCw\(/, /^function cycleFor\(/,
    /^function roomById\(/, /^function calcBins\(/, /^let _binOv=\{\};/, /^function getBinCount\(/,
  ];
  const code = blocks.map(p => extractSrcdocBlock('calc-iframe', p).text).join('\n\n');
  const g = id => id === 'council'
    ? { value: councilValue, selectedIndex: 0, options: [{ text: councilLabel }] }
    : id === 'state' ? { value: state } : { value: '' };
  rooms.forEach(r => { if (!r.com) r.com = []; });
  const factory = new Function('ROOMS', 'g', 'document', code + `
    ;return { defSize, defCw, cycleFor, getBinCount, resTableFor, resTableBin, resTableCount, resTableLookup,
              activeResMethodEntry, perDwellingUnits, methodOf,
              setLib: rows => rebuildBinLib(rows), setResMethods: m => { RES_METHODS = m; },
              setSchedules: s => { COUNCIL_SCHEDULES = s; }, setSz: (k, v) => { _szOv[k] = v; },
              setBinOv: (k, v) => { _binOv[k] = v; } };`);
  // defSize/curSize reach for the DOM only through querySelector; nothing is
  // rendered in these tests, so an empty stub is the honest stand-in.
  return factory(rooms, g, { querySelector: () => null, querySelectorAll: () => [] });
}
const LIB = [
  { code: 'mgb140', label: '140L MGB', capacity_l: 140, streams: [], is_common: false, width_mm: 500, depth_mm: 560 },
  { code: 'mgb240', label: '240L MGB', capacity_l: 240, streams: [], is_common: true, width_mm: 585, depth_mm: 735 },
  { code: 'b660', label: '660L', capacity_l: 660, streams: [], is_common: true, width_mm: 1370, depth_mm: 780 },
];
function tableRow(steps) {
  const P = loadPlatform();
  return [{ state: 'NSW', value: 'northern_beaches', name: 'Northern Beaches Council',
            key: P.glBridgeNorm('Northern Beaches Council'), valueKey: P.glBridgeNorm('northern beaches'),
            method: { type: 'table', status: 'live', source: 'Appendix A', table: P.wpResTableParse({ steps }) } }];
}
const room = (over) => Object.assign({ id: 'r1', name: 'Bin room', kind: 'res',
  alloc: { apt_1br: 0, apt_2br: 0, apt_3br: 0, townhouse: 0 }, com: [],
  method: { r: 'kerbside_shared', c: 'bulk' } }, over);

test('a stepped-table council sizes, counts and paces the bins — the 140L case, end to end', () => {
  const r = room({ alloc: { apt_1br: 1, apt_2br: 1, apt_3br: 0, townhouse: 0 } });   // 2 dwellings
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB); C.setResMethods(tableRow(BANDS));
  assert.equal(C.defSize('r1', 'r', 'GW'), 140, 'the council’s own table supplies the size — including one the common list never offered');
  assert.equal(C.getBinCount('r1', 'r', 'GW', 0, 140, 1), 1, 'the count comes from the table, with no generation rate in sight');
  assert.equal(C.defCw('r1', 'r', 'REC'), 0.5, 'and the table’s own fortnightly cadence');
  assert.equal(C.cycleFor('r1', 'r', 'REC', 0.5), 'F', 'which travels downstream as the presentation cycle');
  // The band above: same room, more dwellings, a different row of the table.
  r.alloc.apt_2br = 4;   // 5 dwellings
  assert.equal(C.defSize('r1', 'r', 'GW'), 240);
  assert.equal(C.getBinCount('r1', 'r', 'GW', 0, 240, 1), 2);
});

test('a table council with no generation rate still answers — volume is not the basis', () => {
  const r = room({ alloc: { apt_1br: 20, apt_2br: 0, apt_3br: 0, townhouse: 0 } });
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB); C.setResMethods(tableRow(BANDS));
  // vol 0 is exactly the state a table-only council leaves behind: there is
  // no L/dwelling figure to compute. The table must still answer.
  assert.equal(C.getBinCount('r1', 'r', 'GW', 0, 660, 1), 4, 'the open-ended top band answers at 20 dwellings');
  assert.equal(C.resTableFor('r1', 'r').step.min, 11);
});

test('outside the bands the table stops answering, and the volume path takes over rather than a guessed band', () => {
  const closed = [BANDS[0], BANDS[1]];   // 1–10 only
  const r = room({ alloc: { apt_1br: 40, apt_2br: 0, apt_3br: 0, townhouse: 0 } });
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB); C.setResMethods(tableRow(closed));
  const hit = C.resTableFor('r1', 'r');
  assert.equal(hit.ok, false);
  assert.equal(hit.reason, 'above', 'the miss is reportable, so the room note can name where the table ran out');
  assert.equal(C.resTableBin('r1', 'r', 'GW'), null, 'no bin is invented for a band the council never published');
  assert.equal(C.getBinCount('r1', 'r', 'GW', 2400, 240, 1), 10, 'and the ordinary volume sizing answers instead');
});

test('the table is gated where it is physically wrong: commercial, bulk, and per-dwelling kerbside', () => {
  const P = loadPlatform();
  const r = room({ alloc: { apt_1br: 0, apt_2br: 0, apt_3br: 0, townhouse: 6 },
                   com: [{ use: 'office', value: 100, days: 5 }] });
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB); C.setResMethods(tableRow(BANDS));
  assert.ok(C.resTableFor('r1', 'r'), 'shared kerbside: the table applies');
  assert.equal(C.resTableFor('r1', 'c'), null, 'commercial keeps its own use-based rates — this is a residential method');
  // Kerbside INDIVIDUAL: every dwelling wheels out its own bin. That is a
  // fact about the development, not a figure a council can table — letting a
  // band of 2 bins answer for 6 townhouses with 6 bins would be wrong on the
  // drawing.
  r.method.r = 'kerbside_individual';
  assert.equal(C.perDwellingUnits('r1', 'r'), 6);
  assert.equal(C.resTableFor('r1', 'r'), null, 'the table stands aside for the per-dwelling rule');
  assert.equal(C.getBinCount('r1', 'r', 'GW', 500, 240, 1), 6, 'and every dwelling still gets its own bin');
  // A bulk collection point is not the council's kerbside service at all.
  r.method.r = 'bulk';
  assert.equal(C.resTableFor('r1', 'r'), null);
});

test('departing from the table’s size carries the council’s CAPACITY over, not the bare count', () => {
  const C = loadCalc({ rooms: [room()], councilValue: 'x', councilLabel: 'x' });
  const tb = { n: 4, sizeL: 660, cycle: 'W' };
  assert.equal(C.resTableCount(tb, 660), 4, 'at the table’s own size the table’s own count stands');
  // 4 × 660 = 2640L. At 240L that is 11 bins, not 4 — keeping the bare count
  // would quietly under-provide against the council's own figure.
  assert.equal(C.resTableCount(tb, 240), 11);
  assert.equal(C.resTableCount(tb, 1100), 3, 'and rounds up at a larger size rather than under-providing');
  assert.equal(C.resTableCount(null, 240), null);
});

test('a manual bin count still wins over the council’s table', () => {
  const r = room({ alloc: { apt_1br: 2, apt_2br: 0, apt_3br: 0, townhouse: 0 } });
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB); C.setResMethods(tableRow(BANDS));
  C.setBinOv('r1|r|GW', 7);
  assert.equal(C.getBinCount('r1', 'r', 'GW', 0, 140, 1), 7, 'the override is the last word, as it is on every other path');
});

test('a draft method never reaches a calculation, and the state row is reported as a fallback', () => {
  const P = loadPlatform();
  const r = room({ alloc: { apt_1br: 2, apt_2br: 0, apt_3br: 0, townhouse: 0 } });
  const rows = tableRow(BANDS);
  const C = loadCalc({ rooms: [r], councilValue: 'northern_beaches', councilLabel: 'Northern Beaches Council' });
  C.setLib(LIB);
  C.setResMethods([Object.assign({}, rows[0], { method: Object.assign({}, rows[0].method, { status: 'draft' }) })]);
  assert.equal(C.resTableFor('r1', 'r'), null, 'an unreviewed table is invisible to the calculator');
  assert.equal(C.activeResMethodEntry().scope, 'none');
  // A state row standing in for a council is a fallback and says so.
  C.setResMethods([{ state: 'NSW', value: null, name: null, key: null, valueKey: null,
                     method: { type: 'rate', status: 'live', source: null } }]);
  assert.equal(C.activeResMethodEntry().scope, 'state', 'the scope is what the screen and the WMP print as “state fallback used”');
});

// ── §3: the transcription parser ──
test('wpResTableLines: the table is COPIED and our code decides the shape', () => {
  const P = loadPlatform();
  const out = P.wpResTableLines(`dwellings_from | dwellings_to | stream | bin_count | bin_size_litres | frequency
1 | 2 | Garbage | 1 | 140 | weekly
1 | 2 | Recycling | 1 | 240 | fortnightly
3 | 10 | Garbage | 2 | 240 | weekly
3 | 10 | FOGO | 1 | 240 | weekly
11 |  | Garbage | 4 | 660 | weekly`);
  assert.equal(out.steps.length, 3, 'one band per dwelling range, however many stream lines it took');
  assert.deepStrictEqual(out.steps[0].bins.GW, { n: 1, sizeL: 140, cycle: 'W' });
  assert.equal(out.steps[0].bins.REC.cycle, 'F');
  assert.equal(out.steps[1].bins.ORG.sizeL, 240, 'FOGO resolves onto the organics stream');
  assert.equal(out.steps[2].max, null, 'an empty "to" is an open-ended band, not a zero');
  assert.equal(out.steps[0].bins.ORG, undefined, 'a stream a band does not list stays absent');
});

test('wpResTableLines: a line it cannot read is REPORTED BY NAME, never half-stored', () => {
  const P = loadPlatform();
  const out = P.wpResTableLines(`1 | 2 | Garbage | 1 | 140 | weekly
3 | 10 | Garbage | 2 |  | weekly
3 | 10 | Sharps | 1 | 120 | weekly
This table is indicative only and subject to change.`);
  assert.equal(out.steps.length, 1, 'only the complete line became a band');
  assert.equal(out.skipped.length, 2);
  assert.ok(out.skipped.some(x => /count or size missing/.test(x.why)), 'a missing size is named, never inferred');
  assert.ok(out.skipped.some(x => /stream not recognised/.test(x.why)), 'an unknown stream is named, never guessed onto the nearest one');
  assert.ok(out.skipped.every(x => x.line), 'each skipped line is quoted back so it can be typed in by hand');
  assert.equal(P.wpResTableLines('NO TABLE').steps.length, 0);
});

// ── §4: pins on the wiring ──
test('the two copies of the lookup agree — the calculator cannot call the platform’s', () => {
  const P = loadPlatform();
  const C = loadCalc({ rooms: [room()] });
  const t = P.wpResTableParse({ steps: BANDS });
  // The calculator is a sandboxed srcdoc, so resTableLookup is a second copy
  // of wpResTableLookup, exactly as councilKey is of glBridgeNorm. This test
  // is what keeps them from drifting.
  for (const n of [0, 1, 2, 3, 10, 11, 500]) {
    assert.deepStrictEqual(C.resTableLookup(t, n), P.wpResTableLookup(t, n), `lookup disagrees at ${n} dwellings`);
  }
  const closed = P.wpResTableParse({ steps: [BANDS[0]] });
  assert.deepStrictEqual(C.resTableLookup(closed, 40), P.wpResTableLookup(closed, 40));
});

test('the methods reach the calculator, and the calculator reports which one answered', () => {
  const push = extractBlock(/^function wsPushEquipToCalc\(/).text;
  assert.ok(/res_methods:\s*WP_RES_METHODS/.test(push), 'the methods ride the same push as the bin library and the schedules');
  const load = extractBlock(/^async function wpLoadCouncilSchedules\(/).text;
  assert.ok(/residential_method/.test(load) && /\.in\(/.test(load),
    'both council-database datasets load in one fetch, so the calculator cannot get a schedule and a method from different moments');
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/RES_METHODS = d\.res_methods/.test(src.replace(/&amp;/g, '&').replace(/&gt;/g, '>').replace(/&lt;/g, '<')),
    'the calculator takes them off the message');
  assert.ok(/residential: residential/.test(src), 'and the results payload carries which method answered');
  assert.ok(/State fallback used — no council-specific method found/.test(src),
    'the state fallback is worded the same in the payload as on screen');
});

test('extraction writes a DRAFT and only a human opens the gate', () => {
  const ex = extractBlock(/^async function rdbResExtract\(/).text;
  assert.ok(/m\.status = 'draft'/.test(ex), 'an extracted table is always a draft');
  assert.ok(!/status = 'live'/.test(ex), 'extraction can never mark itself live');
  assert.ok(/skipped/.test(ex), 'and what it could not read is reported rather than dropped');
  const gate = extractBlock(/^async function rdbResGoLive\(/).text;
  assert.ok(/confirm\(/.test(gate), 'going live is a deliberate act, with the document in front of you');
  assert.ok(/wpResTableParse/.test(gate), 'and an unusable table is refused rather than stored for the calculator to ignore');
});

test('the admin panel never reads the core’s const bindings across a script block', () => {
  // index.html is one file of many <script> blocks with no module system.
  // Function declarations cross them; top-level const/let are not to be
  // relied on to. The residential method core and the admin panel that
  // renders it live in DIFFERENT blocks, so every cross-block read goes
  // through wpResMethodSpec / wpResStreams / wpResMethodTypeIds. This test is
  // what stops a future edit reaching for the constant directly — which would
  // throw only in the browser, only when an admin opened that panel.
  const fs = require('fs'), pathMod = require('path');
  const src = fs.readFileSync(pathMod.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = [];
  const open = /<script[^>]*>/g;
  let m;
  while ((m = open.exec(src))) {
    const end = src.indexOf('</script>', m.index);
    if (end > 0) blocks.push({ from: open.lastIndex, to: end });
  }
  const owner = blocks.findIndex(b => src.slice(b.from, b.to).includes('\nconst WP_RES_METHOD_TYPES = '));
  assert.ok(owner >= 0, 'the core declares the registry');
  const hits = [];
  for (const mm of src.matchAll(/WP_RES_STREAMS|WP_RES_METHOD_TYPES/g)) {
    const b = blocks.findIndex(x => mm.index >= x.from && mm.index <= x.to);
    if (b !== owner) hits.push(src.slice(Math.max(0, mm.index - 50), mm.index + 30).replace(/\s+/g, ' '));
  }
  assert.deepStrictEqual(hits, [], 'read these through wpResMethodSpec() / wpResStreams() instead');
  // And the accessors really are function declarations, not consts holding
  // arrow functions — an arrow in a const would not cross the block either.
  ['wpResMethodTypeIds', 'wpResMethodSpec', 'wpResStreams'].forEach(fn =>
    assert.ok(new RegExp('\\nfunction ' + fn + '\\(').test(src), fn + ' must be a function declaration'));
});

test('the WMP says which method produced the numbers, with the calculator closed', () => {
  const note = new Function(extractBlock(/^function wmpgResMethodNote\(/).text + ';return wmpgResMethodNote;')();
  assert.equal(note(null), '', 'nothing to say about a project that predates this');
  assert.equal(note({ type: 'rate', scope: 'council' }), '', 'the ordinary case adds no noise');
  assert.match(note({ type: 'rate', scope: 'state' }), /state fallback used — no council-specific method found/,
    'the wording the brief asks for, verbatim, where the WMP shows its rates');
  assert.match(note({ type: 'table', scope: 'council', council: 'Northern Beaches Council', source: 'Appendix A' }),
    /Northern Beaches Council’s stepped table \(Appendix A\)/,
    'a stepped table is named as such — it is not a generation rate and must not read as one');
  assert.match(note({ type: 'table', scope: 'state' }), /state fallback/);
  // The provenance has to be STORED with the numbers: the WMP is written
  // later, with the calculator closed.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/p\.residential_method = e\.data\.residential/.test(src), 'the project keeps it beside the schedule it explains');
  assert.ok(/d\.residentialMethod = p\.residential_method/.test(src), 'and the WMP reads it back');
});
