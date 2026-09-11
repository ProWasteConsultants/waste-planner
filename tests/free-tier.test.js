'use strict';
// ── FREE TIER, SIGNUP AND CALCULATOR HANDOFF ─────────────────────────────
// §1 no anonymous path · §2 auth defaults + copy · §3 ?calc= handoff ·
// §4 project + compliance caps and the paywall · §5 no trial · §6 events ·
// §7 standalone legal pages. Functional tests extract the real declarations
// from index.html (never copies); the rest are pins on load-bearing strings.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock } = require('./extract.js');

// ── the free-plan predicate family, extracted and run for real ──
function loadFreePlan({ user = null, profile = null, projects = [], staff = false } = {}) {
  const blocks = [
    /^const WP_FREE_RUNS_CAP = 2;/,
    /^function wpIsFreePlan\(\)/,
    /^function wpProjectsCreated\(\)/,
    /^function wpFreeRunsCap\(\)/,
    /^function wpFreeRunsRemaining\(/,
    /^function wpProjectCapReached\(\)/,
  ];
  const code = blocks.map(p => extractBlock(p).text).join('\n\n');
  const factory = new Function('currentUser', 'currentProfile', 'getProjects', 'wmpgIsStaff',
    code + '\n;return { wpIsFreePlan, wpProjectsCreated, wpFreeRunsCap, wpFreeRunsRemaining, wpProjectCapReached };');
  return factory(user, profile, () => projects, () => staff);
}

test('free plan is tier none (or missing) on a signed-in, non-staff account', () => {
  const user = { id: 'u1', email: 'someone@example.com' };
  assert.equal(loadFreePlan({ user, profile: { tier: 'none' } }).wpIsFreePlan(), true);
  assert.equal(loadFreePlan({ user, profile: {} }).wpIsFreePlan(), true, 'missing tier counts as free');
  assert.equal(loadFreePlan({ user, profile: null }).wpIsFreePlan(), true, 'no profile row counts as free');
  for (const tier of ['standard', 'founding', 'council_paid'])
    assert.equal(loadFreePlan({ user, profile: { tier } }).wpIsFreePlan(), false, tier + ' is paid');
  assert.equal(loadFreePlan({ user: null }).wpIsFreePlan(), false, 'signed out is not "free plan" — it is no plan');
  assert.equal(loadFreePlan({ user, profile: { tier: 'none' }, staff: true }).wpIsFreePlan(), false, 'staff exempt');
});

test('the project slot counts CREATED, and deletion cannot free it', () => {
  const user = { id: 'u1' };
  // DB counter is authoritative even when the local list is empty (deleted)
  const eng = loadFreePlan({ user, profile: { tier: 'none', projects_created: 1 }, projects: [] });
  assert.equal(eng.wpProjectsCreated(), 1);
  assert.equal(eng.wpProjectCapReached(), true, 'deleting the project must not reopen the slot');
  // pre-migration schema: the visible list is the floor
  const eng2 = loadFreePlan({ user, profile: { tier: 'none' }, projects: [{ id: 'p1' }] });
  assert.equal(eng2.wpProjectsCreated(), 1);
  assert.equal(eng2.wpProjectCapReached(), true);
  // fresh free account: slot open
  const eng3 = loadFreePlan({ user, profile: { tier: 'none', projects_created: 0 }, projects: [] });
  assert.equal(eng3.wpProjectCapReached(), false);
  // paid: never capped, however many projects exist
  const eng4 = loadFreePlan({ user, profile: { tier: 'standard', projects_created: 9 }, projects: [{}, {}] });
  assert.equal(eng4.wpProjectCapReached(), false);
});

test('compliance runs: 2 per project on free, null (uncapped) everywhere else', () => {
  const user = { id: 'u1' };
  const free = loadFreePlan({ user, profile: { tier: 'none' } });
  assert.equal(free.wpFreeRunsCap(), 2);
  assert.equal(free.wpFreeRunsRemaining({ complianceRuns: 0 }), 2);
  assert.equal(free.wpFreeRunsRemaining({ complianceRuns: 1 }), 1);
  assert.equal(free.wpFreeRunsRemaining({ complianceRuns: 2 }), 0);
  assert.equal(free.wpFreeRunsRemaining({ complianceRuns: 7 }), 0, 'clamped, never negative');
  assert.equal(free.wpFreeRunsRemaining({}), 2, 'legacy project with no counter starts fresh');
  assert.equal(free.wpFreeRunsRemaining(null), null, 'no open project = nothing to cap');
  const paid = loadFreePlan({ user, profile: { tier: 'founding' } });
  assert.equal(paid.wpFreeRunsCap(), null);
  assert.equal(paid.wpFreeRunsRemaining({ complianceRuns: 99 }), null);
});

// ── §1: no anonymous path remains ──
test('the anonymous mode is gone — no guest entry point, no lite caps', () => {
  for (const token of ['continueAsGuest', 'LITE_CAPS', 'liteCapRemaining', 'incrementLiteCap',
    'getLiteCap', 'showCapUpgrade', 'applyGuestAccess', 'addLiteCapBanner', 'lite-cap-banner',
    "tier: 'lite'", "'lite'"])
    assert.ok(!SOURCE.includes(token), token + ' must not survive the §1 removal');
  assert.ok(SOURCE.includes('// ── ANONYMOUS MODE: REMOVED'), 'the tombstone comment explains the absence');
  assert.ok(SOURCE.includes("if (!currentUser) { promptFreeSignup(); return; }"),
    'plan extraction routes signed-out users to signup, not a guest cap');
});

// ── §2: auth screen defaults and copy ──
test('fresh visitors see Create Account with the free-plan value line', () => {
  assert.ok(SOURCE.includes('Your first project is free.'), 'the value line leads');
  assert.ok(SOURCE.includes('All tools, exports included. No card needed.'));
  assert.ok(SOURCE.includes('Your bin calculation is ready.'), 'calc-handoff variant exists');
  assert.ok(SOURCE.includes('Create a free account to lay out your bin room'),
    'the gate names the thing they clicked, not a generic wall');
  assert.ok(SOURCE.includes('Sign in and we’ll attach it to your account.'),
    'existing customers are offered login, and told their data attaches');
  assert.ok(SOURCE.includes('Already have an account?'), 'sign-in escape hatch under signup');
  assert.ok(!SOURCE.includes('or sign in for full access'), 'old divider copy removed');
  // default tab: signup unless this browser has signed in before
  assert.ok(SOURCE.includes("if (!localStorage.getItem('wp_known_user'))"));
  const marks = SOURCE.split("localStorage.setItem('wp_known_user', '1')").length - 1;
  assert.equal(marks, 3, 'known-user marked on session boot, sign-in, and free signup');
  assert.ok(SOURCE.includes('href="privacy.html"') && SOURCE.includes('href="terms.html"'),
    'auth screen links the standalone legal pages');
});

// ── §3: ?calc= handoff ──
test('the calculator handoff parses, validates, persists and applies once', () => {
  assert.ok(SOURCE.includes("params.get('calc')") || SOURCE.includes("get('calc')"), 'reads ?calc=');
  assert.ok(SOURCE.includes("sessionStorage.setItem('wp_calc_prefill'"), 'parks the payload');
  assert.ok(SOURCE.includes('history.replaceState'), 'strips the parameter from the URL');
  const apply = extractBlock(/^async function applyCalcPrefill\(\)/).text;
  assert.ok(apply.includes("sessionStorage.removeItem('wp_calc_prefill')"), 'one-shot: cleared before use');
  assert.ok(apply.includes("wpProjectCapReached() ) { showPaywall('project_cap'); return; }") ||
    apply.includes("wpProjectCapReached()) { showPaywall('project_cap'); return; }"),
    'a capped account gets the paywall, not a silent drop');
  assert.ok(apply.includes("logEvent('calc_prefill_applied'"));
  assert.ok(SOURCE.includes("if (typeof applyCalcPrefill === 'function') applyCalcPrefill();"),
    'showApp hooks the prefill after sign-in');
  // the calc iframe seeds a commercial room from the handoff, but never
  // double-seeds a project that already carries its own com room
  assert.ok(SOURCE.includes("if(Array.isArray(d.com)&amp;&amp;d.com.length&amp;&amp;!ROOMS.some(r=&gt;r.kind==='com')){"));
  assert.ok(SOURCE.includes('days:Number(c.days)&gt;0?Number(c.days):COMM[c.use].defaultDays'));
});

// ── §3a: payload normalisation, extracted and run for real ──
function loadNormalise() {
  const code = extractBlock(/^function wpNormaliseCalcPayload\(p\)/).text;
  return new Function(code + ';return wpNormaliseCalcPayload;')();
}

test('payload normalisation: clamps, filters, and the nothing-usable refusal', () => {
  const norm = loadNormalise();
  assert.equal(norm(null), null);
  assert.equal(norm('str'), null);
  assert.equal(norm({}), null, 'an empty payload is not a prefill');
  assert.equal(norm({ state: 'ZZ', council: 'x', mix: {}, com: [] }), null,
    'unknown state + council alone is nothing usable');
  assert.ok(norm({ state: 'NSW' }), 'a state alone is usable — council defaults matter');
  const r = norm({ state: 'VIC', council: 'melbourne',
    mix: { apt_1br: '4', apt_2br: -2, apt_3br: 'x', townhouse: 3.9 }, com: null });
  assert.deepEqual(r.mix, { apt_1br: 4, apt_2br: 0, apt_3br: 0, townhouse: 3 },
    'counts parse as non-negative integers');
  assert.equal(r.state, 'VIC');
  assert.deepEqual(r.com, []);
  // commercial rows: typed uses with positive values only, capped at 20
  const com = Array.from({ length: 25 }, (_, i) => ({ use: 'cafe', value: 10 + i, days: 0 }));
  com.push({ use: 42, value: 5 }, { use: 'shop', value: 0 }, null);
  const rc = norm({ com });
  assert.equal(rc.com.length, 20, 'tenancies cap at 20');
  assert.ok(rc.com.every(c => typeof c.use === 'string' && c.value > 0));
  assert.equal(rc.com[0].days, 0, 'no trading days stays 0 — the calc applies its own default');
});

// ── §3b: the durable half — calc_leads record, claimed on first sign-in ──
test('the lead survives the tab: token parked, created server-side, claimed after sign-in', () => {
  assert.ok(SOURCE.includes("localStorage.setItem('wp_calc_lead'"), 'token parked in localStorage (sessionStorage dies with the tab)');
  assert.ok(SOURCE.includes("sb.rpc('create_calc_lead'"), 'durable copy created server-side');
  assert.ok(SOURCE.includes("q.get('lead')"), '?lead= handoff for capture points that created the lead themselves (QR flow)');
  const apply = extractBlock(/^async function applyCalcPrefill\(\)/).text;
  assert.ok(apply.includes("sb.rpc('claim_calc_lead'"), 'claimed after sign-in');
  assert.ok(apply.includes("localStorage.removeItem('wp_calc_lead')"), 'one-shot: token cleared with the payload');
  assert.ok(apply.includes('wpNormaliseCalcPayload(data)'), 'claimed content is re-normalised, never trusted');
  assert.ok(apply.includes("wpNormaliseCalcPayload(JSON.parse(sessionStorage.getItem('wp_calc_prefill')")
    , 'the in-tab payload stays the fast path and wins over the claim');
});

test('the calc_leads migration is RPC-only, expiring, and un-enumerable', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-11-calc-leads.sql'), 'utf8');
  assert.ok(sql.includes('create table if not exists public.calc_leads'));
  assert.ok(sql.includes("interval '48 hours'"), 'expiry inside the briefed 24-48h band');
  assert.ok(sql.includes('enable row level security'));
  assert.ok(!/create policy/i.test(sql), 'no policies — the token is the secret, a SELECT policy would allow enumeration');
  assert.ok(!/grant\s+(select|insert|update|delete|all)[\s\S]{0,60}on\s+(table\s+)?public\.calc_leads/i.test(sql),
    'no table grants either — the two SECURITY DEFINER functions are the whole surface');
  assert.ok((sql.match(/security definer/g) || []).length >= 2, 'both RPCs run as definer');
  assert.ok(sql.includes('on conflict (token) do nothing'), 'a guessed token can never clobber a lead');
  assert.ok(sql.includes('auth.uid() is null'), 'claiming requires a session');
  assert.ok(sql.includes('claimed_by is null or claimed_by = auth.uid()'),
    'first claimant wins; same-account re-claim is an idempotent retry');
  assert.ok(sql.includes("grant execute on function public.create_calc_lead(text, jsonb, text) to anon, authenticated"));
  assert.ok(sql.includes("grant execute on function public.claim_calc_lead(text) to authenticated"));
  assert.ok(!/to\s+anon[\s\S]{0,40}claim_calc_lead/.test(sql), 'anon can create, never claim');
  assert.ok(sql.includes("notify pgrst, 'reload schema'"));
  assert.ok(sql.includes('ROLLBACK'));
});

