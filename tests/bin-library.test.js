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
    /^const WP_COLLECT_METHOD_IDS = /, /^function wpParseMethods\(/, /^function wpUseClassScope\(/,
    /^const WP_KERB_STREAMS = /, /^const WP_KERB_CYCLES = /, /^function wpKerbScheduleParse\(/, /^function glBridgeNorm\(/,
  ].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + '\n;return { WP_COLLECT_METHOD_IDS, wpParseMethods, wpUseClassScope, wpKerbScheduleParse, glBridgeNorm };')();
}

test('wpUseClassScope: non-residential is commercial, and the checker shares the classifier', () => {
  const { wpUseClassScope } = loadPlatform();
  assert.equal(wpUseClassScope('Non-Residential Developments'), 'commercial', '"non-residential" must never read as residential');
  assert.equal(wpUseClassScope('residential'), 'residential');
  assert.equal(wpUseClassScope('MUD'), 'mixed', 'the checker’s existing reading of MUD is kept');
  assert.equal(wpUseClassScope('retail / office'), 'commercial');
  assert.equal(wpUseClassScope('mixed use'), 'mixed');
  assert.equal(wpUseClassScope(null), 'all');
  assert.ok(extractBlock(/^function crqToLegacy\(/).text.includes('const applies = wpUseClassScope;'), 'crqToLegacy uses the same classifier');
});

test('wpParseMethods: comma lists and synonyms collapse onto the four ids; junk is dropped', () => {
  const { wpParseMethods, WP_COLLECT_METHOD_IDS } = loadPlatform();
  assert.deepStrictEqual(WP_COLLECT_METHOD_IDS, ['kerbside_individual', 'kerbside_shared', 'bulk', 'self_haul']);
  assert.deepStrictEqual(wpParseMethods('bulk, kerbside_individual'), ['bulk', 'kerbside_individual']);
  assert.deepStrictEqual(wpParseMethods('kerbside'), ['kerbside_individual', 'kerbside_shared'], 'a bare kerbside means both kerbside methods');
  assert.deepStrictEqual(wpParseMethods('Front-lift; communal'), ['bulk', 'kerbside_shared'], 'synonyms and separators');
  assert.deepStrictEqual(wpParseMethods(['self haul', 'bulk', 'bulk']), ['self_haul', 'bulk'], 'arrays pass through, deduped');
  assert.deepStrictEqual(wpParseMethods('Private shared bin collection, private shared'), ['self_haul'], 'the method’s current name resolves to its original id');
  assert.deepStrictEqual(wpParseMethods('helicopter'), [], 'unknown words never become a silent no-match tag');
  assert.deepStrictEqual(wpParseMethods(null), []);
});

test('wpKerbScheduleParse: the council database row becomes a normalised kerbside service; junk never does', () => {
  const { wpKerbScheduleParse } = loadPlatform();
  // Camden, as briefed: 140L garbage weekly (240L offered), 240L recycling and FOGO alternating fortnights
  const s = wpKerbScheduleParse(JSON.stringify({
    GW: { sizeL: '140', altL: '240', cycle: 'W' },
    REC: { sizeL: 240, altL: [], cycle: 'A' },
    ORG: { sizeL: 240, altL: '', cycle: 'B' },
    GLS: { sizeL: '', altL: '', cycle: '' },
    bulk: { maxL: '1100', maxPerWeek: '3' },
  }));
  assert.deepStrictEqual(s.GW, { sizeL: 140, altL: [240], cycle: 'W' });
  assert.deepStrictEqual(s.REC, { sizeL: 240, altL: [], cycle: 'A' });
  assert.deepStrictEqual(s.ORG, { sizeL: 240, altL: [], cycle: 'B' });
  assert.ok(!s.GLS, 'a blank stream is absent — no kerbside service, not a zero');
  assert.deepStrictEqual(s.bulk, { maxL: 1100, maxPerWeek: 3 });
  // alternatives dedupe, drop the default and sort; a size with no cycle reads weekly
  assert.deepStrictEqual(wpKerbScheduleParse({ GW: { sizeL: 140, altL: '240, 140; 80 240' } }).GW, { sizeL: 140, altL: [80, 240], cycle: 'W' });
  // a cycle can stand alone (size left to the library); an unknown cycle is dropped
  assert.deepStrictEqual(wpKerbScheduleParse({ REC: { cycle: 'M' } }).REC, { sizeL: null, altL: [], cycle: 'M' });
  assert.equal(wpKerbScheduleParse({ REC: { cycle: 'weekly' } }), null);
  // nothing usable → null, so the UI never claims a schedule it lacks
  assert.equal(wpKerbScheduleParse(''), null);
  assert.equal(wpKerbScheduleParse('not json'), null);
  assert.equal(wpKerbScheduleParse('{"GW":{"sizeL":"","altL":"","cycle":""},"bulk":{}}'), null);
  assert.equal(wpKerbScheduleParse([1, 2]), null);
  // the admin grid round-trips through the same parser
  assert.ok(extractBlock(/^function rdbKerbGridCollect\(\)/).text.includes('wpKerbScheduleParse(o)'), 'the grid saves what the parser accepts');
  assert.ok(SOURCE.includes("field_key: 'kerbside_schedule', value: rdbKerbGridCollect()"), 'stored as one waste_meta row');
  // sizes are picked from the library, never typed — the calculator can always size and draw a recorded bin
  const grid = extractBlock(/^function rdbKerbGridHtml\(inp\)/).text;
  assert.ok(grid.includes('<select data-kerb="${s}.sizeL"') && grid.includes('<select data-kerb="${s}.altL" multiple'), 'default and alternatives are library-size selects');
  assert.ok(grid.includes("' (not in library)'"), 'a stored size the library no longer carries stays visible, marked');
  assert.ok(extractBlock(/^function rdbKerbGridCollect\(\)/).text.includes('Array.from(el.selectedOptions)'), 'multi-select alternatives collect as an array');
  assert.ok(!SOURCE.includes("['bin_sizes','Bin sizes']") && !SOURCE.includes("['coll_freq_townhouse'"), 'the retired free-text fields are gone from the grid');
  assert.ok(!SOURCE.includes('wpCouncilScheduleFromRows'), 'the clause-inference path is gone — a service is typed in, never guessed from clauses');
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
function loadCalc({ rooms = [], councilLabel = '', councilValue = '', state = 'NSW' } = {}) {
  const blocks = [
    /^const ALLOWED_SIZES=/, /^const LIB_STREAM_KEY=/, /^let BIN_LIB=/,
    /^const COLLECT_METHODS=\{/, /^const DEFAULT_METHOD=/, /^function normMethod\(/,
    /^function defaultMethod\(/, /^function methodOf\(/, /^const DWELL=/, /^function roomDwellings\(/, /^function perDwellingUnits\(/,
    /^let COUNCIL_SCHEDULES=/, /^function councilKey\(/, /^function activeCouncilLabel\(/,
    /^function activeScheduleEntry\(/, /^function activeSchedule\(/, /^function scheduleFor\(/, /^function cycleCw\(/,
    /^const BIN_EQUIPMENT=/, /^function binFP\(/, /^function rebuildBinLib\(/,
    /^function binSizesRaw\(/, /^function binSizesFor\(/,
    /^let _szOv=\{\},_cwOv=\{\};/, /^function ovKey\(/, /^const DEFAULT_BINSIZES=/, /^const DEFAULT_COLWK=/,
    /^function defSize\(/, /^function defCw\(/, /^function normCw\(/, /^function cwLabel\(/, /^function cycleFor\(/,
    /^function roomById\(/,
  ];
  const code = blocks.map(p => extractSrcdocBlock('calc-iframe', p).text).join('\n\n');
  const g = id => id === 'council'
    ? { value: councilValue, selectedIndex: 0, options: [{ text: councilLabel }] }
    : id === 'state' ? { value: state } : { value: '' };
  rooms.forEach(r => { if (!r.com) r.com = []; });
  const factory = new Function('ROOMS', 'g', code + `
    ;return { COLLECT_METHODS, normMethod, defaultMethod, methodOf, perDwellingUnits, rebuildBinLib, binSizesRaw, binSizesFor, binFP,
              defSize, defCw, normCw, cwLabel, cycleFor, activeSchedule, scheduleFor, ALLOWED_SIZES,
              setLib: rows => rebuildBinLib(rows), setSchedules: s => { COUNCIL_SCHEDULES = s; },
              setSz: (k, v) => { _szOv[k] = v; }, setCw: (k, v) => { _cwOv[k] = v; }, lib: () => BIN_LIB, rooms: ROOMS };`);
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
  assert.deepStrictEqual(bulk.list.map(e => e.sizeL), [120, 140, 240, 660, 1100, 3000], 'bulk offers every library bin THAT SERVES THE STREAM');
  assert.ok(!bulk.list.some(e => e.sizeL === 80), 'the glass-only crate is never a garbage option, under any method');
  assert.equal(bulk.M.equipment, true);
  assert.ok(!c.binSizesFor('R1', 'r', 'GW').list.some(e => e.sizeL === 3000), 'a bulk-tagged record never appears under kerbside');
  assert.deepStrictEqual(c.normMethod({ r: 'kerbside_individual', c: 'nonsense' }), { r: 'kerbside_individual', c: null });
  assert.ok(c.COLLECT_METHODS.kerbside_individual.kerb && c.COLLECT_METHODS.kerbside_shared.kerb && !c.COLLECT_METHODS.bulk.kerb && !c.COLLECT_METHODS.self_haul.kerb,
    'only kerbside methods present bins at the frontage');
  assert.equal(c.COLLECT_METHODS.self_haul.label, 'Private shared bin collection', 'the id is persisted in bin_rooms — the NAME changed, the id must not');
  assert.equal(c.COLLECT_METHODS.bulk.label, 'Bulk bin collection point (front / rear-lift)');
});

test('kerbside individual is one bin per dwelling; shared kerbside and bulk size from volume', () => {
  const c = loadCalc({ rooms: [
    room('R1', { townhouse: 6 }),                                   // defaults to kerbside individual
    room('R2', { apt_2br: 20 }, { r: 'kerbside_shared', c: null }),
    room('R3', { apt_1br: 3, apt_3br: 2 }, { r: 'kerbside_individual', c: 'kerbside_individual' }),
  ] });
  c.rooms[2].com = [{ use: 'cafe', value: 120 }, { use: 'office', value: 0 }, { use: 'shop', value: 40 }];
  assert.equal(c.perDwellingUnits('R1', 'r'), 6, 'six townhouses → six bins per stream');
  assert.equal(c.perDwellingUnits('R2', 'r'), null, 'shared kerbside sizes from volume as normal');
  assert.equal(c.perDwellingUnits('R3', 'r'), 5, 'every dwelling type counts');
  assert.equal(c.perDwellingUnits('R3', 'c'), 2, 'commercial: one set per tenancy with a size');
  assert.equal(c.perDwellingUnits('nope', 'r'), null);
  // provision() and getBinCount() both take the rule, so the table, the payload and the layout agree
  const prov = extractSrcdocBlock('calc-iframe', /^function provision\(/).text;
  assert.ok(prov.includes('const pd=perDwellingUnits(rr.id,sec);') && prov.includes('pd!=null?(vol>0?pd:0)'), 'provision counts dwellings under kerbside individual');
  assert.ok(extractSrcdocBlock('calc-iframe', /^function getBinCount\(/).text.includes('perDwellingUnits(room,sec)'), 'the results builder agrees');
  assert.ok(decodeSrcdoc('calc-iframe').html.includes('not enough — pick a larger bin or more frequent collection'), 'a per-dwelling bin that cannot hold its share is flagged');
});

test('the council service reaches the calculator without a publish, and ↻ refreshes it', () => {
  assert.ok(SOURCE.includes("if (typeof wpRefreshCouncilSchedules === 'function') wpRefreshCouncilSchedules();"), 'saving the grid pushes straight to the calculator');
  assert.ok(SOURCE.includes("e.data.type === 'ws-calc-refresh'"), 'the calculator can ask the platform to re-read library + schedules');
  assert.ok(decodeSrcdoc('calc-iframe').html.includes("postMessage({type:'ws-calc-refresh'},'*')"), '↻ asks');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-14-kerbside-service-read.sql'), 'utf8');
  assert.ok(sql.includes("using (field_key = 'kerbside_schedule')"), 'every signed-in user reads the service row — and only that row');
  assert.ok(sql.includes('grant select on public.waste_meta to anon, authenticated'), 'GRANT with the policy, per the Supabase convention');
  const load = extractBlock(/^async function wpLoadCouncilSchedules\(\)/).text;
  assert.ok(load.includes("valueKey: r.council_value ? glBridgeNorm(String(r.council_value).replace(/_/g, ' ')) : null"), 'the registry value also matches read as a name');
  assert.ok(decodeSrcdoc('calc-iframe').html.includes("loaded, ↻ to refresh"), 'a miss says how many services are loaded, so a stale or empty load is visible');
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
  assert.equal(c.normCw('0.3'), 0.25, 'under fortnightly reads as monthly');
  assert.equal(c.normCw('0.7'), 0.5, 'between reads as fortnightly');
  assert.equal(c.normCw('2.7'), 3, 'whole collections otherwise');
  assert.equal(c.normCw('', 2), 2, 'blank keeps the fallback');
  assert.equal(c.cwLabel(0.5), 'fortnightly');
  assert.equal(c.cwLabel(0.25), 'monthly');
});

test('council kerbside service: the council database defaults size and cadence; alternatives and every legal size stay reachable', () => {
  const CAMDEN = { GW: { sizeL: 140, altL: [240], cycle: 'W' }, REC: { sizeL: 240, altL: [], cycle: 'A' }, ORG: { sizeL: 240, altL: [], cycle: 'B' },
                   bulk: { maxL: 660, maxPerWeek: 2 } };
  const c = loadCalc({ rooms: [room('R1', { townhouse: 6 }), room('R2', { apt_2br: 20 })], councilLabel: 'Camden Council', councilValue: 'camden', state: 'NSW' });
  c.setLib(LIB);
  c.setSchedules([{ state: 'NSW', value: 'camden', name: 'Camden Council', key: 'camden', schedule: CAMDEN }]);
  assert.ok(c.activeSchedule(), 'the selected council matches by registry value');
  const gw = c.binSizesFor('R1', 'r', 'GW');
  assert.deepStrictEqual(gw.councilSizes, [140, 240], 'the council default and its alternative');
  assert.deepStrictEqual(gw.list.map(e => [e.sizeL, e.common]), [[140, true], [240, true]], 'the council service IS the kerbside list — default plus what the council also offers, nothing else');
  assert.equal(c.defSize('R1', 'r', 'GW'), 140, 'the council DEFAULT is the default, not the largest');
  assert.equal(c.defCw('R1', 'r', 'GW'), 1);
  assert.equal(c.defSize('R1', 'r', 'REC'), 240);
  assert.equal(c.defCw('R1', 'r', 'REC'), 0.5, 'fortnightly recycling arrives as 0.5/week');
  assert.equal(c.cycleFor('R1', 'r', 'REC', 0.5), 'A', 'and carries the council’s own week letter downstream');
  assert.equal(c.cycleFor('R1', 'r', 'ORG', 0.5), 'B');
  assert.equal(c.cycleFor('R1', 'r', 'GW', 1), 'W');
  assert.equal(c.cycleFor('R1', 'r', 'REC', 1), 'W', 'a row switched to weekly is weekly, whatever the council does');
  assert.equal(c.cycleFor('R2', 'r', 'REC', 0.5), 'F', 'a bulk row at 0.5 is an unassigned fortnight — the Collection Point assigns the week');
  assert.equal(c.cycleFor('R2', 'r', 'REC', 0.25), 'M');
  assert.ok(!c.scheduleFor('r', 'GLS'), 'a stream the council does not collect has no service entry');
  // bulk methods: any size within the council's bulk cap, any frequency — the kerbside service never applies
  const bulk = c.binSizesFor('R2', 'r', 'GW');
  assert.deepStrictEqual(bulk.list.map(e => e.sizeL), [120, 140, 240, 660], 'every stream-serving library bin within the council bulk cap');
  assert.equal(c.defSize('R2', 'r', 'GW'), 660, 'the 1100L default snaps under the council bulk cap');
  assert.equal(c.defCw('R2', 'r', 'GW'), 2, 'kerbside cadence never leaks into a bulk row');
  // a council size the library does not carry yet is still offered, labelled as the council's
  c.setSchedules([{ state: 'NSW', value: 'camden', name: 'Camden Council', key: 'camden', schedule: { GW: { sizeL: 90, altL: [], cycle: 'W' }, bulk: {} } }]);
  assert.deepStrictEqual(c.binSizesFor('R1', 'r', 'GW').list[0], { sizeL: 90, common: true, methods: [], source: 'council' });
  // a state-level row (no council value) is the default for councils without their own
  c.setSchedules([{ state: 'NSW', value: null, name: null, key: null, schedule: { GW: { sizeL: 120, altL: [], cycle: 'W' }, bulk: {} } }]);
  assert.equal(c.defSize('R1', 'r', 'GW'), 120, 'state default applies');
  // no schedule for the council → the method-filtered library list, and the UI says where to add one
  const none = loadCalc({ rooms: [room('R1', { townhouse: 6 })], councilLabel: 'Nowhere Shire', councilValue: 'nowhere' });
  none.setLib(LIB);
  assert.equal(none.activeSchedule(), null);
  assert.deepStrictEqual(none.binSizesFor('R1', 'r', 'GW').list.map(e => e.sizeL), [120, 140, 240]);
  assert.ok(decodeSrcdoc('calc-iframe').html.includes('no kerbside service recorded for'), 'the fallback is flagged, and names where to record one');
});

// ── §3: Collection Point ──
const ws = loadEngine({ blocks: [
  ['WS_BIN_TYPES', /^const WS_BIN_TYPES = \[/],
  ['WS_STREAMS', /^const WS_STREAMS = \[/],
  ['wsPolyArea', /^function wsPolyArea\(/],
  ['wsPolyBBox', /^function wsPolyBBox\(/],
  ['wsPointInPoly', /^function wsPointInPoly\(/],
  ['wsPackBins', /^function wsPackBins\(/],
  ['WS_COLLECT_DEFAULTS', /^const WS_COLLECT_DEFAULTS = \{/],
  ['wsCollectSchedule', /^function wsCollectSchedule\(/],
  ['wsCollectScenarios', /^function wsCollectScenarios\(/],
  ['wsCollectCyclesFromTargets', /^function wsCollectCyclesFromTargets\(/],
  ['wsCollectBins', /^function wsCollectBins\(/],
  ['wsCollectBinSummary', /^function wsCollectBinSummary\(/],
  ['wsKerbCleanPts', /^function wsKerbCleanPts\(/],
  ['wsKerbLen', /^function wsKerbLen\(/], ['wsKerbAt', /^function wsKerbAt\(/],
  ['wsCollectKerbBinPoses', /^function wsCollectKerbBinPoses\(/],
  ['wsCollectAreaBinPoses', /^function wsCollectAreaBinPoses\(/],
  ['wsIsPresentationBin', /^function wsIsPresentationBin\(/],
  ['wsTagBinsToRooms', /^function wsTagBinsToRooms\(/], ['wsBinRoomId', /^function wsBinRoomId\(/], ['wsRoomAtPt', /^function wsRoomAtPt\(/], ['wsRoomPts', /^function wsRoomPts\(/],
  ['wsCollectBulk', /^function wsCollectBulk\(/],
] });

test('the calculator’s cadence feeds the scenarios: the council’s week letters pass through, F takes the default week, panel edits win', () => {
  const cyc = ws.wsCollectCyclesFromTargets([
    { stream: 'garbage', cycle: 'W' }, { stream: 'recycling', cycle: 'A' }, { stream: 'fogo', cycle: 'B' },
    { stream: 'fogo', cycle: 'W' }, { stream: 'glass', cycle: 'M' }, { stream: 'paper', cycle: 'F' }, { stream: 'soft', cycle: null }, { stream: 'x' },
  ]);
  assert.deepStrictEqual(cyc, { garbage: 'W', recycling: 'A', fogo: 'W', glass: 'M', paper: 'F' }, 'weekly anywhere wins; council letters pass through; no cycle = absent');
  const s = ws.wsCollectSchedule(['garbage', 'recycling', 'fogo', 'glass', 'paper', 'soft'], null, cyc);
  assert.deepStrictEqual(s, { garbage: 'W', recycling: 'A', fogo: 'W', glass: 'M', paper: 'A', soft: 'B' }, 'F → default week; monthly kept; unknown → default pattern');
  assert.deepStrictEqual(ws.wsCollectSchedule(['fogo'], { fogo: 'B' }, { fogo: 'W' }), { fogo: 'B' }, 'a panel edit outranks the calculator');
  assert.deepStrictEqual(ws.wsCollectSchedule(['soft'], null, { soft: 'F' }), { soft: 'B' }, 'a stream whose default week is B keeps B');
  assert.deepStrictEqual(ws.wsCollectSchedule(['garbage'], null, { garbage: 'OFF' }), { garbage: 'OFF' });
  assert.deepStrictEqual(ws.wsCollectSchedule(['garbage', 'recycling'], null), { garbage: 'W', recycling: 'A' }, 'two-argument callers are unchanged');
  // Camden: garbage weekly, recycling week A, FOGO week B, glass monthly → two weeks, glass in both
  const sc = ws.wsCollectScenarios({ garbage: 'W', recycling: 'A', fogo: 'B', glass: 'M', paper: 'OFF' });
  assert.equal(sc.length, 2);
  assert.deepStrictEqual(sc[0].streams, ['garbage', 'glass', 'recycling'], 'weekly + monthly + week A');
  assert.deepStrictEqual(sc[1].streams, ['garbage', 'glass', 'fogo'], 'weekly + monthly + week B — the busiest of the two is the design case');
  assert.ok(!sc.some(x => x.streams.includes('paper')), 'OFF never presents');
});

test('bulk collection point: every bulk-method bin packs into the drawn area, all streams at once', () => {
  const mpp = 0.02;   // 2 cm per px → a 6 m × 4 m area is 300 × 200 px
  const area = { id: 'z1', label: 'Collection point area', pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] };
  const targets = [
    { stream: 'garbage', typeId: 'b1100', sizeL: 1100, qty: 3, method: 'bulk', cycle: 'W' },
    { stream: 'recycling', typeId: 'b1100', sizeL: 1100, qty: 2, method: 'bulk', cycle: 'A' },
    { stream: 'fogo', typeId: 'b240', sizeL: 240, qty: 2, method: 'bulk', cycle: 'B' },
  ];
  const b = ws.wsCollectBulk(targets, [area], mpp, 0.15, ws.WS_BIN_TYPES);
  assert.equal(b.bins.length, 7, 'no scenarios — A and B streams stand there together');
  assert.equal(b.left, 0);
  assert.ok(b.ok);
  assert.equal(b.areas[0].placed.length, 7);
  assert.equal(+b.areas[0].m2.toFixed(1), 24.0);
  // too small: the shortfall is counted, never silently dropped
  const tiny = { ...area, pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }] };
  const t = ws.wsCollectBulk(targets, [tiny], mpp, 0.15, ws.WS_BIN_TYPES);
  assert.ok(t.left > 0 && !t.ok);
  assert.equal(t.left + t.areas[0].placed.length, 7);
  // two areas: the second takes what the first could not
  const both = ws.wsCollectBulk(targets, [tiny, area], mpp, 0.15, ws.WS_BIN_TYPES);
  assert.equal(both.left, 0);
  assert.equal(both.areas[0].placed.length + both.areas[1].placed.length, 7);
  // nothing on a bulk method → empty, and no area is still not "fits"
  assert.ok(ws.wsCollectBulk([], [area], mpp, 0.15).empty);
  assert.ok(!ws.wsCollectBulk(targets, [], mpp, 0.15, ws.WS_BIN_TYPES).ok);
  // wiring: the COLLECT zone is drawn through the zone polygon tool, and the DXF carries the packed bins
  assert.ok(SOURCE.includes("COLLECT:   { id: 'COLLECT',   label: 'Collection point area'"), 'a real zone type — edits, tags and exports like every other zone');
  assert.ok(extractBlock(/^function wsCollectAreaMode\(\)/).text.includes("WS_LAYOUT._zoneType = 'COLLECT'"));
  assert.ok(SOURCE.includes("b.collectArea ? 'A-COLLECT-BINS'"), 'DXF layer for the collection point bins (real placed bins)');
  assert.ok(!SOURCE.includes("rect('A-COLLECT-BINS'"), 'no ghost rectangles in the export');
  assert.ok(SOURCE.includes("'COLLECTION POINT - ALL STREAMS - '"), 'the DXF header says every stream is shown at once');
});

test('kerb bins resolve library ids, and an unknown type falls back to the nearest built-in by capacity', () => {
  const libTypes = [{ id: 'eq_mgb140', label: '140L MGB', w: 0.5, d: 0.56, capacityL: 140 }].concat(ws.WS_BIN_TYPES);
  const t = [{ stream: 'garbage', typeId: 'eq_mgb140', sizeL: 140, qty: 2 }, { stream: 'recycling', typeId: 'b240', sizeL: 240, qty: 1 }];
  const bins = ws.wsCollectBins(t, ['garbage', 'recycling'], libTypes);
  assert.equal(bins.length, 3, 'library-typed bins are no longer dropped');
  assert.equal(bins[0].wM, 0.5);
  assert.equal(bins[2].label, '240L', 'the label is the size the calculator scheduled');
  assert.equal(bins[2].fpFrom, '240L MGB', '…and the footprint record is named');
  assert.ok(!bins[2].fpAssumed && !bins[0].fpAssumed, 'record capacity matches the scheduled size → nothing assumed');
  const legacy = ws.wsCollectBins([{ stream: 'garbage', typeId: 'eq_gone', sizeL: 660, qty: 1 }], ['garbage']);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].fpFrom, '660L Bin', 'nearest built-in by capacity when the id resolves nowhere');
  assert.equal(ws.wsCollectBins([{ stream: 'garbage', typeId: 'eq_gone', qty: 1 }], ['garbage']).length, 0, 'no id, no size → nothing invented');
  // a 140L record with no W×D is not placeable, so the layout points the
  // target at the nearest sized record (120L) — the kerb keeps the scheduled
  // size on the label and FLAGS the borrowed footprint instead of relabelling
  const borrowed = ws.wsCollectBins([{ stream: 'garbage', typeId: 'b120', sizeL: 140, qty: 2 }], ['garbage']);
  assert.equal(borrowed.length, 2);
  assert.equal(borrowed[0].label, '140L');
  assert.equal(borrowed[0].fpFrom, '120L MGB');
  assert.ok(borrowed[0].fpAssumed, 'the footprint is stated as borrowed');
});

test('the bin set is summarised per stream and size, in stream order, with borrowed footprints carried', () => {
  const bins = [
    { stream: 'fogo', label: '240L', typeId: 'b240', fpFrom: '240L MGB', fpAssumed: false },
    { stream: 'garbage', label: '140L', typeId: 'b120', fpFrom: '120L MGB', fpAssumed: true },
    { stream: 'garbage', label: '140L', typeId: 'b120', fpFrom: '120L MGB', fpAssumed: true },
    { stream: 'recycling', label: '240L', typeId: 'b240', fpFrom: '240L MGB', fpAssumed: false },
    { stream: 'garbage', label: '1100L', typeId: 'b1100', fpFrom: '1100L Bin', fpAssumed: false },
  ];
  const rows = ws.wsCollectBinSummary(bins);
  assert.deepStrictEqual(rows.map(r => [r.stream, r.label, r.n]),
    [['garbage', '140L', 2], ['garbage', '1100L', 1], ['recycling', '240L', 1], ['fogo', '240L', 1]],
    'stream order is WS_STREAMS order; sizes sort numerically within a stream');
  assert.ok(rows[0].fpAssumed && rows[0].fpFrom === '120L MGB');
  assert.deepStrictEqual(ws.wsCollectBinSummary([]), []);
  // the panel draws that list for the kerb set AND the bulk set from the same helper
  const panel = extractBlock(/^function wsCollectPanelRefresh\(\)/).text;
  assert.ok(panel.includes("wsCollectSetHtml(cp.worst.bins, null)"), 'the design-week bins are listed under the scenario chips');
  assert.ok(panel.includes("wsCollectSetHtml(b.bins, 'all streams at once')"), 'the bulk set lists every stream together');
  assert.ok(panel.includes('the weekly bins plus the larger of the two alternating fortnights set the kerb'), 'the choice between alternating weeks is explained');
  assert.ok(SOURCE.includes('id="ws-collect-set"'), 'the set has its own element in section 3');
  const setHtml = extractBlock(/^function wsCollectSetHtml\(/).text;
  assert.ok(setHtml.includes('add width × depth to that size'), 'a borrowed footprint names the fix');
});

test('the Collection Point computes from the calculator’s schedule before any kerb or area is drawn', () => {
  const compute = extractBlock(/^function wsCollectCompute\(/).text;
  assert.ok(compute.includes("if (!nKerb && !areas.length && !tg.targets.length && !(tg.bulk || []).length) return null;"),
    'null only when there is nothing at all — no kerb, no area, no schedule');
  assert.ok(!compute.includes("else if (!c.kerbs.length && !areas.length) return null;"), 'the old kerb-or-area gate is gone');
  const render = extractBlock(/^function wsCollectRender\(/).text;
  assert.ok(render.includes("const side = (slot.collect && slot.collect.side === -1) ? -1 : 1;"), 'the renderer runs from every tab — a schedule with no collect slot yet must not throw');
  // a fresh calculator payload lands on the open tab; the tab loads the library it needs
  const setT = extractBlock(/^function wsLayoutSetTargets\(/).text;
  assert.ok(setT.includes("_wsPanelTab === 'collect'") && setT.includes('wsCollectPanelRefresh()'), 'calc → targets → Collection Point refresh');
  assert.ok(SOURCE.includes("if (WS_EQUIP_DB === null) wsLoadEquipmentDB();            // bin footprints come from the library"), 'the tab loads the library itself');
  const load = extractBlock(/^async function wsLoadEquipmentDB\(\)/).text;
  assert.ok(load.includes("_wsPanelTab === 'collect' && typeof wsCollectPanelRefresh === 'function'"), 'and the loader refreshes the tab once the footprints are in');
  // the DXF still only carries kerb content once a kerb or area exists — no silent extra content
  assert.ok(SOURCE.includes("const anyCollect = (slot.collect && slot.collect.kerbs && slot.collect.kerbs.length)"), 'DXF gate unchanged');
});

test('only kerbside-method bins present at the kerb; pre-method payloads keep presenting everything', () => {
  const fn = extractBlock(/^function wsCollectTargets\(\)/).text;
  assert.ok(fn.includes("WS_CALC_TARGETS.some(t => t.method)"), 'typed payload detection');
  assert.ok(fn.includes("/^kerbside/.test(String(t.method || ''))"), 'bulk collection point and private shared bin collection never line the frontage');
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
  assert.ok(calc.includes("if (Array.isArray(d.council_schedules)) {"), 'and its council schedules');
  assert.ok(calc.includes("council kerbside services ("), 'and logs what arrived, by council value');
  assert.ok(calc.includes('optgroup label="More sizes"'), 'non-common sizes stay selectable under their own group');
  assert.ok(calc.includes('class="wsr-methodsel"'), 'the collection method is a visible select per room section');
  assert.ok(calc.includes("method: methodOf(rr.id, sec), cycle: cycleFor(rr.id, sec, s, cw)"), 'the schedule payload carries method + the council’s cycle letter');
  assert.ok(calc.includes("source: ent ? 'council' : 'manual'"), 'the presentation block names its source');
  assert.ok(calc.includes('min="0.25" step="0.25"'), 'fortnightly and monthly collection are enterable');
  assert.ok(!/sizeOpts\(|ALLOWED_SIZES\[s\]\.map/.test(calc.replace(/function sizeOpts[^\n]*\n/, '')), 'no dropdown reads the constant directly any more');
  assert.ok(calc.includes('differs from the council service'), 'departing from the council service is stated, never silent');
  // generation-rate provenance: which rates the volumes are built on is on screen, with a reload
  assert.ok(calc.includes("g('roomResults').innerHTML=ratesNoteHtml()+"), 'the results open with the rates source');
  assert.ok(calc.includes('no published override for ${escAttr(i.label)}'), 'a council with no published override is named, not silently defaulted');
  assert.ok(calc.includes('onclick="reloadRates()"'), 'a publish made while the page is open can be pulled in without a reload');
  // the council card lists the approved clauses on file
  const reqs = extractBlock(/^async function glCouncilReqs\(row, mountId\)/).text;
  assert.ok(reqs.includes(".in('council_guideline_id', ids).eq('status', 'approved')"), 'approved rows across every version of the council’s document');
  assert.ok(reqs.includes('(superseded)'), 'a clause from an older version says so');
  assert.ok(reqs.includes('approved clause') && reqs.includes('clause_ref'), 'each clause shows its reference');
  assert.ok(extractBlock(/^async function glCouncilCard\(/).text.includes("glCouncilReqs(row, mountId + '-reqs')"), 'both council cards get the list');
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

test('finishing a kerb trace: Enter commits it (as promised), the panel has its own Finish button, a double-click’s doubled corner is one corner', () => {
  assert.deepStrictEqual(ws.wsKerbCleanPts([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }]),
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 20 }], 'consecutive identical points collapse');
  assert.deepStrictEqual(ws.wsKerbCleanPts([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 0 }]).length, 3, 'a genuine return to a point is kept');
  assert.deepStrictEqual(ws.wsKerbCleanPts(null), []);
  // the keydown handler: every mode whose prompt says "or Enter" finishes on Enter
  assert.ok(SOURCE.includes("if (WS._mode === 'layoutkerb') { e.preventDefault(); wsCollectKerbFinish(); return; }"), 'Enter commits the kerb trace');
  assert.ok(SOURCE.includes("if (WS._mode === 'layoutman') { e.preventDefault(); wsManFinish(); return; }"), 'Enter commits the manoeuvre route');
  const fin = extractBlock(/^function wsCollectKerbFinish\(\)/).text;
  assert.ok(fin.includes('const tr = wsKerbCleanPts(WS_COLLECT.trace || []);'), 'the finish cleans the trace before storing it');
  const trace = extractBlock(/^function wsCollectTraceHtml\(\)/).text;
  assert.ok(trace.includes('onclick="wsCollectKerbFinish()"') && trace.includes('onclick="wsCollectKerbCancel()"'), 'panel finish / cancel while tracing');
  const panel = extractBlock(/^function wsCollectPanelRefresh\(\)/).text;
  assert.ok(panel.includes('wrap.innerHTML = wsCollectTraceHtml() + (cp.kerbs.length'), 'the live trace sits above the kerb list');
  assert.ok(SOURCE.includes("if (kerbDropped) { wsCollectMsg('Kerb trace discarded (Escape)."), 'Escape on a half-traced kerb says so');
});

test('kerb bins are REAL placed bins: poses from the design case, tagged `kerb`, counted apart, exported to A-KERB-BINS', () => {
  // a straight kerb along +x; bins sit on side +1 (below the line in canvas y), rotated along the tangent
  const mpp = 0.02;
  const kerb = { k: { id: 'kerb_1', pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] }, L: 1000 };
  const cp = { kerbs: [kerb], worst: { assess: { placed: [
    { kerb: 0, s0: 0, s1: 29.25, bin: { stream: 'garbage', typeId: 'eq_gone', resolvedType: 'b120', wM: 0.585, dM: 0.735 } },
    { kerb: 0, s0: 36.75, s1: 66, bin: { stream: 'recycling', typeId: 'b240', resolvedType: 'b240', wM: 0.585, dM: 0.735 } },
  ] } } };
  const poses = ws.wsCollectKerbBinPoses(cp, 1, mpp);
  assert.equal(poses.length, 2);
  assert.equal(poses[0].kerbId, 'kerb_1');
  assert.equal(poses[0].type, 'b120', 'the RESOLVED type is what gets placed — an unresolvable id would be an invisible bin');
  assert.equal(poses[1].type, 'b240');
  assert.equal(poses[0].rot, 0, 'rotated along the kerb tangent');
  assert.ok(Math.abs(poses[0].x - 14.625) < 1e-6, 'centred on its stretch');
  assert.ok(Math.abs(poses[0].y - (0.735 / 2 + 0.08) / mpp) < 1e-6, 'offset by half the depth plus the 80 mm stand-off, to the chosen side');
  assert.ok(ws.wsCollectKerbBinPoses(cp, -1, mpp)[0].y < 0, 'flip side mirrors the offset');
  assert.deepStrictEqual(ws.wsCollectKerbBinPoses(null, 1, mpp), []);
  // wiring: commit places them; delete removes them with the kerb; flip re-places; the panel can re-place
  const fin = extractBlock(/^function wsCollectKerbFinish\(\)/).text;
  assert.ok(fin.includes('const n = wsCollectPlaceBins([kerb.id]);'), 'a committed kerb gets its bins immediately');
  const place = extractBlock(/^function wsCollectPlaceBins\(/).text;
  assert.ok(extractBlock(/^function wsCollectMaterialise\(/).text.includes('wsLayoutSnapshot();'), 'undoable');
  assert.ok(extractBlock(/^function wsCollectMaterialise\(/).text.includes("roomId: null, [tag]: p[tag === 'kerb' ? 'kerbId' : 'areaId']"), 'tagged to the kerb / area, never to a room');
  assert.ok(extractBlock(/^function wsCollectKerbDelete\(/).text.includes('slot.bins = slot.bins.filter(b => b.kerb !== k.id);'), 'deleting a kerb takes its bins — stated in the button title');
  assert.ok(SOURCE.includes('title="Remove this kerb and the bins placed along it (Ctrl+Z restores both)"'));
  assert.ok(extractBlock(/^function wsCollectFlipSide\(\)/).text.includes('wsCollectPlaceBins(withBins)'), 'flip re-places on the other side');
  const panel = extractBlock(/^function wsCollectPanelRefresh\(\)/).text;
  assert.ok(panel.includes("'↻ Re-place bins along the kerb' : '⤓ Place the bins on the kerb'"), 'a kerb without bins (legacy save) can place them from the panel');
  // counted apart from room storage everywhere a room count is taken
  assert.ok(extractBlock(/^function wsLayoutPlacedCount\(/).text.includes('!wsIsPresentationBin(b) && b.stream === stream'), 'presentation bins never satisfy a room target');
  assert.ok(extractBlock(/^function wsLayoutUntagged\(\)/).text.includes('!b.calcRoom && !wsIsPresentationBin(b)'));
  const stats = extractBlock(/^function wsLayoutUpdateStats\(/).text;
  assert.ok(stats.includes("if (b.kerb) { onKerb++; return; }") && stats.includes('at the kerb'), 'the status line counts them on their own');
  assert.ok(extractBlock(/^function wsCollectTargets\(\)/).text.includes('const plan = slot.bins.filter(b => !wsIsPresentationBin(b));'), 'presented bins are never their own schedule');
  assert.ok(!SOURCE.includes("cp.areas.map(a => a.m2.toFixed(1)"), 'the panel reads the area m² from the bulk pack (cp.areas carries no m² — this used to throw the moment an area held bins)');
  // the drawing: no verdict text, no kerb label, no ghost bins; the kerb line sits on the Bin room layer
  const render = extractBlock(/^function wsCollectRender\(/).text;
  assert.ok(!render.includes('fits on the busiest week') && !render.includes("'Kerb ' + String.fromCharCode(65 + i) + ' — '"), 'the two canvas labels are gone');
  assert.ok(!render.includes('sc.assess.placed.forEach') && !render.includes('const sc = cp.active;'), 'no engine-drawn ghost kerb bins — the bin pass draws the real ones (the bulk AREA pack still draws its own)');
  assert.ok(render.includes("const gB = document.getElementById('ws-layer-binroom') || gW;") && render.includes("'stroke-linecap': 'round' }, gB);"), 'the kerb line renders into the Bin room layer, so that toggle hides it');
  assert.ok(render.includes("don’t fit (' + cp.worst.label + ')"), 'a shortfall still shows on the plan');
  // DXF: real kerb bins on their own layer, drawn once
  const dxf = SOURCE.slice(SOURCE.indexOf('function wsLayoutDXFEntities'), SOURCE.indexOf('// ── CALC → LAYOUT TARGETS'));
  assert.ok(dxf.includes("const layer = b.kerb ? 'A-KERB-BINS' : b.collectArea ? 'A-COLLECT-BINS' : 'BINS_' + st.id.toUpperCase();"));
  assert.ok(SOURCE.includes("if (b.collectArea && k.zoneType === 'COLLECT') continue;"), 'a collection point bin is not a clash with its own area');
  assert.ok(!dxf.includes("rect('A-KERB-BINS'"), 'the ghost rectangles are gone from the export');
});

test('collection point AREA bins get the same treatment: real bins tagged `collectArea`, placed on draw, pruned with the zone, never a room’s storage', () => {
  const mpp = 0.02;
  const area = { id: 'fx_9', label: 'Collection point area', pts: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] };
  const targets = [
    { stream: 'garbage', typeId: 'eq_gone', sizeL: 1100, qty: 2, method: 'bulk', cycle: 'W' },
    { stream: 'fogo', typeId: 'b240', sizeL: 240, qty: 1, method: 'bulk', cycle: 'B' },
  ];
  const b = ws.wsCollectBulk(targets, [area], mpp, 0.15, ws.WS_BIN_TYPES);
  const poses = ws.wsCollectAreaBinPoses(b);
  assert.equal(poses.length, 3, 'one pose per packed bin');
  assert.ok(poses.every(p => p.areaId === 'fx_9' && p.rot === 0));
  assert.equal(poses[0].type, 'b1100', 'the resolved type is placed, never an id that would draw nothing');
  assert.ok(poses.every(p => ws.wsPointInPoly(area.pts, p.x, p.y)), 'inside the drawn area');
  assert.deepStrictEqual(ws.wsCollectAreaBinPoses(null), []);
  // presentation bins are never a room's storage, even when the area sits inside the bin room
  assert.ok(ws.wsIsPresentationBin({ kerb: 'k' }) && ws.wsIsPresentationBin({ collectArea: 'a' }) && !ws.wsIsPresentationBin({ calcRoom: 'R1' }));
  const room = { id: 'room1', pts: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 1000 }, { x: 0, y: 1000 }] };
  const bins = [{ id: 'a', x: 50, y: 50, collectArea: 'fx_9', roomId: 'stale' }, { id: 'b', x: 60, y: 60 }];
  ws.wsTagBinsToRooms([room], bins);
  assert.equal(bins[0].roomId, null, 'an area bin inside the room is untagged, not counted toward the schedule');
  assert.equal(bins[1].roomId, 'room1', 'an ordinary bin inside the room still tags');
  // wiring
  assert.ok(extractBlock(/^function wsZonePolyFinish\(/).text.includes("if (t.id === 'COLLECT' && typeof wsCollectPlaceAreaBins === 'function')"), 'drawing the area places its bins');
  assert.ok(extractBlock(/^function wsCollectPruneAreaBins\(/).text.includes("filter(e => e.zoneType === 'COLLECT')"), 'bins follow their area out');
  assert.equal((SOURCE.match(/(?<!function )wsCollectPruneAreaBins\(slot\)/g) || []).length, 3, 'pruned on cut, multi-delete and single delete');
  const place = extractBlock(/^function wsCollectPlaceAreaBins\(/).text;
  assert.ok(place.includes("wsCollectMaterialise(slot, 'collectArea', want,"), 'same materialiser as the kerb');
  const panel = extractBlock(/^function wsCollectPanelRefresh\(\)/).text;
  assert.ok(panel.includes("'↻ Re-place bins in the area' : '⤓ Place the bins in the area'"));
  const render = extractBlock(/^function wsCollectRender\(/).text;
  assert.ok(!render.includes("mk('polygon'"), 'no engine-drawn ghost bins anywhere — the bin pass draws the real ones');
  const stats = extractBlock(/^function wsLayoutUpdateStats\(/).text;
  assert.ok(stats.includes('at the collection point'));
});
