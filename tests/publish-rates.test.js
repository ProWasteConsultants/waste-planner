'use strict';
// ── PUBLISH RATES: ONE SOURCE OF TRUTH FOR GENERATION RATES ──────────────
// WastePlanner's tables → waste_rates.json on R2 → the free calculator on
// go.wasteplanner.au, the prowaste.au embed, the in-app calculator and the
// WMP generator. The build/validate module is shared by the edge function,
// the landing-page backup script and this file, so what is tested here is
// what runs.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SOURCE, extractBlock, extractSrcdocBlock, decodeSrcdoc } = require('./extract.js');

const ROOT = path.join(__dirname, '..');
const FN_DIR = path.join(ROOT, 'supabase', 'functions', 'publish-rates');
const FN = fs.readFileSync(path.join(FN_DIR, 'index.ts'), 'utf8');
const mod = () => import(path.join(FN_DIR, 'rates.mjs'));
const r2 = () => import(path.join(FN_DIR, 'r2.mjs'));
const backup = () => import(path.join(ROOT, 'scripts', 'landing-rates-backup.mjs'));

// The in-app calculator IS the landing page's calculator ("Pro Waste Bin
// Calculator v2"), so its decoded srcdoc stands in for the landing page.
const CALC = decodeSrcdoc('calc-iframe').html;

const councils = [
  { state: 'VIC', value: 'whittlesea', label: 'City of Whittlesea', published: true },
  { state: 'VIC', value: 'darebin_draft', label: 'Darebin (setting up)', published: false },
  { state: 'NSW', value: 'city_of_sydney', label: 'City of Sydney', published: true },
];
const resRows = (state, cv, rows) => Object.entries(rows).flatMap(([ut, s]) =>
  Object.entries(s).map(([stream, l]) => ({ state, council_value: cv, unit_type: ut, stream, l_per_week: l })));
const VIC = resRows('VIC', null, {
  townhouse: { GW: 120, REC: 120, ORG: 0, GLS: 0 }, apt_1br: { GW: 80, REC: 80, ORG: 0, GLS: 0 },
  apt_2br: { GW: 100, REC: 100, ORG: 0, GLS: 0 }, apt_3br: { GW: 120, REC: 120, ORG: 107, GLS: 108 } });
const NSW = resRows('NSW', null, {
  townhouse: { GW: 140, REC: 140 }, apt_1br: { GW: 80, REC: 80 }, apt_2br: { GW: 100, REC: 100 }, apt_3br: { GW: 120, REC: 120 } });
const fixture = () => JSON.parse(JSON.stringify({
  councils,
  resRates: [...VIC, ...NSW,
    { state: 'VIC', council_value: 'whittlesea', unit_type: 'apt_3br', stream: 'GW', l_per_week: 125 },
    { state: 'VIC', council_value: 'darebin_draft', unit_type: 'apt_3br', stream: 'GW', l_per_week: 999 }],
  comRates: [
    { state: 'VIC', council_value: null, use_code: 'cafe', stream: 'GW', rate: 240, unit_value: 100, unit: 'L/Day/100m2' },
    { state: 'VIC', council_value: 'whittlesea', use_code: 'cafe', stream: 'GW', rate: 210, unit_value: 100, unit: 'L/Day/100m2' },
    { state: 'NSW', council_value: 'city_of_sydney', use_code: 'childcare', stream: 'ORG', rate: 15, unit_value: 100, unit: 'L/Day/100m2' },
    { state: 'NSW', council_value: null, use_code: 'invented_use', stream: 'GW', rate: 5, unit_value: 1, unit: 'L/Week' },
  ],
  version: '2026-10-19T00:00:00Z',
}));