// ── §3c: post-signup landing is the Design tab, not a calculator re-entry ──
test('after sign-in the user lands in Design with the schedule, never re-entering numbers', () => {
  const apply = extractBlock(/^async function applyCalcPrefill\(\)/).text;
  assert.ok(apply.includes('wsOpenProject(project)'), 'opens the workspace on the project just created');
  assert.ok(apply.includes("wsShowTab") && apply.includes("'layout'"),
    'Layout tab up: bin-room cards, with the canvas asking for the floor plan');
  // the schedule reaches the embedded calculator via the summary push,
  // tenancies included — the fill runs the calc and posts the schedule back
  const push = extractBlock(/^function wsPushSummaryToCalc\(\)/).text;
  assert.ok(push.includes('com: (Array.isArray(s.com) && s.com.length) ? s.com : undefined'),
    'commercial tenancies ride the summary push into the Design-tab calculator');
  assert.ok(apply.includes('pre.com.length ? { com: pre.com } : {}'),
    'the created project summary carries the tenancies for that push');
  // the old landing survives ONLY as the degraded fallback
  const primaryFirst = apply.indexOf('wsOpenProject(project)');
  const calcScreen = apply.indexOf("showScreen('calculator'");
  assert.ok(primaryFirst > -1 && (calcScreen === -1 || calcScreen > primaryFirst),
    "showScreen('calculator') may remain only as the fallback branch");
});

