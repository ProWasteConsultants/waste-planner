'use strict';
// ── ACCESS TIERS: FREE · PRO WASTE PROJECT · SUBSCRIBER ──────────────────
// §1 the entitlement rule (extracted and run) · §2 free slots and the
// engaged credit · §3 every export path asks the gate · §4 engagement and the
// design team · §5 the SQL statement of the same rule · §6 copy and events.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SOURCE, extractBlock } = require('./extract.js');

const SQL = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-10-18-access-tiers.sql'), 'utf8');
const fn = (re, ...names) => new Function(extractBlock(re).text + '\n;return { ' + names.join(', ') + ' };')();

// ── §1 ──
test('wpEntitlementsResolve: subscriber → engaged project → free', () => {
  const { wpEntitlementsResolve: R } = fn(/^function wpEntitlementsResolve\(/, 'wpEntitlementsResolve');
  const own = { id: 'p1', ownerId: 'u1' };
  const free = R({ tier: 'none', uid: 'u1', slotsUsed: 1, project: own });
  assert.deepStrictEqual(
    { plan: free.plan, canExport: free.canExport, canCreateProject: free.canCreateProject, aiTier: free.aiTier, readOnly: free.readOnly },
    { plan: 'free', canExport: false, canCreateProject: false, aiTier: 'free', readOnly: false });
  assert.equal(R({ tier: 'none', slotsUsed: 0 }).canCreateProject, true, 'a fresh free account has its one project');

  const eng = R({ tier: 'none', uid: 'u1', slotsUsed: 1, project: { ...own, pwcEngaged: true } });
  assert.equal(eng.plan, 'engaged');
  assert.equal(eng.canExport, true, 'exports unlock on the engaged project');
  assert.equal(eng.aiTier, 'free', 'existing free AI limits on an engaged project (open decision: unchanged by default)');
  assert.equal(eng.isOwner, true);
  assert.equal(R({ tier: 'none', uid: 'u1', slotsUsed: 1, project: own }).canExport, false, 'but only on that project');

  const team = R({ tier: 'none', uid: 'u2', project: { id: 'p1', ownerId: 'u1', shared: true, pwcEngaged: true } });
  assert.equal(team.isMember, true);
  assert.equal(team.canExport, true, 'the invited design team exports the engaged project');

  for (const tier of ['standard', 'founding', 'council_paid']) {
    const sub = R({ tier, slotsUsed: 9, project: own });
    assert.equal(sub.plan, 'subscriber', tier);
    assert.equal(sub.canExport && sub.canCreateProject, true, tier + ': unlimited projects and exports');
    assert.equal(sub.aiTier, 'paid');
  }
  assert.equal(R({ tier: 'standard', project: { ...own, pwcEngaged: true } }).plan, 'subscriber', 'subscriber wins over engaged');
  assert.equal(R({ staff: true, tier: 'none', slotsUsed: 5 }).canExport, true, 'staff export everything');
  assert.equal(R({ tier: 'none' }).canExport, false, 'no project open: free cannot export');
});

test('engagement ended: read-only for a non-subscriber, data untouched; a subscriber keeps editing', () => {
  const { wpEntitlementsResolve: R } = fn(/^function wpEntitlementsResolve\(/, 'wpEntitlementsResolve');
  const ended = { id: 'p1', ownerId: 'u1', pwcEngaged: false, engagedAt: '2026-10-01', engagementEndedAt: '2026-10-10' };
  const free = R({ tier: 'none', uid: 'u1', project: ended });
  assert.equal(free.readOnly, true);
  assert.equal(free.canExport, false);
  assert.equal(R({ tier: 'none', uid: 'u2', project: { ...ended, shared: true } }).readOnly, true, 'the team too');
  assert.equal(R({ tier: 'standard', project: ended }).readOnly, false);
  assert.equal(R({ staff: true, project: ended }).readOnly, false);
  assert.equal(R({ tier: 'none', project: { id: 'p2', ownerId: 'u1' } }).readOnly, false, 'a never-engaged free project is editable');
});

// ── §2 ──
test('free slots: an engaged project does not use the slot; shared and org projects are not the user’s', () => {
  const blocks = [/^function wpIsFreePlan\(\)/, /^function wpProjectCapReached\(\)/, /^function wpFreeSlotsUsed\(\)/]
    .map(p => extractBlock(p).text).join('\n');
  const load = (profile, projects) => new Function('currentUser', 'currentProfile', 'getProjects', 'wmpgIsStaff',
    blocks + '\n;return { wpFreeSlotsUsed, wpProjectCapReached };')({ id: 'u1' }, profile, () => projects, () => false);
  assert.equal(load({ tier: 'none', projects_created: 1, projects_engaged: 1 }, [{ id: 'p1', ownerId: 'u1', pwcEngaged: true }]).wpProjectCapReached(), false,
    'the engaged project frees the slot');
  assert.equal(load({ tier: 'none', projects_created: 2, projects_engaged: 1 }, []).wpProjectCapReached(), true,
    'the credit is per engagement, and deleting cannot reopen a slot');
  assert.equal(load({ tier: 'none', projects_created: 0 }, [{ id: 'x', ownerId: 'u9', shared: true }, { id: 'o', orgId: 'org' }]).wpFreeSlotsUsed(), 0,
    'a project shared with me, or an org’s, is not my free project');
  assert.equal(load({ tier: 'none', projects_created: 0 }, [{ id: 'p1' }]).wpFreeSlotsUsed(), 1, 'pre-migration floor: my visible project');
  assert.equal(load({ tier: 'none', projects_created: 1, projects_engaged: 1 }, [{ id: 'p1', ownerId: 'u1', engagedAt: 'x', engagementEndedAt: 'y' }]).wpFreeSlotsUsed(), 0,
    'an engagement that ended still does not use the slot (the project is read-only instead)');
});

test('compliance checks: a Pro Waste project has no free-plan check limit', () => {
  const t = extractBlock(/^function wpFreeRunsRemaining\(/).text;
  assert.match(t, /if \(proj\.pwcEngaged\) return null;/);
  assert.match(SQL, /if new\.org_id is not null or new\.user_id is null or old\.pwc_engaged then/);
});

// ── §3 ──
test('every export path asks the gate before it writes a file', () => {
  const parent = {
    wsExportPDF: /^function wsExportPDF\(\)/, wsSheetExportSafe: /^function wsSheetExportSafe\(\)/,
    wsExportDXF: /^function wsExportDXF\(\)/, wsLayoutExportDXF: /^function wsLayoutExportDXF\(\)/,
    wsSweptDXF: /^function wsSweptDXF\(\)/, wsManSnapshot: /^async function wsManSnapshot\(\)/,
    wsRampSnapshot: /^async function wsRampSnapshot\(\)/,
  };
  for (const [name, re] of Object.entries(parent)) {
    const body = extractBlock(re).text.split('\n').slice(0, 3).join('\n');
    assert.match(body, /if \(!wsExportAllowed\('[a-z_]+'\)\) return;/, name + ' is gated on its first lines');
  }
  const allowed = extractBlock(/^function wsExportAllowed\(/).text;
  assert.match(allowed, /typeof wpExportGate === 'function' && wpExportGate\(kind, wsExportProjectId\(\)\)/, 'fails closed if the gate is missing');

  // sandboxed tool iframes: swept path (DXF + PDF), health check PDF, compliance report + RFI
  for (const k of ['swept_dxf', 'swept_pdf', 'health_check_pdf', 'compliance_report', 'compliance_rfi'])
    assert.ok(SOURCE.includes(`wpExpGate(&#x27;${k}&#x27;`), 'iframe export gated: ' + k);
  assert.equal(SOURCE.split('var WP_EXP_OK, WP_EXP_RUN, WP_EXP_ON;').length - 1, 3, 'gate helper in each of the three tool srcdocs (declarations only — order-proof)');
  assert.ok(SOURCE.includes('if (e.source !== window.parent || !e.data) return;'), 'iframes take the answer from the platform only');
  assert.ok(SOURCE.includes("if (e.data.type === 'wp-export-blocked') {"), 'the platform answers a refused iframe export');
  const blocked = extractBlock(/^function wpExportBlockedFrom\(/).text;
  assert.ok(blocked.indexOf('wpExportGate(') < blocked.indexOf("type: 'wp-export-go'"), 're-asks the rule before it lets the iframe run');
});

test('wpExportGate: refused → upgrade modal + export_blocked naming the export; guests get the signup gate', () => {
  const g = extractBlock(/^function wpExportGate\(/).text;
  assert.ok(g.indexOf('wpAnonActive()') < g.indexOf('wpEntitlements('), 'anonymous guest first');
  assert.match(g, /logEvent\('export_blocked', \{ export: kind \|\| null/);
  assert.match(g, /showExportUpgrade\(kind, pid, ent\)/);
  const m = extractBlock(/^function showExportUpgrade\(/).text;
  assert.ok(m.includes("'Exports are included with a subscription or a Pro Waste project'"));
  assert.ok(m.includes("'Subscribe'") && m.includes("'Get a fee proposal'"));
});

// ── §4 ──
test('engagement is staff-only, server-checked; the team is invited by the owner of an engaged project', () => {
  const set = extractBlock(/^async function projSetEngaged\(/).text;
  assert.match(set.split('\n')[1], /wmpgIsStaff\(\)\)\) return;/, 'client gate first');
  assert.match(set, /sb\.rpc\('wp_set_engagement'/, 'the write is the staff-checked RPC, never a column update');
  assert.match(set, /logEvent\(on \? 'project_engaged' : 'project_disengaged'/);
  const inv = extractBlock(/^async function projTeamInvite\(/).text;
  assert.ok(inv.indexOf('p.pwcEngaged') < inv.indexOf("sb.from('project_members').insert"), 'no team before engagement');
  assert.match(inv, /logEvent\('team_invite_sent'/);
  assert.match(extractBlock(/^async function wpLoadSharedProjects\(/).text, /logEvent\('team_invite_accepted'/);
  const { projTeamEmailClean: clean } = fn(/^function projTeamEmailClean\(/, 'projTeamEmailClean');
  assert.equal(clean('  Arch@Firm.COM '), 'arch@firm.com');
  assert.equal(clean('nope'), null);
  assert.ok(SOURCE.includes('✓ Engaged with Pro Waste Consultants'), 'the badge');
});

test('a shared project is updated, never upserted; a read-only one is not written at all', () => {
  const save = extractBlock(/^async function saveProjectToDB\(/).text;
  assert.ok(save.indexOf('.readOnly') < save.indexOf("sb.from('projects')"), 'read-only checked before any write');
  assert.match(save, /project\.shared\s*\? await sb\.from\('projects'\)\.update\(row\)\.eq\('id', project\.id\)\s*: await sb\.from\('projects'\)\.upsert\(row\)/);
  const { wpProjectStorageUid: uid } = new Function('getProjects', 'currentUser',
    extractBlock(/^function wpProjectStorageUid\(/).text + '\n;return { wpProjectStorageUid };')(
    () => [{ id: 'p1', ownerId: 'owner', shared: true }, { id: 'p2', ownerId: 'me' }], { id: 'me' });
  assert.equal(uid('p1'), 'owner', 'a shared project’s plans live in its owner’s folder');
  assert.equal(uid('p2'), 'me');
  assert.ok(!/\$\{currentUser\.id\}\/\$\{projectId\}/.test(SOURCE), 'no storage path still assumes the signed-in user owns the project');
});

test('design team on an organisation project: any org member manages it; a team member never does', () => {
  const r = extractBlock(/^function projEngageRender\(/).text;
  assert.match(r, /if \(p\.pwcEngaged && \(ent\.isOwner \|\| staff\) && !p\.shared\) \{/, 'org projects get the Design team box');
  assert.ok(!/!p\.orgId\) \{/.test(r), 'no longer hidden on org projects');
  const sql2 = fs.readFileSync(path.join(__dirname, '..', 'sql', '2026-10-19-design-team-org-projects.sql'), 'utf8');
  assert.match(sql2, /join public\.org_members om on om\.org_id = pr\.org_id/);
  for (const pol of ['project_members_read', 'project_members_invite', 'project_members_remove'])
    assert.match(sql2, new RegExp('create policy ' + pol + '[\\s\\S]*?wp_project_team_manager\\(project_id::text, auth\\.uid\\(\\)\\)'), pol + ' uses the one manager rule');
  assert.match(sql2, /and user_id is null and accepted_at is null and notified_at is null/, 'invite policy keeps its row guards');
  // shared = loaded because of a team membership / staff, not "someone else created it"
  assert.ok(SOURCE.includes('shared: sharedIds.has(p.id),'));
  assert.ok(SOURCE.includes("? p.orgId === currentOrg.id : (!p.orgId || p.shared));"), 'a shared org project shows in the personal list');
});

// ── §5 ──
test('the SQL states the same rule, ships GRANTs + RLS, and keeps engagement staff-only', () => {
  assert.match(SQL, /v_plan := case when v_staff then 'staff'\s*when v_paid then 'subscriber'\s*when v_engaged then 'engaged'\s*else 'free' end;/, 'same resolution order');
  assert.match(SQL, /'canExport', v_staff or v_paid or v_engaged,/);
  assert.match(SQL, /'readOnly', v_ended and not v_staff and not v_paid,/);
  assert.match(SQL, /in \('standard', 'founding', 'council_paid'\)/, 'same paid tiers as the client');
  assert.match(extractBlock(/^function wpEntitlementsResolve\(/).text, /\['standard', 'founding', 'council_paid'\]/);
  assert.match(SQL, /grant select, insert, delete on public\.project_members to authenticated;/);
  assert.match(SQL, /alter table public\.project_members enable row level security;/);
  assert.match(SQL, /raise exception 'staff_only: only Pro Waste staff can change engagement'/);
  assert.match(SQL, /raise exception 'staff_only: only Pro Waste staff can grant a subscription'/);
  assert.match(SQL, /create trigger trg_wp_protect_engagement\s+before insert or update on public\.projects/);
  assert.match(SQL, /create trigger trg_wp_protect_projects_engaged/);
  assert.match(SQL, /if exists \(select 1 from public\.projects where id = new\.id\) then\s+return new;/, 'saving the one free project is not a second project');
  assert.match(SQL, /coalesce\(projects_created, 0\) - coalesce\(projects_engaged, 0\)/);
  assert.match(SQL, /raise exception 'project_read_only:/);
  assert.match(SQL, /where id = auth\.uid\(\) and email_confirmed_at is not null;/, 'invites accept to a confirmed email only');
  assert.ok(!/delete from public\.projects/i.test(SQL), 'ending an engagement never deletes data');
  assert.match(SQL, /if v_row\.stripe_subscription_id is null then/, 'a manual grant never overwrites a Stripe subscriber');
  assert.match(SQL, /where uuid = v_uid and tier_source = 'manual';/, 'revoking only removes a manual grant');
});

test('invite email: the project-invite function, through Supabase Auth, once per row, only by whoever made the invite', () => {
  const fnSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'project-invite', 'index.ts'), 'utf8');
  assert.ok(fnSrc.indexOf('auth.getUser()') < fnSrc.indexOf('inviteUserByEmail(m.email'), 'caller is authenticated first');
  assert.match(fnSrc, /if \(m\.invited_by !== user\.id && !me\?\.is_staff\) return jsonRes\(\{ error: "Not your invite" \}, 403/);
  assert.match(fnSrc, /if \(m\.notified_at\) return jsonRes\(\{ status: "already_sent" \}/, 'one email per row');
  assert.match(fnSrc, /if \(!project\.pwc_engaged\) return jsonRes/, 'engaged projects only');
  assert.match(fnSrc, /if \(!project\) return jsonRes\(\{ error: "project " \+ m\.project_id \+ " not visible to the service key/, 'an invisible project is not reported as unengaged');
  assert.match(fnSrc, /inviteUserByEmail\(m\.email, \{ data: meta \}\)/, 'new address → Invite user template with project + inviter');
  assert.match(fnSrc, /signInWithOtp\(\{\s*email: m\.email,\s*options: \{ shouldCreateUser: false \}/, 'existing account → sign-in link, never a new account');
  const inv = extractBlock(/^async function projTeamInvite\(/).text;
  assert.ok(inv.indexOf(".insert({ project_id: pid, email })") < inv.indexOf('projTeamSendEmail(row.id)'), 'the row first, then the email for that row');
  assert.ok(!/invitee_email|logEvent\([^)]*email/.test(inv), 'no address in the analytics event');
  assert.match(inv, /Invited, but the email didn’t send/, 'a failed send is stated, and the invite stands');
  assert.match(SQL, /add column if not exists notified_at timestamptz/);
  assert.match(SQL, /and user_id is null and accepted_at is null and notified_at is null/, 'a client cannot pre-stamp a row as sent');
  const crm = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-events', 'index.ts'), 'utf8');
  assert.ok(!crm.includes('team_invite_sent') && !crm.includes('project_members'), 'not routed through the CRM');
});

// ── §6 ──
test('one line per level, the same everywhere; WMPs stay PWC-prepared; Stripe stays in test mode', () => {
  const { WP_TIER_LINES } = new Function(extractBlock(/^const WP_TIER_LINES = \[/).text + '\n;return { WP_TIER_LINES };')();
  assert.deepStrictEqual(WP_TIER_LINES.map(r => r[0]), ['Free', 'Pro Waste project', 'Subscription']);
  for (const [k, v] of WP_TIER_LINES)
    assert.ok(SOURCE.includes(`<div><b>${k}:</b> ${v}</div>`), 'pricing page says the same: ' + k);
  assert.equal(WP_TIER_LINES[0][1], 'try one project, no exports.');
  assert.ok(SOURCE.includes("'\\u{1F4C4} Get your WMP prepared by Pro Waste'"), 'no self-serve WMP for subscribers');
  assert.ok(SOURCE.includes("Stripe('pk_test_"), 'gate 8: test key until launch day');
  const pay = extractBlock(/^async function handlePayment\(\)/).text;
  assert.ok(!/first charge is on|alert\([^)]*trial/i.test(pay), 'no trial wording left in checkout');
  const crm = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'functions', 'crm-events', 'index.ts'), 'utf8');
  for (const e of ['export_blocked', 'paywall_option', 'project_engaged', 'project_disengaged', 'team_invite_accepted'])
    assert.ok(crm.includes(`"${e}"`), 'CRM relays ' + e);
});

test('fee proposal: the prowaste.au form with project id + UTM once its URL is set; the Engage modal until then', () => {
  const { wpFeeProposalUrl: url } = fn(/^function wpFeeProposalUrl\(/, 'wpFeeProposalUrl');
  assert.equal(url(null, 'p1', 'paywall'), null);
  const u = new URL(url('https://example.com/form', 'p1', 'paywall_project_cap'));
  assert.equal(u.searchParams.get('project_id'), 'p1');
  assert.equal(u.searchParams.get('utm_source'), 'wasteplanner');
  assert.equal(u.searchParams.get('utm_campaign'), 'paywall_project_cap');
});