test('resMethod: a council\'s LIVE stepped table is flagged for the free calculator; drafts and state tables are not', async () => {
  const { buildRates, validateRates, resMethodSummary } = await mod();
  const table = (status, steps) => JSON.stringify({ type: 'table', status, source: 'Appendix A', table: { basis: 'dwellings', steps } });
  const nb = [{ min: 3, max: 3, bins: { GW: { n: 1, sizeL: 240, cycle: 'W' } } }, { min: 100, max: 100, bins: { GW: { n: 34, sizeL: 240, cycle: 'W' } } }];
  assert.deepStrictEqual(resMethodSummary(table('live', nb)), { type: 'table', source: 'Appendix A', min: 3, max: 100 });
  assert.equal(resMethodSummary(table('draft', nb)), null, 'a draft has not been checked against the document');
  assert.equal(resMethodSummary(JSON.stringify({ type: 'rate', status: 'live' })), null);
  assert.equal(resMethodSummary(table('live', [{ min: 3, max: null, bins: { GW: { n: 1, sizeL: 240 } } }])).max, null, 'open-ended top band');
  const f = fixture();
  f.resMethods = [
    { state: 'NSW', council_value: 'city_of_sydney', value: table('live', nb) },
    { state: 'VIC', council_value: 'whittlesea', value: table('draft', nb) },
    { state: 'NSW', council_value: null, value: table('live', nb) },
  ];
  const { json, skipped } = buildRates(f);
  assert.deepStrictEqual(json.COUNCIL_PROFILES['NSW|city_of_sydney'].resMethod, { type: 'table', source: 'Appendix A', min: 3, max: 100 });
  assert.ok(!('resMethod' in json.COUNCIL_PROFILES['VIC|whittlesea']));
  assert.ok(skipped.some(x => /state-level table/.test(x.reason)), 'a state table is reported, not published');
  assert.deepStrictEqual(validateRates(json), []);
  json.COUNCIL_PROFILES['NSW|city_of_sydney'].resMethod = { type: 'hybrid', min: 0, max: 'x', source: 3 };
  assert.equal(validateRates(json).filter(e => /resMethod/.test(e)).length, 4, 'every bad field is named');
  assert.ok(/"waste_meta"/.test(FN) && /residential_method/.test(FN), 'the function reads the methods');
  assert.ok(/could not be read/.test(FN), 'and reports, rather than hides, a failed read');
});

test('build: the brief\'s exact shape, from the tables', async () => {
  const { buildRates, validateRates } = await mod();
  const { json } = buildRates(fixture());
  assert.deepStrictEqual(Object.keys(json), ['version', 'PROFILES', 'COUNCIL_PROFILES', 'COUNCILS', 'USES']);
  assert.strictEqual(json.version, '2026-10-19T00:00:00Z');
  assert.deepStrictEqual(json.PROFILES.VIC.resRates.apt_3br, { GW: 120, REC: 120, ORG: 107, GLS: 108 });
  assert.deepStrictEqual(json.PROFILES.VIC.comRates.cafe, { GW: { rate: 240, unitValue: 100, unit: 'L/Day/100m2' } });
  assert.deepStrictEqual(json.COUNCIL_PROFILES['VIC|whittlesea'],
    { resRates: { apt_3br: { GW: 125 } }, comRates: { cafe: { GW: { rate: 210, unitValue: 100, unit: 'L/Day/100m2' } } } });
  assert.deepStrictEqual(json.COUNCILS.VIC, [{ value: 'whittlesea', label: 'City of Whittlesea' }]);
  assert.deepStrictEqual(json.USES, {
    cafe: { label: 'Cafe', metric: 'm² (NLA)', defaultDays: 7 },
    childcare: { label: 'Childcare', metric: 'm² (NLA)', defaultDays: 5 } }, 'every published use is described, built-ins from COMM');
  assert.deepStrictEqual(validateRates(json), []);
});

test('build: a typed-in use publishes under USES; a council\'s own list is marked comList "own"', async () => {
  const { buildRates, validateRates } = await mod();
  const f = fixture();
  f.councils = f.councils.map(c => c.value === 'city_of_sydney' ? { ...c, com_own: true } : c);
  f.uses = [{ use_code: 'invented_use', label: 'Nail salon', metric: 'Seats (no.)', default_days: 6 },
    { use_code: 'cafe', label: 'Café', metric: null, default_days: null }];
  f.comRates.push({ state: 'VIC', council_value: 'whittlesea', use_code: 'nail_bar', stream: 'GW', rate: 1, unit_value: 1, unit: 'L/Week' });
  f.uses.push({ use_code: 'nail_bar', label: 'Nail bar', metric: null, default_days: null });
  const { json, skipped } = buildRates(f);
  assert.deepStrictEqual(json.USES.invented_use, { label: 'Nail salon', metric: 'Seats (no.)', defaultDays: 6 });
  assert.deepStrictEqual(json.USES.nail_bar, { label: 'Nail bar', metric: 'Units (no.)', defaultDays: 7 }, 'no measure typed → read off the unit');
  assert.deepStrictEqual(json.USES.cafe, { label: 'Café', metric: 'm² (NLA)', defaultDays: 7 }, 'the table\'s label wins, blanks fall back to COMM');
  assert.deepStrictEqual(json.PROFILES.NSW.comRates.invented_use, { GW: { rate: 5, unitValue: 1, unit: 'L/Week' } });
  assert.ok(!skipped.some(x => /invented_use/.test(x.what)));
  assert.strictEqual(json.COUNCIL_PROFILES['NSW|city_of_sydney'].comList, 'own');
  assert.strictEqual(json.COUNCIL_PROFILES['VIC|whittlesea'].comList, undefined, 'not ticked → overrides, as before');
  assert.deepStrictEqual(validateRates(json), []);
  // own with no commercial rows: nothing to mark, the state list applies
  const g = fixture(); g.councils = g.councils.map(c => ({ ...c, com_own: true }));
  g.comRates = g.comRates.filter(r => r.council_value !== 'city_of_sydney');
  assert.ok(!('comList' in (buildRates(g).json.COUNCIL_PROFILES['NSW|city_of_sydney'] || {})));
});

