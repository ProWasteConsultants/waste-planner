'use strict';
// Sheet export — scale selection maths and legend content.
//
// The promise the sheet makes is that "1:X@A3" in the title block is PHYSICALLY
// TRUE on the printed page: 1 mm of paper is exactly X mm on site. That only
// holds if the crop window is derived from the scale rather than the drawing
// being fitted to the page, so these tests pin the maths in both directions.
//
// The jsPDF drawing calls sit on top of this and are not covered here.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSheet, SOURCE } = require('./extract.js');

const ws = loadSheet();
const VIEW = ws.wsSheetViewportMm();

// ── sheet geometry ──────────────────────────────────────────────────────
test('the sheet is A3 landscape and the plan fills essentially the whole page', () => {
  assert.equal(ws.WS_SHEET.w, 420);
  assert.equal(ws.WS_SHEET.h, 297);
  assert.equal(VIEW.x, ws.WS_SHEET.margin);
  assert.equal(VIEW.y, ws.WS_SHEET.margin);
  assert.equal(VIEW.w, 420 - 2 * ws.WS_SHEET.margin);
  assert.equal(VIEW.h, 297 - 2 * ws.WS_SHEET.margin - ws.WS_SHEET.bottomText);
  assert.ok(VIEW.w > VIEW.h, 'landscape viewport');
  assert.ok(VIEW.y + VIEW.h + ws.WS_SHEET.bottomText <= 297 + 1e-9, 'viewport must fit the page');
  // the old bottom title strip cost ~50 mm of plan height; the redesign returns it
  assert.ok(VIEW.h >= 270, 'plan viewport is only ' + VIEW.h + ' mm tall');
  assert.ok(VIEW.w * VIEW.h > 404 * 231 * 1.15, 'the redesign must gain real plan area');
});

test('A7: the bigger viewport really does buy a finer scale', () => {
  // A plan that needed 1:750 on the old 404x231 mm viewport now fits 1:500.
  const OLD = { x: 8, y: 8, w: 404, h: 231 };
  const extent = { w: 200, h: 138 };
  assert.equal(ws.wsPickExportScale(extent, OLD, null).scale, 750);
  assert.equal(ws.wsPickExportScale(extent, VIEW, null).scale, 500);
  assert.equal(ws.wsScaleFits(extent, VIEW, 500), true);
});

// ── floating cards ──────────────────────────────────────────────────────
test('there is ONE title card, top-left, and no bottom-right card', () => {
  for (const rows of [0, 1, 5, 12, 20]) {
    const r = ws.wsSheetCardRects(VIEW, { legendRows: rows });
    assert.deepEqual(ws.wsSheetCardCollisions(r), [], 'overlap at ' + rows + ' legend rows');
    assert.ok(r.id.x < VIEW.x + VIEW.w / 2 && r.id.y < VIEW.y + VIEW.h / 2, 'title card is top-left');
    assert.equal(r.issue, undefined, 'the separate bottom-right card must be gone');
    if (r.legend) assert.ok(r.legend.x > VIEW.x + VIEW.w / 2 && r.legend.y < VIEW.y + VIEW.h / 2, 'legend is top-right');
  }
});

test('every card stays inside the plan viewport', () => {
  const r = ws.wsSheetCardRects(VIEW, { legendRows: 14 });
  for (const k of ['id', 'legend', 'issue']) {
    if (!r[k]) continue;
    assert.ok(r[k].x >= VIEW.x, k + ' runs off the left edge');
    assert.ok(r[k].y >= VIEW.y, k + ' runs off the top edge');
    assert.ok(r[k].x + r[k].w <= VIEW.x + VIEW.w + 1e-9, k + ' runs off the right edge');
    assert.ok(r[k].y + r[k].h <= VIEW.y + VIEW.h + 1e-9, k + ' runs off the bottom edge');
  }
});

test('the legend card can be switched off entirely', () => {
  const off = ws.wsSheetCardRects(VIEW, { legendRows: 6, legend: false });
  assert.equal(off.legend, undefined);
  assert.ok(off.id, 'the title card still renders');
  // ...and it is absent when there is nothing to list, without needing the flag
  assert.equal(ws.wsSheetCardRects(VIEW, { legendRows: 0 }).legend, undefined);
});

test('the bottom-centre region is reserved for the future swept-path panel', () => {
  const r = ws.wsSheetCardRects(VIEW, { legendRows: 8 });
  assert.ok(r.sweptReserved, 'the reservation must be expressed in the layout, not just a comment');
  assert.equal(ws.wsRectsOverlap(r.sweptReserved, r.issue), false, 'the reserved band must not clash with the issue card');
  assert.equal(ws.wsRectsOverlap(r.sweptReserved, r.id), false);
  const mid = r.sweptReserved.x + r.sweptReserved.w / 2;
  assert.ok(Math.abs(mid - (VIEW.x + VIEW.w / 2)) < 1e-6, 'reserved band is centred');
});

