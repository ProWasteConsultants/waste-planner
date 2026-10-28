'use strict';
// ── WORKSPACE (PERSONAL / ORGANISATION) FOLLOWS THE ACCOUNT ─────────────────
// The chosen workspace used to live in this device's localStorage only, and
// the one switcher sat in a hover panel a phone cannot open: a laptop in the
// organisation's workspace and a phone in Personal showed different project
// lists for one account (reported 2026-10-27). The choice is now the
// account's (auth user metadata) and every device can switch.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock } = require('./extract.js');

const pick = new Function(extractBlock(/^function wpOrgCtxPick\(/).text + ';return wpOrgCtxPick;')();

test('the account’s stored workspace wins, and every device follows it', () => {
  assert.equal(pick('org1', '', ['org1']), 'org1', 'a device with nothing of its own opens the account’s org');
  assert.equal(pick('org1', 'org2', ['org1', 'org2']), 'org1', 'the account beats this device’s old key');
  assert.equal(pick('', 'org1', ['org1']), '', 'Personal stored on the account is a real choice');
  assert.equal(pick('gone', 'org1', ['org1']), '', 'an org the user has left falls back to Personal');
  assert.equal(pick(undefined, 'org1', ['org1']), 'org1', 'an account that never stored one uses this device’s key…');
  assert.equal(pick(undefined, 'gone', ['org1']), '');
  assert.equal(pick(undefined, null, []), '');
});

test('loading writes a device-only choice up to the account; switching always does', () => {
  const load = extractBlock(/^async function loadOrgs\(/).text;
  assert.ok(/currentUser\?\.user_metadata\?\.wp_org_ctx/.test(load), 'reads the account’s choice');
  assert.ok(/if \(metaId === undefined && pick\) wpOrgCtxSaveToAccount\(pick\);/.test(load),
    '…and stores this device’s choice on the account the first time, so the next device follows');
  const set = extractBlock(/^function setOrgContext\(/).text;
  assert.ok(/wpOrgCtxSaveToAccount\(currentOrg\?\.id \|\| ''\)/.test(set), 'a switch is saved to the account');
  const save = extractBlock(/^function wpOrgCtxSaveToAccount\(/).text;
  assert.ok(/sb\.auth\.updateUser\(\{ data: \{ wp_org_ctx: id \|\| '' \} \}\)/.test(save), 'no migration: auth user metadata');
});

test('a phone can switch: the Projects header carries the same switcher', () => {
  assert.ok(SOURCE.includes('id="proj-workspace"') && /id="proj-workspace"[^>]*onchange="setOrgContext\(this\.value\)"/.test(SOURCE));
  const r = extractBlock(/^function renderOrgSwitcher\(/).text;
  assert.ok(r.includes("'org-switcher', 'proj-workspace'"), 'both switchers are filled from one list');
  assert.ok(extractBlock(/^function resetOrgState\(/).text.includes("'proj-workspace'"), 'and both are cleared on sign-out');
  assert.ok(SOURCE.includes('<div class="stat-sub">Saved to your account</div>') && !SOURCE.includes('Saved locally'),
    'the project count no longer says projects are saved locally');
});

// ── what follows the project to another device (2026-10-27) ──
const reconcile = new Function(extractBlock(/^function wpLocalReconcile\(/).text + ';return wpLocalReconcile;')();
const newer = new Function(extractBlock(/^function wpCloudNewer\(/).text + ';return wpCloudNewer;')();

test('the WMP draft, bin schedule and title block travel in app_data', () => {
  const save = extractBlock(/^async function saveProjectToDB\(/).text;
  ['wmp: project.wmp', 'schedule: project.schedule', 'scheduleTs: project.scheduleTs', 'calc_rooms: project.calc_rooms',
   'presentation: project.presentation', 'residential_method: project.residential_method', "localStorage.getItem('ws_sheet_' + project.id)"]
    .forEach(k => assert.ok(save.includes(k), k));
  const load = extractBlock(/^async function loadProjectsFromDB\(/).text;
  assert.ok(load.includes('...wpCloudNewer(prev, ad)') && load.includes("localStorage.setItem('ws_sheet_' + p.id"), 'and come back on load');
});

test('the newer copy wins, by its own stamp', () => {
  const local = { wmp: { savedAt: 200, x: 'local' }, scheduleTs: 50, schedule: ['local'] };
  assert.deepStrictEqual(newer(local, { wmp: { savedAt: 100, x: 'cloud' } }), {}, 'an older cloud draft never replaces this device’s');
  assert.equal(newer(local, { wmp: { savedAt: 300, x: 'cloud' } }).wmp.x, 'cloud');
  const s = newer(local, { schedule: ['cloud'], scheduleTs: 60, calc_rooms: [1], residential_method: { type: 'table' } });
  assert.deepStrictEqual(s.schedule, ['cloud']);
  assert.deepStrictEqual(s.calc_rooms, [1], 'the room figures computed with the schedule come with it');
  assert.deepStrictEqual(newer({}, { schedule: ['c'], scheduleTs: 1 }).schedule, ['c'], 'a device with none takes the cloud’s');
  assert.deepStrictEqual(newer({ wmp: { savedAt: 1 } }, {}), {}, 'nothing in the cloud changes nothing');
});

test('local-only and deleted-elsewhere projects: upload yours, drop the gone, touch nothing else', () => {
  const me = 'u1';
  const local = [
    { id: 'a', cloudSeen: true },                       // deleted on another device
    { id: 'b', ownerId: me },                           // created here, never reached the cloud
    { id: 'c' },                                        // no recorded owner — could be another account's
    { id: 'd', ownerId: 'u2' },                         // another account's
    { id: 'e', orgId: 'o1', cloudSeen: true },          // the other workspace — not asked for
    { id: 'f', cloudSeen: true },                       // still in the cloud
    { id: 'g', shared: true, cloudSeen: true },         // design-team access ended
  ];
  const r = reconcile(local, new Set(['f']), { org: null, uid: me });
  assert.deepStrictEqual(r.drop.sort(), ['a', 'g']);
  assert.deepStrictEqual(r.upload, ['b']);
  const o = reconcile(local, new Set([]), { org: 'o1', uid: me });
  assert.deepStrictEqual(o.drop, ['e'], 'an org load judges only that org’s projects');
  assert.deepStrictEqual(o.upload, []);
});

test('another account’s cached project never lists, and every save carries an owner', () => {
  const r = extractBlock(/^function renderProjects\(/).text;
  assert.ok(r.includes('p.ownerId === me'), 'the personal list skips a project another account created on this browser');
  assert.ok(/ownerId: currentUser\?\.id \|\| null,\n    created:/.test(SOURCE), 'the bin-calculator hand-off records its owner');
});

test('leaving the page sends what is waiting; the calculator’s schedule goes up at once', () => {
  assert.ok(/document\.addEventListener\('visibilitychange', \(\) => \{ if \(document\.visibilityState === 'hidden'\) wsFlushOnLeave\(\); \}\);/.test(SOURCE));
  assert.ok(SOURCE.includes("window.addEventListener('pagehide', wsFlushOnLeave);"));
  const f = extractBlock(/^function wsFlushOnLeave\(/).text;
  assert.ok(f.includes('wsFlushState()') && f.includes('wmpgPersistNow()'), 'both the canvas and the WMP draft');
  assert.ok(/if \(e\.data\.schedule && typeof saveProjectToDB === 'function' && currentUser\) saveProjectToDB\(p\);/.test(SOURCE));
});

test('the cover photo and site figure go to the plans bucket and come back on another device', () => {
  assert.equal(new Function('wpProjectStorageUid', 'currentUser', extractBlock(/^function wmpgImgCloudPath\(/).text + ';return wmpgImgCloudPath;')(
    () => 'owner', null)('cover', 'p1'), 'owner/p1/wmp/cover', 'the owner’s folder, like plans and documents');
  const accept = extractBlock(/^async function wmpgCoverAccept\(/).text;
  assert.ok(accept.includes("wmpgImgCloudPut('cover'"));
  const load = extractBlock(/^async function wmpgCoverLoad\(/).text;
  assert.ok(load.includes("wmpgImgCloudGet('cover'") && load.indexOf('idbGetPdf') < load.indexOf('wmpgImgCloudGet'), 'local copy first, the cloud when it is missing');
  const sload = extractBlock(/^async function wmpgSiteFigLoad\(/).text;
  assert.ok(sload.includes("wmpgImgCloudGet('sitefig'"));
  assert.ok(extractBlock(/^async function wmpgCoverRemove\(/).text.includes("wmpgImgCloudDel('cover'"));
  assert.ok(extractBlock(/^async function wmpgSiteFigRemove\(/).text.includes("wmpgImgCloudDel('sitefig'"));
});

test('the project stores its council by name, and the Documents grid marks the plan in Design', () => {
  const name = new Function(extractBlock(/^function wpCouncilName\(/).text + ';return wpCouncilName;')();
  const NSW = [{ value: 'northern_beaches_council', label: 'Northern Beaches Council' }];
  assert.equal(name(NSW, 'northern_beaches_council'), 'Northern Beaches Council', 'the calculator’s code becomes the name');
  assert.equal(name(NSW, 'Northern Beaches Council'), 'Northern Beaches Council');
  assert.equal(name(NSW, 'Somewhere Shire'), 'Somewhere Shire', 'an unlisted council is kept as typed');
  assert.ok(extractBlock(/^function writeProjectSummary\(/).text.includes('wpCouncilName(getCouncilsForState('), 'every summary write names it');
  assert.ok(extractBlock(/^function populateCouncilSelect\(/).text.includes('wpCouncilName(getCouncilsForState(state)'), 'and the picker shows the name, not "(custom)"');
  const inDesign = new Function(extractBlock(/^function wpDocsInDesign\(/).text + ';return wpDocsInDesign;')();
  const p = { pdf_name: 'plan_B.pdf', stage_plans: { construction: { pdf_name: 'cons.pdf' } },
    docs: [{ id: 'a', name: 'plan_A.pdf', ts: 1 }, { id: 'b', name: 'plan_B.pdf', ts: 2 }, { id: 'b0', name: 'plan_B.pdf', ts: 1 }, { id: 'c', name: 'cons.pdf', ts: 3 }, { id: 'l', name: 'letter.pdf', ts: 4 }] };
  assert.deepStrictEqual(inDesign(p), { b: ['occupancy'], c: ['construction'] }, 'the newest copy of the plan in each slot; nothing else');
  assert.deepStrictEqual(inDesign({ docs: [{ id: 'x', name: 'x.pdf' }] }), {}, 'no plan in Design, no badge');
  assert.ok(extractBlock(/^function docCardHtml\(/).text.includes('wpDocsInDesign(p)[d.id]'), 'the card shows it');
});