test('validate: USES entries and comList are checked; a file without USES still passes', async () => {
  const { buildRates, validateRates } = await mod();
  const f = fixture(); f.uses = [{ use_code: 'invented_use', label: 'Nail salon', metric: 'Seats (no.)', default_days: 6 }];
  const json = buildRates(f).json;
  const old = JSON.parse(JSON.stringify(json)); delete old.USES; delete old.PROFILES.NSW.comRates;
  assert.deepStrictEqual(validateRates(old), [], 'a pre-USES file validates');
  const bad = JSON.parse(JSON.stringify(json));
  bad.USES.invented_use = { label: '', metric: '', defaultDays: 9 };
  bad.USES['Bad Code'] = { label: 'x', metric: 'y', defaultDays: 7 };
  bad.COUNCIL_PROFILES['VIC|whittlesea'].comList = 'mine';
  const noUse = JSON.parse(JSON.stringify(json)); delete noUse.USES.invented_use;
  const errs = validateRates(bad).concat(validateRates(noUse));
  const has = re => assert.ok(errs.some(e => re.test(e)), 'expected ' + re + ' in\n' + errs.join('\n'));
  has(/^USES · invented_use: label is blank/); has(/^USES · invented_use: input measure/); has(/defaultDays 9 must be a whole number 1–7/);
  has(/^USES · Bad Code: code must be/); has(/VIC\|whittlesea: comList "mine" must be "own"/);
  has(/^NSW · commercial invented_use: not a use the calculator knows, and USES does not describe it/);
});

