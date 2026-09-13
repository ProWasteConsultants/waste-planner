'use strict';
// ── BIN CALCULATOR: LIBRARY-DRIVEN SIZES, COLLECTION METHOD, COUNCIL SCHEDULE ──
// §1 platform-side pure functions (method vocabulary, council schedule
// projection, the council-name normaliser the two sides must share) ·
// §2 the calculator's own selection logic, extracted from its srcdoc and run
// for real (library sizes, method ceilings, council schedule, defaults,
// fortnightly frequency) · §3 the Collection Point's cadence + bin resolution
// · §4 pins on the wiring between them. Nothing here is copied from
// index.html — every function is lifted by anchor.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock, extractSrcdocBlock, decodeSrcdoc, loadEngine } = require('./extract.js');

// ── §1: platform side ──
function loadPlatform() {
  const code = [
    /^const WP_COLLECT_METHOD_IDS = /, /^function wpParseMethods\(/,
    /^function wpCouncilScheduleFromRows\(/, /^function glBridgeNorm\(/,
  ].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + '\n;return { WP_COLLECT_METHOD_IDS, wpParseMethods, wpCouncilScheduleFromRows, glBridgeNorm };')();
}

test('wpParseMethods: comma lists and synonyms collapse onto the four ids; junk is dropped', () => {
  const { wpParseMethods, WP_COLLECT_METHOD_IDS } = loadPlatform();
  assert.deepStrictEqual(WP_COLLECT_METHOD_IDS, ['kerbside_individual', 'kerbside_shared', 'bulk', 'self_haul']);
  assert.deepStrictEqual(wpParseMethods('bulk, kerbside_individual'), ['bulk', 'kerbside_individual']);
  assert.deepStrictEqual(wpParseMethods('kerbside'), ['kerbside_individual', 'kerbside_shared'], 'a bare kerbside means both kerbside methods');
  assert.deepStrictEqual(wpParseMethods('Front-lift; communal'), ['bulk', 'kerbside_shared'], 'synonyms and separators');
  assert.deepStrictEqual(wpParseMethods(['self haul', 'bulk', 'bulk']), ['self_haul', 'bulk'], 'arrays pass through, deduped');
  assert.deepStrictEqual(wpParseMethods('helicopter'), [], 'unknown words never become a silent no-match tag');
  assert.deepStrictEqual(wpParseMethods(null), []);
});

test('wpCouncilScheduleFromRows: approved collection_limit rows become a kerbside schedule + bulk caps', () => {
  const { wpCouncilScheduleFromRows } = loadPlatform();
  const row = (o) => ({ status: 'approved', requirement_type: 'collection_limit', ...o });
  const s = wpCouncilScheduleFromRows([
    row({ stream: 'garbage', value_num: 140, unit: 'L', value_text: '140L garbage bin', clause_ref: 'cl 3.1, p.4' }),
    row({ stream: 'garbage', value_num: 1, unit: 'per week', value_text: 'collected weekly', clause_ref: 'cl 3.2, p.4' }),
    row({ stream: 'recycling', value_num: 240, unit: 'L', value_text: '240L recycling', clause_ref: 'cl 3.3' }),
    row({ stream: 'recycling', value_num: null, unit: 'per fortnight', value_text: 'fortnightly', clause_ref: 'cl 3.3' }),
    row({ stream: 'fogo', value_num: 240, unit: 'litres', value_text: 'maximum 240L', clause_ref: 'cl 3.4' }),
    row({ stream: null, value_num: 1100, unit: 'L', value_text: 'bulk bins no larger than 1100L', clause_ref: 'cl 5.1' }),
    row({ stream: null, value_num: 3, unit: 'per week', value_text: 'front-lift service at most three times a week', clause_ref: 'cl 5.2' }),
    row({ stream: 'glass', value_num: 120, unit: 'L', value_text: 'pending', clause_ref: 'x', status: 'proposed' }),
    row({ stream: null, value_num: 120, unit: 'L', value_text: '120L', clause_ref: 'y' }),
    row({ stream: 'paper', value_num: null, unit: null, value_text: 'as directed', clause_ref: 'z' }),
  ]);
  assert.deepStrictEqual(s.kerbside.garbage.sizesL, [140]);
  assert.equal(s.kerbside.garbage.perWeek, 1);
  assert.deepStrictEqual(s.kerbside.garbage.cites.map(c => c.clause), ['cl 3.1, p.4', 'cl 3.2, p.4'], 'every number carries its clause');
  assert.equal(s.kerbside.recycling.perWeek, 0.5, 'fortnightly is half a collection per week');
  assert.equal(s.kerbside.fogo.maxL, 240, 'a "maximum" wording caps instead of listing');
  assert.deepStrictEqual(s.kerbside.fogo.sizesL, []);
  assert.equal(s.bulk.maxL, 1100, 'bulk wording routes to the bulk cap');
  assert.equal(s.bulk.maxPerWeek, 3);
  assert.ok(!s.kerbside.glass, 'a proposed row is never consumed');
  assert.ok(!('null' in s.kerbside), 'a streamless kerbside row is dropped, not guessed');
  assert.ok(!s.kerbside.paper, 'a row with no usable number resolves to nothing');
  assert.equal(wpCouncilScheduleFromRows([]), null, 'no rows, no schedule — the calculator says so instead of assuming');
  assert.equal(wpCouncilScheduleFromRows([row({ stream: 'garbage', value_num: 3, unit: 'bins', value_text: '3 bins', clause_ref: 'q' })]), null);
});

test('the council-name normaliser is one function on both sides of the iframe boundary', () => {
  const { glBridgeNorm } = loadPlatform();
  const calcKey = new Function(extractSrcdocBlock('calc-iframe', /^function councilKey\(/).text + '\n;return councilKey;')();
  for (const name of ['Central Coast Council', 'City of Melbourne', 'Bega Valley Shire Council', 'Council of the City of Sydney', ''])
    assert.equal(calcKey(name), glBridgeNorm(name), name || '(empty)');
  // the regexes are literally identical — a drift here means "no schedule" for every council
  const a = /replace\((\/[^)]*\/g)/.exec(extractBlock(/^function glBridgeNorm\(/).text)[1];
  const b = /replace\((\/[^)]*\/g)/.exec(extractSrcdocBlock('calc-iframe', /^function councilKey\(/).text)[1];
  assert.equal(a, b);
});

// ── §2: the calculator's selection logic, run for real ──
function loadCalc({ rooms = [], councilLabel = '', councilValue = '' } = {}) {
  const blocks = [
    /^const ALLOWED_SIZES=/, /^const LIB_STREAM_KEY=/, /^let BIN_LIB=/,
    /^const COLLECT_METHODS=\{/, /^const DEFAULT_METHOD=/, /^function normMethod\(/,
    /^function defaultMethod\(/, /^function methodOf\(/,
    /^let COUNCIL_SCHEDULES=/, /^function councilKey\(/, /^function activeCouncilLabel\(/,
    /^function activeSchedule\(/, /^function scheduleFor\(/,
    /^const BIN_EQUIPMENT=/, /^function binFP\(/, /^function rebuildBinLib\(/,
    /^function binSizesRaw\(/, /^function binSizesFor\(/,
    /^let _szOv=\{\},_cwOv=\{\};/, /^function ovKey\(/, /^const DEFAULT_BINSIZES=/, /^const DEFAULT_COLWK=/,
    /^function defSize\(/, /^function defCw\(/, /^function normCw\(/, /^function cwLabel\(/,
    /^function roomById\(/,
  ];
  const code = blocks.map(p => extractSrcdocBlock('calc-iframe', p).text).join('\n\n');
  const g = id => id === 'council'
    ? { value: councilValue, selectedIndex: 0, options: [{ text: councilLabel }] }
    : { value: '' };
  const factory = new Function('ROOMS', 'g', code + `
    ;return { COLLECT_METHODS, normMethod, defaultMethod, methodOf, rebuildBinLib, binSizesRaw, binSizesFor, binFP,
              defSize, defCw, normCw, cwLabel, activeSchedule, scheduleFor, ALLOWED_SIZES,
              setLib: rows => rebuildBinLib(rows), setSchedules: s => { COUNCIL_SCHEDULES = s; },
              setSz: (k, v) => { _szOv[k] = v; }, setCw: (k, v) => { _cwOv[k] = v; }, lib: () => BIN_LIB };`);
  return factory(rooms, g);
}
const LIB = [
  { code: 'mgb120', label: '120L MGB', capacity_l: 120, streams: [], is_common: true, width_mm: 480, depth_mm: 555 },
  { code: 'mgb140', label: '140L MGB', capacity_l: 140, streams: [], is_common: false, width_mm: 500, depth_mm: 560 },
  { code: 'mgb240', label: '240L MGB', capacity_l: 240, streams: [], is_common: true, width_mm: 585, depth_mm: 735 },
  { code: 'mgb240b', label: '240L MGB (other supplier)', capacity_l: 240, streams: ['garbage'], is_common: false, footprint_m2: 0.5 },
  { code: 'b660', label: '660L', capacity_l: 660, streams: [], is_common: true, width_mm: 1370, depth_mm: 780 },
  { code: 'b1100', label: '1100L', capacity_l: 1100, streams: ['garbage', 'recycling'], is_common: true, width_mm: 1245, depth_mm: 1075 },
  { code: 'fl3000', label: '3m³ front-lift', capacity_l: 3000, streams: [], is_common: false, collection_methods: ['bulk'], width_mm: 1800, depth_mm: 1200 },
  { code: 'glass80', label: '80L glass crate', capacity_l: 80, streams: ['glass'], is_common: false, width_mm: 400, depth_mm: 300 },
];
const room = (id, alloc, method) => ({ id, kind: 'res', alloc: { apt_1br: 0, apt_2br: 0, apt_3br: 0, townhouse: 0, ...alloc }, method: method || null });

test('no library reached → the built-in sizes, all common, exactly as before', () => {
  const c = loadCalc({ rooms: [room('R1', { apt_1br: 4 })] });
  const raw = c.binSizesRaw('GW');
  assert.deepStrictEqual(raw.map(e => e.sizeL), c.ALLOWED_SIZES.GW);
  assert.ok(raw.every(e => e.common && e.source === 'builtin'));
  assert.equal(c.binFP(140), 0.329025, 'the built-in footprint table still answers');
});

test('library sizes: deduped per litre, common if any record says so, restricted only if every record is', () => {
  const c = loadCalc({ rooms: [room('R1', { apt_1br: 4 })] });
  c.setLib(LIB);
  const gw = c.binSizesRaw('GW');
  assert.deepStrictEqual(gw.map(e => e.sizeL), [120, 140, 240, 660, 1100, 3000]);
  assert.deepStrictEqual(gw.filter(e => e.common).map(e => e.sizeL), [120, 240, 660, 1100], 'the 140L is offered but not in the default list');
  assert.deepStrictEqual(gw.find(e => e.sizeL === 240).methods, [], 'two 240L records, one untagged → unrestricted');
  assert.deepStrictEqual(gw.find(e => e.sizeL === 3000).methods, ['bulk'], 'the front-lift bin carries its tag');
  assert.ok(!c.binSizesRaw('ORG').some(e => e.sizeL === 1100), 'a record restricted to garbage/recycling is not offered for organics');
  assert.ok(c.binSizesRaw('GLS').some(e => e.sizeL === 80) && !c.binSizesRaw('GW').some(e => e.sizeL === 80), 'stream-restricted records only serve their streams');
  assert.equal(c.binFP(140), 500 * 560 / 1e6, 'footprint from the record’s own dimensions beats the built-in table');
  assert.equal(c.binFP(240), 585 * 735 / 1e6, 'the first record with dimensions supplies the footprint');
});

test('collection method: kerbside tops out at 360L and offers no plant; bulk offers everything incl. tagged bins', () => {
  const c = loadCalc({ rooms: [room('R1', { townhouse: 6 }), room('R2', { apt_2br: 20 }), room('R3', { apt_2br: 8 }, { r: 'kerbside_shared', c: null })] });
  c.setLib(LIB);
  assert.equal(c.methodOf('R1', 'r'), 'kerbside_individual', 'a townhouse-only room wheels its own bins out');
  assert.equal(c.methodOf('R2', 'r'), 'bulk', 'apartments are serviced in the room');
  assert.equal(c.methodOf('R2', 'c'), 'bulk', 'commercial is always serviced in the room by default');
  assert.equal(c.methodOf('R3', 'r'), 'kerbside_shared', 'an explicit choice wins');
  const kerb = c.binSizesFor('R1', 'r', 'GW');
  assert.deepStrictEqual(kerb.list.map(e => e.sizeL), [120, 140, 240], 'nothing above 360L at the kerb — no 660, 1100 or front-lift');
  assert.equal(kerb.M.equipment, false, 'no compaction plant under a kerbside method');
  const bulk = c.binSizesFor('R2', 'r', 'GW');
  assert.deepStrictEqual(bulk.list.map(e => e.sizeL), [120, 140, 240, 660, 1100, 3000]);
  assert.equal(bulk.M.equipment, true);
  assert.ok(!c.binSizesFor('R1', 'r', 'GW').list.some(e => e.sizeL === 3000), 'a bulk-tagged record never appears under kerbside');
  assert.deepStrictEqual(c.normMethod({ r: 'kerbside_individual', c: 'nonsense' }), { r: 'kerbside_individual', c: null });
  assert.ok(c.COLLECT_METHODS.kerbside_individual.kerb && c.COLLECT_METHODS.kerbside_shared.kerb && !c.COLLECT_METHODS.bulk.kerb && !c.COLLECT_METHODS.self_haul.kerb,
    'only kerbside methods present bins at the frontage');
});

test('defaults snap onto what is offered, and say so through the pick they keep', () => {
  const c = loadCalc({ rooms: [room('R1', { townhouse: 6 }), room('R2', { apt_2br: 20 })] });
  c.setLib(LIB);
  assert.equal(c.defSize('R2', 'r', 'GW'), 1100, 'generic default (1100L) stands under bulk');
  assert.equal(c.defSize('R1', 'r', 'GW'), 240, 'under kerbside the 1100L default snaps to the largest kerbside size');
  c.setSz('R1|r|GW', 1100);
  assert.equal(c.defSize('R1', 'r', 'GW'), 240, 'an explicit 1100L pick is not honoured at the kerb…');
  c.setSz('R2|r|GW', 140);
  assert.equal(c.defSize('R2', 'r', 'GW'), 140, '…but a non-common library size is, wherever it is offered');
  assert.equal(c.defCw('R2', 'r', 'GW'), 2, 'generic frequency default');
  assert.equal(c.normCw('0.5'), 0.5, 'fortnightly');
  assert.equal(c.normCw('0.3'), 0.5, 'anything under weekly reads as fortnightly');
  assert.equal(c.normCw('2.7'), 3, 'whole collections otherwise');
  assert.equal(c.normCw('', 2), 2, 'blank keeps the fallback');
  assert.equal(c.cwLabel(0.5), 'fortnightly');
});

test('council schedule: kerbside sizes and cadence come from the guidelines library and default the row', () => {
  const c = loadCalc({ rooms: [room('R1', { townhouse: 6 }), room('R2', { apt_2br: 20 })], councilLabel: 'Central Coast Council', councilValue: 'central_coast' });
  c.setLib(LIB);
  c.setSchedules([{ key: 'centralcoast', name: 'Central Coast Council', schedule: {
    kerbside: { garbage: { sizesL: [140], maxL: null, perWeek: 1, cites: [{ clause: 'cl 3.1' }] },
                recycling: { sizesL: [240, 360], maxL: null, perWeek: 0.5, cites: [] },
                fogo: { sizesL: [], maxL: 120, perWeek: null, cites: [] } },
    bulk: { maxL: 660, maxPerWeek: 2, cites: [] }, count: 5 } }]);
  assert.ok(c.activeSchedule(), 'the selected council matches its schedule by normalised name');
  const gw = c.binSizesFor('R1', 'r', 'GW');
  assert.deepStrictEqual(gw.list.map(e => e.sizeL), [140], 'the council’s size IS the kerbside list');
  assert.deepStrictEqual(gw.councilSizes, [140]);
  assert.equal(c.defSize('R1', 'r', 'GW'), 140, 'and it is the default — no hunting through a general list');
  assert.equal(c.defCw('R1', 'r', 'GW'), 1);
  assert.equal(c.defSize('R1', 'r', 'REC'), 360, 'several council sizes → the largest defaults');
  assert.equal(c.defCw('R1', 'r', 'REC'), 0.5, 'fortnightly recycling arrives as 0.5/week');
  const org = c.binSizesFor('R1', 'r', 'ORG');
  assert.deepStrictEqual(org.list.map(e => e.sizeL), [120], 'a council maximum trims the library list without replacing it');
  assert.ok(gw.list[0].source === 'library', 'the 140L comes from the library record when one exists');
  // bulk methods are capped by the council's bulk limit, never by its kerbside sizes
  const bulk = c.binSizesFor('R2', 'r', 'GW');
  assert.deepStrictEqual(bulk.list.map(e => e.sizeL), [120, 140, 240, 660]);
  assert.equal(c.defSize('R2', 'r', 'GW'), 660, 'the 1100L default snaps under the council bulk cap');
  assert.equal(c.defCw('R2', 'r', 'GW'), 2, 'kerbside cadence never leaks into a bulk row');
  // a council size the library does not carry yet is still offered, labelled as the council's
  c.setSchedules([{ key: 'centralcoast', name: 'Central Coast Council', schedule: { kerbside: { garbage: { sizesL: [80], maxL: null, perWeek: 1, cites: [] } }, bulk: {}, count: 1 } }]);
  const g80 = c.binSizesFor('R1', 'r', 'GW');
  assert.deepStrictEqual(g80.list.map(e => [e.sizeL, e.source]), [[80, 'council']]);
  // no schedule for the council → the normal method-filtered list, and the UI says so
  const none = loadCalc({ rooms: [room('R1', { townhouse: 6 })], councilLabel: 'Nowhere Shire', councilValue: 'nowhere' });
  none.setLib(LIB);
  assert.equal(none.activeSchedule(), null);
  assert.deepStrictEqual(none.binSizesFor('R1', 'r', 'GW').list.map(e => e.sizeL), [120, 140, 240]);
  assert.ok(decodeSrcdoc('calc-iframe').html.includes('in the guidelines library — common sizes shown'), 'the fallback is flagged, not silent');
});

// ── §3: Collection Point ──
const ws = loadEngine({ blocks: [
  ['WS_BIN_TYPES', /^const WS_BIN_TYPES = \[/],
  ['WS_COLLECT_DEFAULTS', /^const WS_COLLECT_DEFAULTS = \{/],
  ['wsCollectSchedule', /^function wsCollectSchedule\(/],
  ['wsCollectCyclesFromTargets', /^function wsCollectCyclesFromTargets\(/],
  ['wsCollectBins', /^function wsCollectBins\(/],
] });

test('the calculator’s cadence feeds the scenarios: W stays weekly, F takes the default A/B week, panel edits still win', () => {
  const cyc = ws.wsCollectCyclesFromTargets([
    { stream: 'garbage', cycle: 'W' }, { stream: 'recycling', cycle: 'F' }, { stream: 'fogo', cycle: 'F' },
    { stream: 'fogo', cycle: 'W' }, { stream: 'glass', cycle: null }, { stream: 'paper' },
  ]);
  assert.deepStrictEqual(cyc, { garbage: 'W', recycling: 'F', fogo: 'W' }, 'any weekly target makes the stream weekly; no cycle = absent');
  const s = ws.wsCollectSchedule(['garbage', 'recycling', 'fogo', 'glass'], null, cyc);
  assert.deepStrictEqual(s, { garbage: 'W', recycling: 'A', fogo: 'W', glass: 'A' }, 'F → default week; unknown → default pattern');
  assert.deepStrictEqual(ws.wsCollectSchedule(['fogo'], { fogo: 'B' }, { fogo: 'W' }), { fogo: 'B' }, 'a panel edit outranks the calculator');
  assert.deepStrictEqual(ws.wsCollectSchedule(['soft'], null, { soft: 'F' }), { soft: 'B' }, 'a stream whose default week is B keeps B');
  assert.deepStrictEqual(ws.wsCollectSchedule(['garbage'], null, { garbage: 'OFF' }), { garbage: 'OFF' });
  assert.deepStrictEqual(ws.wsCollectSchedule(['garbage', 'recycling'], null), { garbage: 'W', recycling: 'A' }, 'two-argument callers are unchanged');
});

test('kerb bins resolve library ids, and an unknown type falls back to the nearest built-in by capacity', () => {
  const libTypes = [{ id: 'eq_mgb140', label: '140L MGB', w: 0.5, d: 0.56, capacityL: 140 }].concat(ws.WS_BIN_TYPES);
  const t = [{ stream: 'garbage', typeId: 'eq_mgb140', sizeL: 140, qty: 2 }, { stream: 'recycling', typeId: 'b240', sizeL: 240, qty: 1 }];
  const bins = ws.wsCollectBins(t, ['garbage', 'recycling'], libTypes);
  assert.equal(bins.length, 3, 'library-typed bins are no longer dropped');
  assert.equal(bins[0].wM, 0.5);
  assert.equal(bins[2].label, '240L MGB', 'built-ins still resolve through the same list');
  const legacy = ws.wsCollectBins([{ stream: 'garbage', typeId: 'eq_gone', sizeL: 660, qty: 1 }], ['garbage']);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].label, '660L Bin', 'nearest built-in by capacity when the id resolves nowhere');
  assert.equal(ws.wsCollectBins([{ stream: 'garbage', typeId: 'eq_gone', qty: 1 }], ['garbage']).length, 0, 'no id, no size → nothing invented');
});

test('only kerbside-method bins present at the kerb; pre-method payloads keep presenting everything', () => {
  const fn = extractBlock(/^function wsCollectTargets\(\)/).text;
  assert.ok(fn.includes("WS_CALC_TARGETS.some(t => t.method)"), 'typed payload detection');
  assert.ok(fn.includes("/^kerbside/.test(String(t.method || ''))"), 'bulk collection point and self-haul never line the frontage');
  assert.ok(fn.includes('bulkOnly: typed && !kerb.length'), 'an all-bulk site is reported, not shown as "no bins"');
  assert.ok(SOURCE.includes('Nothing presents at the kerb — every stream is collected from a bulk collection point'), 'the verdict names the reason');
  assert.ok(SOURCE.includes('Standard alternating pattern assumed'), 'the default cadence stays flagged');
  assert.ok(SOURCE.includes('’s schedule (guidelines library, via the calculator)'), 'a council cadence names its source');
  assert.ok(SOURCE.includes('const types = (typeof wsLayoutBinList === \'function\') ? wsLayoutBinList().concat(WS_BIN_TYPES) : WS_BIN_TYPES;'),
    'the assembler resolves against the live bin list');
});

// ── §4: wiring pins ──
test('the equipment library reaches the calculator as `bins`, with the two selection flags', () => {
  assert.ok(SOURCE.includes("isCommon: r.is_common === true"), 'parent reads is_common');
  assert.ok(SOURCE.includes("collectionMethods: Array.isArray(r.collection_methods)"), 'parent reads collection_methods');
  const push = extractBlock(/^function wsPushEquipToCalc\(\)/).text;
  assert.ok(push.includes("x.kind === 'bin' && x.active !== false && x.capacityL > 0"), 'every active bin with a capacity is pushed, common or not');
  assert.ok(push.includes('council_schedules: WP_COUNCIL_SCHEDULES || []'), 'council schedules ride the same push');
  const calc = decodeSrcdoc('calc-iframe').html;
  assert.ok(calc.includes('if (Array.isArray(d.bins)) rebuildBinLib(d.bins);'), 'calculator rebuilds its bin library from the push');
  assert.ok(calc.includes("if (Array.isArray(d.council_schedules)) COUNCIL_SCHEDULES ="), 'and its council schedules');
  assert.ok(calc.includes('optgroup label="More sizes"'), 'non-common sizes stay selectable under their own group');
  assert.ok(calc.includes('class="wsr-methodsel"'), 'the collection method is a visible select per room section');
  assert.ok(calc.includes("method: methodOf(rr.id, sec), cycle: cw < 1 ? 'F' : 'W'"), 'the schedule payload carries method + cycle');
  assert.ok(calc.includes("source: sch ? 'council' : 'manual'"), 'the presentation block names its source');
  assert.ok(calc.includes('min="0.5" step="0.5"'), 'fortnightly collection is enterable');
  assert.ok(!/sizeOpts\(|ALLOWED_SIZES\[s\]\.map/.test(calc.replace(/function sizeOpts[^\n]*\n/, '')), 'no dropdown reads the constant directly any more');
  assert.ok(calc.includes('differs from the council schedule'), 'departing from the council schedule is stated, never silent');
  assert.ok(calc.includes('is not offered for ${bs.M.label}'), 'a snapped pick is stated');
  // admin table + migration + extraction hint
  assert.ok(SOURCE.includes("['is_common','Common size',52,'bool'], ['collection_methods','Collection methods',150,'text']"));
  assert.ok(SOURCE.includes('collection_methods: wpParseMethods(it.collection_methods)'), 'the admin save parses the comma list');
  assert.ok(SOURCE.includes('collection_limit rows describe the council\'s collection SERVICE'), 'the extraction prompt teaches the row convention');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-13-bin-library-calculator.sql'), 'utf8');
  assert.ok(sql.includes('add column if not exists is_common boolean'));
  assert.ok(sql.includes('add column if not exists collection_methods text[]'));
  assert.ok(sql.includes('capacity_l in (120, 240, 360, 660, 1100)'), 'day one looks like yesterday');
  assert.ok(sql.includes("notify pgrst, 'reload schema'") && sql.includes('ROLLBACK'));
  const claude = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  assert.ok(claude.includes('library-driven') && claude.includes('collection method'), 'CLAUDE.md records the new convention');
});
