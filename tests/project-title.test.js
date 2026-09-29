'use strict';
// Project naming: the name is optional and the address is required, so an
// unnamed project is shown by its address — never blank.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadEngine, SOURCE } = require('./extract.js');

const E = loadEngine({ blocks: [
  ['wpProjectTitle', /^function wpProjectTitle\(p\) \{/],
  ['wpEscHtml',      /^function wpEscHtml\(t\) \{/],
] });

test('a named project is shown by its name', () => {
  assert.equal(E.wpProjectTitle({ name: ' The Mercer ', address: '142 Mercer St' }), 'The Mercer');
});

test('an unnamed project is shown by its address', () => {
  assert.equal(E.wpProjectTitle({ name: '', address: '142 Mercer St' }), '142 Mercer St');
  assert.equal(E.wpProjectTitle({ name: '   ', summary: { address: '8 Cobar Pl' } }), '8 Cobar Pl');
});

test('neither → a visible placeholder, never blank', () => {
  assert.equal(E.wpProjectTitle({}), 'Untitled project');
  assert.equal(E.wpProjectTitle(null), 'Untitled project');
});

test('titles are escaped where they go into HTML', () => {
  assert.equal(E.wpEscHtml('<b>"A&B"</b>'), '&lt;b&gt;&quot;A&amp;B&quot;&lt;/b&gt;');
});

test('both create paths require the address, not the name', () => {
  const need = SOURCE.split("if (!document.getElementById('np-address').value.trim())").length - 1;
  assert.equal(need, 2);
  assert.ok(!SOURCE.includes("alert('Please enter a project name.')"));
});

test('summary edits (name, address) reach the cloud row', () => {
  const start = SOURCE.indexOf('function saveSummaryField()');
  const body = SOURCE.slice(start, SOURCE.indexOf('\nfunction dsAddressBlur', start));
  assert.ok(body.includes('saveProjectToDB('));
});
