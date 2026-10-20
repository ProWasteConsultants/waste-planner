'use strict';
// ── TERMS / PRIVACY: versions, sign-up consent, re-acceptance, notice email,
// and the design-aid notice on results and exports ───────────────────────
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SOURCE, extractBlock, loadEngine, decodeSrcdoc } = require('./extract.js');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const AID = 'Design aid only — verify before submission';
const legalConfig = () => JSON.parse(read('legal/versions.json'));
const fn = name => extractBlock(new RegExp('^(?:async )?function ' + name + '\\('))
  .text;
const MD = require('../legal/md.js');

// ── 1. one source of truth ──
test('legal/versions.json is the one place versions and effective dates live', () => {
  const L = legalConfig();
  for (const k of ['terms', 'privacy']) {
    assert.match(L[k].version, /^\d+(\.\d+)*$/, k + ' version');
    assert.match(L[k].effective, /^\d{4}-\d{2}-\d{2}$/, k + ' effective date is a fixed date');
    assert.ok(fs.existsSync(path.join(ROOT, 'legal', L[k].file)), k + ' document file exists');
  }
  assert.equal(L.terms.version, '2.0'); assert.equal(L.privacy.version, '2.0');
  assert.equal(L.terms.effective, '2026-10-20'); assert.equal(L.privacy.effective, '2026-10-20');
  assert.ok(!fs.existsSync(path.join(ROOT, 'legal.js')), 'the old config is gone');
  assert.ok(fn('wpLegalLoad').includes("fetch('legal/versions.json'"), 'the app reads it');
  assert.ok(!/Last updated: \$\{new Date/.test(SOURCE), 'no run-time date anywhere');
  // no version hard-coded in the sign-up / acceptance paths
  ['wpLegalSignupMeta', 'wpLegalRecord', 'wpLegalCheck', 'wpLegalModal', 'handleSignup'].forEach(n =>
    assert.ok(!/['"]\d+\.\d+['"]/.test(fn(n)), n + ' carries no literal version'));
  assert.ok(!/['"]2\.0['"]/.test(read('supabase/functions/legal-notice/index.ts')), 'the notice reads the published versions');
});
test('no copy of the legal text anywhere but legal/*.md', () => {
  assert.ok(!SOURCE.includes('const LEGAL_DOCS'), 'the modal text is gone');
  assert.ok(!SOURCE.includes('id="legal-modal"'), 'and its modal');
  for (const f of ['terms.html', 'privacy.html', 'terms/index.html', 'privacy/index.html']) {
    const page = read(f);
    assert.ok(!/Draft for review/i.test(page), f + ': no draft notice');
    const text = page.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    assert.ok(text.length < 260, f + ' holds no prose of its own: ' + text.slice(0, 120));
  }
  for (const marker of ['Privacy Act 1988', 'Australian Privacy Principles', 'governed by the laws', 'Limitation of Liability'])
    assert.ok(!SOURCE.includes(marker), 'index.html carries no legal text: ' + marker);
  assert.ok(fn('showLegal').includes("window.open(doc === 'privacy' ? 'privacy' : 'terms', '_blank', 'noopener')"), 'links open the pages');
});
test('the pages render legal/<doc>.md with the version line, at both URLs', () => {
  for (const k of ['terms', 'privacy']) {
    const page = read(k + '.html');
    assert.ok(page.includes(`<article id="doc" data-doc="${k}">`));
    assert.ok(page.includes('<script src="legal/md.js"></script>') && page.includes('<script src="legal/page.js"></script>'));
    const alias = read(k + '/index.html');
    assert.ok(alias.includes(`url=../${k}.html`) && alias.includes(`location.replace('../${k}.html'`), k + '/ forwards to ' + k + '.html');
  }
  assert.ok(fs.existsSync(path.join(ROOT, '.nojekyll')), 'Jekyll off, so legal/*.md is served raw, not converted');
  const pj = read('legal/page.js');
  assert.ok(pj.includes("fetch(at('versions.json')") && pj.includes('fetch(at(d.file)'), 'reads the config, then the document');
  assert.ok(pj.includes("'Version ' + d.version + ' · Effective ' + window.wpLegalMd.longDate(d.effective)"));
});
test('md.js: the Markdown legal documents use, and nothing executable', () => {
  const h = MD.render('# Terms\n\nIntro **bold** and *it*.\n\n## 1. Scope\n1. one\n2. two\n   - a\n   - b\n\n| A | B |\n|---|:-:|\n| x | y |\n\n> note\n\n---\nEmail info@prowaste.au or https://wasteplanner.au.\n\n<!-- hidden -->');
  assert.match(h, /<h1 id="terms">Terms<\/h1>/);
  assert.match(h, /<h2 id="1-scope">1\. Scope<\/h2>/);
  assert.match(h, /<strong>bold<\/strong> and <em>it<\/em>/);
  assert.match(h, /<ol><li>one<\/li><li>two<ul><li>a<\/li><li>b<\/li><\/ul><\/li><\/ol>/);
  assert.match(h, /<th>A<\/th><th style="text-align:center">B<\/th>/);
  assert.match(h, /<blockquote><p>note<\/p><\/blockquote>/);
  assert.match(h, /<a href="mailto:info@prowaste.au">info@prowaste.au<\/a>/);
  assert.match(h, /<a href="https:\/\/wasteplanner.au" target="_blank" rel="noopener">https:\/\/wasteplanner.au<\/a>\./);
  assert.ok(!h.includes('hidden'), 'editor comments are not shown');
  const bad = MD.render('<script>alert(1)</script>\n\n[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
  assert.ok(!/<script|<img|href="javascript/i.test(bad), 'raw HTML and javascript: links never come through');
  assert.equal(MD.longDate('2026-10-20'), '20 October 2026');
});

// ── 2. sign-up ──
test('sign-up: an unticked box linking both pages in a new tab, and both paths refuse without it', () => {
  const box = SOURCE.slice(SOURCE.indexOf('<input type="checkbox" id="signup-terms"'), SOURCE.indexOf('</label>', SOURCE.indexOf('id="signup-terms"')));
  assert.ok(!/\bchecked\b/.test(box.split('>')[0]), 'unticked by default');
  assert.match(box, /I agree to the <a href="terms" target="_blank" rel="noopener"[^>]*>Terms of Service<\/a> and <a href="privacy" target="_blank" rel="noopener"[^>]*>Privacy Policy<\/a>/);
  ['handleSignupToPay', 'handleFreeSignup'].forEach(n => {
    const src = fn(n);
    assert.ok(/if \(termsCheck && !termsCheck\.checked\)/.test(src), n + ' blocks an unticked box');
    assert.ok(src.indexOf('termsCheck.checked') < (src.indexOf('handleSignup()') >= 0 ? src.indexOf('handleSignup()') : Infinity), n + ' checks before creating anything');
  });
  assert.ok(fn('handleSignupToPay').includes('if (!(await wpLegalLoad()))'), 'no payment before the versions are known');
  assert.ok(fn('handleFreeSignup').includes('if (!(await wpLegalLoad()))'));
  const su = fn('handleSignup');
  assert.ok(su.includes('...wpLegalSignupMeta()'), 'the agreed versions ride the auth metadata');
  assert.ok(su.indexOf("await wpLegalRecord('signup')") > su.indexOf("from('profiles').upsert("), 'recorded once the profile row exists');
  assert.ok(!SOURCE.includes("console.log('pendingSignup set:'"), 'the password is never logged');
});

// ── 3. the acceptance record ──
test('SQL: three profile columns, written only by wp_accept_terms with the server clock', () => {
  const sql = read('sql/2026-10-20-legal-acceptance.sql');
  ['terms_version text', 'privacy_version text', 'terms_accepted_at timestamptz'].forEach(c => assert.ok(sql.includes('add column if not exists ' + c), c));
  assert.match(sql, /function public\.wp_accept_terms\([\s\S]*?security definer[\s\S]*?terms_accepted_at = t/);
  assert.match(sql, /t timestamptz := now\(\)/, 'server time, never a client value');
  assert.match(sql, /before insert or update on public\.profiles/, 'client writes to the columns are discarded');
  assert.match(sql, /grant execute on function public\.wp_accept_terms\(text, text, text\) to authenticated/);
  assert.match(sql, /is_anonymous/, 'guest sessions refused');
  assert.match(sql, /create table if not exists public\.legal_acceptances/);
  assert.match(sql, /grant select on public\.legal_acceptances to authenticated/);
});

// ── 4. re-acceptance ──
test('wpLegalNeeds: who must accept, and when', () => {
  const w = loadEngine({ blocks: [['wpLegalVersionCmp', /^function wpLegalVersionCmp\(/], ['wpLegalNeeds', /^function wpLegalNeeds\(/]] });
  assert.equal(w.wpLegalVersionCmp('2.0', '1.9'), 1);
  assert.equal(w.wpLegalVersionCmp('1.10', '1.9'), 1);
  assert.equal(w.wpLegalVersionCmp('2', '2.0'), 0);
  assert.equal(w.wpLegalVersionCmp(null, '2.0'), -1);
  const L = { terms: { version: '2.0' }, privacy: { version: '2.0' }, publishedAt: '2026-10-20', reacceptFrom: '2026-11-20' };
  const old = { created_at: '2026-01-01T00:00:00Z', user_metadata: {} };
  const at = d => Date.parse(d);
  assert.deepEqual({ ...w.wpLegalNeeds({ terms_version: '2.0', privacy_version: '2.0' }, old, L, at('2027-01-01')) }, { need: false }, 'accepted');
  assert.equal(w.wpLegalNeeds({ terms_version: '1.0', privacy_version: '2.0' }, old, L, at('2027-01-01')).need, true, 'one document behind → asked');
  assert.equal(w.wpLegalNeeds({}, old, L, at('2026-11-19T12:00:00Z')).need, false, 'existing user, before the date → not yet');
  assert.deepEqual({ ...w.wpLegalNeeds({}, old, L, at('2026-11-20T00:00:00+10:00')) }, { need: true, why: 'update' }, 'from the date (Melbourne midnight) → asked');
  assert.deepEqual({ ...w.wpLegalNeeds({}, { created_at: '2026-10-25T00:00:00Z', user_metadata: {} }, L, at('2026-10-26')) }, { need: true, why: 'new' }, 'a new account that never ticked a box (an invitation) → asked now');
  assert.deepEqual({ ...w.wpLegalNeeds({}, { created_at: '2026-10-25T00:00:00Z', user_metadata: { terms_version: '2.0', privacy_version: '2.0' } }, L, at('2027-01-01')) }, { need: false, record: true }, 'ticked at sign-up, not yet recorded → recorded, no modal');
  assert.equal(w.wpLegalNeeds({}, { ...old, is_anonymous: true }, L, at('2027-01-01')).need, false, 'guest sessions are not asked');
  assert.equal(w.wpLegalNeeds({}, old, { ...L, reacceptFrom: null }, at('2030-01-01')).need, false, 'no date set → existing users are not asked');
});
test('the check runs on every way into the app, and the modal is blocking', () => {
  const show = fn('showApp');
  assert.ok(show.includes('wpLegalCheck()'), 'showApp runs the check');
  const modal = fn('wpLegalModal');
  assert.ok(!/onclick=.*close|addEventListener\('click'/.test(modal.replace(/wp-legal-out|wp-legal-accept/g, '')), 'no click-away');
  assert.ok(modal.includes('btn.disabled = !box.checked'), 'accept is disabled until the box is ticked');
  assert.ok(modal.includes("handleLogout()"), 'the only other way out is signing out');
  assert.ok(modal.includes("wpLegalRecord(why === 'new' ? 'signup' : 'reaccept')"));
  assert.ok(fn('wpLegalRecord').includes("sb.rpc('wp_accept_terms'"), 'recorded through the RPC');
});

// ── 5. the notice email ──
test('legal-notice: content, recipients, 30-day rule, and nothing sends without the typed confirmation', async () => {
  const n = await import(path.join(ROOT, 'supabase/functions/legal-notice/notice.mjs'));
  assert.equal(n.longDate('2026-11-20'), '20 November 2026');
  assert.equal(n.longDate('2026-02-30'), null);
  assert.equal(n.checkEffectiveDate('2026-11-19', '2026-10-20').ok, true);
  assert.match(n.checkEffectiveDate('2026-11-18', '2026-10-20').why, /29 days/);
  const r = n.noticeRecipients([
    { email: 'a@x.au', full_name: 'Ann Lee' }, { email: 'A@X.au' }, { email: 'b@x.au', terms_version: '2.0', privacy_version: '2.0' },
    { email: 'c@x.au', terms_version: '2.0', privacy_version: '1.0' }, { email: 'not-an-email' }, { email: null }], '2.0', '2.0');
  assert.deepEqual(r.map(x => x.email), ['a@x.au', 'c@x.au'], 'deduped, valid, not already on the current versions');
  const m = n.buildNotice({ name: 'Ann Lee', effectiveDate: '2026-11-20', termsVersion: '2.0', privacyVersion: '2.0' });
  assert.match(m.text, /^Hi Ann,/);
  for (const s of [m.text, m.html]) {
    assert.ok(s.includes('https://wasteplanner.au/terms') && s.includes('https://wasteplanner.au/privacy'), 'both links');
    assert.ok(s.includes('20 November 2026'), 'the effective date');
    assert.ok(s.includes('Version 2.0'));
  }
  assert.equal(n.sendPhrase(42, '2026-11-20'), 'SEND 42 2026-11-20');
  const fnSrc = read('supabase/functions/legal-notice/index.ts');
  const at = s => { const i = fnSrc.indexOf(s); assert.ok(i >= 0, 'missing: ' + s); return i; };
  assert.ok(at('if (!me?.is_staff)') < at('sbAdmin.from("profiles")'), 'staff check before any read');
  assert.ok(at('if (body.send !== true)') < at('api.resend.com'), 'dry run by default');
  assert.ok(at('if (body.confirm !== phrase)') < at('api.resend.com'), 'typed confirmation before any send');
  assert.ok(at('if (already && body.resend !== true)') < at('api.resend.com'), 'one send per version');
  assert.ok(!/console\.(log|info|warn|error)/.test(fnSrc), 'logs nothing');
});

// ── 6. design-aid notice ──
test('design-aid notice: one wording, in the parent and every sandboxed tool that shows or exports results', () => {
  const w = loadEngine({ blocks: [['wpDesignAid', /^function wpDesignAid\(/], ['wsDXFNoticeEntity', /^function wsDXFNoticeEntity\(/],
    ['wpDocxAidPara', /^function wpDocxAidPara\(/], ['wpDocxFooterWithAid', /^function wpDocxFooterWithAid\(/]] });
  assert.equal(w.wpDesignAid(), AID);
  for (const id of ['compliance-iframe', 'swept-iframe']) {
    assert.ok(decodeSrcdoc(id).html.includes(`const WP_DESIGN_AID='${AID}';`), id + ' carries the same words');
  }
  // every static notice element says exactly the words
  const statics = [...SOURCE.matchAll(/class="wp-aid"[^>]*>([^<$]+)</g)].map(m => m[1]);
  statics.forEach(t => assert.equal(t, AID));
  assert.ok(decodeSrcdoc('compliance-iframe').html.includes(`class="wp-aid" style="font-size:11px;font-weight:600;color:#C2410C;margin:6px 0 2px;">${AID}</div>`), 'beside the checker results');
  // DXF: a TEXT entity below the extents, on its own layer
  const t = w.wsDXFNoticeEntity('0\nLINE\n8\nX\n10\n100\n20\n50\n11\n400\n21\n250\n');
  assert.match(t, /^0\nTEXT\n8\nWP-NOTES\n/);
  assert.ok(t.includes('\n1\nDESIGN AID ONLY - VERIFY BEFORE SUBMISSION\n'));
  // DOCX footer: appended once
  const f = '<w:ftr xmlns:w="x"><w:p/></w:ftr>';
  const once = w.wpDocxFooterWithAid(f);
  assert.ok(once.endsWith('</w:ftr>') && once.includes(AID));
  assert.equal(w.wpDocxFooterWithAid(once), once, 'idempotent');
});
test('design-aid notice: wired into every export path', () => {
  const has = (name, s) => assert.ok(fn(name).includes(s), name + ' → ' + s);
  has('wsSheetBottomText', 'notes.unshift(wpDesignAid())');
  has('wsDXFDocument', 'wsDXFNoticeEntity(entities)');
  has('wsManSnapshot', 'wpDesignAid()');
  has('wsRampSnapshot', 'wpDesignAid()');
  has('pkgBuild', 'out.getPages().forEach');
  has('wmpgBuildTemplateBlob', 'await wpDocxStampAid(zip, xml)');
  has('advExport', 'await wpDocxStampAid(zip, xml)');
  has('wmpgBuildHtml', '<div class="aidfoot">${esc(wpDesignAid())}</div>');
  assert.ok(SOURCE.includes("new D.Paragraph({ alignment:D.AlignmentType.CENTER, children:[ run(wpDesignAid(), {size:14, color:'8A9A9A'}) ] })"), 'generic WMP .docx footer');
  const comp = decodeSrcdoc('compliance-iframe').html, swept = decodeSrcdoc('swept-iframe').html;
  assert.ok(comp.includes('<div class="aid">${WP_DESIGN_AID}</div>'), 'compliance report');
  assert.ok(comp.includes('text += `—\\n${WP_DESIGN_AID}\\n`;'), 'RFI download');
  assert.ok(swept.includes('<br><b>${WP_DESIGN_AID}</b></div>'), 'swept-path PDF footer');
  assert.ok(swept.includes('DESIGN AID ONLY - VERIFY BEFORE SUBMISSION'), 'swept-path DXF');
});
test('design-aid notice: beside every AI extraction result', () => {
  ['npExtract', 'wsRunAiExtract', 'rdbResExtract', 'crqExtract', 'crqRatesReport', 'eqpRender', 'ssxRender', 'wmpgGenerateSiteContext', 'wmpgPolishNarrative']
    .forEach(n => { let src; try { src = fn(n); } catch (e) { src = ''; } assert.ok(src.includes('wpDesignAid()'), n); });
  assert.ok(SOURCE.includes(`<div class="wp-aid" style="padding:7px 18px;`), 'plan upload results card');
});

// ── 8. links ──
test('links: app rail, account, auth screen, and the payment step', () => {
  assert.ok(SOURCE.includes('<div class="rail-legal"><a href="terms" target="_blank" rel="noopener">Terms</a><a href="privacy" target="_blank" rel="noopener">Privacy</a></div>'));
  assert.ok(SOURCE.includes('By subscribing you agree to the <a href="terms" target="_blank" rel="noopener"'), 'beside Subscribe');
  assert.ok(!/href="(terms|privacy)\.html"/.test(SOURCE), 'one URL form: /terms and /privacy');
  assert.ok(!/lachy@prowaste\.au/.test(SOURCE.replace("const ADMIN_EMAIL = 'lachy@prowaste.au'", '')), 'users are shown info@prowaste.au, never a personal address');
  for (const f of ['supabase/functions/delete-account/index.ts', 'supabase/functions/create-subscription/index.ts', 'legal/terms.md', 'legal/privacy.md'])
    assert.ok(!read(f).includes('lachy@prowaste.au'), f);
});
