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
const { scriptBlocks, buildSource, extractBlock, BLOCKS, SOURCE } = require('./extract.js');

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

test('the extracted swept-path engine parses and evaluates as a unit', () => {
  const { code } = buildSource();
  assert.doesNotThrow(() => new vm.Script(code, { filename: 'index.html (extracted engine)' }));
});

test('every extraction anchor still resolves to exactly one declaration', () => {
  for (const [name, pattern] of BLOCKS) {
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