test('calculator: a council\'s own list replaces the state uses; USES join COMM; a saved unknown use is kept', () => {
  const ctx = { RATES_REMOTE: null, isObj: o => o && typeof o === 'object' && !Array.isArray(o), out: null };
  const P = { NSW: { streams: ['GW', 'REC'], resRates: {}, comRates: { office: { GW: { rate: 10, unitValue: 100, unit: 'L/Day/100m2' } }, cafe: { GW: { rate: 1, unitValue: 100, unit: 'L/Day/100m2' } } } } };
  const nail = { GW: { rate: 5, unitValue: 100, unit: 'L/Day/100m2' } };
  ctx.PROFILES = P;
  ctx.COUNCIL_PROFILES = { 'NSW|nb': { comList: 'own', comRates: { nail_salon: nail, cafe: { GW: { rate: 2, unitValue: 100, unit: 'L/Day/100m2' } } } }, 'NSW|rw': { comRates: { cafe: { GW: { rate: 3, unitValue: 100, unit: 'L/Day/100m2' } } } } };
  ctx.COMM = { cafe: { label: 'Cafe', metric: 'm² (NLA)', defaultDays: 7 } };
  let council = 'nb';
  ctx.g = id => ({ value: id === 'state' ? 'NSW' : council });
  vm.createContext(ctx);
  const fn = name => extractSrcdocBlock('calc-iframe', new RegExp('^function ' + name + '\\(')).text;
  vm.runInContext([/function deepMerge\(.*/.exec(CALC)[0], /function getActiveProfile\(.*/.exec(CALC)[0],
    fn('ownComList'), fn('applyRemoteUses'), fn('comUseKeep')].join('\n'), ctx);
  const own = vm.runInContext('getActiveProfile()', ctx);
  assert.deepStrictEqual(Object.keys(own.comRates).sort(), ['cafe', 'nail_salon'], 'office (state only) is not offered');
  council = 'rw';
  const inh = vm.runInContext('getActiveProfile()', ctx);
  assert.deepStrictEqual(Object.keys(inh.comRates).sort(), ['cafe', 'office'], 'no flag → overrides merge over the state list');
  assert.strictEqual(inh.comRates.cafe.GW.rate, 3);
  assert.strictEqual(P.NSW.comRates.nail_salon, undefined, 'the state profile is never mutated');
  // a saved project's typed-in use survives before the file arrives …
  assert.strictEqual(vm.runInContext("comUseKeep('nail_salon')", ctx), 'nail_salon');
  assert.ok(ctx.COMM.nail_salon.pending);
  assert.strictEqual(vm.runInContext("comUseKeep('<x>')", ctx), null, 'junk is not a use');
  // … and the file's USES fill it in; built-ins are never replaced
  vm.runInContext("applyRemoteUses({USES:{nail_salon:{label:'Nail salon',metric:'Seats (no.)',defaultDays:6},cafe:{label:'CHANGED',metric:'x',defaultDays:1}}})", ctx);
  assert.deepStrictEqual({ ...ctx.COMM.nail_salon }, { label: 'Nail salon', metric: 'Seats (no.)', defaultDays: 6, remote: true });
  assert.strictEqual(ctx.COMM.cafe.label, 'Cafe');
  // wiring
  assert.ok(CALC.includes('const j=await r.json();applyRemoteUses(j);return j;'), 'every load of the file applies USES');
  assert.ok(CALC.includes('const u=(c&&comUseKeep(c.use))||first;'), 'restore keeps an unknown saved use');
  assert.ok(CALC.includes("label=\"Rated for ${escAttr(locLabel())}\""), 'the picker puts the scope\'s rated uses first');
});

test('WMP: a council\'s own list replaces the state rates; USES name the use', () => {
  const ctx = { WMPG_COM_ORDER: ['GW', 'REC'], WMPG_COM_USES: { cafe: { label: 'Cafe', metric: 'm² (NLA)' } } };
  vm.createContext(ctx);
  vm.runInContext(['wmpgCouncilOverride', 'wmpgComRatesFor', 'wpComUsesMerge'].map(n => extractBlock(new RegExp('^function ' + n + '\\(')).text).join('\n'), ctx);
  const R = { PROFILES: { NSW: { comRates: { cafe: { GW: { rate: 10, unitValue: 100, unit: 'L/Day/100m2' }, REC: { rate: 4, unitValue: 100, unit: 'L/Day/100m2' } } } } },
    COUNCILS: { NSW: [{ value: 'nb', label: 'Northern Beaches' }] },
    COUNCIL_PROFILES: { 'NSW|nb': { comList: 'own', comRates: { cafe: { GW: { rate: 12, unitValue: 100, unit: 'L/Day/100m2' } } } } },
    USES: { nail_salon: { label: 'Nail salon', metric: 'Seats (no.)', defaultDays: 6 } } };
  ctx.R = R;
  const r = vm.runInContext("wmpgComRatesFor(R, { state: 'NSW', council: 'Northern Beaches' }, 'cafe')", ctx);
  assert.deepStrictEqual(Object.keys(r), ['GW'], 'REC is a state figure the council\'s own list does not give');
  assert.strictEqual(r.GW.src, 'council');
  delete R.COUNCIL_PROFILES['NSW|nb'].comList;
  assert.deepStrictEqual(Object.keys(vm.runInContext("wmpgComRatesFor(R, { state: 'NSW', council: 'Northern Beaches' }, 'cafe')", ctx)), ['GW', 'REC'], 'overrides still merge');
  assert.strictEqual(vm.runInContext('wpComUsesMerge(R)', ctx), 1);
  assert.strictEqual(ctx.WMPG_COM_USES.nail_salon.label, 'Nail salon');
  assert.ok(SOURCE.includes('WMPG.remote = await r.json(); wpComUsesMerge(WMPG.remote);'));
});

test('build: streams are the residential streams the state rates; a council adding one lists the union', async () => {
  const { buildRates } = await mod();
  const { json } = buildRates(fixture());
  assert.deepStrictEqual(json.PROFILES.VIC.streams, ['GW', 'REC', 'ORG', 'GLS']);
  assert.deepStrictEqual(json.PROFILES.NSW.streams, ['GW', 'REC'], 'no ORG/GLS figure → not a column');
  assert.deepStrictEqual(json.COUNCIL_PROFILES['NSW|city_of_sydney'].streams, ['GW', 'REC', 'ORG'],
    'deepMerge replaces arrays, so the council list must be complete');
  assert.strictEqual(json.COUNCIL_PROFILES['VIC|whittlesea'].streams, undefined, 'nothing extra → inherits');
});

test('build: draft councils and their rates never reach the public file; leftovers are reported', async () => {
  const { buildRates } = await mod();
  const { json, skipped } = buildRates(fixture());
  const text = JSON.stringify(json);
  assert.ok(!text.includes('darebin_draft') && !text.includes('999'), 'draft council absent, rates included');
  assert.ok(skipped.some(s => s.key === 'VIC|darebin_draft' && /draft/.test(s.reason)));
  assert.ok(skipped.some(s => /invented_use/.test(s.what) && /no row for/.test(s.reason)), 'an unknown use is named, not silently dropped');
  const orphan = buildRates({ ...fixture(), resRates: [...VIC, { state: 'VIC', council_value: 'gone', unit_type: 'apt_1br', stream: 'GW', l_per_week: 1 }] });
  assert.ok(orphan.skipped.some(s => s.key === 'VIC|gone' && /not.*councils table|no council/.test(s.reason)));
  assert.ok(!('VIC|gone' in orphan.json.COUNCIL_PROFILES));
});

test('build: deterministic — the same tables in another order publish byte-identically', async () => {
  const { buildRates } = await mod();
  const f = fixture(), g = fixture();
  g.resRates.reverse(); g.comRates.reverse(); g.councils = [...g.councils].reverse();
  assert.strictEqual(JSON.stringify(buildRates(f).json), JSON.stringify(buildRates(g).json));
});

test('validate: bad values block the publish, each one named', async () => {
  const { buildRates, validateRates } = await mod();
  const bad = fixture();
  bad.resRates.find(r => r.state === 'VIC' && r.unit_type === 'apt_1br' && r.stream === 'GW').l_per_week = -5;
  bad.resRates.find(r => r.state === 'VIC' && r.unit_type === 'apt_2br' && r.stream === 'REC').l_per_week = null;
  bad.comRates[0].unit = 'L/Day/m2';
  bad.comRates[1].unit_value = 0;
  bad.resRates = bad.resRates.filter(r => !(r.state === 'NSW' && r.unit_type === 'townhouse'));
  const errs = validateRates(buildRates(bad).json);
  const has = re => assert.ok(errs.some(e => re.test(e)), 'expected an error matching ' + re + ' in\n' + errs.join('\n'));
  has(/^VIC · apt_1br · GW: -5 must be 0 or more/);
  has(/^VIC · apt_2br · REC: no figure \(blank\)/);
  has(/^VIC · commercial cafe · GW: unit "L\/Day\/m2" is not one the calculator understands/);
  has(/^VIC\|whittlesea · commercial cafe · GW · unitValue: 0 must be greater than 0/);
  has(/^NSW: residential "townhouse" missing/);
});

test('validate: council keys, values, streams and the shape itself', async () => {
  const { validateRates } = await mod();
  const ok = { version: '2026-10-19T00:00:00Z', PROFILES: {}, COUNCIL_PROFILES: {}, COUNCILS: {} };
  assert.deepStrictEqual(validateRates(ok), []);
  const errs = validateRates({ ...ok, extra: 1, version: 'yesterday',
    PROFILES: { VIC: { streams: [], resRates: {} }, XX: { streams: ['GW'], resRates: {} } },
    COUNCIL_PROFILES: { 'vic|whittlesea': {}, 'VIC|unlisted': {} },
    COUNCILS: { VIC: [{ value: 'Bad Value', label: 'x' }, { value: 'a', label: '' }, { value: 'a', label: 'A' }] } });
  const has = re => assert.ok(errs.some(e => re.test(e)), 'expected ' + re + ' in\n' + errs.join('\n'));
  has(/top-level keys must be exactly/); has(/version must be an ISO timestamp/);
  has(/^VIC: streams list is missing or empty/); has(/unknown state "XX"/);
  has(/key "vic\|whittlesea" is not STATE\|value/); has(/"VIC\|unlisted" has rates but is not in COUNCILS VIC/);
  has(/value "Bad Value" must be lower-case/); has(/label is blank/); has(/"a" is listed twice/);
});

test('validate: the calculator\'s own built-in data passes (the allowed units cover what is in use)', async () => {
  const { validateRates } = await mod();
  const { evalLiteral, findLiteral } = await backup();
  const P = evalLiteral(findLiteral(CALC, 'PROFILES').text);
  const CP = evalLiteral(findLiteral(CALC, 'COUNCIL_PROFILES').text);
  const CB = evalLiteral(findLiteral(CALC, 'COUNCILS_BY_STATE').text);
  const errs = validateRates({ version: '2026-10-19T00:00:00Z', PROFILES: P, COUNCIL_PROFILES: CP, COUNCILS: CB });
  // Units, uses, streams and council keys all pass. What fails is the brief's
  // own completeness rule: every built-in profile but VIC carries an empty
  // resRates, so a state published from tables in that state is refused
  // until its residential rates are entered (0 where none are published).
  assert.deepStrictEqual(errs.filter(e => !/^[A-Z]+: residential "\w+" missing/.test(e)), []);
  assert.deepStrictEqual([...new Set(errs.map(e => e.split(':')[0]))], ['NSW', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'], 'every built-in state but VIC');
});

test('mirror: COMM_META is the calculator\'s COMM — keys, labels, measures and days', async () => {
  const { COMM_KEYS, COMM_META } = await mod();
  const { evalLiteral, findLiteral } = await backup();
  const C = evalLiteral(findLiteral(CALC, 'COMM').text);
  assert.deepStrictEqual([...COMM_KEYS].sort(), Object.keys(C).sort());
  Object.keys(C).forEach(k => assert.deepStrictEqual(COMM_META[k], { label: C[k].label, metric: C[k].metric, defaultDays: C[k].defaultDays }, k));
});

test('mirror: the admin table\'s unit list is COM_UNITS', async () => {
  const { COM_UNITS } = await mod();
  const m = /const RDB_COM_UNITS = (\[[\s\S]*?\]);/.exec(SOURCE);
  assert.deepStrictEqual(new Function('return ' + m[1])(), COM_UNITS);
});

test('mirror: COM_UNITS covers every unit weeklyL has a branch for', async () => {
  const { COM_UNITS } = await mod();
  const src = /function weeklyL\([\s\S]*?\n}/.exec(CALC)[0];
  const weeklyL = new Function(src + ';return weeklyL;')();
  // every allowed unit gives a non-zero, formula-driven volume
  COM_UNITS.forEach(u => assert.ok(weeklyL(100, 7, { rate: 10, unitValue: 100, unit: u }) > 0, u));
  assert.strictEqual(weeklyL(200, 5, { rate: 350, unitValue: 100, unit: 'L/Week/100m2' }), 700, 'L/Week/100m2: m² × rate / 100, no days');
});

test('diff: a council dropped from the live file is named; figures are counted', async () => {
  const { buildRates, diffRates } = await mod();
  const prev = buildRates(fixture()).json;
  const f = fixture(); f.councils = f.councils.map(c => c.value === 'whittlesea' ? { ...c, published: false } : c);
  f.resRates.find(r => r.state === 'VIC' && r.unit_type === 'townhouse' && r.stream === 'GW').l_per_week = 130;
  const d = diffRates(prev, buildRates(f).json);
  assert.deepStrictEqual(d.removedCouncils, [{ key: 'VIC|whittlesea', label: 'City of Whittlesea' }]);
  assert.ok(d.figures.changed >= 1 && d.figures.removed >= 1);
  assert.strictEqual(diffRates(null, prev).first, true);
});

test('r2: SigV4 matches AWS\'s published S3 example signatures', async () => {
  const { s3Authorization, sha256Hex } = await r2();
  const creds = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' };
  const get = await s3Authorization({ method: 'GET', path: '/test.txt', ...creds, headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9',
    'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z' } });
  assert.match(get, /Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41$/);
  const put = await s3Authorization({ method: 'PUT', path: '/test$file.text', ...creds, headers: { host: 'examplebucket.s3.amazonaws.com',
    date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-content-sha256': await sha256Hex('Welcome to Amazon S3.'),
    'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY' } });
  assert.match(put, /Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd$/);
});

test('r2: the client writes JSON with no-cache, and reads a missing object as null', async () => {
  const { r2Client } = await r2();
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, init }); return { ok: init.method !== 'GET', status: init.method === 'GET' ? 404 : 200, text: async () => '' }; };
  const c = r2Client({ accountId: 'acct', accessKeyId: 'k', secretAccessKey: 's', bucket: 'rates' }, fake);
  assert.strictEqual(await c.getText('waste_rates.json'), null);
  await c.putJson('waste_rates.json', '{}');
  const put = calls[1];
  assert.strictEqual(put.url, 'https://acct.r2.cloudflarestorage.com/rates/waste_rates.json');
  assert.strictEqual(put.init.headers['content-type'], 'application/json');
  assert.strictEqual(put.init.headers['cache-control'], 'no-cache');
  assert.match(put.init.headers.authorization, /SignedHeaders=cache-control;content-type;host;x-amz-content-sha256;x-amz-date/);
});