// ── §4: caps wired through the UI, checker and paywall ──
test('project creation is gated at open, at create, and at prefill', () => {
  const openFn = extractBlock(/^function openNewProject\(\)/).text;
  assert.ok(openFn.includes("wpProjectCapReached()) { showPaywall('project_cap'); return; }"));
  const idx = SOURCE.indexOf('window.createProject = async function()');
  assert.ok(idx > 0);
  const createFn = SOURCE.slice(idx, SOURCE.indexOf('window.deleteProject', idx));
  assert.ok(createFn.includes("wpProjectCapReached()) { closeModal(); showPaywall('project_cap'); return; }"),
    're-checked at the moment of insert, not just at modal open');
});

test('the checker carries the per-project run count and reports each scan', () => {
  // parent → checker: cap rides the role handshake and the wp-set-runs refresh
  assert.ok(SOURCE.includes("runsCap: (typeof wpFreeRunsCap === 'function') ? wpFreeRunsCap() : null"));
  assert.ok(SOURCE.includes("runsRemaining: (typeof wpFreeRunsRemaining === 'function') ? wpFreeRunsRemaining(proj) : null"));
  // checker: gate before scanning, badge in the toolbar, report on completion
  assert.ok(SOURCE.includes('if (state.runsRemaining === 0) {'), 'startScan refuses the third run');
  assert.ok(SOURCE.includes('type: &#x27;wp-paywall&#x27;, reason: &#x27;compliance_cap&#x27;'));
  assert.ok(SOURCE.includes('id=&quot;runs-left-label&quot;'), 'remaining runs shown in the tool header');
  assert.ok(SOURCE.includes('free checks left on this project'));
  assert.ok(SOURCE.includes('type: &#x27;wp-scan-done&#x27;, fails: fail, flags: flag, score'));
  // parent owns the counter: increments, saves, logs, pushes the fresh count
  assert.ok(SOURCE.includes("proj.complianceRuns = (Number(proj.complianceRuns) || 0) + 1;"));
  assert.ok(SOURCE.includes("logEvent('compliance_run', { project_id: proj?.id || null, fails: e.data.fails ?? null"));
  assert.ok(SOURCE.includes("type: 'wp-set-runs'"));
});

