'use strict';
// (d) Syntax sweep — every <script> block in index.html must parse.
//
// A single-file app has no build step and no module loader: a syntax error
// anywhere in a <script> block silently kills every declaration in that block at
// load time, and the browser reports it only in the console. This sweep parses
// each block with V8 (without executing it) so a stray brace fails CI instead of
// a customer's plan review.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { scriptBlocks, buildSource, extractBlock, BLOCKS, LAYOUT_BLOCKS, SOURCE } = require('./extract.js');

const ALL = scriptBlocks();
const INLINE = ALL.filter(b => !b.src && (b.type === '' || b.type === 'text/javascript' || b.type === 'module'));
const EXTERNAL = ALL.filter(b => b.src);
const DATA = ALL.filter(b => !b.src && b.type && b.type !== 'text/javascript' && b.type !== 'module');

test('index.html exposes the script blocks the sweep expects', () => {
  assert.ok(ALL.length > 0, 'no <script> blocks found — did the regex break?');
  assert.ok(INLINE.length >= 10, `only ${INLINE.length} inline blocks found`);
  assert.ok(EXTERNAL.length >= 1, 'expected external <script src> tags (Supabase, Stripe, pdf.js)');
});

test('every inline <script> block parses', () => {
  const failures = [];
  for (const b of INLINE) {
    if (!b.body.trim()) continue;
    try {
      // Module blocks may use import/export; classic blocks may use top-level return-free code.
      new vm.Script(b.body, {
        filename: `index.html:${b.startLine}`,
        // parse only — nothing is executed
      });
    } catch (e) {
      failures.push(`index.html:${b.startLine} <script ${b.attrs}> — ${e.message}`);
    }
  }
  assert.equal(failures.length, 0, `\n${failures.join('\n')}`);
});

// A single-file app has no module boundaries: an unguarded dereference of a
// missing element at TOP LEVEL throws during evaluation and silently kills
// every remaining declaration in that <script> block. That is exactly how a
// class rename (.user-pill -> the rail account chip) took out role-based nav,
// the lite caps, the showScreen cap gate and Enter-to-submit — with no error
// anywhere but the console. Two rules, both enforced here.
test('no parent JS selects a class that no longer exists in the markup', () => {
  // a class counts as existing if it is in markup, defined in CSS, or applied
  // from JS (className =, classList.add) — elements are built both ways here
  const classes = new Set();
  for (const m of SOURCE.matchAll(/\bclass="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => classes.add(c));
  for (const m of SOURCE.matchAll(/^\s*\.([A-Za-z0-9_-]+)[\s,{:.]/gm)) classes.add(m[1]);
  for (const m of SOURCE.matchAll(/className\s*=\s*['"`]([^'"`]+)/g)) m[1].split(/\s+/).forEach(c => classes.add(c));
  for (const m of SOURCE.matchAll(/classList\.(?:add|toggle|remove)\(\s*['"]([A-Za-z0-9_-]+)/g)) classes.add(m[1]);
  const js = INLINE.map(b => b.body).join('\n');
  const dead = new Set();
  for (const m of js.matchAll(/document\.querySelector(?:All)?\(\s*'(\.[A-Za-z0-9_-]+)'\s*\)/g)) {
    if (!classes.has(m[1].slice(1))) dead.add(m[1]);
  }
  assert.deepEqual([...dead], [],
    'these selectors match nothing — they are dead code at best, a load-time crash at worst');
});

test('top-level DOM wiring is guarded', () => {
  // column-0 statements run at load; `el.addEventListener` on a missing
  // element takes the whole block down with it. `?.` or a null check is the
  // price of wiring anything at top level.
  const bad = [];
  INLINE.forEach(b => {
    b.body.split(/\r?\n/).forEach((line, i) => {
      if (!/^document\.(querySelector(?:All)?|getElementById)\(/.test(line)) return;
      if (/\)\s*\?\./.test(line)) return;                       // optional-chained
      if (/^document\.(addEventListener|querySelectorAll)\(/.test(line)) return;  // document itself / list
      bad.push(line.trim().slice(0, 90));
    });
  });
  assert.deepEqual(bad, [], 'guard these with ?. — an unguarded top-level lookup kills the rest of the block');
});

test('external <script src> tags are absolute https URLs', () => {
  for (const b of EXTERNAL) {
    assert.match(b.src, /^https:\/\//, `insecure or relative script src: ${b.src} (index.html:${b.startLine})`);
  }
});

test('non-JavaScript <script> payloads contain valid JSON', () => {
  for (const b of DATA) {
    if (!/json/i.test(b.type)) continue;
    try {
      JSON.parse(b.body);
    } catch (e) {
      assert.fail(`index.html:${b.startLine} <script type="${b.type}"> is not valid JSON — ${e.message}`);
    }
  }
});

test('the extracted engines parse as a unit', () => {
  // Parsed as a function body, which is how loadEngine evaluates them (the
  // assembled source ends in a `return`, so it is not a valid top-level script).
  for (const [label, blocks] of [['swept-path', BLOCKS], ['layout rooms', LAYOUT_BLOCKS]]) {
    const { code } = buildSource(blocks);
    assert.doesNotThrow(() => new Function('document', 'console', code),
      `the extracted ${label} engine does not parse`);
  }
});

test('every extraction anchor still resolves to exactly one declaration', () => {
  for (const [name, pattern] of BLOCKS.concat(LAYOUT_BLOCKS)) {
    const block = extractBlock(pattern);
    assert.ok(block.text.length > 0, `${name}: empty extraction`);
    assert.ok(block.endLine >= block.startLine, `${name}: inverted range`);
  }
});

test('script tags are balanced — no unclosed <script>', () => {
  const opens = (SOURCE.match(/<script\b/gi) || []).length;
  const closes = (SOURCE.match(/<\/script\s*>/gi) || []).length;
  assert.equal(opens, closes, `${opens} <script> tags vs ${closes} </script> tags`);
  assert.equal(ALL.length, opens, `matcher paired ${ALL.length} of ${opens} script tags`);
});

test('Supabase calls use the `sb` client binding, never `supabase` or `client`', () => {
  // Convention: the Supabase client is the lexical const `sb` (see CLAUDE.md).
  // `supabase.createClient(...)` is the CDN global and is the one allowed exception.
  const offenders = [];
  const lines = SOURCE.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/\b(supabase|client)\s*\.\s*(from|rpc|auth|storage|functions|channel|removeChannel)\b/g)) {
      if (m[1] === 'supabase' && /supabase\s*\.\s*createClient/.test(line)) continue;
      offenders.push(`index.html:${i + 1} — ${m[0]}  (use the \`sb\` client)`);
    }
  });
  assert.equal(offenders.length, 0, `\n${offenders.join('\n')}`);
});
