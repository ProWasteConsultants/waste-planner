'use strict';
// ── Plan slots: replace, per-stage plans (staff), revision freshness ─────────
// A project's plan can be replaced from the Design tab (toolbar, drop, or the
// Documents grid) without losing the placed work under it; PWC staff get one
// plan + one layer state per C&D stage; and a re-issued plan saved under the
// SAME file name refreshes every device (gate 4) because the revision is the
// content hash, not the name. Everything below is extracted from index.html.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, SOURCE } = require('./extract.js');

const BLOCKS = [
  ['WP_PLAN_STAGES',     /^const WP_PLAN_STAGES = \[/],
  ['wpPlanStages',       /^function wpPlanStages\(\)/],
  ['wpPlanStage',        /^function wpPlanStage\(/],
  ['wpPlanStageLabel',   /^function wpPlanStageLabel\(/],
  ['wpPlanSlot',         /^function wpPlanSlot\(/],
  ['wpPlanMeta',         /^function wpPlanMeta\(/],
  ['wpPlanMetaSet',      /^function wpPlanMetaSet\(/],
  ['wpPlanCacheStale',   /^function wpPlanCacheStale\(/],
  ['wsStagePack',        /^function wsStagePack\(/],
  ['wsStageDraft',       /^function wsStageDraft\(/],
  ['wsPlanPlacedCount',  /^function wsPlanPlacedCount\(/],
  ['wsPlanReplaceNote',  /^function wsPlanReplaceNote\(/],
  ['wsPlanLoadedKey',    /^function wsPlanLoadedKey\(/],
];
const E = loadEngine({ blocks: BLOCKS });

// ── §1 slots: occupancy is the legacy slot, stages are suffixed ─────────────
test('occupancy keeps the legacy keys, so every existing project still finds its plan', () => {
  const s = E.wpPlanSlot('p1', 'occupancy', 'u1');
  assert.equal(s.idbKey, 'p1', 'IDB key is the bare project id, as it always was');
  assert.equal(s.cloudPath, 'u1/p1.pdf', 'cloud path is {uid}/{projectId}.pdf, as it always was');
  assert.deepEqual(E.wpPlanSlot('p1', undefined, 'u1'), s, 'no stage means occupancy');
  assert.deepEqual(E.wpPlanSlot('p1', 'nonsense', 'u1'), s, 'an unknown stage never invents a slot');
});

test('each C&D stage has its own slot, independent of the occupancy plan', () => {
  const sp = E.wpPlanSlot('p1', 'site_prep', 'u1');
  const co = E.wpPlanSlot('p1', 'construction', 'u1');
  assert.equal(sp.idbKey, 'p1:stage:site_prep');
  assert.equal(sp.cloudPath, 'u1/p1.site_prep.pdf');
  assert.equal(co.cloudPath, 'u1/p1.construction.pdf');
  const keys = new Set([E.wpPlanSlot('p1', 'occupancy', 'u1').idbKey, sp.idbKey, co.idbKey]);
  assert.equal(keys.size, 3, 'three stages, three distinct caches — replacing one never touches another');
  assert.equal(E.wsPlanLoadedKey('p1', 'occupancy'), 'p1', 'the session marker for occupancy is the project id (legacy readers set it to null)');
  assert.notEqual(E.wsPlanLoadedKey('p1', 'site_prep'), E.wsPlanLoadedKey('p1', 'construction'));
});

test('stage labels and the registry', () => {
  assert.deepEqual(E.wpPlanStages(), ['occupancy', 'site_prep', 'construction']);
  assert.equal(E.wpPlanStageLabel('site_prep'), 'Site preparation');
  assert.equal(E.wpPlanStageLabel('construction'), 'Construction');
  assert.equal(E.wpPlanStageLabel('occupancy'), 'Occupancy');
});

// ── §2 metadata on the project record ───────────────────────────────────────
test('occupancy metadata lives on pdf_name / pdf_rev; stage metadata under stage_plans', () => {
  const p = { id: 'p1', pdf_name: 'A101.pdf' };
  assert.deepEqual(E.wpPlanMeta(p, 'occupancy'), { pdf_name: 'A101.pdf', pdf_rev: null }, 'a pre-revision record still reads');
  assert.equal(E.wpPlanMeta(p, 'site_prep'), null, 'no stage plan recorded');
  E.wpPlanMetaSet(p, 'site_prep', { pdf_name: 'DEMO-01.pdf', pdf_rev: 'abc' });
  assert.deepEqual(p.stage_plans, { site_prep: { pdf_name: 'DEMO-01.pdf', pdf_rev: 'abc' } });
  assert.deepEqual(E.wpPlanMeta(p, 'site_prep'), { pdf_name: 'DEMO-01.pdf', pdf_rev: 'abc' });
  assert.equal(p.pdf_name, 'A101.pdf', 'setting a stage plan never touches the occupancy plan');
  E.wpPlanMetaSet(p, 'occupancy', { pdf_name: 'A101-B.pdf', pdf_rev: 'def' });
  assert.equal(p.pdf_rev, 'def');
  assert.deepEqual(p.stage_plans.site_prep, { pdf_name: 'DEMO-01.pdf', pdf_rev: 'abc' }, 'and the reverse');
  E.wpPlanMetaSet(p, 'site_prep', null);
  assert.equal(E.wpPlanMeta(p, 'site_prep'), null, 'cleared');
  assert.equal(E.wpPlanMeta(null, 'occupancy'), null);
});

// ── §3 freshness (gate 4) ───────────────────────────────────────────────────
test('a same-named re-issue is stale by revision — the case the name check missed', () => {
  const cached = { name: 'A101.pdf', rev: 'r1' };
  assert.equal(E.wpPlanCacheStale(cached, { pdf_name: 'A101.pdf', pdf_rev: 'r1' }), false, 'same bytes: fresh');
  assert.equal(E.wpPlanCacheStale(cached, { pdf_name: 'A101.pdf', pdf_rev: 'r2' }), true, 'same name, new revision: STALE');
  assert.equal(E.wpPlanCacheStale({ name: 'A101.pdf' }, { pdf_name: 'A101.pdf', pdf_rev: 'r2' }), true, 'a cache with no stamp is refetched once the record has one');
});

test('records that predate the stamp fall back to the name check, exactly as before', () => {
  assert.equal(E.wpPlanCacheStale({ name: 'old.pdf' }, { pdf_name: 'new.pdf', pdf_rev: null }), true);
  assert.equal(E.wpPlanCacheStale({ name: 'same.pdf' }, { pdf_name: 'same.pdf', pdf_rev: null }), false);
  assert.equal(E.wpPlanCacheStale({ name: 'x.pdf' }, null), false, 'no record: the cache is all there is');
  assert.equal(E.wpPlanCacheStale(null, { pdf_name: 'x.pdf', pdf_rev: 'r' }), false, 'nothing cached: nothing to be stale');
});

test('the freshness stamp travels in app_data both ways, so no schema change is needed', () => {
  const load = SOURCE.slice(SOURCE.indexOf('async function loadProjectsFromDB()'), SOURCE.indexOf('async function saveProjectToDB('));
  const save = SOURCE.slice(SOURCE.indexOf('async function saveProjectToDB('), SOURCE.indexOf('async function deleteProjectFromDB('));
  for (const src of [load, save]) {
    assert.ok(/pdf_rev:/.test(src), 'pdf_rev carried');
    assert.ok(/stage_plans:/.test(src), 'stage_plans carried');
  }
  const store = SOURCE.slice(SOURCE.indexOf('async function storeProjectPdf('), SOURCE.indexOf('async function loadProjectPdf('));
  assert.ok(store.includes('const rev = await wpPlanRev(buf)') && store.includes('wpPlanMetaSet(p, slot.stage, { pdf_name: name, pdf_rev: rev })'),
    'storing a plan always stamps its revision on the record');
  assert.ok(store.includes('saveProjectToDB(p)'), 'and pushes the stamp so other devices see it');
  const loadOne = SOURCE.slice(SOURCE.indexOf('async function loadProjectPdf('), SOURCE.indexOf('async function removeProjectPdf('));
  assert.ok(loadOne.includes('wpPlanCacheStale(rec, meta)'), 'loading compares by the pure freshness rule');
});

// ── §4 stage state: pack / draft ────────────────────────────────────────────
test('wsStagePack lifts exactly the per-stage fields and defaults the rest', () => {
  assert.deepEqual(E.wsStagePack(undefined), { layoutData: {}, sweptByPage: {}, currentPage: 1, scale: '', paper: '' });
  const packed = E.wsStagePack({ layoutData: { 1: { bins: [1] } }, sweptByPage: { 1: { paths: [] } }, currentPage: 3, scale: '200', paper: '420,297', calcTargets: [1, 2], extra: true });
  assert.deepEqual(packed, { layoutData: { 1: { bins: [1] } }, sweptByPage: { 1: { paths: [] } }, currentPage: 3, scale: '200', paper: '420,297' },
    'the calculator targets and everything else are occupancy facts, never parked per stage');
});

test('occupancy live: the draft is unchanged at the top level, parked stages go under `stages`', () => {
  const base = { ts: 1, projectId: 'p1', layoutData: { 1: { bins: [{}] } }, sweptByPage: {}, currentPage: 1, scale: '100', paper: '420,297', calcTargets: [1] };
  const park = { site_prep: { layoutData: { 2: { rooms: [{}] } }, sweptByPage: {}, currentPage: 2, scale: '200', paper: '' } };
  const d = E.wsStageDraft(base, 'occupancy', park, null);
  assert.deepEqual(d.layoutData, base.layoutData, 'occupancy stays where every existing reader looks');
  assert.deepEqual(d.calcTargets, [1]);
  assert.equal(d.stage, 'occupancy');
  assert.deepEqual(Object.keys(d.stages), ['site_prep']);
  assert.equal(d.stages.site_prep.currentPage, 2);
  const none = E.wsStageDraft(base, 'occupancy', {}, null);
  assert.equal(none.stages, undefined, 'no parked stages, no key');
});

test('a stage live: its state goes under `stages`, occupancy comes back from the park', () => {
  const live = { ts: 2, projectId: 'p1', layoutData: { 1: { zones: [{}, {}] } }, sweptByPage: {}, currentPage: 1, scale: '500', paper: '', calcTargets: [9] };
  const park = { occupancy: { layoutData: { 3: { bins: [{}, {}, {}] } }, sweptByPage: { 3: { paths: [{}] } }, currentPage: 3, scale: '100', paper: '420,297' } };
  const d = E.wsStageDraft(live, 'construction', park, null);
  assert.deepEqual(d.layoutData, park.occupancy.layoutData, 'top level is OCCUPANCY, not the stage being drawn');
  assert.equal(d.scale, '100');
  assert.equal(d.currentPage, 3);
  assert.deepEqual(d.stages.construction.layoutData, live.layoutData, 'the live stage is saved under its own key');
  assert.equal(d.stages.construction.scale, '500', 'scale is per stage');
  assert.deepEqual(d.calcTargets, [9], 'shared facts pass straight through');
  assert.equal(d.stage, 'construction');
});

test('a stage live with no parked occupancy reads the last saved draft — never blanks the layout', () => {
  const live = { layoutData: { 1: { zones: [{}] } }, sweptByPage: {}, currentPage: 1, scale: '', paper: '' };
  const saved = { layoutData: { 1: { bins: [{}, {}] } }, sweptByPage: {}, currentPage: 1, scale: '200', paper: '420,297', stages: { site_prep: { layoutData: {} } } };
  const d = E.wsStageDraft(live, 'site_prep', {}, saved);
  assert.deepEqual(d.layoutData, saved.layoutData, 'occupancy from the fallback');
  assert.equal(d.scale, '200');
  assert.deepEqual(d.stages.site_prep.layoutData, live.layoutData);
  const blank = E.wsStageDraft(live, 'site_prep', {}, null);
  assert.deepEqual(blank.layoutData, {}, 'with nothing to read there is genuinely nothing — but the stage never masquerades as occupancy');
  assert.deepEqual(blank.stages.site_prep.layoutData, live.layoutData);
});

// ── §5 replace: what is kept, and the note that says so ─────────────────────
test('wsPlanPlacedCount counts every array on every page slot plus swept paths', () => {
  const layout = { 1: { bins: [{}, {}], rooms: [{}], chutes: [], equip: [{}], zones: [{}] }, 2: { bins: [{}], callouts: [{}, {}] } };
  const swept = { 1: { paths: [{}, {}], active: 0 }, 2: { paths: [{}] } };
  assert.deepEqual(E.wsPlanPlacedCount(layout, swept), { placed: 8, paths: 3 });
  assert.deepEqual(E.wsPlanPlacedCount({}, {}), { placed: 0, paths: 0 });
  assert.deepEqual(E.wsPlanPlacedCount(undefined, undefined), { placed: 0, paths: 0 });
});

test('the replace note states what was kept, the scale to check, and where the old plan went', () => {
  const n = E.wsPlanReplaceNote('A101-B.pdf', { placed: 14, paths: 2 }, '200', '420,297');
  assert.ok(n.startsWith('Plan replaced with A101-B.pdf.'));
  assert.ok(n.includes('14 placed items and 2 swept paths kept at their page and position'), n);
  assert.ok(n.includes('check they still sit on the linework'), 'the user is told to check alignment — nothing re-fits');
  assert.ok(n.includes('Scale stays 1:200 @ A3'), 'the scale is per stage, not per plan, and is named');
  assert.ok(n.includes('Documents'), 'the previous plan is recoverable and the note says where');
  const one = E.wsPlanReplaceNote('x.pdf', { placed: 1, paths: 0 }, '', '');
  assert.ok(one.includes('1 placed item kept') && !one.includes('swept path'), 'singular, and nothing about paths when there are none');
  assert.ok(one.includes('No scale set yet.'));
  const empty = E.wsPlanReplaceNote('x.pdf', { placed: 0, paths: 0 }, '100', '210,297');
  assert.ok(!empty.includes('kept at'), 'nothing placed, nothing claimed kept');
  assert.ok(empty.includes('1:100 @ A4'));
});

// ── §6 wiring conventions ───────────────────────────────────────────────────
test('every way a PDF becomes a plan goes through wsSetProjectPlan', () => {
  const loadFile = SOURCE.slice(SOURCE.indexOf('async function wsLoadPdfFile('), SOURCE.indexOf('function wsReplacePlan()'));
  assert.equal((loadFile.match(/wsSetProjectPlan\(/g) || []).length, 2, 'draft project and open project both use the setter');
  assert.ok(!loadFile.includes('storeProjectPdf('), 'and never the raw store');
  assert.ok(loadFile.includes('wsPlanReplaceNote('), 'a replacement is reported, never silent');
  const copy = SOURCE.slice(SOURCE.indexOf('async function wsStageCopyOccupancyPlan('), SOURCE.indexOf('function wsStageRenderSwitch('));
  assert.ok(copy.includes('wsSetProjectPlan(pid, rec.buf, rec.name, { stage: st, file: false })'), 'copying the occupancy plan into a stage slot too');
  const setter = SOURCE.slice(SOURCE.indexOf('async function wsSetProjectPlan('), SOURCE.indexOf('async function wsFileOldPlan('));
  assert.ok(setter.includes('before.pdf_rev === rev) return { rev, unchanged: true'), 'the identical file is a no-op, not a duplicate card');
  assert.ok(setter.includes('await wsFileOldPlan(projectId, stage, before)'), 'the plan being replaced is kept in the Documents grid');
});

test('the canvas takes a dropped PDF, and the plan input serves both the empty state and Replace plan', () => {
  assert.ok(/id="ws-canvas-area"[\s\S]{0,400}ondrop="wsOnDrop\(event\)"/.test(SOURCE), 'drop on the loaded canvas replaces, not a dead preventDefault');
  assert.equal((SOURCE.match(/id="ws-plan-file"/g) || []).length, 1, 'one input');
  assert.ok(/id="ws-replace-plan-btn"[^>]*onclick="wsReplacePlan\(\)"/.test(SOURCE), 'the float bar has Replace plan');
  assert.ok(!/id="ws-pdf-input"/.test(SOURCE) && !/wsTriggerUpload\(\)"/.test(SOURCE), 'the dead ws-pdf-input path is not what the button wires to');
  for (const id of ['ws-empty-title', 'ws-empty-sub', 'ws-empty-copy-btn']) assert.ok(SOURCE.includes(`id="${id}"`), id + ' exists for wsShowNoPlan');
});

test('stage slots are gated on wsStageAllowed (PWC staff) at every entry', () => {
  const set = SOURCE.slice(SOURCE.indexOf('function wsStageSet('), SOURCE.indexOf('function wsStageLoadPlan('));
  assert.ok(set.includes("if (stage !== 'occupancy' && !wsStageAllowed()) stage = 'occupancy';"), 'the switcher falls back to occupancy for non-staff');
  const open = SOURCE.slice(SOURCE.indexOf('async function docOpenInDesign(docId, stage)'), SOURCE.indexOf('async function docOpenInCompliance('));
  assert.ok(open.includes("wsStageAllowed())) stage = 'occupancy'"), 'the Documents grid entry too');
  const card = SOURCE.slice(SOURCE.indexOf('function docCardHtml('), SOURCE.indexOf('function docsRender()'));
  assert.ok(/wsStageAllowed\(\)\s*\?\s*`<div class="doc-menu-sep">Use as stage plan<\/div>`/.test(card), 'the menu entries render only for staff');
  const seg = SOURCE.slice(SOURCE.indexOf('function wsStageRenderSwitch('), SOURCE.indexOf('async function wsSetProjectPlan('));
  assert.ok(seg.includes('!!WS.projectId && wsStageAllowed()'), 'the float-bar switcher shows only for staff with a project open');
  assert.ok(/function wsStageAllowed\(\) \{ return typeof wmpgIsStaff === 'function' && wmpgIsStaff\(\); \}/.test(SOURCE),
    'one staff gate, shared with the generator');
});

test('project open and the crash-recovery draft park the stage states and go live on occupancy', () => {
  const open = SOURCE.slice(SOURCE.indexOf('function wsOpenProject(project, opts = {})'), SOURCE.indexOf('let _wsPanelCollapsed'));
  assert.ok(open.includes("WS_STAGE.id = 'occupancy'; WS_STAGE.park = {};"), 'a project always opens on occupancy');
  assert.ok(open.includes('WS_STAGE.park[k] = wsStagePack(v)'), 'saved stage states are parked, not lost');
  assert.ok(open.includes('wsStageSet(stage, { noLoad: true })'), 'an explicit stage (Documents grid) is switched to after the state loads');
  const restore = SOURCE.slice(SOURCE.indexOf('function wsRestoreDraft()'), SOURCE.indexOf('function savePlanApiKey()'));
  assert.ok(restore.includes('WS_STAGE.park[k] = wsStagePack(v)'), 'the crash draft carries the stages too');
  const build = SOURCE.slice(SOURCE.indexOf('function wsBuildDraft()'), SOURCE.indexOf('function wsFlushState()'));
  assert.ok(build.includes('}, WS_STAGE.id, WS_STAGE.park, occFallback);'), 'every save goes through wsStageDraft');
});