test('the paywall keeps what you have, offers checkout, and the Pro Waste handoff', () => {
  const fn = extractBlock(/^function showPaywall\(reason\)/).text;
  assert.ok(fn.includes("logEvent('paywall_shown', { reason: reason || null })"));
  assert.ok(fn.includes('stays yours'), 'keep-what-you-have, stated plainly');
  assert.ok(fn.includes("wpEngageOpen('paywall')"), '§4a: Engage Pro Waste replaces the external fee-proposal link');
  assert.ok(fn.includes('wpPaywallUpgrade()'), 'the upgrade button routes to Stripe checkout');
  assert.ok(!/only|hurry|last chance/i.test(fn), 'no pressure copy');
});

// ── §5: the 14-day trial is gone from the client ──
test('no trial anywhere: pricing copy, buttons, and the success alert', () => {
  assert.ok(!SOURCE.includes('14-day'), 'no trial framing survives');
  assert.ok(!SOURCE.includes('Start free trial'), 'no trial CTAs');
  assert.ok(SOURCE.includes('Subscribe →'), 'the payment button says what it does');
  assert.ok(SOURCE.includes('🔒 Secured by Stripe · GST included · Cancel anytime'));
  // gate 8 (CLAUDE.md): test-mode publishable key stays until launch day
  assert.ok(SOURCE.includes("Stripe('pk_test_"), 'live key swap is a launch-day step, not this change');
});

