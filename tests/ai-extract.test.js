'use strict';
// AI plan extraction — the commercial-uses pipeline.
//
// The original bug: aiExtractCore carried a trimmed private copy of the
// extraction prompt that had lost the COMMERCIAL TENANCIES rule, and its
// example JSON showed `"commercial": []` — which a "output ONLY this JSON"
// system prompt reads as an instruction to return an empty array. Three of the
// four extraction paths therefore never extracted commercial uses; the fourth
// extracted them and then dropped them before the calculator. These tests pin
// the fix at every joint: one prompt, an explicit populated schema, and the
// array surviving summary → push → calculator seeding.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, loadCalc } = require('./extract.js');

// ── the prompt ──

test('one extraction prompt: AIX_PROMPT is the single copy, sent by both callers', () => {
  const copies = SOURCE.match(/You are a data extraction engine/g) || [];
  assert.equal(copies.length, 1,
    'the prompt exists exactly once — a drifted second copy is how the commercial rule was lost');
  assert.ok(SOURCE.includes('const AIX_PROMPT = `'), 'declared as the shared const');
  const uses = SOURCE.match(/system: AIX_PROMPT/g) || [];
  assert.equal(uses.length, 2, 'aiExtractCore and runPlanExtraction both send it as the system prompt');
});

test('the prompt demands commercial tenancies with an explicit, populated item schema', () => {
  const start = SOURCE.indexOf('const AIX_PROMPT');
  const prompt = SOURCE.slice(start, SOURCE.indexOf('`;', start));
  assert.ok(prompt.includes('COMMERCIAL TENANCIES'), 'the extraction rule exists');
  for (const key of ['"label"', '"type"', '"sqm"', '"days_per_week"'])
    assert.ok(prompt.includes(key), `item schema documents ${key}`);
  assert.ok(prompt.includes('{"label": "Retail 1", "type": "retail", "sqm": 120, "days_per_week": 7}'),
    'the example JSON shows a POPULATED commercial array — an empty [] example is what taught the model to return nothing');
});

// ── plumbing: extraction result → project summary → calculator ──

test('commercial survives the whole pipeline: persisted, watched, pushed, seeded', () => {
  const persisted = SOURCE.match(/\.\.\.\(Array\.isArray\(extracted\.commercial\) && \{ commercial: extracted\.commercial \}\),/g) || [];
  assert.equal(persisted.length, 2,
    'wsRunAiExtract and detailRunExtraction both write commercial to the project summary');
  assert.ok(SOURCE.includes("'apt_1br','apt_2br','apt_3br','townhouses','commercial','bin_rooms'"),
    'writeProjectSummary stamps staleness when commercial changes');
  assert.ok(SOURCE.includes('commercial: Array.isArray(s.commercial) ? s.commercial : null,'),
    'wsPushSummaryToCalc forwards it to the calculator pane');
  const created = SOURCE.match(/commercial: Array\.isArray\(NP\.summary\?\.commercial\) \? NP\.summary\.commercial : \[\],/g) || [];
  assert.equal(created.length, 2, 'both createProject variants keep it on the new project');
  assert.ok(SOURCE.includes('commercial: Array.isArray(data.commercial) ? data.commercial : null,'),
    'the plan-upload Apply button forwards it instead of dropping it');
  assert.ok(SOURCE.includes('if(Array.isArray(d.commercial)&amp;&amp;d.commercial.length)seedComRoom(d.commercial);'),
    'the ws-calc-fill bridge folds the tenancies into the room model');
  assert.ok(SOURCE.includes('type: c.use, label: (COMM[c.use] || {}).label || c.use,'),
    'the results echo mirrors the rooms back into summary.commercial, so a use the user deletes never resurrects on reopen');
});

// ── comUseKey: free-text type/label → COMM rate key ──