test('edge function: staff only, validate before any write, removals confirmed, prev kept before replace', () => {
  const body = FN.slice(FN.indexOf('Deno.serve('));
  const at = s => { const i = body.indexOf(s); assert.ok(i >= 0, 'missing: ' + s); return i; };
  assert.ok(at('sbUser.auth.getUser()') < at('if (!me?.is_staff)'));
  assert.ok(!/SERVICE_ROLE/.test(FN), 'reads run as the calling staff member');
  assert.ok(at('if (!me?.is_staff)') < at('buildRates('));
  const firstPut = at('r2.putJson(');
  assert.ok(at('if (errors.length) return') < at('r2.getText(LIVE_KEY)'), 'validation before R2 is touched');
  assert.ok(at('if (unconfirmed.length)') < firstPut, 'removal guard before any write');
  assert.ok(at('if (dryRun) return') < firstPut);
  assert.ok(at('r2.putJson(PREV_KEY, prevText)') < at('r2.putJson(LIVE_KEY, text)'), 'rollback copy first');
  assert.match(FN, /const LIVE_KEY = "waste_rates\.json";/);
  assert.match(FN, /const PREV_KEY = "waste_rates\.prev\.json";/);
  ['councils', 'res_rates', 'com_rates'].forEach(t => assert.match(body, new RegExp(`readAll\\(\\(\\) => sbUser\\.from\\("${t}"\\)`), t + ' paged'));
  assert.match(body, /select\("state,value,label,published,com_own"\)/, 'the published and own-list flags are read, not assumed');
  assert.match(body, /readAll\(\(\) => sbUser\.from\("com_uses"\)\.select\("use_code,label,metric,default_days"\)/, 'the use list is read for USES');
  assert.match(body, /buildRates\(\{ councils, resRates, comRates, uses, resMethods: resMethods as never\[\] \}\)/);
  assert.ok(!/R2_SECRET|R2_ACCESS/.test(SOURCE), 'no R2 credential in the frontend');
});

test('platform: the publish button, the report, and the council listing toggle', () => {
  assert.ok(SOURCE.includes('onclick="rdbPublish()"') && SOURCE.includes('⬆ Publish rates to calculator</button>'));
  assert.ok(!SOURCE.includes('Publish to live'), 'one name for the action everywhere');
  assert.ok(SOURCE.includes('functions/v1/publish-rates'));
  assert.ok(SOURCE.includes('id="rdb-council-published"') && SOURCE.includes('onchange="rdbSetCouncilPublished(this.checked)"'));
  const report = new Function(extractBlock(/^function rdbPublishReport\(/).text + ';return rdbPublishReport;')();
  const inv = report({ ok: false, code: 'invalid', errors: ['VIC · apt_1br · GW: -5 must be 0 or more', 'x <script>'], skipped: [] });
  assert.match(inv, /Not published — 2 problems/); assert.match(inv, /-5 must be 0 or more/); assert.match(inv, /live file is unchanged/);
  assert.ok(!inv.includes('<script>'), 'escaped');
  const ok = report({ ok: true, version: '2026-10-19T01:02:03Z', bytes: 2048, counts: { states: 2, councils: 3, councilProfiles: 1, residentialFigures: 32, commercialFigures: 4 },
    changes: { first: false, figures: { changed: 1, added: 0, removed: 0 }, addedCouncils: [], removedCouncils: [] }, skipped: [{ key: 'VIC|d', what: 'w', reason: 'draft' }] });
  assert.match(ok, /Published — version 2026-10-19T01:02:03Z/); assert.match(ok, /3 councils listed/); assert.match(ok, /1 figure changed/);
  assert.match(ok, /1 row left out/); assert.match(ok, /waste_rates\.prev\.json/);
  const rem = report({ ok: false, code: 'removals', removed: [{ key: 'VIC|whittlesea', label: 'City of Whittlesea' }] });
  assert.match(rem, /would be dropped/); assert.match(rem, /City of Whittlesea \(VIC\|whittlesea\)/);
});

test('SQL: published flag backfilled true for every existing council, drafts by default after', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql', '2026-10-19-publish-rates.sql'), 'utf8');
  const i = s => { const k = sql.indexOf(s); assert.ok(k >= 0, 'missing: ' + s); return k; };
  assert.ok(i('add column if not exists published boolean') < i('set published = true where published is null'));
  assert.ok(i('set published = true where published is null') < i('set default false'));
  i('set not null');
});

test('backup script: rebuilds the three blocks with the page\'s own merge rule, and the result runs', async () => {
  const { rebuildPage, evalLiteral, findLiteral } = await backup();
  const { buildRates } = await mod();
  const rates = buildRates(fixture()).json;
  const { html, report } = rebuildPage(CALC, rates);
  const plain = o => JSON.parse(JSON.stringify(o));   // vm objects carry another realm's prototype
  const P = evalLiteral(findLiteral(html, 'PROFILES').text);
  const CP = evalLiteral(findLiteral(html, 'COUNCIL_PROFILES').text);
  const CB = evalLiteral(findLiteral(html, 'COUNCILS_BY_STATE').text);
  const old = evalLiteral(findLiteral(CALC, 'PROFILES').text);
  assert.deepStrictEqual(plain(P.VIC), rates.PROFILES.VIC, 'published state replaces the built-in one');
  assert.deepStrictEqual(plain(P.QLD), plain(old.QLD), 'unpublished state keeps its built-in profile');
  assert.deepStrictEqual(plain(CP['VIC|whittlesea']), rates.COUNCIL_PROFILES['VIC|whittlesea']);
  assert.ok('NSW|randwick' in CP && report.councilProfiles.builtInOnly.includes('NSW|randwick'), 'built-in-only kept and reported');
  assert.ok(CB.VIC.some(c => c.value === 'city_of_melbourne'), 'never removes a council');
  assert.ok(report.councils.builtInOnly.includes('VIC|city_of_melbourne'));
  assert.ok(Object.keys(CB).includes('TAS'), 'empty built-in states survive');
  assert.match(html, /\/\/ Offline backup regenerated from waste_rates\.json version 2026-10-19T00:00:00Z/);
  // rerun: one stamp, not two; idempotent
  const again = rebuildPage(html, rates).html;
  assert.strictEqual(again, html);
  // every script block still parses
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m => new vm.Script(m[1]));
  // and the page's own resolver now reads the published figure offline
  const ctx = { RATES_REMOTE: null, PROFILES: P, COUNCIL_PROFILES: CP, isObj: o => o && typeof o === 'object' && !Array.isArray(o),
    g: id => ({ value: id === 'state' ? 'VIC' : 'whittlesea' }) };
  vm.createContext(ctx);
  vm.runInContext(/function deepMerge\(.*/.exec(CALC)[0] + '\n' + /function getActiveProfile\(.*/.exec(CALC)[0] + '\n' + /function ownComList\(.*/.exec(CALC)[0] + '\nthis.out=getActiveProfile();', ctx);
  assert.strictEqual(ctx.out.resRates.apt_3br.GW, 125);
  assert.strictEqual(ctx.out.resRates.apt_3br.ORG, 107);
});

test('backup script: refuses a bad export, an unknown use, and an ambiguous page', async () => {
  const { rebuildPage } = await backup();
  const { buildRates } = await mod();
  const rates = buildRates(fixture()).json;
  const neg = JSON.parse(JSON.stringify(rates)); neg.PROFILES.VIC.resRates.apt_1br.GW = -1;
  assert.throws(() => rebuildPage(CALC, neg), /fails validation/);
  const noCafe = CALC.replace(/\n\s*cafe:\s*\{label:"Cafe"[^\n]*/, '');
  const bare = JSON.parse(JSON.stringify(rates)); delete bare.USES.cafe;
  assert.throws(() => rebuildPage(noCafe, bare), /does not list in COMM and USES does not describe: cafe/);
  assert.throws(() => rebuildPage(CALC + '\n<script>const PROFILES={};</script>', rates), /exactly one "const PROFILES=\{"/);
});

test('backup script: uses the export describes are added to the page\'s COMM, once, and the page reports its runtime', async () => {
  const { rebuildPage, evalLiteral, findLiteral } = await backup();
  const { buildRates } = await mod();
  const f = fixture(); f.uses = [{ use_code: 'invented_use', label: 'Nail salon', metric: 'Seats (no.)', default_days: 6 }];
  const rates = buildRates(f).json;
  const { html, report } = rebuildPage(CALC, rates);
  const C = evalLiteral(findLiteral(html, 'COMM').text);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.invented_use)), { label: 'Nail salon', metric: 'Seats (no.)', defaultDays: 6 });
  assert.strictEqual(C.cafe.label, 'Cafe', 'built-ins untouched');
  assert.deepStrictEqual(report.usesAdded, ['invented_use']);
  // resTableOf is the landing page's reader of resMethod; the in-app
  // calculator standing in here gets its tables from the platform instead.
  assert.deepStrictEqual(report.runtime, { applyRemoteUses: true, ownComList: true, resTableOf: false });
  assert.strictEqual(rebuildPage(html, rates).html, html, 'idempotent');
  const noCafe = CALC.replace(/\n\s*cafe:\s*\{label:"Cafe"[^\n]*/, '');
  assert.strictEqual(evalLiteral(findLiteral(rebuildPage(noCafe, rates).html, 'COMM').text).cafe.label, 'Cafe', 'a page missing a published use gets it from USES');
  const old = CALC.replace('function applyRemoteUses(', 'function applyRemoteUsesX(');
  assert.strictEqual(rebuildPage(old, rates).report.runtime.applyRemoteUses, false);
  [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].forEach(m => new vm.Script(m[1]));
});

test('SQL: own-list flag defaults off for every council; use measure and days are optional', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'sql', '2026-10-19-council-commercial-lists.sql'), 'utf8');
  const i = s => { const k = sql.indexOf(s); assert.ok(k >= 0, 'missing: ' + s); return k; };
  assert.ok(i('add column if not exists com_own boolean') < i('set com_own = false where com_own is null'));
  i('alter column com_own set default false'); i('alter column com_own set not null');
  i('add column if not exists metric text'); i('add column if not exists default_days integer');
  i('check (default_days is null or default_days between 1 and 7)');
});

test('admin: the commercial table types a use in, removes a use, copies the state list, and sets the own-list flag', () => {
  assert.ok(SOURCE.includes('<option value="__typed">+ type a new use…</option>'));
  assert.ok(SOURCE.includes('id="rdb-com-own" onchange="rdbSetComOwn(this.checked)"'));
  assert.ok(SOURCE.includes("onclick=\"rdbDeleteComUse('${cgbEsc(r.use_code)}')\""));
  assert.ok(SOURCE.includes('onclick="rdbComCopyState()"'));
  const own = extractBlock(/^async function rdbSetComOwn\(/).text;
  assert.ok(own.includes(".from('councils').update({ com_own: !!on })"));
  const save = extractBlock(/^async function rdbSaveCom\(/).text;
  assert.ok(save.indexOf('rdbComCollect()') < save.indexOf("from('com_rates').delete()"), 'edits are read off the inputs first');
});
