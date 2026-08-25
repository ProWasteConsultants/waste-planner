'use strict';
// DXF export validation.
//
// Regression: exports were rejected by Autodesk Viewer as AutoCAD-InvalidFile
// because the file was a bare BLOCKS/ENTITIES stream — no HEADER ($ACADVER),
// no TABLES, layers referenced but never defined, and blocks defined but never
// INSERTed. These tests build a real export from the real generators (via the
// extraction harness — nothing duplicated) and then hand the file to ezdxf,
// a strict DXF parser, so the unit tests cannot pass while the file is
// unopenable in CAD.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadEngine, SOURCE } = require('./extract.js');

const BLOCKS = [
  ['WS_STREAMS',        /^const WS_STREAMS = \[/],
  ['wsRoomPts',         /^function wsRoomPts\(/],
  ['wsPolyArea',        /^function wsPolyArea\(/],
  ['wsPolyBBox',        /^function wsPolyBBox\(/],
  ['wsPointInPoly',     /^function wsPointInPoly\(/],
  ['WS_DIM_COLOUR',     /^const WS_DIM_COLOUR = /],
  ['wsDimText',         /^function wsDimText\(/],
  ['wsRoomDimEdges',    /^function wsRoomDimEdges\(/],
  ['WS_DOOR_KINDS',     /^const WS_DOOR_KINDS = \{/],
  ['wsDoorGeometry',    /^function wsDoorGeometry\(/],
  ['WS_ZONE_PURPLE',    /^const WS_ZONE_PURPLE = /],
  ['wsIsHardWasteZone', /^function wsIsHardWasteZone\(/],
  ['WS_ZONE_TYPES',     /^const WS_ZONE_TYPES = /],
  ['wsZoneColour',      /^function wsZoneColour\(/],
  ['wsZoneLabel',       /^function wsZoneLabel\(/],
  ['wsIsZone',          /^function wsIsZone\(/],
  ['wsZoneDxfLayer',    /^function wsZoneDxfLayer\(/],
  ['WS_SHAPES',         /^const WS_SHAPES = \{/],
  ['WS_PROFILES',       /^const WS_PROFILES = \{/],
  ['wsInferProfile',    /^function wsInferProfile\(/],
  ['wsBuildProfile',    /^function wsBuildProfile\(/],
  ['wsShapeFor',        /^function wsShapeFor\(/],
  ['wsPathPolys',       /^function wsPathPolys\(/],
  ['wsShapePolys',      /^function wsShapePolys\(/],
  ['WS_BIN_TYPES',      /^const WS_BIN_TYPES = \[/],
  ['WS_FIXTURES',       /^const WS_FIXTURES = \[/],
  ['WS_EQUIP_DB',       /^let WS_EQUIP_DB = null;/],
  ['wsLayoutBinList',   /^function wsLayoutBinList\(/],
  ['wsLayoutEquipList', /^function wsLayoutEquipList\(/],
  ['wsBinType',         /^function wsBinType\(/],
  ['WS_CHUTE_SPECS',    /^const WS_CHUTE_SPECS = \{/],
  ['WS_RECV_SPECS',     /^const WS_RECV_SPECS = \{/],
  ['WS_RECV_GAP',       /^const WS_RECV_GAP = /],
  ['wsRecvDims',        /^function wsRecvDims\(/],
  ['wsMarkLen',         /^function wsMarkLen\(/],
  ['wsDXFBlockName',    /^function wsDXFBlockName\(/],
  ['wsDXFLayersIn',     /^function wsDXFLayersIn\(/],
  ['wsDXFDocument',     /^function wsDXFDocument\(/],
  ['wsLayoutDXFBlocks', /^function wsLayoutDXFBlocks\(/],
  ['wsLayoutDXFEntities', /^function wsLayoutDXFEntities\(/],
];

// wsLayoutDXFEntities reads WS.layers.dims to decide whether to write the
// dimensions layer; give it a real value on the host global the extracted
// code resolves against.
global.WS = { layers: { dims: true } };
const ws = loadEngine({ blocks: BLOCKS });

// A slot exercising every entity family the exporter emits: a polygon room
// (with dimensions), bins (one rotated), a chute with a receiver, markups,
// a fixture, a compactor, a door, an aisle and a typed zone.
function sampleSlot() {
  const zoneType = Object.keys(ws.WS_ZONE_TYPES)[0];
  return {
    rooms: [{ id: 'r1', name: 'Bin room',
      pts: [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }],
      x1: 100, y1: 100, x2: 400, y2: 300 }],
    bins: [
      { id: 'b1', type: 'b240', stream: 'garbage', x: 150, y: 150, rot: 0 },
      { id: 'b2', type: 'b1100', stream: 'recycling', x: 230, y: 160, rot: 37.5 },
    ],
    chutes: [{ id: 'c1', x: 300, y: 180, type: 'SINGLE', rot: 0,
      openings: [{ stream: 'garbage', recv: 'BIN_240', rx: 300, ry: 230 }] }],
    equip: [
      { id: 'e1', code: 'COLUMN', label: 'Column', w: 0.4, d: 0.4, x: 130, y: 250, rot: 0, fixture: true, known: true },
      { id: 'e2', code: 'baler', label: 'Baler', w: 1.8, d: 1.0, x: 350, y: 250, rot: 90, known: true, compactor: true },
      { id: 'e3', code: 'DOOR', door: 'SINGLE', label: 'Door', w: 0.92, d: 0.1, x: 250, y: 100, rot: 0, fixture: true },
      { id: 'e4', code: 'AISLE', label: 'Aisle', aisle: true, w: 4, d: 1.3, x: 250, y: 280, rot: 0 },
      { id: 'e5', zoneType, label: 'Zone', w: 3, d: 2, x: 200, y: 220, rot: 0 },
    ],
    markups: [
      { kind: 'text', pts: [{ x: 120, y: 120 }, { x: 140, y: 130 }], text: 'NOTE' },
      { kind: 'area', pts: [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }] },
    ],
  };
}

function buildDoc() {
  const mpp = 0.05;
  const mmx = v => (v * mpp * 1000).toFixed(1);
  const mmy = v => (-v * mpp * 1000).toFixed(1);
  const slot = sampleSlot();
  const ents = ws.wsLayoutDXFEntities(mpp, slot);
  const blocks = ws.wsLayoutDXFBlocks(mpp, mmx, mmy, slot);
  return { doc: ws.wsDXFDocument(blocks.section, ents), ents, blocks };
}

test('the document carries the R12 skeleton: HEADER, TABLES, then content', () => {
  const { doc } = buildDoc();
  assert.ok(doc.startsWith('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n'),
    'HEADER with $ACADVER AC1009 must come first');
  const order = ['2\nHEADER', '2\nTABLES', '2\nBLOCKS', '2\nENTITIES'];
  let at = -1;
  for (const s of order) {
    const i = doc.indexOf('0\nSECTION\n' + s);
    assert.ok(i > at, s + ' section present and in order');
    at = i;
  }
  assert.ok(doc.endsWith('0\nENDSEC\n0\nEOF\n'), 'terminated with EOF');
  for (const t of ['2\nLTYPE', '2\nLAYER', '2\nSTYLE'])
    assert.ok(doc.includes('0\nTABLE\n' + t), t.slice(2) + ' table present');
});

test('every referenced layer is defined, from the payload — not a hardcoded list', () => {
  const { doc, ents, blocks } = buildDoc();
  const referenced = ws.wsDXFLayersIn(blocks.section + ents);
  assert.ok(referenced.length >= 10, 'the sample slot spans many layers, got ' + referenced.length);
  for (const layer of referenced)
    assert.ok(doc.includes(`0\nLAYER\n2\n${layer}\n`), 'layer defined: ' + layer);
});

test('wsDXFLayersIn walks code/value pairs — an ACI colour of 8 is not a layer', () => {
  const layers = ws.wsDXFLayersIn('0\nPOLYLINE\n8\nA-DOOR\n62\n8\n10\n0.0\n20\n0.0\n');
  assert.deepEqual(layers, ['A-DOOR'], 'the value 8 after code 62 must not read as a layer code');
});

test('no orphan blocks and no dangling INSERTs', () => {
  const { ents, blocks } = buildDoc();
  const defined = Object.keys(blocks.names);
  assert.ok(defined.length >= 3, 'bins and equipment define blocks');
  for (const nm of defined)
    assert.ok(ents.includes(`\n2\n${nm}\n`), 'defined block is INSERTed: ' + nm);
  const inserted = [...ents.matchAll(/0\nINSERT\n8\n[^\n]+\n62\n[^\n]+\n2\n([^\n]+)\n/g)].map(m => m[1]);
  assert.ok(inserted.length >= 3, 'bins and equipment INSERT their blocks');
  for (const nm of inserted)
    assert.ok(defined.includes(nm), 'INSERT resolves to a definition: ' + nm);
  // doors, aisles and zones are raw linework — they must not define blocks
  for (const nm of defined)
    assert.ok(!/WP_DOOR|WP_AISLE|WP_ZONE/.test(nm), 'raw-linework item leaked a block: ' + nm);
});

test('the export parses in ezdxf — a real CAD parser, not our own assertions', () => {
  const { doc } = buildDoc();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsdxf-'));
  const file = path.join(dir, 'layout.dxf');
  fs.writeFileSync(file, doc);
  const res = spawnSync('python3', [path.join(__dirname, 'validate-dxf.py'), file], { encoding: 'utf8' });
  // A missing python or ezdxf FAILS the suite by design: without parser
  // validation these tests could pass while the file is unopenable.
  assert.equal(res.error, undefined, 'python3 must be available to validate the DXF: ' + (res.error?.message || ''));
  assert.equal(res.status, 0, 'ezdxf validation failed:\n' + res.stderr + res.stdout);
  assert.match(res.stdout, /^OK layers=\d+ entities=\d+ inserts=\d+/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('both exporters assemble through wsDXFDocument', () => {
  const layoutFn = SOURCE.slice(SOURCE.indexOf('function wsLayoutExportDXF'), SOURCE.indexOf('// ── SWEPT PATH ON CANVAS'));
  assert.ok(layoutFn.includes('wsDXFDocument(blocks.section, ents)'));
  const sweptFn = SOURCE.slice(SOURCE.indexOf('function wsSweptDXF'), SOURCE.indexOf('function wsRenderSweptLayer'));
  assert.ok(sweptFn.includes("wsDXFDocument('', d)"));
  assert.ok(!sweptFn.includes("let d = '0\\nSECTION"), 'no hand-rolled section wrapper left behind');
});
