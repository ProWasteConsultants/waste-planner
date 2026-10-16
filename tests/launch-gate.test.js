'use strict';
// ── LAUNCH GATE: COMING SOON ─────────────────────────────────────────────
// Until launch only the PWC team gets in. §1 who is allowed (the pure rule,
// extracted and run) · §2 pins on the wiring that makes it hold: the markup
// ships gated, every way into the app goes through showApp's check, sign-up
// and the anonymous entry are closed.

const test = require('node:test');
const assert = require('node:assert');
const { SOURCE, extractBlock } = require('./extract.js');

function loadGate() {
  const code = [
    /^const ADMIN_EMAIL = /,
    /^function wpLaunchGateAllows\(/,
  ].map(p => extractBlock(p).text).join('\n\n');
  return new Function(code + '\n;return { ADMIN_EMAIL, wpLaunchGateAllows };')();
}

test('wpLaunchGateAllows: staff, the admin and confirmed @prowaste.au in; everyone else out', () => {
  const { ADMIN_EMAIL, wpLaunchGateAllows: ok } = loadGate();
  assert.equal(ok(null, null), false, 'no user');
  assert.equal(ok({ email: 'a@firm.com' }, { is_staff: false }), false, 'outside user');
  assert.equal(ok({ email: 'a@firm.com' }, { is_staff: true }), true, 'is_staff wins');
  assert.equal(ok({ email: ADMIN_EMAIL }, null), true, 'admin address');
  assert.equal(ok({ email: 'x@prowaste.au', email_confirmed_at: '2026-01-01' }, null), true, 'confirmed team address');
  assert.equal(ok({ email: 'x@prowaste.au' }, null), false, 'an unconfirmed address is anyone');
  assert.equal(ok({ email: 'x@prowaste.au.evil.com', email_confirmed_at: '2026-01-01' }, null), false, 'suffix, not substring');
  assert.equal(ok({ is_anonymous: true, email: '' }, { is_staff: true }), false, 'anonymous guest');
});

test('the gate is wired into every way in', () => {
  assert.match(SOURCE, /^const WP_COMING_SOON = (true|false);$/m, 'one switch');
  assert.match(SOURCE, /<div class="auth-screen wp-cs" id="auth-screen">/, 'markup ships gated — fails closed');
  const showApp = extractBlock(/^function showApp\(/).text;
  assert.match(showApp.split('\n').slice(0, 5).join('\n'), /wpLaunchGateAllows\(currentUser, currentProfile\)/, 'showApp checks before loading anything');
  for (const fn of [/^function handleSignupToPay\(/, /^async function handleFreeSignup\(/, /^async function handleSignup\(/, /^async function wpAnonStart\(/, /^function wpAnonEnter\(/])
    assert.match(extractBlock(fn).text, /wpComingSoon\(\)/, `${fn} is closed while gated`);
  assert.match(SOURCE, /\.auth-screen\.wp-cs #auth-value-line,\.auth-screen\.wp-cs \.auth-tabs,\.auth-screen\.wp-cs #auth-signup\{display:none !important;\}/, 'sign-up form hidden even in team mode');
});