test('wsRectsOverlap: touching edges do not count as overlapping', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(ws.wsRectsOverlap(a, { x: 10, y: 0, w: 10, h: 10 }), false, 'edge-to-edge');
  assert.equal(ws.wsRectsOverlap(a, { x: 9.9, y: 0, w: 10, h: 10 }), true);
  assert.equal(ws.wsRectsOverlap(a, { x: 0, y: 10, w: 10, h: 10 }), false);
  assert.equal(ws.wsRectsOverlap(a, null), false);
});

test('the offered scales are the agreed standard set, ascending', () => {
  assert.deepEqual(ws.WS_STD_SCALES, [100, 200, 250, 400, 500, 750, 1000]);
  const sorted = ws.WS_STD_SCALES.slice().sort((a, b) => a - b);
  assert.deepEqual(ws.WS_STD_SCALES, sorted, 'the picker relies on ascending order');
});

// ── required scale ──────────────────────────────────────────────────────
test('wsRequiredScaleDenom: 1 mm of paper is X mm on site', () => {
  // an extent one tenth of the viewport in metres exactly fills it at 1:100
  const fullW = VIEW.w / 10, fullH = VIEW.h / 10;
  assert.ok(Math.abs(ws.wsRequiredScaleDenom({ w: fullW, h: 1 }, VIEW) - 100) < 1e-9);
  assert.ok(Math.abs(ws.wsRequiredScaleDenom({ w: fullW * 2, h: 1 }, VIEW) - 200) < 1e-9);
  assert.ok(Math.abs(ws.wsRequiredScaleDenom({ w: 1, h: fullH }, VIEW) - 100) < 1e-9);
  assert.ok(ws.wsRequiredScaleDenom({ w: fullW, h: fullH * 2 }, VIEW) > 100, 'the tighter axis wins');
});

test('wsRequiredScaleDenom: degenerate inputs do not produce a bogus scale', () => {
  assert.equal(ws.wsRequiredScaleDenom(null, VIEW), Infinity);
  assert.equal(ws.wsRequiredScaleDenom({ w: 1, h: 1 }, null), Infinity);
  assert.equal(ws.wsRequiredScaleDenom({ w: 1, h: 1 }, { w: 0, h: 0 }), Infinity);
  assert.equal(ws.wsRequiredScaleDenom({ w: 0, h: 0 }, VIEW), 0, 'an empty extent needs no scale');
});

test('wsScaleFits agrees with the required denominator at the boundary', () => {
  const exact = { w: VIEW.w / 10, h: 1 };
  const need = ws.wsRequiredScaleDenom(exact, VIEW);   // exactly 100
  assert.equal(ws.wsScaleFits(exact, VIEW, 100), true, 'an exact fit must fit');
  assert.equal(ws.wsScaleFits(exact, VIEW, 99), false);
  assert.equal(ws.wsScaleFits(exact, VIEW, 200), true);
  assert.ok(Math.abs(need - 100) < 1e-9);
});

// ── default scale selection ─────────────────────────────────────────────
test('wsPickExportScale: keeps the plan scale when the visible extent fits at it', () => {
  const r = ws.wsPickExportScale({ w: 20, h: 10 }, VIEW, 200);
  assert.equal(r.scale, 200);
  assert.equal(r.source, 'plan');
  assert.equal(r.fits, true);
  // even though a more detailed scale would also fit, the plan's own scale wins
  assert.ok(ws.wsScaleFits({ w: 20, h: 10 }, VIEW, 100), 'precondition: 1:100 would also fit');
});

test('wsPickExportScale: falls to the most detailed standard that fits', () => {
  // just over what 1:100 can hold, so 1:200 is the next standard up
  const big = { w: VIEW.w / 10 * 1.05, h: 1 };
  const r = ws.wsPickExportScale(big, VIEW, 100);
  assert.equal(r.scale, 200);
  assert.equal(r.source, 'fit');
  assert.equal(r.fits, true);
  assert.ok(r.required > 100 && r.required < 200);
  assert.equal(ws.wsScaleFits(big, VIEW, 100), false);
  assert.equal(ws.wsScaleFits(big, VIEW, 200), true);
});

test('wsPickExportScale: picks the smallest fitting standard, not merely a fitting one', () => {
  for (const [extent, expect] of [
    [{ w: 10, h: 5 }, 100],
    [{ w: 60, h: 30 }, 200],
    [{ w: 90, h: 50 }, 250],
    [{ w: 150, h: 80 }, 400],
    [{ w: 190, h: 110 }, 500],
    [{ w: 290, h: 160 }, 750],
    [{ w: 390, h: 220 }, 1000],
  ]) {
    const r = ws.wsPickExportScale(extent, VIEW, null);
    assert.equal(r.scale, expect, `${extent.w}x${extent.h} m should export at 1:${expect}, got 1:${r.scale}`);
    assert.equal(ws.wsScaleFits(extent, VIEW, r.scale), true, 'the chosen scale must actually fit');
    const idx = ws.WS_STD_SCALES.indexOf(r.scale);
    if (idx > 0) assert.equal(ws.wsScaleFits(extent, VIEW, ws.WS_STD_SCALES[idx - 1]), false,
      'a more detailed standard would also have fitted — the pick is not the tightest');
  }
});

