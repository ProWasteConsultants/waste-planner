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
  assert.ok(nodes.some(n => n.k === 'table' && n.header[0] === 'Touchpoint' && n.rows.length === 9), 'journey table: eight touchpoints + diversion');
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
