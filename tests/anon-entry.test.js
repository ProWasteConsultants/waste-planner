'use strict';
// ── ANONYMOUS COMPLIANCE ENTRY + SHARED CLAIM STORE ──────────────────────
// The planner landing page's one scoped exception to "everything inside
// WastePlanner requires a free account": §1 the shared claim mechanism
// (pure functions, extracted and run) · §2 the entry point and anonymous
// session boot · §3 the gate — copy, triggers, and the wall in showScreen ·
// §4 the checker's guest behaviour (one check, exports gate, result parked)
// · §5 claim-on-signup application · §6 the server-side fences.
// Functional tests extract the real declarations from index.html (never
// copies); the rest are pins on load-bearing strings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock } = require('./extract.js');

// ── §1: the claim store's pure core, extracted and run for real ──
function loadClaims() {
  const blocks = [
    /^const WP_CLAIM_KEY = /,
    /^const WP_CLAIM_KINDS = /,
    /^const WP_CLAIM_MAX_AGE_MS = /,
    /^function wpClaimNormalise\(/,
    /^function wpClaimFresh\(/,
    /^function wpComplianceClaimClean\(/,
    /^function wpAnonGateCopy\(/,
  ];
  const code = blocks.map(p => extractBlock(p).text).join('\n\n');
  const factory = new Function(code +
    '\n;return { WP_CLAIM_KEY, WP_CLAIM_KINDS, WP_CLAIM_MAX_AGE_MS, wpClaimNormalise, wpClaimFresh, wpComplianceClaimClean, wpAnonGateCopy };');
  return factory();
}

test('wpClaimNormalise: known kinds with object payloads park, junk never does', () => {
  const eng = loadClaims();
  const rec = eng.wpClaimNormalise('compliance', { data: {} }, 1000);
  assert.deepStrictEqual(rec, { kind: 'compliance', payload: { data: {} }, at: 1000 });
  assert.ok(eng.wpClaimNormalise('calc', { mix: {} }), 'calc is a known kind');
  assert.equal(eng.wpClaimNormalise('qr_lead', {}), null, 'future kinds are added deliberately, not accepted blind');
  assert.equal(eng.wpClaimNormalise('compliance', null), null);
  assert.equal(eng.wpClaimNormalise('compliance', 'a-string'), null);
  assert.equal(eng.wpClaimNormalise('compliance', [1, 2]), null, 'an array is not a payload');
  assert.equal(eng.wpClaimNormalise(null, {}), null);
  // a missing stamp gets "now", not NaN
  const stamped = eng.wpClaimNormalise('calc', {});
  assert.ok(Number.isFinite(stamped.at) && Math.abs(Date.now() - stamped.at) < 5000);
  // prototype-pollution style kind names must not read as known
  assert.equal(eng.wpClaimNormalise('toString', {}), null);
  assert.equal(eng.wpClaimNormalise('constructor', {}), null);
});

test('wpClaimFresh: the age cap holds, clock skew forwards is forgiven', () => {
  const eng = loadClaims();
  const now = 10_000_000_000;
  const rec = at => ({ kind: 'compliance', payload: {}, at });
  assert.equal(eng.wpClaimFresh(rec(now - 1000), now), true);
  assert.equal(eng.wpClaimFresh(rec(now - eng.WP_CLAIM_MAX_AGE_MS), now), true, 'exactly at the cap still applies');
  assert.equal(eng.wpClaimFresh(rec(now - eng.WP_CLAIM_MAX_AGE_MS - 1), now), false, 'one ms past the cap is dead');
  assert.equal(eng.wpClaimFresh(rec(now + 60_000), now), true, 'a stamp slightly in the future is fresh, not rejected');
  assert.equal(eng.wpClaimFresh(rec('soon'), now), false, 'a broken stamp is dead');
  assert.equal(eng.wpClaimFresh(null, now), false);
  assert.equal(eng.wpClaimFresh({ kind: 'nope', payload: {}, at: now }, now), false);
  assert.equal(eng.wpClaimFresh({ kind: 'calc', payload: null, at: now }, now), false);
  assert.equal(eng.WP_CLAIM_MAX_AGE_MS, 14 * 24 * 3600 * 1000, 'two weeks, per the store comment');
});

test('wpComplianceClaimClean: the comments array IS the result', () => {
  const eng = loadClaims();
  assert.equal(eng.wpComplianceClaimClean(null), null);
  assert.equal(eng.wpComplianceClaimClean({}), null, 'no data block, no claim');
  assert.equal(eng.wpComplianceClaimClean({ data: { comments: [] } }), null, 'zero clauses is not a check worth carrying');
  const clean = eng.wpComplianceClaimClean({
    data: { comments: [{ id: 1, result: 'fail' }, null, 'junk'], readiness_score: '72', overall_summary: 'ok', council_risk_note: 7 },
    score: 72, council: 'melb', councilName: 'City of Melbourne',
    address: '1 Test St', ref: 'DA-1', fileName: 'wmp.pdf',
    checkedDoc: { short: 'Melb guidelines v3', pdf: true, extra: 'dropped' },
    checkedAgainst: { guidelineId: 'g1' },
  });
  assert.equal(clean.data.comments.length, 1, 'non-object clauses are dropped');
  assert.equal(clean.data.readiness_score, 72, 'numeric strings coerce');
  assert.equal(clean.data.council_risk_note, '', 'non-string fields become empty, never leak types');
  assert.equal(clean.council, 'melb');
  assert.equal(clean.checkedDoc.pdf, false, 'the parked snapshot never claims a viewable PDF it did not carry');
  assert.deepStrictEqual(clean.checkedAgainst, { guidelineId: 'g1' });
  // oversized inputs are capped, not refused
  const big = eng.wpComplianceClaimClean({ data: { comments: Array.from({ length: 500 }, (_, i) => ({ id: i })) }, address: 'x'.repeat(9999) });
  assert.equal(big.data.comments.length, 200);
  assert.equal(big.address.length, 200);
});

test('wpAnonGateCopy: every trigger names the value delivered; navigate presumes nothing', () => {
  const eng = loadClaims();
  for (const trigger of ['second_check', 'export', 'submit', 'engage', 'navigate']) {
    const c = eng.wpAnonGateCopy(trigger);
    assert.ok(c.title && c.body, trigger + ' has copy');
    assert.ok(!/hurry|last chance|only today/i.test(c.title + c.body), 'no pressure copy');
  }
  assert.ok(eng.wpAnonGateCopy('second_check').body.includes('nothing re-runs'), 'the carried result is the pitch');
  assert.ok(!/result|check you just ran|report/i.test(eng.wpAnonGateCopy('navigate').body.replace('free check', '')),
    'navigate can fire before any run — its copy must not reference a result');
  assert.deepStrictEqual(eng.wpAnonGateCopy('unknown-trigger'), eng.wpAnonGateCopy('navigate'), 'unknown triggers fall back to navigate');
});

// ── §2: entry point and anonymous session boot ──
test('?check=wmp parks the entry flag, strips the param, leaves UTMs to captureAttribution', () => {
  assert.ok(SOURCE.includes("q.get('check') !== 'wmp'"), 'reads ?check=wmp');
  assert.ok(SOURCE.includes("sessionStorage.setItem('wp_anon_entry', 'compliance')"), 'parks the entry flag');
  const idx = SOURCE.indexOf('function captureCheckEntry()');
  assert.ok(idx > SOURCE.indexOf('function captureAttribution()'), 'runs after first-touch UTM capture');
  const fn = SOURCE.slice(idx, SOURCE.indexOf('})();', idx));
  assert.ok(fn.includes('history.replaceState'), 'strips the parameter from the URL');
});

test('the session boot routes anonymous sessions into the checker, never the app', () => {
  assert.ok(SOURCE.includes('session?.user?.is_anonymous'), 'boot distinguishes anon sessions');
  assert.ok(SOURCE.includes('wpAnonEnter(session.user);'), 'a returning guest re-enters the checker');
  const fn = extractBlock(/^async function wpAnonStart\(\)/).text;
  assert.ok(fn.includes('sb.auth.signInAnonymously()'), 'guests are REAL is_anonymous Supabase users — the ai-user allowance needs a token');
  assert.ok(fn.includes('falling back to signup'), 'anonymous sign-ins off → signup-first, not a broken page');
  const enter = extractBlock(/^function wpAnonEnter\(user\)/).text;
  assert.ok(enter.includes("classList.add('wp-anon')"), 'body class hides the nav rail');
  assert.ok(enter.includes("showScreen('compliance'"), 'lands directly on the checker');
  assert.ok(enter.includes("logEvent('anon_check_entry'"), 'funnel head is logged');
  assert.ok(!enter.includes('wp_known_user'), 'a guest is not a known user — auth defaults stay signup-first');
});

// ── §3: the gate and the wall ──
test('showScreen is the wall: everything but compliance gates while anonymous', () => {
  const fn = extractBlock(/^function showScreen\(name, navEl\)/).text;
  assert.ok(fn.includes("wpAnonActive() && name !== 'compliance'"), 'one intercept covers every navigation path');
  assert.ok(fn.includes("wpAnonGate('navigate')"), 'the wall routes to the gate, not a dead end');
  assert.ok(SOURCE.includes('body.wp-anon .side-nav{display:none;}'), 'nav rail hidden — cosmetics on top of the intercept');
});

test('the gate leads into the normal account flow and never traps the result', () => {
  const gate = extractBlock(/^function wpAnonGate\(trigger\)/).text;
  assert.ok(gate.includes("logEvent('anon_gate_shown', { trigger"), 'every gate raise is logged with its trigger');
  assert.ok(gate.includes("wpAnonToAuth('signup')") && gate.includes("wpAnonToAuth('login')"),
    'signup AND sign-in — an existing account attaches the result, no duplicate');
  assert.ok(gate.includes('Not now — keep viewing this result'), 'the delivered result is never gated');
  const toAuth = extractBlock(/^function wpAnonToAuth\(tab\)/).text;
  assert.ok(toAuth.includes('Your compliance result is ready to keep.'), 'gate copy references the value just delivered');
  assert.ok(toAuth.includes('wpAnonBackToResult()'), 'the auth screen offers a way back to the live result');
  // and showApp tears the guest chrome down once a real account signs in
  const showApp = extractBlock(/^function showApp\(\)/).text;
  assert.ok(showApp.includes('wpAnonExit()'), 'entering the app proper always ends anon mode');
});

// ── §4: the checker's guest behaviour ──
test('the handshake carries anonMode with a cap of exactly one check', () => {
  assert.ok(SOURCE.includes('anonMode,'), 'wp-set-role carries the flag');
  assert.ok(SOURCE.includes('runsCap: anonMode ? 1 :'), 'one check, not the per-project two');
  assert.ok(SOURCE.includes('runsRemaining: anonMode ? (wpAnonCheckUsed() ? 0 : 1)'), 'used state persists per device');
  assert.ok(SOURCE.includes('aiEntitled() || anonMode'), 'the anon session token rides the same included-AI handoff');
  assert.ok(SOURCE.includes('state.anonMode = !!e.data.anonMode;'), 'iframe stores the flag');
  assert.ok(SOURCE.includes('Free compliance check — no account needed'), 'guest badge copy');
});

test('guest exports and submits gate; the parked result carries the whole check', () => {
  // exportReport and submitToCouncil bail to the platform gate (HTML-escaped in the srcdoc)
  const gates = SOURCE.split('type: &#x27;wp-anon-gate&#x27;').length - 1;
  assert.equal(gates, 2, 'export and submit both route to the gate');
  // the completed run posts the full result + transferred PDF bytes for claim parking
  assert.ok(SOURCE.includes('type: &#x27;wp-anon-result&#x27;'), 'result parks via its own message, wp-scan-done stays lean');
  assert.ok(SOURCE.includes('state.wmpBuf = ab.slice(0);'), 'WMP bytes survive pdf.js transferring the buffer');
  // parent side: sanitise, park, stash bytes under the temp IDB key
  assert.ok(SOURCE.includes("wpClaimPark('compliance', clean)"), 'result parks in the SHARED claim store');
  assert.ok(SOURCE.includes("idbPutPdf('doc:anon:check'"), 'PDF parks under the temp key');
  // the guest run marks the device used and never touches a project counter
  assert.ok(SOURCE.includes("localStorage.setItem('wp_anon_check_used', '1')"));
  assert.ok(SOURCE.includes("logEvent('anon_check_run'"));
  // second-check attempt: the iframe's existing cap message becomes the gate, not the paywall
  assert.ok(SOURCE.includes("if (anon) { wpAnonGate('second_check'); return; }"),
    'a guest has no plan to upgrade — wp-paywall reroutes to signup');
  assert.ok(SOURCE.includes("if (anon) { wpAnonGate('engage'); return; }"), 'engage gates too');
});

test('restoreScan re-renders without re-counting', () => {
  assert.ok(SOURCE.includes('function restoreScan(payload)'), 'the checker can restore a stored result');
  assert.ok(SOURCE.includes('state.restoring = true;'), 'restore flag set');
  assert.ok(SOURCE.includes('if (!state.restoring &amp;&amp; window.parent &amp;&amp; window.parent !== window)'),
    'wp-scan-done is suppressed during restore — no double-billed run');
  assert.ok(SOURCE.includes('if (!state.restoring &amp;&amp; typeof state.runsRemaining === &#x27;number&#x27;)'),
    'the local badge decrement is suppressed too');
});

// ── §5: claim-on-signup application ──
test('the compliance claim creates the project with the anonymous run already counted', () => {
  const fn = extractBlock(/^async function applyComplianceClaim\(pre\)/).text;
  assert.ok(fn.includes('complianceRuns: 1'), 'the anon check IS the first run — every free path tops out at two checks total');
  assert.ok(fn.includes("wpProjectCapReached() ) { showPaywall('project_cap'); return; }") ||
    fn.includes("wpProjectCapReached()) { showPaywall('project_cap'); return; }"),
    'a capped existing account gets the paywall, same doctrine as the calc prefill');
  assert.ok(fn.includes("docStore(project.id, rec.buf"), 'the WMP files as a real project document');
  assert.ok(fn.includes("idbDeletePdf('doc:anon:check')"), 'the temp slot clears after filing');
  assert.ok(fn.includes('w.restoreScan(pre)'), 'the exact stored result re-renders — nothing re-runs');
  assert.ok(fn.includes("logEvent('project_created'") && fn.includes("source: 'compliance_claim'"));
  assert.ok(fn.includes("logEvent('compliance_claim_applied'"));
  // the carried result persists to the cloud row like docs and summary do
  assert.ok(SOURCE.includes('check: project.check || null'), 'app_data carries the result');
  assert.ok(SOURCE.includes('check: ad.check || prev.check || null'), 'and the merge restores it');
});

test('one shared mechanism: both kinds dispatch through wpClaimApply', () => {
  const fn = extractBlock(/^async function wpClaimApply\(\)/).text;
  assert.ok(fn.includes("rec.kind === 'calc'") && fn.includes("rec.kind === 'compliance'"),
    'calc handoff and compliance claim ride the same store and dispatcher');
  assert.ok(fn.includes('wpClaimTake()'), 'one shot — cleared before the applier can fail halfway');
  // and the auth screen's value line reads the same store for both kinds
  assert.ok(SOURCE.includes("claim?.kind === 'calc'") && SOURCE.includes("claim?.kind === 'compliance'"));
});

// ── §6: server-side fences ──
test('the migration fences anonymous JWTs off projects and profiles, leaves events open', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-12-anon-compliance-entry.sql'), 'utf8');
  assert.ok(sql.includes("'is_anonymous', 'false') = 'true'"), 'predicate reads the JWT claim, not a client field');
  assert.ok(sql.includes('before insert or update on public.projects'), 'no guest projects');
  assert.ok(sql.includes('before insert or update on public.profiles'), 'no guest profile writes');
  assert.ok(!/on public\.events/.test(sql), 'the anonymous funnel events stay open — deliberately');
  assert.ok(sql.includes('DELIBERATELY NOT BLOCKED'), 'and the file says so');
  assert.ok(sql.includes('ai-user edge function'), 'the one-run allowance is flagged as owned elsewhere, not faked here');
  assert.ok(sql.includes('Allow anonymous'), 'the dashboard toggle is documented');
  assert.ok(sql.includes("notify pgrst, 'reload schema'"), 'PostgREST cache reload');
  assert.ok(sql.includes('ROLLBACK'), 'rollback path documented');
});

test('the scoped exception is documented where the next reader will look', () => {
  assert.ok(SOURCE.includes('// ── ANONYMOUS MODE: ONE SCOPED EXCEPTION'), 'the old tombstone became the exception record');
  assert.ok(SOURCE.includes('Do not widen this to any other tool or entry point.'));
  const claude = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  assert.ok(claude.includes('Anonymous compliance entry'), 'CLAUDE.md carries the convention');
  assert.ok(claude.includes('doc:anon:check'), 'the temp IDB key is on record');
});
