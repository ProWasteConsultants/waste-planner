'use strict';
// ── DELETE ACCOUNT ────────────────────────────────────────────────────────
// Each person deletes their own account. Org projects stay with the org,
// Pro Waste-engaged projects are kept for PWC, other personal projects and
// ONLY their files are deleted, a personal subscription is cancelled first,
// and the sole admin of an org with other members is refused.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock } = require('./extract.js');

const FN = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'delete-account', 'index.ts'), 'utf8');
const body = FN.slice(FN.indexOf('Deno.serve('));
const at = s => { const i = body.indexOf(s); assert.ok(i >= 0, 'missing: ' + s); return i; };

test('only the caller, only after typing their own email', () => {
  assert.ok(at('sbUser.auth.getUser()') < at('sbAdmin'), 'authenticated before the service key is used');
  assert.match(body, /String\(body\.confirm_email \|\| ""\)\.trim\(\)\.toLowerCase\(\) !== email/);
  assert.ok(!/body\.(user_id|uid)/.test(body), 'never takes an account id from the request');
  assert.match(body, /const uid = user\.id;/);
});

test('refusals and the subscription cancel come before any data changes', () => {
  const firstWrite = Math.min(at('.update({ user_id'), at('.storage.from(PLANS_BUCKET).remove('), at('.from("projects").delete()'));
  assert.ok(at('code: "sole_admin"') < firstWrite, 'sole-admin refusal first');
  assert.ok(at('stripe.subscriptions.cancel(') < firstWrite, 'subscription cancelled before anything is deleted');
  assert.match(body, /if \(others\.length && !others\.some\(\(x\) => x\.role === "admin"\)\) blocking\.push/, 'same rule as leaving an org');
});

test('org projects stay with the org, engaged projects stay with PWC, only the rest is deleted', () => {
  assert.match(body, /if \(p\.org_id\) orgKeep\.push\(p\);\s*else if \(p\.engaged_at\) pwcKeep\.push\(p\);\s*else remove\.push/);
  assert.match(body, /update\(\{ user_id: p\.engaged_by \}\)/, 'engaged project handed to the staff member who engaged it');
  assert.ok(at('update({ user_id: heir })') < at('auth.admin.deleteUser(uid)'), 'ownership handed over before the login goes');
  assert.match(body, /\.from\("projects"\)\.delete\(\)\.in\("id", remove\)/, 'deletes only the personal list');
  assert.ok(!/\.from\("projects"\)\.delete\(\)\.eq\("user_id"/.test(body), 'never deletes "everything they own"');
});

test('only files of the deleted projects are removed — not the whole folder', () => {
  const sp = new Function(FN.match(/function storageProjectId[\s\S]*?\n\}/)[0].replace(/: string/g, '') + '\n;return storageProjectId;')();
  assert.equal(sp('u1/p9.pdf'), 'p9');
  assert.equal(sp('u1/p9.site_prep.pdf'), 'p9');
  assert.equal(sp('u1/p9'), 'p9');
  assert.match(body, /if \(!doomed\.has\(storageProjectId\(path\)\)\) continue;/);
  assert.ok(!/remove\(\[\s*uid/.test(body), 'no blanket folder delete');
});

test('invite cleanup matches the address exactly — ilike would treat "_" as a wildcard', () => {
  assert.ok(!/ilike\(/.test(body));
  assert.match(body, /from\("project_members"\)\.delete\(\)\.eq\("email", email\)/);
});

test('the app: typed confirmation, the server does the work, device copies cleared', () => {
  const del = extractBlock(/^async function wpDeleteAccount\(\)/).text;
  assert.ok(del.indexOf("typed !== currentUser.email.toLowerCase()") < del.indexOf('fetch('), 'confirmation checked before the call');
  assert.match(del, /\/delete-account`/);
  assert.match(del, /localStorage\.removeItem\('pw_projects'\)/);
  const open = extractBlock(/^function wpDeleteAccountOpen\(\)/).text;
  for (const w of ['personal projects', 'Organisation projects', 'Pro Waste was engaged on', 'Cancel Subscription'])
    assert.ok(open.includes(w), 'the box says: ' + w);
  assert.ok(SOURCE.includes('onclick="wpDeleteAccountOpen()"'), 'reachable from Account Settings');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-10-19-delete-account.sql'), 'utf8');
  assert.match(sql, /grant select, update, delete on public\.projects to service_role;/);
  // The policy text is legal/privacy.md (the one copy). Until the final
  // document is dropped in, the placeholder stands and this is a reminder;
  // after that, the policy must say what deletion keeps.
  const priv = fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy.md'), 'utf8');
  if (!/PLACEHOLDER:/.test(priv)) assert.ok(/kept|retain/i.test(priv) && /delet/i.test(priv), 'privacy policy says what deletion keeps');
});
