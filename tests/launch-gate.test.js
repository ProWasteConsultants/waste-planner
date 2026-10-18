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

test('a design-team member with a confirmed email gets in; an unconfirmed one does not', () => {
  const { wpLaunchGateAllows: ok } = loadGate();
  assert.equal(ok({ email: 'arch@firm.com', email_confirmed_at: '2026-01-01' }, null, true), true, 'team member');
  assert.equal(ok({ email: 'arch@firm.com' }, null, true), false, 'unconfirmed: could be anyone');
  assert.equal(ok({ email: 'arch@firm.com', email_confirmed_at: '2026-01-01' }, null, false), false, 'not on a team');
  assert.equal(ok({ is_anonymous: true, email_confirmed_at: 'x' }, null, true), false, 'anonymous never');
  const chk = extractBlock(/^async function wpLaunchGateTeamCheck\(/).text;
  assert.ok(chk.indexOf("rpc('wp_accept_project_invites')") < chk.indexOf("from('project_members')"), 'pending invites accepted before counting');
});

test('email links: the hash session is read, stripped, and a reset or invitation asks for a password', () => {
  const { wpAuthLinkParse: P } = new Function(extractBlock(/^function wpAuthLinkParse\(/).text + '\n;return { wpAuthLinkParse };')();
  assert.deepStrictEqual(P('#access_token=a&refresh_token=r&expires_in=3600&type=invite'), { access_token: 'a', refresh_token: 'r', type: 'invite' });
  assert.equal(P('#access_token=a&refresh_token=r&type=recovery').type, 'recovery');
  assert.deepStrictEqual(P('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), { error: 'Email link is invalid or has expired' });
  assert.equal(P(''), null);
  assert.equal(P('#pw-app'), null, 'an ordinary anchor is not a link');
  assert.equal(P('#access_token=a'), null, 'no refresh token, no session');
  const consume = extractBlock(/^async function wpAuthLinkConsume\(/).text;
  assert.ok(consume.indexOf('history.replaceState') < consume.indexOf('setSession'), 'tokens leave the address bar before anything else');
  assert.ok(SOURCE.includes('const linkType = await wpAuthLinkConsume();'), 'consumed at boot, before the session is read');
  assert.ok(SOURCE.includes('if (!currentProfile) await wpEnsureProfile();'), 'an invitee without a profile gets one');
  assert.match(extractBlock(/^async function wpEnsureProfile\(/).text, /tier: 'none'/, 'same tier rule as signup');
});

test('the gate is wired into every way in', () => {
  assert.match(SOURCE, /^const WP_COMING_SOON = (true|false);$/m, 'one switch');
  assert.match(SOURCE, /<div class="auth-screen wp-cs" id="auth-screen">/, 'markup ships gated — fails closed');
  const showApp = extractBlock(/^function showApp\(/).text;
  assert.match(showApp.split('\n').slice(0, 5).join('\n'), /wpLaunchGateAllows\(currentUser, currentProfile, wpLaunchGateTeamCheck\.ok === true\)/, 'showApp checks before loading anything');
  assert.ok(showApp.indexOf('wpLaunchGateTeamCheck().then(ok => ok ? showApp() : wpLaunchGateBounce())') < showApp.indexOf("getElementById('app-content').style.display = 'flex'"), 'the team check runs before the app opens, and a non-member is bounced');
  for (const fn of [/^function handleSignupToPay\(/, /^async function handleFreeSignup\(/, /^async function handleSignup\(/, /^async function wpAnonStart\(/, /^function wpAnonEnter\(/])
    assert.match(extractBlock(fn).text, /wpComingSoon\(\)/, `${fn} is closed while gated`);
  assert.match(SOURCE, /\.auth-screen\.wp-cs #auth-value-line,\.auth-screen\.wp-cs \.auth-tabs,\.auth-screen\.wp-cs #auth-signup\{display:none !important;\}/, 'sign-up form hidden even in team mode');
});

// ── §3: register interest (waitlist) ──
test('wpWaitlistClean: a valid email or a named error; fields trimmed, role whitelisted', () => {
  const { wpWaitlistClean: clean } = new Function(extractBlock(/^function wpWaitlistClean\(/).text + '\n;return { wpWaitlistClean };')();
  assert.deepStrictEqual(clean({ email: '  Ann@Firm.COM ', name: ' Ann ', company: 'Firm', role: 'architect' }).row,
    { email: 'ann@firm.com', name: 'Ann', company: 'Firm', role: 'architect', attribution: null });
  assert.ok(clean({ email: 'not-an-email' }).error, 'bad address refused');
  assert.ok(clean({ email: '' }).error, 'empty refused');
  assert.equal(clean({ email: 'a@b.co', role: 'admin' }).row.role, '', 'unknown role dropped, not stored');
  assert.equal(clean({ email: 'a@b.co', name: 'x'.repeat(500) }).row.name.length, 120, 'capped to the column check');
  assert.deepStrictEqual(clean({ email: 'a@b.co', attribution: { utm_source: 'li' } }).row.attribution, { utm_source: 'li' });
});

test('waitlist wiring: spam trap writes nothing, duplicate reads as already registered, SQL ships GRANTs + staff-only read', () => {
  const fn = extractBlock(/^async function wpWaitlistSubmit\(/).text;
  assert.ok(fn.indexOf("val('wl-website')") < fn.indexOf("sb.from('waitlist')"), 'honeypot checked before any write');
  assert.match(fn, /error\.code === '23505'/, 'unique-email violation is "already on the list", not a failure');
  const fs = require('node:fs'), path = require('node:path');
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-10-16-waitlist.sql'), 'utf8');
  assert.match(sql, /grant insert on public\.waitlist to anon, authenticated;/);
  assert.match(sql, /for select to authenticated\s+using \(exists \(select 1 from public\.profiles p where p\.uuid = auth\.uid\(\) and p\.is_staff = true\)\)/, 'only staff read the list');
  assert.ok(!/grant select[^;]*anon/.test(sql), 'anon can never read the list');
  assert.match(sql, /unique index if not exists waitlist_email_lower on public\.waitlist \(lower\(email\)\)/);
  const crm = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-events', 'index.ts'), 'utf8');
  assert.ok(crm.includes('payload.table === "waitlist"') && crm.includes('"waitlist_join"'), 'CRM relay forwards waitlist rows');
});

test('coming-soon page: no Privacy/Terms footer; the form states its own collection notice', () => {
  assert.match(SOURCE, /\.auth-screen\.wp-cs \.auth-legal\{display:none;\}/, 'footer hidden while gated');
  assert.match(SOURCE, /<div class="auth-legal"[^>]*>\s*<a href="privacy\.html"/, 'the hidden footer is the Privacy · Terms one');
  const i = SOURCE.indexOf('id="wl-form"'), j = SOURCE.indexOf('id="wl-notice"');
  assert.ok(i > 0 && j > i && j < SOURCE.indexOf('id="wl-msg"'), 'notice sits inside the form');
  const notice = SOURCE.slice(j, SOURCE.indexOf('</details>', j));
  for (const w of ['name, email, company and role', 'only to tell you when WastePlanner opens', 'deleted', 'info@prowaste.au', '<summary'])
    assert.ok(notice.includes(w), 'notice says: ' + w);
});

test('the coming-soon card has its own message element — no id shared with another screen', () => {
  for (const id of ['wl-msg', 'wl-form', 'wl-notice', 'wl-cta', 'auth-coming-soon'])
    assert.equal(SOURCE.split(`id="${id}"`).length - 1, 1, `id="${id}" is unique`);
});
