'use strict';
// ── SITE PREPARATION & CONSTRUCTION STAGES (C&D) ──
// The estimator is parametric and transparent: rates are a versioned JSON
// seed, every row carries its basis and source, an override survives
// re-estimation. §1 the Terrigal fixture (658PW, Central Coast) reproduced ·
// §2 the rules (tick, splits, diversion, overrides, prefill) · §3 the
// appendix renderers (preview nodes, .docx placement) · §4 wiring pins.
// Nothing is copied from index.html — every function is lifted by anchor.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock } = require('./extract.js');

const RATES = JSON.parse(/<script type="application\/json" id="cd-rates-seed">([\s\S]*?)<\/script>/.exec(SOURCE)[1].replace(/<\\\//g, '</'));

function load() {
  const code = [/^function tplEsc\(/, /^const WMPG_TPL_STYLE = /, /^function tplP\(/, /^function tplBullets\(/, /^function tplCaption\(/, /^function tplCell\(/, /^function tplTable\(/,
    /^function cdMaterials\(/, /^function cdMaterialLabel\(/, /^function cdCouncilProfile\(/, /^function cdEmptyMaterial\(/, /^function cdEmptyStage\(/, /^function cdRound\(/, /^function cdSplit\(/,
    /^function cdEstimateSitePrep\(/, /^function cdEstimateConstruction\(/, /^function cdFinish\(/, /^function cdDiverted\(/, /^function cdDiversionPct\(/, /^function cdApplyEstimate\(/,
    /^const CD_JOURNEY_TEMPLATES = /, /^const CD_RISK_TEMPLATES = /, /^function cdFacilitiesFor\(/, /^function cdFacilityName\(/, /^function cdPrefill\(/, /^function cdStageLabel\(/,
    /^function cdAppendixNodes\(/, /^function cdNodesXml\(/, /^function cdTplAppendixE\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function('cdRates', code + ';return { cdMaterials, cdCouncilProfile, cdEmptyStage, cdEmptyMaterial, cdEstimateSitePrep, cdEstimateConstruction, cdDiverted, cdDiversionPct, cdApplyEstimate, cdPrefill, cdAppendixNodes, cdNodesXml, cdTplAppendixE, cdFacilitiesFor };')(() => RATES);
}
const TERRIGAL_SP = { gfa_m2: 150, storeys: 1, yearBuilt: 1975, wall: 'brick_veneer', roof: 'tile', floor: 'slab', paving_m2: 60, roof_m2: null, trees: { small: 0, medium: 8, large: 0 }, ancillary: { septic: true, shed: false, pool: false }, excavation_m3: 150 };
const TERRIGAL_C = { gfa_m2: 450, storeys: 3, structure: 'rc_masonry', fitout: 'full', prefab: false };
const byKey = rows => Object.fromEntries(rows.map(r => [r.key, r]));

test('§1 Terrigal site preparation: the submitted table is reproduced — 12 bricks, 25 concrete, 150 excavation (30 retained), 20 garden, 6 residual, 12 timber; 97% diverted', () => {
  const C = load(); const prof = C.cdCouncilProfile('Central Coast Council');
  assert.equal(prof.id, 'central_coast'); assert.equal(prof.diversionTarget, 80);
  const rows = C.cdEstimateSitePrep(TERRIGAL_SP, RATES), m = byKey(rows);
  const want = { bricks: 12, concrete: 25, excavation: 150, garden: 20, residual: 6, timber_clean: 12 };
  Object.entries(want).forEach(([k, v]) => assert.ok(Math.abs(m[k].qty_m3 - v) <= v * 0.2, `${k}: ${m[k].qty_m3} vs submitted ${v} (±20%)`));
  assert.deepStrictEqual(Object.fromEntries(Object.keys(want).map(k => [k, m[k].qty_m3])), want, 'and in fact exactly, with the brief’s priors');
  assert.equal(m.excavation.reuse_m3, 30); assert.equal(m.excavation.recycleSeparated_m3, 120, '20% retained on site, the balance to a recycler');
  assert.equal(m.residual.landfill_m3, 6); assert.equal(m.concrete.recycleSeparated_m3, 25);
  assert.equal(m.asbestos.qty_m3, null); assert.equal(m.asbestos.note, 'TBC (survey)'); assert.equal(m.asbestos.under10m3, false, 'pre-1990: asbestos is TBC pending the survey — never a guessed volume');
  assert.equal(m.plasterboard.qty_m3, null, 'pre-1990 linings are not quantified as plasterboard');
  ['ceiling_tiles', 'ewaste', 'floor_coverings', 'fixtures', 'glass', 'hazardous', 'metals_ferrous', 'metals_nonferrous', 'mixed', 'plasterboard', 'tiles', 'timber_treated'].forEach(k => assert.equal(m[k].under10m3, true, k + ' ticked, as submitted'));
  assert.equal(m.other.under10m3, false, 'Other is never ticked by default');
  assert.ok(/roof 150 m² × 0\.06 \(tile roof\) = 9\.0 m³ < 10 → tick only/.test(m.tiles.basis), 'a minor stream says why it is a tick: ' + m.tiles.basis);
  assert.ok(/slab 150 m² × 0\.1 \+ paving 60 m² × 0\.12 \+ 1 ancillary × 3 m³ = 25\.2 → 25 m³/.test(m.concrete.basis), m.concrete.basis);
  assert.equal(C.cdDiversionPct(rows, prof), 97);
  assert.ok(rows.every(r => r.source === 'estimate' && r.rates === RATES.version), 'every row is an estimate stamped with the rates version');
});

test('§1 Terrigal construction: 10 timber, 6 plasterboard, 5 concrete, 4 metals, 12 mixed, 6 residual; 81% diverted', () => {
  const C = load(); const prof = C.cdCouncilProfile('Central Coast Council');
  const rows = C.cdEstimateConstruction(TERRIGAL_C, RATES), m = byKey(rows);
  const want = { timber_clean: 10, plasterboard: 6, concrete: 5, metals_ferrous: 4, mixed: 12, residual: 6 };
  Object.entries(want).forEach(([k, v]) => assert.equal(m[k].qty_m3, v, k));
  assert.equal(m.mixed.recycleUnseparated_m3, 12); assert.equal(C.cdDiverted(m.mixed, prof), 10, 'unseparated recycling counts at the council’s 80% recovery: 12 → 10, as submitted');
  assert.equal(rows.filter(r => r.qty_m3 != null).reduce((a, r) => a + r.qty_m3, 0), 43, '≈45 m³ per 450 m²');
  assert.equal(C.cdDiversionPct(rows, prof), 81);
  ['asbestos', 'bricks', 'excavation', 'garden', 'tiles', 'timber_treated'].forEach(k => assert.equal(m[k].under10m3, true, k + ' ticked, as submitted'));
  const shell = byKey(C.cdEstimateConstruction({ ...TERRIGAL_C, fitout: 'shell', prefab: true }, RATES));
  assert.ok(shell.plasterboard.qty_m3 < 6 && /× 0\.4 shell only × 0\.75 prefab/.test(shell.plasterboard.basis), 'shell + prefab reduce, and the basis says so');
});

test('§2 rules: a quantity under the threshold ticks (Residual always quantified), an override survives re-estimation, metals are always separated', () => {
  const C = load(); const prof = C.cdCouncilProfile('Nowhere Shire');
  assert.equal(prof.id, 'default', 'an unprofiled council gets the NSW default');
  const small = byKey(C.cdEstimateSitePrep({ ...TERRIGAL_SP, gfa_m2: 40, paving_m2: 0, ancillary: {}, trees: {}, excavation_m3: 0 }, RATES));
  assert.equal(small.concrete.qty_m3, null); assert.equal(small.concrete.under10m3, true, '4 m³ of slab → tick');
  assert.equal(small.residual.qty_m3, 2, 'residual is always a figure — the landfill line must exist');
  assert.equal(small.excavation.qty_m3, null, 'no excavation entered → nothing');
  const rec = C.cdEmptyStage('site_prep'); rec.inputs = TERRIGAL_SP;
  C.cdApplyEstimate(rec, C.cdEstimateSitePrep(rec.inputs, RATES), RATES);
  const br = rec.materials.find(m => m.key === 'bricks'); br.qty_m3 = 20; br.recycleSeparated_m3 = 20; br.source = 'override';
  C.cdApplyEstimate(rec, C.cdEstimateSitePrep({ ...rec.inputs, gfa_m2: 200 }, RATES), RATES);
  const br2 = rec.materials.find(m => m.key === 'bricks');
  assert.equal(br2.qty_m3, 20); assert.equal(br2.source, 'override'); assert.equal(br2.estimate.qty_m3, 16, 'the override stands; the fresh estimate rides alongside for the ↺');
  assert.equal(rec.materials.find(m => m.key === 'concrete').qty_m3, 30, 'estimate rows moved with the new GFA');
  assert.equal(rec.estimatedWith.version, RATES.version);
  assert.ok(C.cdMaterials().length === 20 && C.cdMaterials()[0].key === 'asbestos' && C.cdMaterials()[19].key === 'other', 'the Central Coast 20-row superset, in its order');
});

test('§2 prefill: journeys per key stream with facilities picked from the table, risks from the templates, a missing fact stays bracketed', () => {
  const C = load(); const prof = C.cdCouncilProfile('Central Coast Council');
  const rec = C.cdEmptyStage('site_prep'); rec.inputs = TERRIGAL_SP; C.cdApplyEstimate(rec, C.cdEstimateSitePrep(rec.inputs, RATES), RATES);
  const pre = C.cdPrefill(rec, { street: 'Maroomba Road', profile: prof, region: 'central_coast' }, RATES);
  assert.deepStrictEqual(pre.journeys.map(j => j.stream), ['Excavation material', 'Bricks, Concrete', 'Garden organics & trees & Timber (clean)']);
  assert.equal(pre.journeys[0].qty, 'Approx. 150 m³'); assert.equal(pre.journeys[0].diversion, '100%');
  assert.ok(/30 m³ reused for backfill/.test(pre.journeys[0].onsiteReuse) && /Maroomba Road/.test(pre.journeys[0].vehicleAccess));
  assert.ok(/Recycled Concrete Products, 18a Tathra Street, West Gosford NSW/.test(pre.journeys[1].offsite), 'destination from the facilities table');
  assert.ok(/Kariong Sand & Soil Supplies, Somersby NSW \(status TBC\)/.test(pre.journeys[0].offsite) || /Recycled Concrete Products/.test(pre.journeys[0].offsite), 'a TBC facility is marked as such');
  assert.equal(pre.risks.length, 6); assert.equal(pre.risks[0].residual, 'Low');
  assert.ok(pre.recycling.some(r => r.material === 'Bricks' && /Recycled Concrete/.test(r.recycler)) && !pre.recycling.some(r => r.material === 'Residual waste'), 'recycling rows for diverted streams only');
  const noStreet = C.cdPrefill(rec, { street: '', profile: prof, region: 'central_coast' }, RATES);
  assert.ok(/\[street\]/.test(noStreet.journeys[0].vehicleAccess), 'no street → a visible placeholder, never a guess');
  assert.ok(C.cdFacilitiesFor('plasterboard', 'central_coast', RATES)[0].name === 'REGYP' && C.cdFacilitiesFor('plasterboard', 'central_coast', RATES)[0].licenceNo === null, 'licence numbers stay null until verified');
});

test('§3 renderers: one node list feeds the preview and the .docx; the appendix lands under the master’s own heading', () => {
  const C = load(); const prof = C.cdCouncilProfile('Central Coast Council');
  const sp = C.cdEmptyStage('site_prep'); sp.inputs = TERRIGAL_SP; C.cdApplyEstimate(sp, C.cdEstimateSitePrep(sp.inputs, RATES), RATES); sp.description = 'Demolition of the dwelling'; sp.declarations.asbestosWHS = true; sp.sitePlanChecklist = { 0: true, 3: true };
  Object.assign(sp, C.cdPrefill(sp, { street: 'Maroomba Road', profile: prof, region: 'central_coast' }, RATES));
  const nodes = C.cdAppendixNodes({ site_prep: sp }, { rates: RATES, profile: prof });
  assert.equal(nodes[0].t, 'Appendix E — Construction and demolition waste');
  const mat = nodes.find(n => n.k === 'table' && n.header[0] === 'Material');
  assert.deepStrictEqual(mat.header, ['Material', '<10 m³', 'Volume', 'Reuse on site', 'Recycled (separated)', 'Recycled (unseparated)', 'Landfill', 'Diverted']);
  assert.deepStrictEqual(mat.rows.find(r => r[0] === 'Excavation material'), ['Excavation material', '', '150', '30', '120', '0', '0', '150']);
  assert.deepStrictEqual(mat.rows.find(r => r[0] === 'Asbestos'), ['Asbestos', '', 'TBC (survey)', '', '', '', '', '']);
  assert.deepStrictEqual(mat.rows.find(r => r[0] === 'Tiles'), ['Tiles', '✓', '', '', '', '', '', '']);
  assert.deepStrictEqual(mat.total, ['Total', '', '225', '30', '189', '0', '6', '219']);
  assert.ok(nodes.some(n => n.k === 'p' && /Diversion from landfill: 97% of quantified volume \(219 of 225 m³\) against Central Coast Council’s 80% target\./.test(n.t)));
  assert.ok(nodes.some(n => n.k === 'table' && n.header[0] === 'Touchpoint' && n.rows.length === 10), 'journey table: nine touchpoints + diversion');
  assert.ok(nodes.some(n => n.k === 'bullets' && n.items.length === 2 && n.items[0] === 'Areas to be excavated or cleared'));
  const xml = C.cdNodesXml(nodes);
  assert.ok(xml.includes('<w:pStyle w:val="ProWaste-Heading3"/>') && xml.includes('<w:tblStyle w:val="ProWaste-Table"/>') && xml.includes('Excavation material') && !xml.includes('Appendix E —'), 'the master’s own styles; the master keeps its own appendix heading');
  const MASTER = '<w:body><w:p><w:pPr><w:pStyle w:val="ProWaste-Appendices"/></w:pPr><w:r><w:t>Signage</w:t></w:r></w:p><w:p><w:r><w:t>signs</w:t></w:r></w:p>' +
    '<w:p><w:pPr><w:pStyle w:val="ProWaste-Appendices"/></w:pPr><w:r><w:t>Construction and d</w:t></w:r><w:r><w:t>emolition w</w:t></w:r><w:r><w:t>aste</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>The following table summarises…</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>placeholder table</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p/><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body>';
  const r = C.cdTplAppendixE(MASTER, xml);
  assert.ok(r.placed && !r.note);
  assert.ok(!r.xml.includes('placeholder table') && !r.xml.includes('The following table summarises'), 'the master’s placeholder body is replaced');
  assert.ok(r.xml.includes('emolition w') && r.xml.includes('signs') && r.xml.includes('<w:sectPr>'), 'the heading, the other appendix and the section end survive');
  assert.ok(r.xml.indexOf('Excavation material') > r.xml.indexOf('aste</w:t>') && r.xml.indexOf('Excavation material') < r.xml.indexOf('<w:sectPr>'));
  const miss = C.cdTplAppendixE('<w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body>', xml);
  assert.ok(!miss.placed && /NOT placed/.test(miss.note) && miss.xml.includes('<w:t>x</w:t>'), 'no heading → untouched, and the export says so');
});

test('§4 wiring: the record is server-authoritative, the form is staff-only, both renderers read the same nodes, the rates are a versioned seed', () => {
  assert.ok(/stages: project\.stages \|\| null/.test(extractBlock(/^async function saveProjectToDB\(/).text), 'app_data carries the stage records');
  assert.ok(/stages: ad\.stages \|\| prev\.stages \|\| null/.test(SOURCE), 'and they come back on load');
  const sec = extractBlock(/^function cdSectionHtml\(/).text;
  assert.ok(/if \(!wmpgIsStaff\(\)\) return '';/.test(sec) && /id="s-cd"/.test(sec), 'PWC staff only; no new routes');
  assert.ok(/\$\{cdSectionHtml\(d\)\}/.test(extractBlock(/^function wmpgRenderForm\(/).text));
  assert.ok(/cdAppendixNodes\(cdSt, \{ rates: cdRates\(\), profile: cdCouncilProfile\(d\.council\) \}\)/.test(extractBlock(/^function wmpgDocModel\(/).text), 'preview');
  assert.ok(/cdTplAppendixE\(xml, cdNodesXml\(cdAppendixNodes\(cdSt/.test(extractBlock(/^async function wmpgBuildTemplateBlob\(/).text), '.docx, same nodes');
  assert.ok(/^cd-rates-v1 \(\d{4}-\d{2}-\d{2}\)$/.test(RATES.version) && RATES.source.length > 20, 'the seed is versioned and says where its priors came from');
  assert.deepStrictEqual(RATES.density_kg_m3, { bricks: 800, concrete: 800, timber_clean: 200, metals_ferrous: 140 }, 'Central Coast densities for a later tonnage view');
  assert.ok(/m\.source = 'override'/.test(extractBlock(/^function cdSetMaterial\(/).text), 'a hand edit is tagged as one');
  assert.ok(/p\.stages = WMPG\.cdCache\.stages \|\| null;/.test(extractBlock(/^function cdPersist\(/).text) && /WMPG\.cdCache = null;/.test(extractBlock(/^async function openWmpGenerator\(/).text), 'one project object per open; only its stages are written back');
  assert.ok(/calibration: \{ contractorQuote: \[\], dockets: \[\] \}/.test(extractBlock(/^function cdEmptyStage\(/).text), 'calibration capture lives apart from estimates');
});

// ── §5–§8 Steps 2 and 3: facilities server-side; the Central Coast fillable form ──
const CCC_MAP = JSON.parse(/<script type="application\/json" id="cd-ccc-map">([\s\S]*?)<\/script>/.exec(SOURCE)[1].replace(/<\\\//g, '</'));
const CCC_FIELDS = require('./fixtures/ccc_rwmp_fields.json');   // page / name / type / rect of every field on the council's form — structure only

function loadCcc() {
  const code = [/^const WMPG_STREAMS = /, /^const WMPG_UNITS = /, /^const WMPG_FREQ = /, /^function wmpgFreqLabel\(/, /^function wmpgRoomQty\(/, /^function wmpgStreamWord\(/, /^function wmpgRoomMethod\(/,
    /^function cdMaterials\(/, /^function cdMaterialLabel\(/, /^function cdCouncilProfile\(/, /^function cdEmptyMaterial\(/, /^function cdEmptyStage\(/, /^function cdRound\(/, /^function cdSplit\(/,
    /^function cdEstimateSitePrep\(/, /^function cdEstimateConstruction\(/, /^function cdFinish\(/, /^function cdDiverted\(/, /^function cdDiversionPct\(/, /^function cdApplyEstimate\(/,
    /^const CD_JOURNEY_TEMPLATES = /, /^const CD_RISK_TEMPLATES = /, /^function cdFacilitiesFor\(/, /^function cdFacilityName\(/, /^function cdPrefill\(/, /^function cdStageLabel\(/,
    /^function cdCccValues\(/, /^async function cdCccFill\(/].map(p => extractBlock(p).text).join('\n\n');
  return new Function('cdRates', code + ';return { cdCouncilProfile, cdEmptyStage, cdEstimateSitePrep, cdEstimateConstruction, cdApplyEstimate, cdPrefill, cdCccValues, cdCccFill, cdMaterials };')(() => RATES);
}
// every name in the map, flattened
function mapNames(o, out) { out = out || []; if (o === CCC_MAP.sharedFields) return out; if (typeof o === 'string') { if (/^(Text Field|C\d|R_|Site|DA|DPs|Lots|Description|Buildings|Part_B|Supporting|Occupancy)/.test(o)) out.push(o); } else if (Array.isArray(o)) o.forEach(x => mapNames(x, out)); else if (o && typeof o === 'object') Object.values(o).forEach(x => mapNames(x, out)); return out; }
function terrigal(C) {
  const prof = C.cdCouncilProfile('Central Coast Council');
  const sp = C.cdEmptyStage('site_prep'); sp.inputs = TERRIGAL_SP; C.cdApplyEstimate(sp, C.cdEstimateSitePrep(sp.inputs, RATES), RATES);
  sp.description = 'Demolition of the existing dwelling and site clearing'; sp.declarations.asbestosWHS = true; sp.declarations.hazardousPOEO = true; sp.sitePlanChecklist = { 0: true, 3: true };
  sp.facilities = { generalWaste: 'Buttonderry Waste Management Facility', resourceRecovery: ['Recycled Concrete Products, West Gosford'] };
  Object.assign(sp, C.cdPrefill(sp, { street: 'Maroomba Road', profile: prof, region: 'central_coast' }, RATES));
  const c = C.cdEmptyStage('construction'); c.inputs = TERRIGAL_C; C.cdApplyEstimate(c, C.cdEstimateConstruction(c.inputs, RATES), RATES);
  c.description = 'Construction of a three-storey residential flat building'; Object.assign(c, C.cdPrefill(c, { street: 'Maroomba Road', profile: prof, region: 'central_coast' }, RATES));
  const d = { address: '12 Maroomba Road, Terrigal NSW 2260', council: 'Central Coast Council', daRef: 'DA/1234/2026', author: 'L. Sample', date: '17/09/2026', projId: '658PW', ver: 'Rev 1', devTypeText: 'Residential flat building',
    siteFigure: { lots: ['Lot 12 DP 12345'] }, unitTypes: [{ key: 'apt_2br' }],
    rooms: [{ name: 'Bin room', location: 'ground floor', alloc: { apt_2br: 6 }, collection: { provider: 'council', street: 'Maroomba Road', vehicle: 'Council side-loader' },
      bins: [{ stream: 'GW', sizeL: 240, qty: 3, colWk: 1, method: 'kerbside_shared' }, { stream: 'REC', sizeL: 240, qty: 2, colWk: 0.5, method: 'kerbside_shared' }, { stream: 'ORG', sizeL: 240, qty: 1, colWk: 1, method: 'kerbside_shared' }] }] };
  return { prof, stages: { site_prep: sp, construction: c }, d };
}

test('§5 the field map names only fields the council’s form carries — every text, tick and radio, on the page the map says', () => {
  const names = mapNames(CCC_MAP); const byName = Object.fromEntries(CCC_FIELDS.map(f => [f.name, f]));
  assert.ok(names.length > 600, 'the map covers the form: ' + names.length + ' names');
  const missing = names.filter(n => !byName[n]); assert.deepStrictEqual(missing, [], 'names not on the form');
  const dup = names.filter((n, i) => names.indexOf(n) !== i); assert.deepStrictEqual(dup, [], 'a field mapped twice would be written twice');
  // the grids: one text field per cell, one checkbox per row, in row order down the page
  ['site_prep', 'construction'].forEach(st => {
    const rows = CCC_MAP[st].grid.rows; const keys = Object.keys(rows);
    assert.equal(keys.length, 20, st + ': the 20-row superset');
    keys.forEach(k => { ['qty', 'reuse', 'sep', 'unsep', 'landfill', 'diverted'].forEach(c => assert.equal(byName[rows[k][c]].type, 'Text', `${st}.${k}.${c}`)); assert.equal(byName[rows[k].tick].type, 'CheckBox', `${st}.${k}.tick`); });
    const ys = keys.map(k => byName[rows[k].qty].rect[1]); assert.ok(ys.every((y, i) => i === 0 || y > ys[i - 1]), st + ': grid rows read top to bottom in material order');
    const pages = new Set(keys.map(k => byName[rows[k].qty].page)); assert.equal(pages.size, 1, st + ': the grid is one page');
    keys.forEach(k => { const r = rows[k]; const y = byName[r.qty].rect[1]; ['reuse', 'sep', 'unsep', 'landfill', 'diverted'].forEach(c => assert.ok(Math.abs(byName[r[c]].rect[1] - y) < 3, `${st}.${k}.${c} sits on its row`)); });
    assert.equal(byName[CCC_MAP[st].grid.pct].type, 'Text');
    [...CCC_MAP[st].declarations.asbestosWHS ? [CCC_MAP[st].declarations.asbestosWHS] : [], CCC_MAP[st].declarations.hazardousPOEO].forEach(n => assert.equal(byName[n].type, 'RadioButton', n));
    assert.equal(CCC_MAP[st].journeys.length, 3, 'three journey columns'); assert.equal(CCC_MAP[st].journeyRows.length, 10);
    CCC_MAP[st].checklist.items.forEach(n => assert.equal(byName[n].type, 'CheckBox'));
    assert.equal(CCC_MAP[st].checklist.items.length, CCC_MAP[st].checklist.labels.length);
  });
  assert.equal(CCC_MAP.occupancy.journeys.length, 3); assert.equal(CCC_MAP.occupancy.checklist.items.length, 12);
  [...CCC_MAP.p19.wasteDeclare, ...CCC_MAP.p19.generalDeclare].forEach(n => assert.equal(byName[n].type, 'RadioButton'));
  assert.equal(byName[CCC_MAP.p19.updateConstruction].type, 'CheckBox');
  assert.equal(CCC_MAP.site_prep.grid.pct, 'Text Field 101053'); assert.equal(CCC_MAP.construction.grid.pct, 'Text Field 1010132');
});

test('§6 cdCccValues reproduces the submitted Terrigal form: Part B grid and ticks, 97%; Part C grid, 81%; Part A, D and the page 19 declarations', () => {
  const C = loadCcc(); const { prof, stages, d } = terrigal(C);
  const v = C.cdCccValues({ map: CCC_MAP, stages, d, rates: RATES, profile: prof });
  // Part B — the values the submitted form carries, by the form's own field names
  const wantB = { 'Text Field 101013': '12', 'Text Field 101010110': '25', 'Text Field 101010113': '150', 'Text Field 101010130': '30', 'Text Field 101010147': '120', 'Text Field 101010116': '20', 'Text Field 101010123': '6', 'Text Field 101010190': '6', 'Text Field 101010124': '12', 'Text Field 101053': '97' };
  Object.entries(wantB).forEach(([n, x]) => assert.equal(v.text[n], x, n));
  ['C55', 'C56', 'C58', 'C59', 'C61', 'C62', 'C63', 'C64', 'C65', 'C66', 'C69', 'C70'].forEach(n => assert.equal(v.checks[n], true, 'site prep tick ' + n));
  ['C51', 'C57', 'C60', 'C67', 'C68'].forEach(n => assert.equal(v.checks[n], false, 'quantified / TBC rows are not ticked: ' + n));
  const asb = CCC_MAP.site_prep.grid.rows.asbestos; assert.equal(v.text[asb.qty], 'TBC', 'the narrow cell gets TBC; the survey note is in the appendix'); assert.equal(v.text[asb.landfill], 'TBC'); assert.equal(v.text[asb.diverted], '0');
  // Part C
  const wantC = { 'Text Field 10101086': '10', 'Text Field 10101074': '6', 'Text Field 1010102': '5', 'Text Field 10101056': '4', 'Text Field 10101068': '12', 'Text Field 10101073': '10', 'Text Field 10101080': '6', 'Text Field 10101084': '6', 'Text Field 1010132': '81' };
  Object.entries(wantC).forEach(([n, x]) => assert.equal(v.text[n], x, n));
  ['C72', 'C73', 'C75', 'C76', 'C77', 'C78', 'C79', 'C80', 'C81', 'C82', 'C84', 'C89', 'C90'].forEach(n => assert.equal(v.checks[n], true, 'construction tick ' + n));
  // Part A
  assert.equal(v.text.Site_address, '12 Maroomba Road, Terrigal NSW 2260'); assert.equal(v.text.DA_number, 'DA/1234/2026'); assert.equal(v.text.Lots, '12'); assert.equal(v.text.DPs, 'DP 12345');
  assert.ok(/Existing single-storey brick veneer dwelling, tile roof, concrete slab, approx\. 150 m² GFA; concrete driveway and paths; septic tank/.test(v.text.Buildings_on_site), v.text.Buildings_on_site);
  ['Site prep', 'Construction', 'Occupancy', 'C10', 'C12', 'C15'].forEach(n => assert.equal(v.checks[n], true, n)); assert.equal(v.checks.C9, false, 'C9 is the asbestos tick (TBC → unticked), whatever page 1 would like');
  assert.equal(v.radios['R_Site declaration 1'], 'yes'); assert.equal(v.radios['R_Site declaration 2'], 'yes');
  assert.ok(/Recycled Concrete Products/.test(v.text['Part_B_resource recovery']) && /Buttonderry/.test(v.text.Part_B_general_waste));
  // journeys: three columns, the record's three site-prep journeys, capture+consolidation joined into the form's one row
  const j0 = CCC_MAP.site_prep.journeys[0]; assert.equal(v.text[j0.stream], 'Excavation material'); assert.equal(v.text[j0.qty], 'Approx. 150 m³'); assert.equal(v.text[j0.recovery], '100%');
  assert.ok(v.text[j0.captureConsolidation].includes('; ') && /Maroomba Road/.test(v.text[j0.vehicleAccess]));
  assert.ok(/658PW Rev 1 — Appendix E \(site preparation stage\)/.test(v.text['Supporting evidence']));
  assert.equal(v.checks.C18, true); assert.equal(v.checks.C19, false); assert.equal(v.checks.C21, true, 'site plan checklist from the record');
  // Part D — from the WMP itself
  const O = CCC_MAP.occupancy;
  assert.ok(/Residential flat building: 6 dwellings; 3 × 240L general waste, 2 × 240L commingled recycling, 1 × 240L organics\./.test(v.text[O.description]), v.text[O.description]);
  assert.equal(v.text[O.journeys[0].stream], 'Residual materials & waste (red lid)'); assert.equal(v.text[O.journeys[0].qty], '720 L/week');
  assert.equal(v.text[O.journeys[1].stream], 'Commingled recycling (yellow lid)'); assert.equal(v.text[O.journeys[1].qty], '240 L/week', 'fortnightly 2 × 240 = 240 L/week');
  assert.ok(/wheels bins to the Maroomba Road kerb/.test(v.text[O.journeys[0].transferToCollection]) && /Council side-loader via Maroomba Road/.test(v.text[O.journeys[0].vehicleAccess]));
  assert.equal(v.text[O.journeys[0].offsite], 'Central Coast Council landfill'); assert.equal(v.text[O.journeys[2].offsite], 'Central Coast Council organics processing (compost)');
  assert.ok(O.checklist.items.every(n => v.checks[n] === true), 'the occupancy site plan is the WMP’s Appendix A — every item shown');
  assert.equal(v.text[O.responsibilities[0][0]], 'Owners corporation'); assert.ok(/Kerbside collection of general waste \(weekly\), commingled recycling \(fortnightly\), organics \(weekly\)/.test(v.text[O.responsibilities[3][1]]));
  // Page 19
  assert.equal(v.text['Site_address 2'], 'L. Sample, Pro Waste Consultants Pty Ltd'); assert.equal(v.text['DA_number 2'], '17/09/2026');
  ['R_waste declare 1', 'R_waste declare 2', 'R_waste declare 3', 'R_general declare 1', 'R_general declare 2', 'R_general declare 3'].forEach(n => assert.equal(v.radios[n], 'yes'));
  assert.equal(v.checks.C49, false, 'construction is in this plan — no "will be updated" tick'); assert.equal(v.checks.C53, false);
  assert.deepStrictEqual(v.notes, ['C9 left unticked — ' + CCC_MAP.sharedFields.C9], 'the council’s form shares C9 between page 1 and the asbestos tick — stated, never hidden');
  assert.deepStrictEqual(CCC_MAP.p1.completed.site_prep, ['C10', 'C11'], 'so page 1 does not claim it');
  // every name written is on the form
  const byName = new Set(CCC_FIELDS.map(f => f.name));
  [...Object.keys(v.text), ...Object.keys(v.checks), ...Object.keys(v.radios)].forEach(n => assert.ok(byName.has(n), 'written but not on the form: ' + n));
  // site prep only: Part C blank, page 19 says construction will follow
  const v2 = C.cdCccValues({ map: CCC_MAP, stages: { site_prep: stages.site_prep }, d, rates: RATES, profile: prof });
  assert.equal(v2.text['Text Field 10101086'], ''); assert.equal(v2.checks.C72, false); assert.equal(v2.checks.C49, true); assert.equal(v2.checks.Construction, false);
  // a fourth journey is reported, never dropped silently
  const s4 = JSON.parse(JSON.stringify(stages)); s4.site_prep.journeys.push({ stream: 'Metals', qty: '', generation: 'x' });
  assert.ok(C.cdCccValues({ map: CCC_MAP, stages: s4, d, rates: RATES, profile: prof }).notes.some(n => /Site preparation: 1 journey\(s\) beyond the form's three columns/.test(n)));
});

test('§7 cdCccFill writes the values into the PDF and reports every field the PDF lacks by name (pdf-lib)', async t => {
  let PDF = null; try { PDF = require('pdf-lib'); } catch (e) { try { PDF = require(require('path').join(process.env.PDF_LIB_DIR || '/nonexistent', 'pdf-lib')); } catch (e2) {} }
  if (!PDF) { t.skip('pdf-lib not installed here'); return; }
  const C = loadCcc();
  // a small form with the same field kinds the council form uses
  const doc = await PDF.PDFDocument.create(); const page = doc.addPage([400, 400]); const form = doc.getForm();
  form.createTextField('Site_address').addToPage(page, { x: 20, y: 340, width: 200, height: 20 });
  form.createTextField('Text Field 101013').addToPage(page, { x: 20, y: 300, width: 60, height: 20 });
  form.createCheckBox('C55').addToPage(page, { x: 20, y: 260, width: 14, height: 14 });
  form.createCheckBox('C51').addToPage(page, { x: 40, y: 260, width: 14, height: 14 }); form.getCheckBox('C51').check();
  const rg = form.createRadioGroup('R_Site declaration 1'); rg.addOptionToPage('Choice1', page, { x: 20, y: 220, width: 14, height: 14 }); rg.addOptionToPage('Choice2', page, { x: 40, y: 220, width: 14, height: 14 });
  const blank = await doc.save();
  const r = await C.cdCccFill(PDF, blank, { text: { 'Site_address': '12 Maroomba Road', 'Text Field 101013': '12', 'Text Field 999': 'x' }, checks: { C55: true, C51: false, C777: true }, radios: { 'R_Site declaration 1': 'yes', 'R_nope': 'yes' }, notes: [] });
  assert.deepStrictEqual(r.missing, ['Text Field 999', 'C777', 'R_nope'], 'fields the PDF lacks are named, in order, never silently skipped');
  const out = await PDF.PDFDocument.load(r.bytes); const f2 = out.getForm();
  assert.equal(f2.getTextField('Site_address').getText(), '12 Maroomba Road'); assert.equal(f2.getTextField('Text Field 101013').getText(), '12');
  assert.equal(f2.getCheckBox('C55').isChecked(), true); assert.equal(f2.getCheckBox('C51').isChecked(), false, 'a pre-ticked box the record does not tick is cleared');
  assert.equal(f2.getRadioGroup('R_Site declaration 1').getSelected(), 'Choice1', 'the option is read from the PDF (Choice1 here, /0 or Yes elsewhere)');
});

test('§8 wiring: facilities and profiles load from Supabase with the seed as the offline fallback; the form fill is staff UI gated on the council profile’s renderers', () => {
  const rates = extractBlock(/^function cdRates\(/).text;
  assert.ok(/CD\.remote/.test(rates) && /facilitiesSource: r\.facilities\.length \? 'supabase' : 'seed'/.test(rates), 'the merged rates say where the facilities came from');
  const load = extractBlock(/^async function cdLoadRemote\(/).text;
  assert.ok(/sb\.from\('cd_facilities'\)/.test(load) && /sb\.from\('cd_council_profiles'\)/.test(load) && /licenceNo: x\.licence_no \|\| null/.test(load) && /CD\.remote = null; CD\.remoteError/.test(load), 'both tables, snake → camel, a failed load falls back to the seed and keeps the reason');
  const save = extractBlock(/^async function cdSaveFacility\(/).text;
  assert.ok(/sb\.from\('cd_facilities'\)\.upsert\(/.test(save) && /onConflict: 'id'/.test(save) && !/licence_no/.test(save), 'a facility is saved server-side; the licence number is never typed in from the form — verified against the EPA register later');
  assert.ok(/2026-09-17-cd-facilities\.sql/.test(save), 'a missing table names the migration');
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'sql', '2026-09-17-cd-facilities.sql'), 'utf8');
  ['cd_facilities', 'cd_council_profiles'].forEach(tname => { assert.ok(new RegExp(`grant select, insert, update, delete on public\\.${tname} to authenticated`, 'i').test(sql), tname + ': GRANT, not just RLS'); assert.ok(new RegExp(`alter table public\\.${tname} enable row level security`, 'i').test(sql), tname + ': RLS on'); });
  assert.ok(/is_staff/.test(sql), 'writes are staff-only');
  const open = extractBlock(/^async function openWmpGenerator\(/).text;
  assert.ok(/if \(wmpgIsStaff\(\)\) await cdLoadRemote\(\);/.test(open), 'loaded per open, staff only');
  const sec = extractBlock(/^function cdSectionHtml\(/).text;
  assert.ok(/prof\.renderers\.includes\('pdf'\) \?/.test(sec) && /onclick="cdExportCcc\(\)"/.test(sec) && /cdUploadCccForm\(event\)/.test(sec), 'the PDF fill appears only for a council whose profile names the pdf renderer');
  assert.ok(/facilitiesSource === 'supabase'/.test(sec) && /run sql\/2026-09-17-cd-facilities\.sql/.test(sec), 'the section states the facilities source');
  const exp = extractBlock(/^async function cdExportCcc\(/).text;
  assert.ok(/await cdLoadPdfLib\(\)/.test(exp) && /cdCccValues\(\{ map, stages, d, rates: cdRates\(\), profile: cdCouncilProfile\(d\.council\) \}\)/.test(exp) && /r\.missing\.length/.test(exp), 'pure values → fill → the missing fields are shown, never swallowed');
  assert.ok(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf-lib\/1\.17\.1\/pdf-lib\.min\.js/.test(extractBlock(/^function cdLoadPdfLib\(/).text), 'pdf-lib is loaded on demand from cdnjs, like jsPDF');
  const get = extractBlock(/^async function cdGetCccForm\(/).text;
  assert.ok(/sb\.storage\.from\('pwc-templates'\)\.download\(CD_CCC_FORM_SUPABASE\)/.test(get) && /idbGetPdf\(CD_CCC_FORM_IDB_KEY\)/.test(get), 'the blank form comes from the templates bucket, else the device cache');
  assert.ok(Array.isArray(RATES.touchpoints) && RATES.touchpoints.length === 9 && RATES.touchpoints.map(t => t[0]).includes('transferToCollection'), 'nine touchpoints, as the council’s form rows them');
});
