'use strict';
// ── SOURCE EXTRACTION HARNESS ────────────────────────────────────────────
// WastePlanner is a single-file app: index.html is the only source of truth.
// These tests therefore NEVER copy geometry code — they lift the exact
// declarations out of index.html by anchor pattern and evaluate them in a
// node:vm context with a stubbed DOM. If a function is renamed, moved, or its
// column-0 formatting changes, extraction throws loudly rather than silently
// testing a stale duplicate.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const INDEX_PATH = path.join(__dirname, '..', 'index.html');
const SOURCE = fs.readFileSync(INDEX_PATH, 'utf8');
const LINES = SOURCE.split(/\r?\n/);

// ── bracket scanner ──
// Walks a line updating bracket depth, skipping string literals and comments so
// that braces inside them don't unbalance the count. `st` persists across lines.
function scanLine(line, st) {
  for (let i = 0; i < line.length; i++) {
    const c = line[i], n = line[i + 1];
    if (st.inBlockComment) {
      if (c === '*' && n === '/') { st.inBlockComment = false; i++; }
      continue;
    }
    if (st.inString) {
      if (c === '\\') { i++; continue; }
      if (c === st.quote) st.inString = false;
      continue;
    }
    if (c === '/' && n === '/') return st;                       // line comment
    if (c === '/' && n === '*') { st.inBlockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { st.inString = true; st.quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') st.depth++;
    else if (c === ')' || c === ']' || c === '}') st.depth--;
  }
  return st;
}

// Extract one top-level declaration: from the (unique) line matching `pattern`
// through to the line where bracket depth returns to zero.
function extractBlock(pattern) {
  const hits = [];
  for (let i = 0; i < LINES.length; i++) if (pattern.test(LINES[i])) hits.push(i);
  if (hits.length === 0) throw new Error(`extract: no line in index.html matches ${pattern} — has it been renamed?`);
  if (hits.length > 1) throw new Error(`extract: ${pattern} matched ${hits.length} lines (${hits.map(i => i + 1).join(', ')}) — anchor is ambiguous`);

  const start = hits[0];
  const st = { depth: 0, inString: false, inBlockComment: false, quote: null };
  for (let i = start; i < LINES.length; i++) {
    scanLine(LINES[i], st);
    if (st.depth === 0 && !st.inString && !st.inBlockComment) {
      return { text: LINES.slice(start, i + 1).join('\n'), startLine: start + 1, endLine: i + 1 };
    }
  }
  throw new Error(`extract: unterminated block starting at index.html:${start + 1}`);
}

// The layout engine's pure room/schedule core. Kept separate from the swept-path
// blocks because it has its own dependency set (WS_STREAMS, polygon helpers).
const LAYOUT_BLOCKS = [
  ['WS_STREAMS',        /^const WS_STREAMS = \[/],
  ['wsRoomPts',         /^function wsRoomPts\(/],
  ['wsPolyArea',        /^function wsPolyArea\(/],
  ['wsPolyBBox',        /^function wsPolyBBox\(/],
  ['wsPointInPoly',     /^function wsPointInPoly\(/],
  ['WS_ROOM_SEQ',       /^let WS_ROOM_SEQ = 0;/],
  ['wsRoomNewId',       /^function wsRoomNewId\(\)/],
  ['wsEnsureRoomIds',   /^function wsEnsureRoomIds\(/],
  ['wsRoomAtPt',        /^function wsRoomAtPt\(/],
  ['wsBinRoomId',       /^function wsBinRoomId\(/],
  ['wsTagBinsToRooms',  /^function wsTagBinsToRooms\(/],
  ['WS_PROVISION_STREAMS', /^const WS_PROVISION_STREAMS = /],
  ['WS_PROVISION_PALETTE', /^const WS_PROVISION_PALETTE = /],
  ['wsProvisionNextColour', /^function wsProvisionNextColour\(/],
  ['wsProvisionCustomId', /^function wsProvisionCustomId\(/],
  ['wsProvisionList', /^function wsProvisionList\(/],
  ['wsProvisionById', /^function wsProvisionById\(/],
  ['wsProvisionReconcile', /^function wsProvisionReconcile\(/],
  ['WS_ZONE_TYPES', /^const WS_ZONE_TYPES = /],
  ['wsZoneColour', /^function wsZoneColour\(/],
  ['wsZoneLabel', /^function wsZoneLabel\(/],
  ['wsIsZone', /^function wsIsZone\(/],
  ['wsZoneDxfLayer', /^function wsZoneDxfLayer\(/],
  ['wsZoneLegendItems', /^function wsZoneLegendItems\(/],
  ['wsCompactedVolume', /^function wsCompactedVolume\(/],
  ['wsBinCount', /^function wsBinCount\(/],
  ['wsPairedOutputQty', /^function wsPairedOutputQty\(/],
  ['wsEquipInvariants', /^function wsEquipInvariants\(/],
  ['wsReconcileRoomEquipment', /^function wsReconcileRoomEquipment\(/],
  ['wsAdoptedQty', /^function wsAdoptedQty\(/],
  ['wsQtyDivergence', /^function wsQtyDivergence\(/],
  ['wsInstanceCollectable', /^function wsInstanceCollectable\(/],
  ['wsRoomTables', /^function wsRoomTables\(/],
  ['wsShowCompactionColumn', /^function wsShowCompactionColumn\(/],
  ['wsRoomTargets',     /^function wsRoomTargets\(/],
  ['wsRoomReconcile',   /^function wsRoomReconcile\(/],
  ['wsEquipLibrary', /^function wsEquipLibrary\(/],
  ['WS_STREAM_ALIAS', /^const WS_STREAM_ALIAS = \{/],
  ['wsStreamKey', /^function wsStreamKey\(/],
  ['wsStreamId', /^function wsStreamId\(/],
  ['wsEquipAllowedStreams', /^function wsEquipAllowedStreams\(/],
  ['wsEquipStreamIssues', /^function wsEquipStreamIssues\(/],
  ['wsEquipAssignStream', /^function wsEquipAssignStream\(/],
  ['wsEquipPickerGroups', /^function wsEquipPickerGroups\(/],
  ['wsMigrateEquipInstance', /^function wsMigrateEquipInstance\(/],
  ['wsMigrateEquipList', /^function wsMigrateEquipList\(/],
  ['wsWmpEquipmentText', /^function wsWmpEquipmentText\(/],
  ['wsWmpShowCompaction', /^function wsWmpShowCompaction\(/],
  ['wsReconcileSnapshot', /^function wsReconcileSnapshot\(/],
  ['wsTargetsToDemand', /^function wsTargetsToDemand\(/],
  ['wsRoomEquipInstances', /^function wsRoomEquipInstances\(/],
  ['wsRoomReconcileWithEquipment', /^function wsRoomReconcileWithEquipment\(/],
  ['wsRoomSyncBBox',    /^function wsRoomSyncBBox\(/],
  ['wsRoomEnsurePts',   /^function wsRoomEnsurePts\(/],
  ['wsRoomTranslate',   /^function wsRoomTranslate\(/],
  ['wsRoomMoveVertex',  /^function wsRoomMoveVertex\(/],
  ['wsRoomRemovableCorner', /^function wsRoomRemovableCorner\(/],
  ['wsRoomRemoveCornerAt', /^function wsRoomRemoveCornerAt\(/],
  ['wsRoomNearestVertex', /^function wsRoomNearestVertex\(/],
  ['wsRoomEdgeMidpoints', /^function wsRoomEdgeMidpoints\(/],
  ['wsRoomInsertVertex', /^function wsRoomInsertVertex\(/],
  ['wsRoomDeleteVertex', /^function wsRoomDeleteVertex\(/],
  ['wsRoomAttached',    /^function wsRoomAttached\(/],
  ['wsRoomDragMove',    /^function wsRoomDragMove\(/],
  ['wsRoomHandleAt',    /^function wsRoomHandleAt\(/],
  ['wsAnyRoomHandleAt', /^function wsAnyRoomHandleAt\(/],
  ['wsRoomCursorAt',    /^function wsRoomCursorAt\(/],
  ['wsSelSet', /^function wsSelSet\(/],
  ['wsSelHas', /^function wsSelHas\(/],
  ['wsExpandGroups', /^function wsExpandGroups\(/],
  ['wsGroupNewId', /^function wsGroupNewId\(\)/],
  ['WS_GROUP_SEQ', /^let WS_GROUP_SEQ = 0;/],
  ['wsGroupItems', /^function wsGroupItems\(/],
  ['wsUngroupItems', /^function wsUngroupItems\(/],
  ['wsMarqueeRect', /^function wsMarqueeRect\(/],
  ['wsMarqueeHits', /^function wsMarqueeHits\(/],
  ['wsCloneItem',       /^function wsCloneItem\(/],    ['wsSnapVertexOrtho', /^function wsSnapVertexOrtho\(/],
  ['wsSnapAxis',        /^function wsSnapAxis\(/],
  ['WS_DIM_COLOUR',     /^const WS_DIM_COLOUR = /],
  ['wsDimText',         /^function wsDimText\(/],
  ['wsRoomDimEdges',    /^function wsRoomDimEdges\(/],
  ['WS_DOOR_KINDS',     /^const WS_DOOR_KINDS = \{/],
  ['wsDoorGeometry',    /^function wsDoorGeometry\(/],
  ['WS_ZONE_PURPLE',    /^const WS_ZONE_PURPLE = /],
  ['wsIsHardWasteZone', /^function wsIsHardWasteZone\(/],
  ['wsRoomStroke',      /^function wsRoomStroke\(/],
];

// Sheet export: scale selection and legend content. Pure maths and data, no PDF
// library involved — the jsPDF drawing calls sit on top of these.
const SHEET_BLOCKS = [
  ['WS_STREAMS',           /^const WS_STREAMS = \[/],
  ['WS_BRAND',             /^const WS_BRAND = \{/],
  ['WS_SHEET',             /^const WS_SHEET = \{ w: 420/],
  ['WS_STD_SCALES',        /^const WS_STD_SCALES = \[/],
  ['WS_PLAN_SCREEN_DEFAULT', /^const WS_PLAN_SCREEN_DEFAULT = /],
  ['wsPlanScreenAlpha',    /^function wsPlanScreenAlpha\(/],
  ['wsSheetViewportMm',    /^function wsSheetViewportMm\(/],
  ['wsRequiredScaleDenom', /^function wsRequiredScaleDenom\(/],
  ['wsScaleFits',          /^function wsScaleFits\(/],
  ['wsPickExportScale',    /^function wsPickExportScale\(/],
  ['wsCropExtentM',        /^function wsCropExtentM\(/],
  ['wsVisibleCanvasRect',  /^function wsVisibleCanvasRect\(/],
  ['wsSheetCropPx',        /^function wsSheetCropPx\(/],
  ['wsSheetContent',       /^function wsSheetContent\(/],
  ['WS_ZONE_TYPES', /^const WS_ZONE_TYPES = \{/],
  ['wsZoneColour', /^function wsZoneColour\(/],
  ['wsZoneLabel', /^function wsZoneLabel\(/],
  ['wsIsZone', /^function wsIsZone\(/],
  ['wsZoneDxfLayer', /^function wsZoneDxfLayer\(/],
  ['wsZoneLegendItems', /^function wsZoneLegendItems\(/],
  ['wsLegendItems',        /^function wsLegendItems\(/],
  ['WS_PAPER_SIZES',       /^const WS_PAPER_SIZES = \[/],
  ['wsMatchPaper',         /^function wsMatchPaper\(/],
  ['wsFullSheetLayout',    /^function wsFullSheetLayout\(/],
  ['wsFullSheetTargets',   /^function wsFullSheetTargets\(/],
  ['wsPtToMm',             /^function wsPtToMm\(/],
  ['wsSheetScaleLine',     /^function wsSheetScaleLine\(/],
  ['WS_SHEET_CARDS',       /^const WS_SHEET_CARDS = \{/],
  ['wsRectsOverlap',       /^function wsRectsOverlap\(/],
  ['wsSheetCardRects',     /^function wsSheetCardRects\(/],
  ['wsSheetCardCollisions',/^function wsSheetCardCollisions\(/],
];

// The swept-path / Ackermann engine, in source order (declaration order matters
// for the const/let bindings).
const BLOCKS = [
  ['wsRsPlan',             /^const wsRsPlan = \(\(\) => \{/],
  ['WS_VEH',               /^const WS_VEH = \[/],
  ['WS_LOCK_TO_LOCK_M',    /^const WS_LOCK_TO_LOCK_M = /],
  ['wsRearAxleRadius',     /^function wsRearAxleRadius\(/],
  ['wsDeltaMax',           /^function wsDeltaMax\(/],
  ['wsGearSegments',       /^function wsGearSegments\(/],
  ['WS_VEH_DB',            /^let WS_VEH_DB = null;/],
  ['wsVehAll',             /^function wsVehAll\(\)/],
  ['wsVehById',            /^function wsVehById\(/],
  ['wsSweptMpp',           /^function wsSweptMpp\(\)/],
  ['wsNormA',              /^function wsNormA\(/],
  ['wsLblF',               /^function wsLblF\(\)/],
  ['wsTracksFromPos',      /^function wsTracksFromPos\(/],
  ['wsShouldRefine',       /^function wsShouldRefine\(/],
  ['WS_REFINE_STEP',       /^const WS_REFINE_STEP = /],
  ['WS_REFINE_SMOOTH',     /^const WS_REFINE_SMOOTH = /],
  ['WS_REFINE_REPAIR',     /^const WS_REFINE_REPAIR = /],
  ['wsRefinePos',          /^function wsRefinePos\(/],
  ['wsCalibrationNumbers', /^function wsCalibrationNumbers\(/],
];

const EXPORTED = BLOCKS.map(([name]) => name);

function buildSource(blocks) {
  const list = blocks || BLOCKS;
  const parts = list.map(([name, pattern]) => {
    const b = extractBlock(pattern);
    return { name, ...b };
  });
  parts.sort((a, b) => a.startLine - b.startLine);
  const body = parts.map(p => `/* index.html:${p.startLine}-${p.endLine} */\n${p.text}`).join('\n\n');
  const names = list.map(([name]) => name);
  const epilogue = `\n;return { ${names.join(', ')} };\n`;
  return { code: body + epilogue, parts };
}

// ── DOM stub ──
// Only what the extracted code touches: getElementById returning objects with
// .value / .width / .checked. Unknown ids return null, matching a real page
// where the swept panel hasn't rendered.
function createDom(initial = {}) {
  const els = Object.assign(Object.create(null), initial);
  return {
    getElementById(id) { return Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null; },
    addEventListener() {},
    __set(id, el) { els[id] = el; },
    __remove(id) { delete els[id]; },
  };
}

/**
 * Evaluate the extracted engine and return its bindings.
 *
 * Deliberately `new Function` rather than `vm.runInContext`: a vm context is a
 * separate realm, so arrays and objects the extracted code builds get that
 * realm's prototypes and `assert.deepStrictEqual` rejects them as "same
 * structure but not reference-equal". Running in the host realm keeps the
 * intrinsics shared. The isolation that matters here is lexical — the function
 * body's declarations never touch the host global — and that still holds.
 *
 * @param {object} [opts.elements] id -> stub element, seeds the DOM stub.
 * @param {Array}  [opts.blocks]   block list to extract (defaults to BLOCKS).
 * @returns {object} the exported bindings plus `dom` (the stub) and `meta`.
 */
function loadEngine(opts = {}) {
  const { code, parts } = buildSource(opts.blocks);
  const dom = createDom(opts.elements);
  let factory;
  try {
    factory = new Function('document', 'console', code);
  } catch (e) {
    throw new Error(`extract: the assembled source from index.html does not parse — ${e.message}`);
  }
  const api = Object.assign({}, factory(dom, console));
  api.dom = dom;
  api.meta = parts.map(p => ({ name: p.name, startLine: p.startLine, endLine: p.endLine }));
  return api;
}

// ── inline <script> blocks, for the syntax sweep ──
function scriptBlocks() {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(SOURCE)) !== null) {
    const attrs = m[1] || '';
    const body = m[2];
    const startLine = SOURCE.slice(0, m.index).split(/\r?\n/).length;
    const typeMatch = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
    out.push({
      startLine,
      attrs: attrs.trim(),
      type: typeMatch ? typeMatch[1].toLowerCase() : '',
      src: srcMatch ? srcMatch[1] : null,
      body,
    });
  }
  return out;
}

/** The layout room/schedule core, evaluated on its own (no DOM needed). */
function loadLayout(opts = {}) {
  return loadEngine({ ...opts, blocks: LAYOUT_BLOCKS });
}

/** The sheet-export scale and legend core (no PDF library involved). */
function loadSheet(opts = {}) {
  return loadEngine({ ...opts, blocks: SHEET_BLOCKS });
}

module.exports = { INDEX_PATH, SOURCE, LINES, extractBlock, buildSource, loadEngine, loadLayout, loadSheet, createDom, scriptBlocks, BLOCKS, LAYOUT_BLOCKS, SHEET_BLOCKS };
