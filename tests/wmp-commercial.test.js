'use strict';
// ── WMP GENERATOR: COMMERCIAL ROOMS · COMPONENTS · LABELS · JOB NO. ─────────
// The bin calculator already splits every room into residential and
// commercial sections; the WMP generator used to drop the commercial half.
// It now carries commercial rooms, their use rows and bins, prices the uses
// against the same published rates through MIRRORS of the calculator's
// weeklyL / SPLIT_DEFS / applySplits / COMM (the srcdoc is sandboxed), and
// fills the master's commercial sections. §1 the mirrors, pinned to the
// calculator · §2 the brief's acceptance project (30 apartments + 200 m²
// café + 400 m² office) against the Excel master's own formula · §3
// hydration · §4 residential exports unchanged · §5 report tables, text and
// template re-homing · §6 Job No. · §7 wiring pins. Nothing is copied from
// index.html — every function is lifted by anchor.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock, extractSrcdocBlock } = require('./extract.js');

// ── loaders ──
function loadCalc() {
  const code = [/^const COMM=\{/, /^function weeklyL\(/, /^const SPLIT_DEFS=\{/, /^function splitPctFor\(/, /^function applySplits\(/]
    .map(p => extractSrcdocBlock('calc-iframe', p).text).join('\n\n');
  return new Function(code + ';return { COMM, weeklyL, SPLIT_DEFS, applySplits };')();
}
const CORE = [
  /^const WMPG_STREAMS = /, /^const WMPG_ORDER = /, /^const WMPG_COM_ORDER = /, /^const WMPG_UNITS = /, /^const WMPG_FREQ = /,
  /^function wmpgFreqLabel\(/, /^function wmpgEsc\(/, /^function wmpgNum\(/, /^function wmpgUid\(/, /^const WMPG_BIN_DIMS = /,
  /^function wmpgNewRoom\(/, /^function wmpgRoomQty\(/, /^function wmpgRoomVols\(/, /^function wmpgTotalVols\(/, /^function wmpgRoomStreams\(/,
  /^function wmpgRoomKind\(/, /^function wmpgRoomSec\(/, /^function wmpgResRooms\(/, /^function wmpgComRooms\(/, /^function wmpgDwLabel\(/,
  /^const WMPG_COM_USES = /, /^function wmpgComWeeklyL\(/, /^function wmpgComRatePerDay\(/, /^const WMPG_SPLIT_DEFS = /,
  /^function wmpgSplitList\(/, /^function wmpgApplySplits\(/, /^function wmpgComUnitWord\(/, /^function wmpgComUseMeta\(/,
  /^function wmpgComUseRows\(/, /^function wmpgComRoomVols\(/, /^function wmpgComRoomMoves\(/, /^function wmpgCouncilOverride\(/,
  /^function wmpgComRatesFor\(/, /^function wmpgComRateScope\(/, /^function wmpgComVolDiff\(/,
  /^const WMPG_METHOD_LABEL = /, /^function wmpgStreamWord\(/, /^function wmpgList\(/, /^function wmpgCycleWords\(/,
  /^function wmpgBinWords\(/, /^function wmpgRoomMethod\(/, /^function wmpgNarrative\(/, /^function wmpgShape\(/,
  /^const WMPG_ALLOW_CODES = /, /^function wmpgHydrateRooms\(/, /^function wmpgUpgradeDraft\(/,
  // report tables (the doc-model block)
  /^function wmpgCompName\(/, /^function wmpgUniq\(/, /^function wmpgResDevSummary\(/, /^function wmpgComQtyText\(/,
  /^function wmpgComDevSummary\(/, /^function wmpgComGenTable\(/, /^function wmpgComTextDefaults\(/,
  /^const WMPG_COM_SORT_TAG = /, /^const WMPG_COM_COLOURS = /, /^function wmpgComSortRows\(/,
  /^function wmpgStorageRows\(/, /^const WMPG_STORAGE_HDR = /, /^const WMPG_COLLECT_HDR = /, /^function wmpgCollectRows\(/,
  /^function wmpgCollectionSentence\(/, /^const WMPG_TPL_REHOME = /, /^function wmpgTplRehome\(/,
];
function load() {
  const code = CORE.map(p => extractBlock(p).text).join('\n\n');
  // wmpgUpgradeDraft reaches for a handful of neighbours that are not under
  // test here; honest no-op stand-ins keep it to the fields this file checks.
  return new Function('wmpgChuteText', 'wmpgTitleDefault', 'wmpgGuidelinesSync', 'wmpgCoverCreditParse', 'wmpgVehList', 'tbGet', code + `
    ;return { WMPG_STREAMS, WMPG_COM_USES, WMPG_SPLIT_DEFS, wmpgComWeeklyL, wmpgApplySplits, wmpgSplitList, wmpgComUseRows,
      wmpgComRoomVols, wmpgComRoomMoves, wmpgComRatesFor, wmpgComRateScope, wmpgComVolDiff, wmpgRoomVols, wmpgTotalVols,
      wmpgRoomStreams, wmpgRoomKind, wmpgDwLabel, wmpgNewRoom, wmpgHydrateRooms, wmpgUpgradeDraft, wmpgShape, wmpgNarrative,
      wmpgCompName, wmpgResDevSummary, wmpgComDevSummary, wmpgComGenTable, wmpgComTextDefaults, wmpgComSortRows,
      wmpgStorageRows, wmpgCollectRows, wmpgCollectionSentence, wmpgTplRehome, wmpgComUnitWord };`)(
    () => '', () => 'Title', () => {}, () => ({ source: '', received: '' }), () => [], () => null);
}

// The published rates file, in the shape the calculator and generator read.
const RATES = {
  PROFILES: { NSW: {
    resRates: { apt_1br: { GW: 80, REC: 80, ORG: 20, GLS: 0 }, apt_2br: { GW: 100, REC: 100, ORG: 25, GLS: 0 }, apt_3br: { GW: 120, REC: 120, ORG: 30, GLS: 10 } },
    comRates: {
      cafe:   { GW: { rate: 240, unitValue: 100, unit: 'L/Day/100m2' }, REC: { rate: 200, unitValue: 100, unit: 'L/Day/100m2' }, ORG: { rate: 60, unitValue: 100, unit: 'L/Day/100m2' } },
      office: { GW: { rate: 8, unitValue: 100, unit: 'L/Day/100m2' }, REC: { rate: 10, unitValue: 100, unit: 'L/Day/100m2' }, ORG: { rate: 2, unitValue: 100, unit: 'L/Day/100m2' } },
      hotel_beds: { GW: { rate: 5, unitValue: 1, unit: 'L/Bed/Day' } },
      boarding_house: { GW: { rate: 60, unitValue: 1, unit: 'L/Occupant/Week' } },
    } } },
  COUNCILS: { NSW: [{ value: 'sydney', label: 'City of Sydney' }] },
  COUNCIL_PROFILES: { 'NSW|sydney': { comRates: { cafe: { GW: { rate: 300, unitValue: 100, unit: 'L/Day/100m2' } } } } },
};
const D = { state: 'NSW', council: 'City of Sydney' };

// ── §1 the mirrors, pinned to the calculator ──
test('§1 wmpgComWeeklyL is the calculator’s weeklyL: every unit, per-day and per-week, and the fallbacks', () => {
  const C = loadCalc(), P = load();
  const units = ['L/Day/100m2', 'L/Bed/Day', 'L/Bed/Week', 'L/Apartment/Week', 'L/Student/Week', 'L/Occupant/Week', 'L/Cat/Week', 'L/Week', 'L/Week/100m2', 'L/Seat/Screening', ''];
  for (const unit of units) for (const [value, days, rate, unitValue] of [[200, 7, 240, 100], [37, 5, 1.5, 1], [0, 7, 10, 1], [12, 0, 5, 1], [50, 6, 0, 100]]) {
    const ro = { rate, unitValue, unit };
    assert.strictEqual(P.wmpgComWeeklyL(value, days, ro), C.weeklyL(value, days, ro), `${unit} ${value}@${days}d`);
  }
});

test('§1 the split definitions and the split arithmetic are the calculator’s', () => {
  const C = loadCalc(), P = load();
  Object.keys(C.SPLIT_DEFS).forEach(id => {
    const c = C.SPLIT_DEFS[id], p = P.WMPG_SPLIT_DEFS[id];
    assert.ok(p, 'mirror has ' + id);
    ['id', 'from', 'to', 'pct'].forEach(k => assert.strictEqual(p[k], c[k], id + '.' + k));
  });
  assert.deepStrictEqual(Object.keys(P.WMPG_SPLIT_DEFS).sort(), Object.keys(C.SPLIT_DEFS).sort());
  assert.ok(Object.values(C.COMM).every(u => !u.splits), 'COMM carries no per-use splits, so the default percentage is the one the calculator applies');
  const cases = [['REC_CARD'], ['GW_ORG', 'GW_SOFT'], ['REC_CARD', 'REC_GLS'], ['GW_ORG', 'GW_SOFT', 'REC_CARD', 'REC_GLS'], []];
  for (const ids of cases) {
    const a = { GW: 1000, REC: 800, ORG: 50, GLS: 0 }, b = Object.assign({}, a);
    const mc = C.applySplits(ids, a, 'cafe'), mp = P.wmpgApplySplits(ids, b);
    assert.deepStrictEqual(b, a, 'same volumes after ' + ids.join('+'));
    assert.deepStrictEqual(mp.map(m => [m.id, m.pct, m.amt]), mc.map(m => [m.id, m.pct, m.amt]));
  }
  assert.deepStrictEqual(P.wmpgSplitList({ r: ['GW_ORG'], c: ['REC_CARD', 'nope'] }), ['REC_CARD'], 'the commercial section’s list; unknown ids dropped');
  assert.deepStrictEqual(P.wmpgSplitList(['REC_CARD', { from: 'GW', to: 'SOFT' }]), ['REC_CARD', 'GW_SOFT'], 'the older bare-list and {from,to} shapes');
});

test('§1 the use list is the calculator’s COMM — every code, label and metric', () => {
  const C = loadCalc(), P = load();
  assert.deepStrictEqual(Object.keys(P.WMPG_COM_USES).sort(), Object.keys(C.COMM).sort());
  Object.keys(C.COMM).forEach(k => {
    assert.strictEqual(P.WMPG_COM_USES[k].label, C.COMM[k].label, k);
    assert.strictEqual(P.WMPG_COM_USES[k].metric, C.COMM[k].metric, k);
  });
  assert.strictEqual(P.wmpgComUnitWord('Beds (no.)'), 'beds');
  assert.strictEqual(P.wmpgComUnitWord('m² (NLA)'), 'm² (NLA)');
});

// ── §2 the brief's acceptance project ──
function mixedProject() {
  return {
    schedule: [
      { room: 'R1', roomName: 'Bin Room 1', sec: 'r', stream: 'GW', sizeL: 1100, qty: 3, colWk: 2, method: 'bulk' },
      { room: 'R1', roomName: 'Bin Room 1', sec: 'r', stream: 'REC', sizeL: 1100, qty: 3, colWk: 1, method: 'bulk' },
      { room: 'R2', roomName: 'Bin Room 1 — Commercial', sec: 'c', stream: 'GW', sizeL: 660, qty: 4, colWk: 3, method: 'self_haul' },
      { room: 'R2', roomName: 'Bin Room 1 — Commercial', sec: 'c', stream: 'REC', sizeL: 660, qty: 2, colWk: 2, method: 'self_haul' },
      { room: 'R2', roomName: 'Bin Room 1 — Commercial', sec: 'c', stream: 'CARD', sizeL: 660, qty: 1, colWk: 2, method: 'self_haul' },
    ],
    calc_rooms: [{ id: 'R2', name: 'Bin Room 1 — Commercial', bins: [{ stream: 'GW', weeklyVolL: 4360 }, { stream: 'REC', weeklyVolL: 1800 }, { stream: 'ORG', weeklyVolL: 880 }, { stream: 'CARD', weeklyVolL: 1200 }] }],
  };
}
function mixedSummary() {
  return { bin_rooms: [
    { id: 'R1', name: 'Bin Room 1', kind: 'res', component: 'Development', alloc: { apt_1br: 10, apt_2br: 15, apt_3br: 5, townhouse: 0 }, com: [] },
    { id: 'R2', name: 'Bin Room 1 — Commercial', kind: 'com', component: 'Development', alloc: { apt_1br: 0, apt_2br: 0, apt_3br: 0, townhouse: 0 },
      com: [{ use: 'cafe', value: 200, days: 7 }, { use: 'office', value: 400, days: 5 }], splits: { r: [], c: ['REC_CARD'] } },
  ] };
}
function hydrated(P) {
  const d = Object.assign({ unitTypes: [{ key: 'apt_1br', label: '1-bedroom apartment' }, { key: 'apt_2br', label: '2-bedroom apartment' }, { key: 'apt_3br', label: '3-bedroom apartment' }],
    rates: { apt_1br: { GW: 80, REC: 80, ORG: 20, GLS: 0 }, apt_2br: { GW: 100, REC: 100, ORG: 25, GLS: 0 }, apt_3br: { GW: 120, REC: 120, ORG: 30, GLS: 10 } },
    defaults: { vehicle: '10.6-metre rear-loading vehicle', point: 'the collection point', provider: 'council' } }, D);
  P.wmpgHydrateRooms(d, mixedProject(), mixedSummary());
  d.rooms.filter(r => r.kind === 'com').forEach(r => r.uses.forEach(u => { u.rates = P.wmpgComRatesFor(RATES, d, u.use); }));
  return d;
}
// The Excel master's own arithmetic (mod_WMP_Main CommWeeklyFromUnit):
// l/100m2/day → rate × (area / 100) × days per week.
const excelWeekly = (rate, area, dpw) => rate * (area / 100) * dpw;

test('§2 30 apartments + a 200 m² café + a 400 m² office: every commercial figure is the master’s formula', () => {
  const P = load(), d = hydrated(P);
  const com = d.rooms.find(r => r.kind === 'com');
  const rows = P.wmpgComUseRows(com);
  assert.deepStrictEqual(rows.map(r => [r.use, r.label, r.value, r.days]), [['cafe', 'Cafe', 200, 7], ['office', 'Office', 400, 5]]);
  // the council's café GW figure wins; everything else is the state fallback, named
  assert.deepStrictEqual(rows[0].rates.GW, { rate: 300, unitValue: 100, unit: 'L/Day/100m2', src: 'council' });
  assert.strictEqual(rows[0].rates.REC.src, 'state');
  assert.strictEqual(rows[0].vols.GW, excelWeekly(300, 200, 7));
  assert.strictEqual(rows[0].vols.REC, excelWeekly(200, 200, 7));
  assert.strictEqual(rows[1].vols.GW, excelWeekly(8, 400, 5));
  assert.strictEqual(rows[1].vols.ORG, excelWeekly(2, 400, 5));
  // the room separates cardboard: 40% of commingled recycling, moved, not made
  const v = P.wmpgComRoomVols(d, com);
  const recPre = excelWeekly(200, 200, 7) + excelWeekly(10, 400, 5);
  assert.strictEqual(v.REC, recPre * 0.6);
  assert.strictEqual(v.CARD, recPre * 0.4);
  assert.strictEqual(v.GW, excelWeekly(300, 200, 7) + excelWeekly(8, 400, 5));
  assert.strictEqual(P.wmpgRoomVols(d, com).CARD, v.CARD, 'wmpgRoomVols reads the commercial path for a commercial room');
  assert.deepStrictEqual(P.wmpgComVolDiff(d, com), [], 'agrees with the calculator’s own weekly volumes');
  com.calcVols.GW = 4000;
  assert.deepStrictEqual(P.wmpgComVolDiff(d, com).map(x => x.stream), ['GW'], 'a drift from the calculator is named');

  // the master's 2.2 table: Level, Waste source, Area, Days/wk, then rate + L/week per stream
  const t = P.wmpgComGenTable(d, com);
  assert.deepStrictEqual(t.header.slice(0, 4), ['Level', 'Waste source', 'Area (m²)', 'Days/week in operation']);
  assert.deepStrictEqual(t.header.slice(4, 6), ['General waste rate', 'General waste volume (L/week)']);
  assert.deepStrictEqual(t.rows[0].slice(0, 6), ['—', 'Cafe', '200', '7', '300', '4,200']);
  assert.ok(t.rows.some(r => r[1] === 'Separated: paper & cardboard from commingled recycling (40%)'), 'the separation is shown as its own row');
  assert.strictEqual(t.total[0], 'Total after separation');
  assert.ok(t.notes.some(n => /State fallback used for Cafe \(organics and commingled recycling\) and Office/.test(n)), 'partial fallback names the streams');
});

test('§2 no separation → the master’s single Total row; per-week units have no days term; Qty + Unit when not all floor area', () => {
  const P = load();
  const room = { kind: 'com', splits: [], uses: [
    { use: 'hotel_beds', value: 40, days: 7, rates: P.wmpgComRatesFor(RATES, D, 'hotel_beds') },
    { use: 'boarding_house', value: 12, days: 5, rates: P.wmpgComRatesFor(RATES, D, 'boarding_house') }] };
  const t = P.wmpgComGenTable(D, room);
  assert.deepStrictEqual(t.header.slice(0, 5), ['Level', 'Waste source', 'Qty', 'Unit', 'Days/week in operation']);
  assert.strictEqual(t.total[0], 'Total');
  assert.deepStrictEqual(t.rows.map(r => r[3]), ['beds', 'occupants']);
  const rows = P.wmpgComUseRows(room);
  assert.strictEqual(rows[0].vols.GW, 5 * 40 * 7, 'L/Bed/Day carries the days');
  assert.strictEqual(rows[1].vols.GW, 60 * 12, 'L/Occupant/Week does not');
  const none = { kind: 'com', uses: [{ use: 'gym', value: 100, days: 7, rates: {} }] };
  assert.ok(P.wmpgComGenTable(D, none).notes.some(n => /No published generation rate for Gym/.test(n)), 'a use with no rate is named, never silently zero');
});

test('§2 the commercial development summary is the master’s layout — uses down, components across, total', () => {
  const P = load(), d = hydrated(P);
  const s = P.wmpgComDevSummary(d);
  assert.deepStrictEqual(s.header, ['Use (commercial)', 'Commercial', 'Total area (m²)']);
  assert.deepStrictEqual(s.rows, [['Cafe', '200', '200'], ['Office', '400', '400']]);
  assert.deepStrictEqual(s.total, ['Total', '600', '600']);
  const com = d.rooms.find(r => r.kind === 'com');
  com.component = 'Retail'; com.uses[0].label = 'Café (ground floor)';
  const s2 = P.wmpgComDevSummary(d);
  assert.deepStrictEqual(s2.header[1], 'Retail', 'a renamed component heads its column');
  assert.strictEqual(s2.rows[0][0], 'Café (ground floor)', 'the use label prints');
});

// ── §3 hydration ──
test('§3 hydration keeps both kinds: commercial rooms, their uses, splits and separated-stream bins', () => {
  const P = load(), d = hydrated(P);
  assert.deepStrictEqual(d.rooms.map(r => [r.kind, r.component, r.name]), [['res', 'Residential', 'Bin Room 1'], ['com', 'Commercial', 'Bin Room 1 — Commercial']],
    '“Development” is the calculator’s placeholder, never a component');
  const com = d.rooms[1];
  assert.deepStrictEqual(com.bins.map(b => b.stream), ['GW', 'REC', 'CARD'], 'cardboard is carried, not filtered out');
  assert.deepStrictEqual(com.splits, ['REC_CARD']);
  assert.strictEqual(com.collection.provider, 'private contractor', 'every bin privately collected → the room is');
  assert.deepStrictEqual(d.rooms[0].bins.map(b => b.stream), ['GW', 'REC']);
  assert.strictEqual(d.rooms[0].collection.provider, 'council', 'residential rooms are untouched');
  assert.ok(P.wmpgShape(d).commercial && P.wmpgShape(d).residential && P.wmpgShape(d).mixed);
  com.component = 'Café';
  assert.ok(P.wmpgShape(d).commercial, 'a renamed commercial component is still commercial (kind, not the label)');
  // residential-only schedules keep the four base streams exactly as before
  const d2 = Object.assign({ unitTypes: [{ key: 'apt_1br', label: '1br' }], rates: {}, defaults: { vehicle: '', point: '' } }, D);
  P.wmpgHydrateRooms(d2, { schedule: [{ room: 'R1', roomName: 'A', sec: 'r', stream: 'CARD', sizeL: 240, qty: 1, colWk: 1 }, { room: 'R1', roomName: 'A', sec: 'r', stream: 'GW', sizeL: 240, qty: 1, colWk: 1 }] },
    { bin_rooms: [{ id: 'R1', name: 'A', kind: 'res', alloc: { apt_1br: 4 } }] });
  assert.deepStrictEqual(d2.rooms[0].bins.map(b => b.stream), ['GW'], 'a residential export is unchanged by the new streams');
});

test('§3 commercial narrative says tenants, never residents; private contractor wording when not council', () => {
  const P = load(), d = hydrated(P);
  const com = d.rooms[1];
  const t = P.wmpgNarrative(d, com);
  assert.ok(/a private waste contractor/.test(t));
  assert.ok(!/resident/i.test(t), t);
  assert.ok(/tenants/.test(t));
  com.bins.forEach(b => b.method = 'kerbside_individual');
  const k = P.wmpgNarrative(d, com);
  assert.ok(/Each tenancy is provided with its own bins\. Tenants will present/.test(k) && /return them to their tenancy/.test(k) && !/resident/i.test(k));
  const res = P.wmpgNarrative(d, d.rooms[0]);
  assert.ok(/residents/.test(res), 'residential wording is unchanged');
  assert.strictEqual(P.wmpgCollectionSentence(d, com).indexOf('Bin Room 1 — Commercial — commercial waste will be collected'), 0);
});

// ── §4 residential exports unchanged ──
test('§4 residential: the development summary keeps its single-column shape; dwelling labels print per room', () => {
  const P = load();
  const d = { unitTypes: [{ key: 'a', label: '1-bedroom apartment' }, { key: 'b', label: '2-bedroom apartment' }],
    rooms: [{ kind: 'res', component: 'Development', alloc: { a: 4, b: 2 } }, { component: 'Residential', alloc: { a: 1, b: 0 } }] };
  assert.deepStrictEqual(P.wmpgResDevSummary(d), { header: ['Dwelling type', 'Residential'],
    rows: [['1-bedroom apartment', '5'], ['2-bedroom apartment', '2']], total: ['Total dwellings', '7'] },
    'exactly the table the WMP has always printed (a legacy room with no kind is residential)');
  d.rooms[0].component = 'Tower A'; d.rooms[1].component = 'Tower B';
  d.rooms[0].dwLabels = { a: '1-bed affordable' };
  const s = P.wmpgResDevSummary(d);
  assert.deepStrictEqual(s.header, ['Dwelling type', 'Tower A', 'Tower B', 'Total'], 'the master’s layout once there is more than one component');
  assert.deepStrictEqual(s.rows, [['1-bed affordable', '4', '0', '4'], ['1-bedroom apartment', '0', '1', '1'], ['2-bedroom apartment', '2', '0', '2']]);
  assert.strictEqual(P.wmpgDwLabel(d.rooms[1], d.unitTypes[0]), '1-bedroom apartment', 'blank label → the dwelling type');
});

test('§4 the storage and collection rows are the residential tables’ own logic, for any room', () => {
  const P = load();
  const room = { kind: 'res', alloc: { apt_1br: 10 }, bins: [{ stream: 'GW', sizeL: 1100, qty: 2, colWk: 2, provider: 'council' }],
    extras: { bulky: { on: true, areaM2: 6, type: 'bulky waste zone', w: 3000, d: 2000, h: 1000 }, textiles: { on: false }, tug: { on: false }, wash: { on: true, areaM2: 0, type: 'Bin wash', w: 0, d: 0, h: 0 } },
    collection: { provider: 'council' } };
  const st = P.wmpgStorageRows(room);
  assert.deepStrictEqual(st.rows[0], ['General waste', '1100L bin', '2', '1330', '1240', '1070', '2.65']);
  assert.deepStrictEqual(st.rows[1], ['Hard waste', 'bulky waste zone', '1', '1000', '3000', '2000', '6.00']);
  assert.deepStrictEqual(st.total, ['Total footprint (m²)', '', '', '', '', '', '8.65']);
  const d = { unitTypes: [{ key: 'apt_1br' }], rates: { apt_1br: { GW: 80 } } };
  assert.deepStrictEqual(P.wmpgCollectRows(d, room)[0], ['General waste', '1100L bin', '2', 'twice weekly', '800', '4,400', 'council']);
});

// ── §5 text defaults, sorting, template re-homing ──
test('§5 WG_COMM_1 or _2 follows the rates’ source; WG_COMM_3 only when a stream is separated', () => {
  const P = load(), d = hydrated(P);
  let t = P.wmpgComTextDefaults(d);
  assert.deepStrictEqual(t.on, { WG_COMM_1: true, WG_COMM_2: false, WG_COMM_3: true }, 'mixed council/state → the council wording');
  assert.strictEqual(t.separated, 'paper & cardboard from commingled recycling');
  d.rooms[1].uses.forEach(u => Object.values(u.rates).forEach(x => x.src = 'state'));
  d.rooms[1].splits = [];
  t = P.wmpgComTextDefaults(d);
  assert.deepStrictEqual(t.on, { WG_COMM_1: false, WG_COMM_2: true, WG_COMM_3: false }, 'all state fallback → _2; nothing separated → no _3');
  assert.strictEqual(P.wmpgComRateScope([]), 'none');
});

test('§5 commercial sorting rows: the room’s own streams, the master’s black-body colours and 80L receptacle', () => {
  const P = load(), d = hydrated(P);
  const rows = P.wmpgComSortRows(d);
  assert.deepStrictEqual(rows.map(r => r[0]), ['General waste', 'Organics', 'Commingled recycling', 'Paper & cardboard'],
    'no library → the stream names; organics is generated (the café and office rates) so it is listed even before a bin is');
  assert.deepStrictEqual(rows.map(r => r[1]), ['black body with red lid', 'black body with lime green lid', 'black body with yellow lid', 'black body with light blue lid']);
  assert.ok(rows.every(r => r[2] === '80L bin'));
});

test('§5 bookmarks the master has and an older .dotx lacks are re-homed and reported, never dropped', () => {
  const P = load();
  const secs = { BM_Sec_WasteGen_Comm: '<t>', BM_Tbl2_DevSummaryComm: '<s>', BM_Sec_WasteGen_Comm_Text: '<x>', BM_Tbl1_DevSummaryResi: '<r>' };
  const old = P.wmpgTplRehome('<w:bookmarkStart w:name="BM_Sec_WasteGen_Comm_Text"/><w:bookmarkStart w:name="BM_Tbl1_DevSummaryResi"/>', secs);
  assert.strictEqual(old.sections.BM_Sec_WasteGen_Comm_Text, '<x><t>');
  assert.strictEqual(old.sections.BM_Tbl1_DevSummaryResi, '<r><s>');
  assert.ok(!('BM_Sec_WasteGen_Comm' in old.sections));
  assert.ok(/BM_Sec_WasteGen_Comm \/ BM_Tbl2_DevSummaryComm/.test(old.note));
  const master = P.wmpgTplRehome('w:name="BM_Sec_WasteGen_Comm" w:name="BM_Tbl2_DevSummaryComm"', secs);
  assert.deepStrictEqual(master.sections, secs);
  assert.strictEqual(master.note, '');
});

// ── §6 Job No. ──
test('§6 the Job No. fills a WMP Project ID still on the placeholder; a typed one stays', () => {
  const P = load();
  const base = () => ({ title: 'T', complianceSrc: null, rooms: [], cover: { source: '', received: '' }, tokens: {}, text: { off: {}, edit: {} } });
  assert.strictEqual(P.wmpgUpgradeDraft(Object.assign(base(), { projId: 'xxxPW' }), { projId: '651PW' }).projId, '651PW');
  assert.strictEqual(P.wmpgUpgradeDraft(Object.assign(base(), { projId: '' }), { projId: ' 651PW ' }).projId, '651PW');
  assert.strictEqual(P.wmpgUpgradeDraft(Object.assign(base(), { projId: '700PW' }), { projId: '651PW' }).projId, '700PW');
  assert.strictEqual(P.wmpgUpgradeDraft(Object.assign(base(), { projId: 'xxxPW' }), {}).projId, 'xxxPW');
});

// ── §7 wiring ──
test('§7 wiring: persisted in app_data, searchable, editable by staff on card + detail, prefilled into the swept tool', () => {
  const save = extractBlock(/^async function saveProjectToDB\(/).text;
  assert.ok(/projId: project\.projId \|\| null/.test(save), 'saved in app_data');
  assert.ok(/projId: \('projId' in ad\)/.test(extractBlock(/^async function loadProjectsFromDB\(/).text), 'restored, and a cleared number stays cleared');
  const rp = extractBlock(/^function renderProjects\(/).text;
  assert.ok(/p\.devType, p\.projId\]/.test(rp), 'search reads the job number');
  assert.ok(/projJobNoCardHtml\(p\)/.test(rp), 'the card shows it');
  assert.ok(/wmpgIsStaff\(\)/.test(extractBlock(/^function projJobNoCardHtml\(/).text), 'staff edit; others read');
  assert.ok(/getElementById\('detail-jobno'\)/.test(extractBlock(/^function openProjectDetail\(/).text));
  assert.ok(/id="detail-jobno"[^>]*onchange="projSetJobNo\(currentProjectId, this\.value\)"/.test(SOURCE));
  const sw = extractBlock(/^function wsSweptPrefillJobNo\(/).text;
  assert.ok(/getElementById\('proj-jobno'\)/.test(sw) && /fromProject !== '1'\) return/.test(sw), 'fills the swept title block’s field, never over a typed number');
  assert.ok(/wsSweptPrefillJobNo\(\)/.test(extractBlock(/^function wsInitSweptIframe\(/).text));
  assert.ok(/fresh\.projId = String\(p\.projId\)\.trim\(\)/.test(extractBlock(/^function wmpgRepull\(/).text), 're-pull picks it up too');
});

test('§7 wiring: the preview and the .docx read the same builders; commercial bookmarks fill only when there is a commercial room', () => {
  const tpl = extractBlock(/^function wmpgTplPayload\(/).text;
  const model = extractBlock(/^function wmpgDocModel\(/).text;
  ['wmpgComGenTable(d, room)', 'wmpgComDevSummary(d)', 'wmpgResDevSummary(d)', 'wmpgComSortRows(d)', 'wmpgCollectionSentence(d, r)', 'wmpgComTextDefaults(d).on'].forEach(f => {
    assert.ok(tpl.includes(f), '.docx uses ' + f);
    assert.ok(model.includes(f), 'preview uses ' + f);
  });
  assert.ok(/if \(!comRooms\.length\) add\('BM_Sec_WasteGen_Comm_Text', NA\);/.test(tpl), 'residential-only keeps the “Not applicable” fill');
  ['BM_Sec_WasteGen_Comm', 'BM_Tbl2_DevSummaryComm', 'BM_Tbl_SORT_COMM', 'BM_Sec_OTHERSORT_COMM', 'BM_Sec_StorageEquipment_Comm', 'BM_Sec_CollectionProcess_Comm']
    .forEach(bm => assert.ok(tpl.includes(`'${bm}'`), bm));
  assert.ok(/wmpgTplRehome\(xml, payload\.sections\)/.test(extractBlock(/^async function wmpgBuildTemplateBlob\(/).text), 'missing master bookmarks are re-homed at export');
  assert.ok(/genAll - allTotals\.GW/.test(tpl), 'diversion counts commercial volumes');
  // the Advice Memo's commercial bullet reads the commercial room's facts
  assert.ok(/tbIsCommercialSnippet\(r\) \? comCtx : memoCtx/.test(extractBlock(/^function advPayload\(/).text));
  // rates: the commercial uses are priced in the same pass as the residential rates
  assert.ok(/u\.rates = wmpgComRatesFor\(R, d, u\.use\)/.test(extractBlock(/^function wmpgApplyRates\(/).text));
});
