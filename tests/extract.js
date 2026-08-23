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

function buildSource() {
  const parts = BLOCKS.map(([name, pattern]) => {
    const b = extractBlock(pattern);
    return { name, ...b };
  });
  parts.sort((a, b) => a.startLine - b.startLine);
  const body = parts.map(p => `/* index.html:${p.startLine}-${p.endLine} */\n${p.text}`).join('\n\n');
  const epilogue = `\n;globalThis.__WS_EXPORTS = { ${EXPORTED.join(', ')} };\n`;
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
 * Evaluate the extracted engine in a fresh vm context.
 * @param {object} [opts.elements] id -> stub element, seeds the DOM stub.
 * @returns {object} the exported bindings plus `dom` (the stub) and `meta`.
 */
function loadEngine(opts = {}) {
  const { code, parts } = buildSource();
  const dom = createDom(opts.elements);
  const sandbox = {
    document: dom,
    console,
    globalThis: undefined, // replaced by createContext
  };
  vm.createContext(sandbox);
  sandbox.globalThis = sandbox;
  vm.runInContext(code, sandbox, { filename: 'index.html (extracted)' });
  const api = Object.assign({}, sandbox.__WS_EXPORTS);
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

module.exports = { INDEX_PATH, SOURCE, LINES, extractBlock, buildSource, loadEngine, createDom, scriptBlocks, BLOCKS };
