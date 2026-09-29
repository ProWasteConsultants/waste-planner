'use strict';
// Commercial mix: AI plan extraction → project Development Summary → bin
// calculator. The rows are the calculator's own { use, value, days } shape.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, extractBlock, SOURCE } = require('./extract.js');

const E = loadEngine({ blocks: [
  ['wpComPromptList',   /^function wpComPromptList\(uses\) \{/],
  ['wpComClean',        /^function wpComClean\(rows, uses\) \{/],
  ['wpComFromExtract',  /^function wpComFromExtract\(list, uses\) \{/],
  ['wpComSummaryText',  /^function wpComSummaryText\(rows, uses\) \{/],
  ['WMPG_COM_USES',     /^const WMPG_COM_USES = \{/],
] });
const USES = E.WMPG_COM_USES;

test('the prompt lists every calculator use with its measure', () => {
  const lines = E.wpComPromptList(USES).split('\n');
  assert.equal(lines.length, Object.keys(USES).length);
  assert.ok(lines.includes('cafe | Cafe | m² (NLA)'));
  assert.ok(lines.includes('hotel_beds | Hotel / motel (by bed count) | Beds (no.)'));
});

test('matched rows come through in the calculator shape, label kept', () => {
  const r = E.wpComFromExtract([
    { label: 'T1 — Café', use: 'cafe', value: 120, days: 0 },
    { label: 'Office L1', use: 'office', value: '450', days: 5 },
  ], USES);
  assert.deepEqual(r.rows, [
    { use: 'cafe', value: 120, days: 0, label: 'T1 — Café' },
    { use: 'office', value: 450, days: 5, label: 'Office L1' },
  ]);
  assert.deepEqual(r.unmatched, []);
});

test('an unknown use or a missing figure is reported, never guessed or dropped', () => {
  const r = E.wpComFromExtract([
    { label: 'Veterinary clinic', use: null, value: 90 },
    { label: 'Pet shop', use: 'pet_shop', value: 60 },
    { label: 'Retail T3', use: 'general_retail_small', value: 0 },
  ], USES);
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.unmatched.map(u => [u.label, u.why]), [
    ['Veterinary clinic', 'no matching use'],
    ['Pet shop', 'no matching use'],
    ['Retail T3', 'no figure on the plans'],
  ]);
});

test('the older reply shape { type, sqm, days_per_week } still reads', () => {
  const r = E.wpComFromExtract([{ type: 'Gym', use: 'gym', sqm: 300, days_per_week: 7 }], USES);
  assert.deepEqual(r.rows, [{ use: 'gym', value: 300, days: 7, label: 'Gym' }]);
});

test('clean: days outside 1–7 become 0 (the calculator default); junk is dropped', () => {
  assert.deepEqual(E.wpComClean([{ use: 'cafe', value: 50, days: 9 }, null, { use: 'cafe', value: -1 }], USES),
    [{ use: 'cafe', value: 50, days: 0 }]);
  assert.deepEqual(E.wpComFromExtract(null, USES), { rows: [], unmatched: [] });
});

test('summary text names each use and its figure', () => {
  assert.equal(E.wpComSummaryText([{ use: 'cafe', value: 120 }, { use: 'hotel_beds', value: 40, label: 'Hotel' }], USES),
    'Cafe 120m², Hotel 40');
});

test('both plan-extraction prompts carry the commercial rules and map the reply', () => {
  assert.equal(SOURCE.split('${wpComPromptRules()}').length - 1, 2);
  const core = extractBlock(/^async function aiExtractCore\(/).text;
  assert.ok(core.includes('wpComFromExtract(out.commercial, wpComUseList())'));
  const pu = extractBlock(/^async function runPlanExtraction\(\)/).text;
  assert.ok(pu.includes('wpComFromExtract(extracted.commercial, wpComUseList())'));
});

test('the summary mix reaches the calculator, and the calculator reports it back', () => {
  const push = extractBlock(/^function wsPushSummaryToCalc\(\)/).text;
  assert.ok(push.includes('...(Array.isArray(s.com) && { com: s.com })'), 'absent on older projects — no wipe');
  assert.ok(SOURCE.includes("com: ROOMS.filter(r =&gt; r.kind === 'com').flatMap("), 'results summary carries com');
  // one commercial room is reconciled, several are left alone with a note
  assert.ok(SOURCE.includes("if(comRooms.length===1)comRooms[0].com=valid;"));
  assert.ok(SOURCE.includes('not applied, because this project has'));
});

test('new projects, the calc handoff and the design extraction keep the mix', () => {
  assert.equal(SOURCE.split('com: NP.summary?.com || [],').length - 1, 2);
  assert.ok(extractBlock(/^async function applyCalcPrefill\(pre\) \{/).text.includes('com: pre.com.filter('));
  const ws = extractBlock(/^async function wsRunAiExtract\(\)/).text;
  assert.ok(ws.includes('...(extracted.com && extracted.com.length && { com: extracted.com })'),
    'an extraction with no commercial leaves a hand-entered mix alone');
});

test('the project page edits the mix and syncs it to the cloud', () => {
  assert.ok(SOURCE.includes('onclick="dsComAdd()"'));
  const save = extractBlock(/^function dsComSave\(rows\) \{/).text;
  assert.ok(save.includes('writeProjectSummary(currentProjectId, { com: rows })'));
  assert.ok(save.includes('dsSyncToDB(currentProjectId)'));
  assert.ok(extractBlock(/^function writeProjectSummary\(/).text.includes("'com'"), 'a mix change marks downstream numbers stale');
});