test('wsPickExportScale: an over-large extent crops at the coarsest standard, flagged', () => {
  const r = ws.wsPickExportScale({ w: 900, h: 600 }, VIEW, 100);
  assert.equal(r.scale, 1000, 'coarsest offered standard');
  assert.equal(r.source, 'crop');
  assert.equal(r.fits, false, 'the dialog must be able to say the sheet crops');
  assert.ok(r.required > 1000);
});

test('wsPickExportScale: a plan scale outside the offered set falls through safely', () => {
  // 1:50 is not offered; a plan set to it must still get a scale that fits, and
  // stating a coarser scale is always safe (never overstates detail).
  const r = ws.wsPickExportScale({ w: 15, h: 8 }, VIEW, 50);
  assert.notEqual(r.source, 'plan');
  assert.equal(r.scale, 100);
  assert.equal(ws.wsScaleFits({ w: 15, h: 8 }, VIEW, r.scale), true);
  assert.ok(r.scale > 50, 'the stated scale is coarser than the plan, never finer');
});

test('wsPickExportScale: never returns a scale it has not verified fits', () => {
  for (let w = 1; w <= 400; w += 7) {
    const extent = { w, h: w * 0.55 };
    const r = ws.wsPickExportScale(extent, VIEW, null);
    if (r.fits) assert.equal(ws.wsScaleFits(extent, VIEW, r.scale), true, `claimed fit at ${w} m but does not`);
    else assert.equal(r.scale, ws.WS_STD_SCALES[ws.WS_STD_SCALES.length - 1]);
  }
});

// ── crop window ─────────────────────────────────────────────────────────
test('wsCropExtentM: the sheet covers exactly viewport × scale', () => {
  const c = ws.wsCropExtentM(200, VIEW);
  assert.ok(Math.abs(c.w - VIEW.w * 0.2) < 1e-9);
  assert.ok(Math.abs(c.h - VIEW.h * 0.2) < 1e-9);
  // round trip: the extent a scale covers requires exactly that scale
  assert.ok(Math.abs(ws.wsRequiredScaleDenom(c, VIEW) - 200) < 1e-9);
});

test('wsCropExtentM: the scale is true, never fitted', () => {
  // Doubling the denominator must double the ground covered — if the drawing were
  // fitted to the page instead, this relationship would not hold.
  const a = ws.wsCropExtentM(100, VIEW), b = ws.wsCropExtentM(200, VIEW);
  assert.ok(Math.abs(b.w / a.w - 2) < 1e-12);
  assert.ok(Math.abs(b.h / a.h - 2) < 1e-12);
});

test('wsSheetCropPx: centres the crop on the view and clamps to the page', () => {
  const mpp = 0.05;                       // m per canvas px
  const canvas = { w: 4000, h: 3000 };
  const centre = { x: 2000, y: 1500 };
  const crop = ws.wsSheetCropPx(200, VIEW, mpp, centre, canvas);
  assert.ok(Math.abs(crop.w - VIEW.w * 0.2 / 0.05) < 1e-6);
  assert.ok(Math.abs(crop.h - VIEW.h * 0.2 / 0.05) < 1e-6);
  assert.ok(Math.abs((crop.x + crop.w / 2) - centre.x) < 1e-6, 'centred horizontally');
  assert.ok(Math.abs((crop.y + crop.h / 2) - centre.y) < 1e-6, 'centred vertically');
});

test('wsSheetCropPx: a crop near the edge slides inside rather than running off', () => {
  const crop = ws.wsSheetCropPx(200, VIEW, 0.05, { x: 10, y: 10 }, { w: 4000, h: 3000 });
  assert.equal(crop.x, 0);
  assert.equal(crop.y, 0);
  assert.ok(crop.x + crop.w <= 4000 + 1e-9);
});

test('wsSheetCropPx: a crop larger than the page is left centred, not clamped', () => {
  // At 1:1000 the sheet covers more ground than the plan holds; clamping would
  // shove the drawing into a corner instead of centring it.
  const crop = ws.wsSheetCropPx(1000, VIEW, 0.05, { x: 500, y: 400 }, { w: 800, h: 600 });
  assert.ok(crop.w > 800 && crop.h > 600);
  assert.ok(Math.abs((crop.x + crop.w / 2) - 500) < 1e-6);
});

// ── visible extent ──────────────────────────────────────────────────────
test('wsVisibleCanvasRect: converts the zoomed viewport back to canvas pixels', () => {
  const r = ws.wsVisibleCanvasRect({ scale: 0.5, panX: 0, panY: 0, areaW: 800, areaH: 600 },
                                   { w: 4000, h: 3000 });
  assert.deepEqual([r.x1, r.y1], [0, 0]);
  assert.equal(r.w, 1600, 'at 50% zoom an 800 px window shows 1600 canvas px');
  assert.equal(r.h, 1200);
});