// ── §6: product events ──
test('every §6 event fires from the client into the events table', () => {
  assert.ok(SOURCE.includes("logEvent('signup', { name, firm: company || null"));
  assert.ok(SOURCE.includes("logEvent('calc_prefill_applied'"));
  assert.ok(SOURCE.includes("logEvent('paywall_shown'"));
  assert.ok(SOURCE.includes("logEvent('subscribed', { plan: selectedPlan || null"));
  // project_created carries project_id from BOTH creation paths
  const created = SOURCE.split("logEvent('project_created', { project_id: project.id").length - 1;
  assert.ok(created >= 2, 'modal create and calc prefill both log with an id, found ' + created);
  // exports: layout DXF, swept DXF, sheet PDF, WMP docx (both exporters), issue package
  const exports_ = SOURCE.split("logEvent('export', {").length - 1;
  assert.equal(exports_, 6, 'six export sites log the export event');
});

test('the CRM relay lives in an edge function, and no CRM secret ships in the bundle', () => {
  const fnPath = path.join(__dirname, '..', 'supabase', 'functions', 'crm-events', 'index.ts');
  const fn = fs.readFileSync(fnPath, 'utf8');
  assert.ok(fn.includes('CRM_WEBHOOK_URL') && fn.includes('CRM_WEBHOOK_SECRET'), 'secrets come from env');
  assert.ok(fn.includes('x-wp-webhook-secret'), 'shared-secret header on the relay');
  assert.ok(fn.includes('secret,'), 'secret duplicated into the body for CRMs that cannot read headers');
  assert.ok(fn.includes("'email,full_name,company_name,tier'") || fn.includes('"email,full_name,company_name,tier"'),
    'events are enriched from profiles so the CRM gets a contact, not a UUID');
  assert.ok(fn.includes('SUPABASE_SERVICE_ROLE_KEY'), 'anon-key posts are refused');
  assert.ok(!SOURCE.includes('CRM_WEBHOOK'), 'the browser bundle never sees the CRM endpoint or secret');
});

