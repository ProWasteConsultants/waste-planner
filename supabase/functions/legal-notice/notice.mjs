// ── The Terms / Privacy update notice: content + rules ──────────────────────
// Pure — no network, no Deno — so the edge function (index.ts) and
// tests/legal.test.js run the SAME code. The wording here is a DRAFT until
// Lachy approves it; nothing sends without the typed confirmation index.ts
// asks for.

export const NOTICE_DAYS = 30;            // effective date ≥ send date + 30 days
export const TERMS_URL = 'https://wasteplanner.au/terms';
export const PRIVACY_URL = 'https://wasteplanner.au/privacy';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// 'YYYY-MM-DD' → '20 November 2026'. A bad date is null, never a guess.
export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}
// Today in Melbourne as 'YYYY-MM-DD' (the notice period is counted in local days).
export function melbourneToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
// The effective date must be a real date at least NOTICE_DAYS after today.
export function checkEffectiveDate(iso, today) {
  if (!longDate(iso)) return { ok: false, why: `effective_date "${iso}" is not a YYYY-MM-DD date` };
  const days = Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
  if (days < NOTICE_DAYS) return { ok: false, why: `effective_date ${iso} is ${days} days from ${today} — it must be at least ${NOTICE_DAYS}` };
  return { ok: true, days };
}
// Version compare, same rule as the app's wpLegalVersionCmp.
export function versionCmp(a, b) {
  const blank = v => v == null || String(v).trim() === '';
  if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : (blank(a) ? -1 : 1);
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0), pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}
// Who gets it: every account with an email that has not already accepted the
// current versions, once per address (case-insensitive).
export function noticeRecipients(profiles, termsVersion, privacyVersion) {
  const seen = new Set(), out = [];
  (profiles || []).forEach(p => {
    const email = String((p && p.email) || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    const key = email.toLowerCase();
    if (seen.has(key)) return;
    if (versionCmp(p.terms_version, termsVersion) >= 0 && versionCmp(p.privacy_version, privacyVersion) >= 0) return;
    seen.add(key);
    out.push({ email, name: String(p.full_name || '').trim() });
  });
  return out;
}
// What a person must type to send: the count and the date, so a send is
// always against the dry run that was just read.
export function sendPhrase(count, iso) { return `SEND ${count} ${iso}`; }

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildNotice({ name, effectiveDate, termsVersion, privacyVersion }) {
  const when = longDate(effectiveDate);
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const hi = first ? `Hi ${first},` : 'Hi there,';
  const subject = 'Updates to the WastePlanner Terms of Service and Privacy Policy';
  const text = [
    hi,
    '',
    `We've updated the WastePlanner Terms of Service (Version ${termsVersion}) and Privacy Policy (Version ${privacyVersion}). The new versions take effect on ${when}.`,
    '',
    `Terms of Service: ${TERMS_URL}`,
    `Privacy Policy: ${PRIVACY_URL}`,
    '',
    `Please read them in full. You can keep using WastePlanner as normal until ${when}. From that date, you'll be asked to accept the updated Terms and Privacy Policy the next time you sign in, before you continue.`,
    '',
    `If you don't agree with the updated terms, you can stop using WastePlanner and delete your account at any time from Account settings > Delete my account.`,
    '',
    'If you have any questions, reply to this email.',
    '',
    'The WastePlanner team',
    'Pro Waste Consultants Pty Ltd',
    '',
    "You're receiving this service notice because you have a WastePlanner account.",
  ].join('\n');
  const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:#0E7C7B;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:8px;margin:0 8px 8px 0;">${label}</a>`;
  const html = `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F7FAFA;font-family:'Helvetica Neue',Arial,sans-serif;color:#374151;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7FAFA;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E3ECEB;border-radius:14px;">
<tr><td style="padding:28px 32px 8px;font-size:18px;font-weight:700;color:#0A3D38;">WastePlanner</td></tr>
<tr><td style="padding:8px 32px 24px;font-size:15px;line-height:1.6;">
<p style="margin:0 0 14px;">${esc(hi)}</p>
<p style="margin:0 0 14px;">We've updated the WastePlanner <b>Terms of Service</b> (Version ${esc(termsVersion)}) and <b>Privacy Policy</b> (Version ${esc(privacyVersion)}). The new versions take effect on <b>${esc(when)}</b>.</p>
<p style="margin:0 0 10px;">${btn(TERMS_URL, 'Read the Terms of Service')}${btn(PRIVACY_URL, 'Read the Privacy Policy')}</p>
<p style="margin:0 0 14px;">Please read them in full. You can keep using WastePlanner as normal until ${esc(when)}. From that date, you'll be asked to accept the updated Terms and Privacy Policy the next time you sign in, before you continue.</p>
<p style="margin:0 0 14px;">If you don't agree with the updated terms, you can stop using WastePlanner and delete your account at any time from <b>Account settings &rsaquo; Delete my account</b>.</p>
<p style="margin:0 0 14px;">If you have any questions, reply to this email.</p>
<p style="margin:0;">The WastePlanner team<br>Pro Waste Consultants Pty Ltd</p>
</td></tr>
<tr><td style="padding:14px 32px 22px;border-top:1px solid #E3ECEB;font-size:12px;color:#6B7280;line-height:1.5;">You're receiving this service notice because you have a WastePlanner account.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