test('wsVisibleCanvasRect: panning shifts the window and clamps at the page edges', () => {
  const r = ws.wsVisibleCanvasRect({ scale: 1, panX: -500, panY: -300, areaW: 800, areaH: 600 },
                                   { w: 4000, h: 3000 });
  assert.equal(r.x1, 500);
  assert.equal(r.y1, 300);
  assert.equal(r.w, 800);
  // panned past the top-left: the window clamps to the page, never negative
  const c = ws.wsVisibleCanvasRect({ scale: 1, panX: 200, panY: 100, areaW: 800, areaH: 600 },
                                   { w: 4000, h: 3000 });
  assert.equal(c.x1, 0);
  assert.equal(c.y1, 0);
  assert.ok(c.w > 0 && c.h > 0);
});

test('wsVisibleCanvasRect: never returns a negative extent', () => {
  const r = ws.wsVisibleCanvasRect({ scale: 1, panX: -99999, panY: -99999, areaW: 800, areaH: 600 },
                                   { w: 4000, h: 3000 });
  assert.ok(r.w >= 0 && r.h >= 0);
});

// ── legend content ──────────────────────────────────────────────────────
const ALL_ON = { binroom: true, waste: true, swept: true, markups: true, dims: true };
const bin = stream => ({ stream, type: 'b1100', x: 0, y: 0 });
const mark = kind => ({ kind, pts: [] });

test('wsSheetContent: summarises only what is actually on the page', () => {
  const slot = {
    bins: [bin('garbage'), bin('garbage'), bin('recycling'), { stream: 'equip' }],
    rooms: [{ kind: 'res' }],
    equip: [{ aisle: false }, { aisle: true }],
    markups: [mark('disposal'), mark('text')],
  };
  const c = ws.wsSheetContent(slot, null);
  assert.deepEqual(c.streams, ['garbage', 'recycling'], 'deduped, equipment excluded');
  assert.equal(c.rooms, true);
  assert.equal(c.comRoom, false);
  assert.equal(c.equip, true);
  assert.equal(c.aisle, true);
  assert.equal(c.disposal, true);
  assert.equal(c.transfer, false);
  assert.equal(c.callout, true);
  assert.equal(c.swept, false);
});

test('wsSheetContent: streams come back in canonical order, not placement order', () => {
  const slot = { bins: [bin('fogo'), bin('garbage'), bin('glass'), bin('recycling')], rooms: [], equip: [], markups: [] };
  assert.deepEqual(ws.wsSheetContent(slot, null).streams, ['garbage', 'recycling', 'fogo', 'glass']);
});

test('wsSheetContent: a swept path only counts once it has been generated', () => {
  assert.equal(ws.wsSheetContent({}, { paths: [{ result: null }] }).swept, false);
  assert.equal(ws.wsSheetContent({}, { paths: [{ result: {} }] }).swept, true);
  assert.equal(ws.wsSheetContent({}, null).swept, false);
});

test('wsSheetContent: tolerates an empty page', () => {
  const c = ws.wsSheetContent(null, null);
  assert.deepEqual(c.streams, []);
  assert.equal(c.rooms, false);
});