// ── §4a: Engage Pro Waste Consultants ──
test('one button, one label, five placements — all routed through wpEngageOpen', () => {
  // 1. project card (secondary action, hidden once a request exists)
  assert.ok(SOURCE.includes("wpEngageOpen('project_card','${p.id}')"));
  // 2. project header: the old Request WMP button now opens the modal for non-staff
  assert.ok(SOURCE.includes("if (!wmpgIsStaff()) return wpEngageOpen('project_header');"));
  assert.ok(SOURCE.includes("'\\u{1F91D} Engage Pro Waste Consultants'"), 'header label for non-staff');
  // 3. design tab nudge, gated on calculated rooms and per-project dismissal
  assert.ok(SOURCE.includes('Bins sized — want Pro Waste to confirm the room and prepare the WMP?'));
  assert.ok(SOURCE.includes("wpEngageOpen('design_tab')"));
  const nudge = extractBlock(/^function wpEngageNudgeUpdate\(\)/).text;
  assert.ok(nudge.includes('WS_CALC_ROOMS.length') && nudge.includes('wp_engage_nudge_'), 'shows on sized bins, dismiss sticks per project');
  assert.ok(nudge.includes('!staff'), 'staff never see their own nudge');
  // 4. compliance checker: button appears on failed clauses, hands over to the parent
  assert.ok(SOURCE.includes('id=&quot;engage-btn&quot;'));
  assert.ok(SOURCE.includes('(fail &gt; 0 &amp;&amp; state.role !== &#x27;council&#x27;)'), 'fails only, and never for council assessors');
  assert.ok(SOURCE.includes('type: &#x27;wp-engage&#x27;, source: &#x27;compliance&#x27;'));
  assert.ok(SOURCE.includes("if (typeof wpEngageOpen === 'function') wpEngageOpen(e.data.source || 'compliance');"));
  // 5. paywall: Engage replaces the external fee-proposal link
  assert.ok(SOURCE.includes("closePaywall();wpEngageOpen('paywall')"));
  assert.ok(!SOURCE.includes('request-a-fee-proposal" target="_blank"'), 'no external form link left in the paywall');
});

test('an engagement files into the existing WMP queue with scope, and logs wmp_requested', () => {
  const fn = extractBlock(/^async function wpEngageSubmit\(\)/).text;
  assert.ok(fn.includes("request_type: 'wmp', status: 'pending'"), 'same queue pipeline as requestWMP');
  assert.ok(fn.includes('engage: { scope, scope_labels: scopeLabels'), 'scope rides in the snapshot — no schema change');
  assert.ok(fn.includes("logEvent('wmp_requested'"), 'CRM event fired');
  assert.ok(fn.includes('Thanks — Pro Waste will send a fee proposal within one business day.'));
  assert.ok(fn.includes('REVIEW_FORMSPREE'), 'email notification reuses the existing endpoint (Resend not integrated — deliberate)');
  const open = extractBlock(/^function wpEngageOpen\(source, projectId\)/).text;
  assert.ok(open.includes("prior.type === 'wmp' && prior.status !== 'declined'"), 'no duplicate requests while one is live');
  // scope options exactly as briefed
  for (const label of ['WMP for DA', 'Design advice on bin room / access', 'RFI response', 'Not sure yet'])
    assert.ok(SOURCE.includes(`'${label}'`), 'scope option: ' + label);
});

