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