test('wsLegendItems: lists a swatch per placed stream, in canonical order', () => {
  const c = ws.wsSheetContent({ bins: [bin('fogo'), bin('garbage')], rooms: [], equip: [], markups: [] }, null);
  const rows = ws.wsLegendItems(ALL_ON, c);
  const streams = rows.filter(r => r.key.startsWith('stream-'));
  assert.deepEqual(streams.map(r => r.key), ['stream-garbage', 'stream-fogo']);
  assert.equal(streams[0].label, 'Garbage bin');
  assert.equal(streams[0].style, 'swatch');
  assert.ok(/^#[0-9A-Fa-f]{6}$/.test(streams[0].col), 'every row needs a drawable colour');
});

test('wsLegendItems: an unplaced stream never gets a swatch', () => {
  const c = ws.wsSheetContent({ bins: [bin('garbage')], rooms: [], equip: [], markups: [] }, null);
  const rows = ws.wsLegendItems(ALL_ON, c);
  assert.ok(rows.some(r => r.key === 'stream-garbage'));
  for (const s of ['recycling', 'fogo', 'glass', 'paper', 'soft'])
    assert.equal(rows.some(r => r.key === 'stream-' + s), false, `${s} is not on the page`);
});

test('wsLegendItems: hiding a layer removes its styles', () => {
  const slot = {
    bins: [bin('garbage')], rooms: [{ kind: 'res' }], equip: [{ aisle: true }],
    markups: [mark('disposal'), mark('transfer')],
  };
  const c = ws.wsSheetContent(slot, { paths: [{ result: {} }] });
  const all = ws.wsLegendItems(ALL_ON, c).map(r => r.key);
  assert.ok(all.includes('room') && all.includes('stream-garbage') && all.includes('disposal') && all.includes('swept'));

  assert.equal(ws.wsLegendItems({ ...ALL_ON, binroom: false }, c).some(r => r.key === 'room'), false);
  assert.equal(ws.wsLegendItems({ ...ALL_ON, waste: false }, c).some(r => r.key.startsWith('stream-')), false);
  assert.equal(ws.wsLegendItems({ ...ALL_ON, waste: false }, c).some(r => r.key === 'aisle'), false);
  assert.equal(ws.wsLegendItems({ ...ALL_ON, markups: false }, c).some(r => r.key === 'disposal'), false);
  assert.equal(ws.wsLegendItems({ ...ALL_ON, swept: false }, c).some(r => r.key === 'swept'), false);
});

test('wsLegendItems: the swept layer contributes envelope, clearance and wheel path', () => {
  const c = ws.wsSheetContent({}, { paths: [{ result: {} }] });
  const keys = ws.wsLegendItems(ALL_ON, c).map(r => r.key);
  assert.deepEqual(keys, ['swept', 'swept-clr', 'swept-wheel']);
  // ...and nothing when the layer is on but no path has been generated
  assert.deepEqual(ws.wsLegendItems(ALL_ON, ws.wsSheetContent({}, null)), []);
});

test('wsLegendItems: a commercial room adds its own outline row', () => {
  const res = ws.wsSheetContent({ rooms: [{ kind: 'res' }], bins: [], equip: [], markups: [] }, null);
  const com = ws.wsSheetContent({ rooms: [{ kind: 'res' }, { kind: 'com' }], bins: [], equip: [], markups: [] }, null);
  assert.equal(ws.wsLegendItems(ALL_ON, res).some(r => r.key === 'room-com'), false);
  assert.equal(ws.wsLegendItems(ALL_ON, com).some(r => r.key === 'room-com'), true);
});

test('wsLegendItems: an empty page produces an empty legend, not an empty box', () => {
  assert.deepEqual(ws.wsLegendItems(ALL_ON, ws.wsSheetContent({}, null)), []);
  assert.deepEqual(ws.wsLegendItems({}, {}), []);
});

test('wsLegendItems: every row carries a label, a style and a colour', () => {
  const slot = {
    bins: [bin('garbage'), bin('recycling')], rooms: [{ kind: 'com' }], equip: [{ aisle: false }, { aisle: true }],
    markups: [mark('disposal'), mark('transfer'), mark('text'), mark('measure'), mark('area')],
  };
  const rows = ws.wsLegendItems(ALL_ON, ws.wsSheetContent(slot, { paths: [{ result: {} }] }));
  assert.ok(rows.length >= 12, `expected a full legend, got ${rows.length}`);
  const keys = rows.map(r => r.key);
  assert.equal(new Set(keys).size, keys.length, 'legend keys must be unique');
  for (const r of rows) {
    assert.ok(r.label && r.label.length > 2, `row ${r.key} has no label`);
    assert.ok(['line', 'swatch', 'hatch', 'arrow', 'leader', 'dim', 'poly', 'dash'].includes(r.style), `row ${r.key} style ${r.style}`);
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(r.col), `row ${r.key} colour ${r.col}`);
  }
});

// ── branding ────────────────────────────────────────────────────────────
test('branding is one object, not literals scattered through the export', () => {
  assert.equal(typeof ws.WS_BRAND, 'object');
  assert.equal(ws.WS_BRAND.company, 'Pro Waste Consultants');
  assert.ok(ws.WS_BRAND.credit.includes('WastePlanner'));
  assert.ok(ws.WS_BRAND.credit.includes('wasteplanner.au'));
  // the company name must not be hard-coded anywhere else in the export path
  const hits = SOURCE.split('Pro Waste Consultants').length - 1;
  const inBrand = SOURCE.slice(SOURCE.indexOf('const WS_BRAND = {'), SOURCE.indexOf('const WS_SHEET = {'))
    .split('Pro Waste Consultants').length - 1;
  assert.equal(inBrand, 1, 'WS_BRAND should name the company exactly once');
  assert.ok(hits >= 1);
});

test('the pre-launch gate on branding is recorded next to the constant', () => {
  const block = SOURCE.slice(SOURCE.indexOf('// ── BRANDING'), SOURCE.indexOf('const WS_SHEET = {'));
  assert.match(block, /PRE-LAUNCH GATE/, 'the org-settings gate must be stated at the constant');
  assert.match(block, /organisation-level[\s\S]{0,12}settings/i);
  assert.match(block, /CLAUDE\.md/, 'and must point at the deferrals list');
});