test('queue gains proposal_sent and declined, staff-only gating unchanged', () => {
  assert.ok(SOURCE.includes("'wmp:proposal_sent': { label: 'Fee proposal sent'"));
  assert.ok(SOURCE.includes("'wmp:declined':      { label: 'Not proceeding'"));
  assert.ok(SOURCE.includes(`"wmpqSetStatus('\${r.id}','proposal_sent')"`));
  assert.ok(SOURCE.includes(`"wmpqSetStatus('\${r.id}','declined')"`));
  assert.ok(SOURCE.includes("q.in('status', ['pending','proposal_sent','inprogress','rfi'])"), 'open filter includes proposals');
  // the generator and queue stay staff-only
  assert.ok(SOURCE.includes('if (!wmpgIsStaff()) { list.innerHTML') || /wmpgIsStaff\(\)\)\s*\{\s*list\.innerHTML/.test(SOURCE), 'queue refuses non-staff');
  const crm = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-events', 'index.ts'), 'utf8');
  assert.ok(crm.includes('"wmp_requested"'), 'relay forwards the new event to CORE');
});

test('the billing functions are de-trialed and cancellation reverts to free', () => {
  const cs = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'create-subscription', 'index.ts'), 'utf8');
  assert.ok(!cs.includes('trial_period_days:'), 'no trial on the subscription create (the comment may name it; the call must not)');
  assert.ok(cs.includes("payment_behavior: \"error_if_incomplete\""),
    'a failed first charge throws instead of creating an unpaid subscription');
  assert.ok(cs.includes('trial_ends_at: null'), 'legacy trial stamps are cleared');
  assert.ok(!/return jsonRes\(\{ tier, trial_ends_at/.test(cs), 'the response no longer advertises a trial');
  const wh = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'stripe-webhook', 'index.ts'), 'utf8');
  assert.ok(wh.includes('constructEventAsync'), 'webhook signature is verified');
  assert.ok(wh.includes('"customer.subscription.deleted"'), 'cancellation is handled');
  assert.ok(wh.includes("tier: \"none\""), 'cancellation reverts to the free plan, never deletes anything');
  assert.ok(wh.includes('.eq("stripe_subscription_id", sub.id)'),
    'events match by subscription id so a stale event cannot clobber a newer subscription');
});

// ── §7: standalone legal pages ──
test('privacy and terms ship as static pages, marked as drafts for review', () => {
  for (const f of ['privacy.html', 'terms.html']) {
    const page = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.ok(page.includes('Draft for review'), f + ' is honest about its status');
    assert.ok(page.includes('Privacy Act 1988') || page.includes('laws of Victoria'), f + ' is AU-oriented');
    assert.ok(page.includes('lachy@prowaste.au'), f + ' carries the contact');
  }
  const terms = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
  assert.ok(terms.includes('free plan'), 'terms describe the free plan, not a trial');
  assert.ok(!terms.includes('14-day'), 'no trial in the standalone terms');
});

// ── server-side enforcement migration ──
test('the enforcement migration uses triggers (not permissive policies) and rolls back', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-09-07-free-tier-enforcement.sql'), 'utf8');
  assert.ok(sql.includes('projects_created'), 'lifetime counter column');
  assert.ok(sql.includes('before insert on public.projects'), 'project cap is a BEFORE INSERT trigger');
  assert.ok(sql.includes('after insert on public.projects'), 'counter increments after insert');
  assert.ok(!/\b(before|after) delete\b/i.test(sql), 'no delete trigger — the slot is spent for good');
  assert.ok(sql.includes('before update on public.projects'), 'compliance cap is a BEFORE UPDATE trigger');
  assert.ok(sql.includes('> 2'), 'two runs per project');
  assert.ok(sql.includes('OR together'), 'states WHY triggers instead of policies');
  assert.ok(sql.includes("notify pgrst, 'reload schema'"), 'PostgREST cache reload');
  assert.ok(sql.includes('ROLLBACK'), 'rollback path documented');
});