test('comUseKey resolves types, aliases, accented labels, and sizes retail by sqm', () => {
  const { comUseKey } = loadCalc();
  assert.equal(comUseKey({ type: 'cafe' }), 'cafe', 'canonical key passes through');
  assert.equal(comUseKey({ label: 'Café', sqm: 40 }), 'cafe', 'accent folds, label alone resolves');
  assert.equal(comUseKey({ type: 'coffee shop' }), 'cafe', 'alias vocabulary');
  assert.equal(comUseKey({ type: 'retail', sqm: 80 }), 'general_retail_small', 'retail ≤100m² prices small');
  assert.equal(comUseKey({ type: 'retail', sqm: 250 }), 'general_retail_large', 'retail >100m² prices large');
  assert.equal(comUseKey({ label: 'Shop 3', type: 'shop', sqm: 0 }), 'general_retail_small', 'unstated area defaults small — the coarser rate');
  assert.equal(comUseKey({ type: 'bar' }), 'bar_club_function');
  assert.equal(comUseKey({ type: 'hotel', sqm: 900 }), 'hotel_area', 'sqm is what we extract, so hotels resolve to the by-area rate');
  assert.equal(comUseKey({ label: 'Bakery' }), 'bakery', 'label matches COMM label');
  assert.equal(comUseKey({ label: 'Function Room' }), 'function_room');
});

test('comUseKey refuses to guess: no COMM rate means null, never a wrong rate', () => {
  const { comUseKey } = loadCalc();
  assert.equal(comUseKey({ type: 'medical', label: 'Medical Suite', sqm: 200 }), null,
    'COMM has no medical category — a guessed rate on a bin schedule is worse than a reported gap');
  assert.equal(comUseKey({}), null);
  assert.equal(comUseKey(null), null);
});

// ── seedComRoom: folding extracted tenancies into the room allocation ──

test('seedComRoom: fresh seed creates one commercial room; unresolved uses are reported', () => {
  const api = loadCalc();
  const out = api.seedComRoom([
    { label: 'Café', type: 'cafe', sqm: 45, days_per_week: 7 },
    { label: 'Retail 1', type: 'retail', sqm: 120, days_per_week: 7 },
    { label: 'Medical Suite', type: 'medical', sqm: 200, days_per_week: 5 },
  ]);
  assert.equal(api.ROOMS.length, 1);
  assert.equal(api.ROOMS[0].kind, 'com');
  assert.deepStrictEqual(api.ROOMS[0].com.map(c => c.use), ['cafe', 'general_retail_large']);
  assert.deepStrictEqual(api.ROOMS[0].com.map(c => c.value), [45, 120]);
  assert.deepStrictEqual(out.missed, ['Medical Suite'], 'the unmatched use is reported, not silently dropped');
});

test('seedComRoom is idempotent: re-pushing an unchanged summary adds nothing', () => {
  const api = loadCalc();
  const list = [{ type: 'cafe', sqm: 45 }, { type: 'office', sqm: 300, days_per_week: 5 }];
  api.seedComRoom(list);
  const before = JSON.parse(JSON.stringify(api.ROOMS));
  const again = api.seedComRoom(list);
  assert.equal(again.added.length, 0, 'every row matched an existing one');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.ROOMS)), before, 'rooms untouched');
});

test('seedComRoom: duplicate tenancies of the same use are counted, not collapsed', () => {
  const api = loadCalc();
  api.seedComRoom([{ type: 'cafe', sqm: 45 }, { type: 'cafe', sqm: 45 }]);
  assert.equal(api.ROOMS[0].com.length, 2, 'two same-size cafés are two rows');
  // …and re-pushing both still adds nothing (multiset match, not first-match)
  const again = api.seedComRoom([{ type: 'cafe', sqm: 45 }, { type: 'cafe', sqm: 45 }]);
  assert.equal(again.added.length, 0);
});

test('seedComRoom: residential rooms are left alone — commercial gets its own room', () => {
  const api = loadCalc();
  api.ROOMS.push(api.mkRoom('Bin Room 1', 'res'));
  api.seedComRoom([{ type: 'gym', sqm: 150 }]);
  assert.equal(api.ROOMS.length, 2);
  assert.equal(api.ROOMS[0].kind, 'res');
  assert.equal(api.ROOMS[0].com.length, 0);
  assert.equal(api.ROOMS[1].kind, 'com');
  assert.equal(api.ROOMS[1].com[0].use, 'gym');
});

test('seedComRoom: days clamp to [1,7] and default from the COMM table', () => {
  const api = loadCalc();
  api.seedComRoom([
    { type: 'office', sqm: 10, days_per_week: 99 },  // clamps down
    { type: 'cafe', sqm: 5 },                        // COMM.cafe.defaultDays
    { type: 'gym', sqm: 20, days_per_week: 0 },      // 0 means "not stated" → default
  ]);
  assert.deepStrictEqual(api.ROOMS[0].com.map(c => c.days), [7, 7, 7]);
});