test('unknown branding fields are blank rather than invented', () => {
  // An ABN and street address are legal identifiers on a drawing. They are left
  // empty on purpose and the title block omits empty lines.
  for (const k of ['abn', 'address', 'phone', 'email'])
    assert.equal(typeof ws.WS_BRAND[k], 'string', `${k} must exist so the title block can test it`);
  assert.equal(ws.WS_BRAND.abn, '', 'an ABN must never be invented');
  assert.equal(ws.WS_BRAND.address, '');
  assert.ok(ws.WS_BRAND.logoDataUrl.startsWith('data:image/png;base64,'),
    'the logo must be embedded so an export never depends on a network fetch');
});

// ── wiring guards ───────────────────────────────────────────────────────
test('the DXF export is untouched by the sheet work', () => {
  assert.match(SOURCE, /function wsExportDXF\(\) \{[\s\S]{0,400}wsLayoutExportDXF\(\);[\s\S]{0,200}wsSweptDXF\(\);/);
  assert.match(SOURCE, /function wsLayoutExportDXF\(\)/);
});

test('a missing plan scale blocks a TRUE-SCALE crop, not the whole export', () => {
  // Full-sheet mode reproduces the base plan and needs no scale of ours, so the
  // export must still run; the crop mode falls back to NOT TO SCALE instead.
  assert.match(SOURCE, /if \(s\.mode === 'crop' && !d\.hasScale\) s\.showScale = false;/,
    'an unscaled crop must be forced to NOT TO SCALE, never silently scaled');
  assert.match(SOURCE, /hasScale: !!mpp/, 'the dialog must know whether a real scale exists');
});

test('the sheet states its scale and never fits to page', () => {
  assert.ok(SOURCE.includes("'1:' + s.scale + '@A3'"), 'the issue card must state 1:X@A3');
  const exp = SOURCE.slice(SOURCE.indexOf('async function wsSheetExport'), SOURCE.indexOf('function wsSheetRasterOverlay'));
  assert.match(exp, /wsSheetCropPx\(s\.scale, viewMm, d\.mpp/,
    'the crop window must be derived from the chosen scale');
  assert.doesNotMatch(exp, /fitTo|fit-to-page/i);
});

test('editing chrome is cleared before the sheet renders and restored after', () => {
  const exp = SOURCE.slice(SOURCE.indexOf('async function wsSheetExport'), SOURCE.indexOf('function wsSheetRasterOverlay'));
  assert.match(exp, /const selWas = WS_LAYOUT\.sel/, 'selection must be parked');
  assert.match(exp, /WS_LAYOUT\.sel = null;/);
  assert.match(exp, /finally \{[\s\S]{0,200}WS_LAYOUT\.sel = selWas/, 'and restored in a finally block');
});

test('hidden layers are removed from the exported overlay', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('function wsSheetOverlayClone'), SOURCE.indexOf('async function wsSheetExport'));
  assert.match(fn, /WS\.layers\[n\] === false/);
  assert.match(fn, /removeChild\(g\)/, 'a hidden layer must be dropped, not just styled away');
});

// ── full-sheet mode: 1:1 reproduction ───────────────────────────────────
test('full sheet: an A3 base plan reproduces exactly, with ZERO added margin', () => {
  const fl = ws.wsFullSheetLayout({ w: 420, h: 297 });
  assert.equal(fl.factor, 1, 'must be 1:1');
  assert.equal(fl.reduced, false);
  assert.deepEqual(fl.page, { w: 420, h: 297 }, 'output page equals the source page');
  // the plan fills the page edge to edge — no margin anywhere
  assert.deepEqual(fl.plan, { x: 0, y: 0, w: 420, h: 297 });
  assert.equal(fl.note, '', 'nothing to warn about at 1:1');
  assert.equal(fl.format, 'A3');
});

test('full sheet: page dimensions are preserved for every standard size', () => {
  for (const p of ws.WS_PAPER_SIZES) {
    for (const src of [{ w: p.a, h: p.b }, { w: p.b, h: p.a }]) {
      const fl = ws.wsFullSheetLayout(src);
      assert.deepEqual(fl.page, src, p.name + ' page size not preserved');
      assert.deepEqual(fl.plan, { x: 0, y: 0, w: src.w, h: src.h }, p.name + ' added a margin');
      assert.equal(fl.factor, 1);
      assert.equal(fl.format, p.name);
    }
  }
});

test('full sheet: a non-standard page is still reproduced exactly', () => {
  const odd = { w: 500, h: 333 };
  const fl = ws.wsFullSheetLayout(odd);
  assert.deepEqual(fl.page, odd);
  assert.deepEqual(fl.plan, { x: 0, y: 0, w: 500, h: 333 });
  assert.equal(fl.factor, 1);
  assert.equal(fl.format, 'custom', 'a non-standard size is labelled, not silently coerced');
  assert.equal(fl.sourceFormat, null);
});

test('full sheet: A1 reduced to A3 is centred, scaled once, and says so', () => {
  const fl = ws.wsFullSheetLayout({ w: 841, h: 594 }, 'A3');
  assert.deepEqual(fl.page, { w: 420, h: 297 });
  assert.equal(fl.reduced, true);
  assert.ok(fl.factor > 0.49 && fl.factor < 0.5, 'roughly half size');
  // one uniform factor on both axes — never stretched to fill
  assert.ok(Math.abs(fl.plan.w / 841 - fl.plan.h / 594) < 1e-9, 'aspect ratio must be preserved');
  // centred, and inside the page
  assert.ok(Math.abs((fl.plan.x + fl.plan.w / 2) - 210) < 1e-6);
  assert.ok(Math.abs((fl.plan.y + fl.plan.h / 2) - 148.5) < 1e-6);
  assert.ok(fl.plan.w <= 420 + 1e-9 && fl.plan.h <= 297 + 1e-9);
  assert.match(fl.note, /REDUCED FROM A1/);
  assert.match(fl.note, /REFER BASE PLAN SCALE BAR/);
});

test('full sheet: reduction never enlarges', () => {
  // an A4 source offered A3 output would be an enlargement — not offered
  assert.deepEqual(ws.wsFullSheetTargets({ w: 297, h: 210 }).map(t => t.name), ['A4']);
  assert.deepEqual(ws.wsFullSheetTargets({ w: 841, h: 594 }).map(t => t.name), ['A1', 'A2', 'A3', 'A4']);
  // the first option is always the source size itself
  assert.equal(ws.wsFullSheetTargets({ w: 420, h: 297 })[0].target, null);
});

test('full sheet: a non-standard source offers only its own size', () => {
  const t = ws.wsFullSheetTargets({ w: 500, h: 333 });
  assert.equal(t.length, 1);
  assert.equal(t[0].target, null);
  assert.match(t[0].label, /as base plan/);
});

test('wsMatchPaper: identifies standard sheets in either orientation, within tolerance', () => {
  assert.equal(ws.wsMatchPaper({ w: 420, h: 297 }).name, 'A3');
  assert.equal(ws.wsMatchPaper({ w: 297, h: 420 }).name, 'A3', 'portrait too');
  assert.equal(ws.wsMatchPaper({ w: 421, h: 296 }).name, 'A3', 'a mm of rounding is still A3');
  assert.equal(ws.wsMatchPaper({ w: 500, h: 333 }), null);
  assert.equal(ws.wsMatchPaper(null), null);
  assert.equal(ws.wsMatchPaper({ w: 0, h: 0 }), null);
});

test('wsPtToMm: PDF points convert at 72 dpi', () => {
  assert.ok(Math.abs(ws.wsPtToMm(72) - 25.4) < 1e-9);
  assert.ok(Math.abs(ws.wsPtToMm(842) - 297.0) < 0.1, 'A3 short edge in points');
  assert.ok(Math.abs(ws.wsPtToMm(1191) - 420.0) < 0.2, 'A3 long edge in points');
});

// ── scale line, per mode ────────────────────────────────────────────────
test('wsSheetScaleLine: full sheet defers to the base plan', () => {
  assert.equal(ws.wsSheetScaleLine({ mode: 'full' }), 'Refer base plan');
  assert.equal(ws.wsSheetScaleLine({ mode: 'full', scale: 200 }), 'Refer base plan',
    'a stale crop scale must not leak onto a full sheet');
});

test('wsSheetScaleLine: a crop states its scale, or NOT TO SCALE — never nothing', () => {
  assert.equal(ws.wsSheetScaleLine({ mode: 'crop', scale: 200, showScale: true }), '1:200@A3');
  assert.equal(ws.wsSheetScaleLine({ mode: 'crop', scale: 200, showScale: false }), 'NOT TO SCALE');
  assert.equal(ws.wsSheetScaleLine({ mode: 'crop', scale: 500 }), '1:500@A3', 'defaults to stating it');
  for (const s of [{ mode: 'full' }, { mode: 'crop', scale: 100 }, { mode: 'crop', showScale: false }])
    assert.ok(String(ws.wsSheetScaleLine(s)).length > 0, 'the scale line is never blank');
});

// ── dialog wiring ───────────────────────────────────────────────────────
test('every field the collector reads is actually rendered by the dialog', () => {
  // Regression: a bad edit dropped the notes/legend/credit controls from the
  // form. The collector then threw on a null element and the export died with
  // no visible error at all.
  const render = SOURCE.slice(SOURCE.indexOf('function wsSheetDlgRender'), SOURCE.indexOf('function wsSheetLayerSummary'));
  const collect = SOURCE.slice(SOURCE.indexOf('function wsSheetDlgCollect'), SOURCE.indexOf('function wsExportDXF'));
  // ids appear either literally or through the fld('shd-x', …) field helper
  const rendered = new Set([
    ...[...render.matchAll(/id="(shd-[a-z]+)"/g)].map(m => m[1]),
    ...[...render.matchAll(/fld\('(shd-[a-z]+)'/g)].map(m => m[1]),
  ]);
  const read = new Set([...collect.matchAll(/'(shd-[a-z]+)'/g)].map(m => m[1]));
  for (const id of read)
    assert.ok(rendered.has(id), '#' + id + ' is read by the collector but never rendered');
  // the always-present controls
  for (const id of ['shd-title', 'shd-sheet', 'shd-no', 'shd-rev', 'shd-pname',
                    'shd-paddr', 'shd-notes', 'shd-north', 'shd-legend', 'shd-credit'])
    assert.ok(rendered.has(id), '#' + id + ' missing from the dialog');
  // and the mode-specific ones
  assert.ok(rendered.has('shd-scale') && rendered.has('shd-showscale'), 'crop-mode controls missing');
  assert.ok(rendered.has('shd-target'), 'full-mode output paper control missing');
});

test('the collector never dereferences a missing element', () => {
  const collect = SOURCE.slice(SOURCE.indexOf('function wsSheetDlgCollect'), SOURCE.indexOf('function wsExportDXF'));
  assert.doesNotMatch(collect, /g\('shd-[a-z]+'\)\.value/,
    'a direct .value on a possibly-absent control will throw and silently kill the export');
  assert.doesNotMatch(collect, /g\('shd-[a-z]+'\)\.checked/);
});

test('both export entry points surface their errors', () => {
  // An async onclick handler that rejects shows the user nothing.
  assert.match(SOURCE, /function wsExportPDF\(\) \{\s*\r?\n\s*wsExportPDFAsync\(\)\.catch\(/);
  assert.match(SOURCE, /function wsSheetExportSafe\(\) \{\s*\r?\n\s*wsSheetExport\(\)\.catch\(/);
  assert.match(SOURCE, /onclick="wsSheetExportSafe\(\)"/, 'the dialog button must use the guarded wrapper');
});

// ── Base plan screening ─────────────────────────────────────────────────────
// The plan is faded on export so the waste layout, markups and swept paths are
// the figure and the architect's drawing is the ground. Two things must hold:
// the fade is bounded (it can never blank the base plan), and it touches the
// RASTER underlay only — annotation is what the fade exists to make readable.

test('wsPlanScreenAlpha: 60% by default, bounded, and never fully transparent', () => {
  assert.equal(ws.WS_PLAN_SCREEN_DEFAULT, 60);
  assert.equal(ws.wsPlanScreenAlpha(60), 0.6);
  assert.equal(ws.wsPlanScreenAlpha(100), 1, '100% is the plan exactly as supplied');
  // a blank underlay would drop the base plan with no error at all
  assert.ok(ws.wsPlanScreenAlpha(0) >= 0.05);
  assert.equal(ws.wsPlanScreenAlpha(-40), 0.05);
  assert.equal(ws.wsPlanScreenAlpha(500), 1, 'over 100 cannot darken the plan past its own tone');
  // garbage in falls back to the default rather than to 0
  assert.equal(ws.wsPlanScreenAlpha(undefined), 0.6);
  assert.equal(ws.wsPlanScreenAlpha('abc'), 0.6);
  assert.equal(ws.wsPlanScreenAlpha(null), 0.6, 'Number(null) is 0, which must not blank the plan');
});

test('screening is applied to the underlay only, and reset afterwards', () => {
  const fn = SOURCE.slice(SOURCE.indexOf('async function wsSheetRenderUnderlay'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /globalAlpha = wsPlanScreenAlpha\(screenPct\)/);
  // white ground first: alpha over white lightens toward paper. Alpha over the
  // page's own backdrop would just make the plan translucent, not screened.
  assert.ok(body.indexOf("fillStyle = '#fff'") < body.indexOf('globalAlpha = wsPlanScreenAlpha'),
    'the white fill must precede the screened draw');
  assert.ok(body.indexOf('globalAlpha = 1') > body.indexOf('drawImage'),
    'alpha must be reset after the draw so nothing else inherits it');
  // the vector overlay is added by doc.svg(), never through this canvas
  assert.doesNotMatch(body, /doc\.svg|svg2pdf/);
});

test('the screening control is wired end to end', () => {
  assert.match(SOURCE, /id="shd-screen"/, 'no control in the dialog');
  assert.match(SOURCE, /wsSheetDlgSet\('planScreen'/, 'the control does not write the setting');
  assert.match(SOURCE, /planScreen: WS_PLAN_SCREEN_DEFAULT/, 'not defaulted for new sheets');
  assert.match(SOURCE, /wsSheetRenderUnderlay\(crop, 4200, s\.planScreen\)/,
    'the setting never reaches the renderer');
});

test('changing a dialog control keeps what has already been typed', () => {
  // wsSheetDlgSet re-renders the whole form, so it must harvest the inputs
  // first — otherwise picking a scale silently discards the drawing title.
  const fn = SOURCE.slice(SOURCE.indexOf('function wsSheetDlgSet'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.indexOf('wsSheetDlgCollect') < body.indexOf('wsSheetDlgRender'),
    'the form must be collected before it is rebuilt');
});
