// ── legal-notice ────────────────────────────────────────────────────────────
// One-off email to every existing account announcing new Terms of Service /
// Privacy Policy versions, sent through Resend. Built so it cannot go out by
// accident:
//
//   1. staff only (profiles.is_staff, read with the caller's own token)
//   2. DRY RUN by default: returns the recipient count, a sample, and the
//      exact subject / text / HTML — nothing is sent
//   3. a real send needs { send: true, confirm: "SEND <count> <effective_date>" }
//      — the count from the dry run just read, so a send is never blind
//   4. effective_date must be at least 30 days after today (Melbourne)
//   5. one send per Terms version: a row in legal_notice_log refuses a second
//      (pass resend: true to override, deliberately)
//
// Recipients: every profile with an email that has not already accepted the
// versions being announced (new sign-ups accept at sign-up). Logs counts only —
// never addresses, never content.
//
// After sending: set WP_LEGAL.reacceptFrom in legal.js to the same
// effective_date, so the app asks existing users to accept from that day.
//
// Secrets: RESEND_API_KEY, LEGAL_NOTICE_FROM (e.g. "WastePlanner <hello@wasteplanner.au>"),
// optional LEGAL_NOTICE_REPLY_TO; plus SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_ROLE_KEY (reading every profile's email needs the service
// role — RLS shows a staff member only what the staff policies allow).
// Requires sql/2026-10-20-legal-acceptance.sql (legal_notice_log).
//
// The versions announced are the PUBLISHED ones — legal/versions.json on the
// live site (LEGAL_VERSIONS_URL to override) — never a value typed here.
//
// Body: { effective_date: "YYYY-MM-DD", send?: boolean, confirm?: string, resend?: boolean }
// Deploy with Verify JWT on: supabase functions deploy legal-notice

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildNotice, checkEffectiveDate, melbourneToday, noticeRecipients, sendPhrase } from "./notice.mjs";

const ALLOWED_ORIGINS = [
  "https://prowasteconsultants.github.io",
  "https://wasteplanner.au",
  "https://www.wasteplanner.au",
];
function corsHeaders(origin: string | null): Record<string, string> {
  const ok = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  );
  return {
    "Access-Control-Allow-Origin": ok ? origin! : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function jsonRes(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405, cors);

  // ── Auth: staff only ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "Sign-in required" }, 401, cors);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sbUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session" }, 401, cors);
  const { data: me } = await sbUser.from("profiles").select("is_staff").eq("uuid", user.id).maybeSingle();
  if (!me?.is_staff) return jsonRes({ error: "Staff only" }, 403, cors);

  let body: { effective_date?: string; send?: boolean; confirm?: string; resend?: boolean } = {};
  try { const t = await req.text(); if (t.trim()) body = JSON.parse(t); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  // the published versions — the same file the app and the pages read
  const versionsUrl = Deno.env.get("LEGAL_VERSIONS_URL") || "https://wasteplanner.au/legal/versions.json";
  let termsVersion = "", privacyVersion = "";
  try {
    const vr = await fetch(versionsUrl, { headers: { "cache-control": "no-cache" } });
    const v = vr.ok ? await vr.json() : null;
    termsVersion = String(v?.terms?.version || ""); privacyVersion = String(v?.privacy?.version || "");
  } catch { /* reported below */ }
  if (!/^\d+(\.\d+)*$/.test(termsVersion) || !/^\d+(\.\d+)*$/.test(privacyVersion))
    return jsonRes({ ok: false, error: `Could not read the published versions from ${versionsUrl} — nothing was sent.` }, 502, cors);
  const effective = String(body.effective_date || "");
  const today = melbourneToday();
  const date = checkEffectiveDate(effective, today);
  if (!date.ok) return jsonRes({ ok: false, error: date.why }, 422, cors);

  // ── Recipients (service role: every profile) ─────────────────────────────
  const sbAdmin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const profiles: { email: string; full_name: string; terms_version: string | null; privacy_version: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sbAdmin.from("profiles").select("email,full_name,terms_version,privacy_version").range(from, from + 999);
    if (error) return jsonRes({ ok: false, error: "Could not read profiles: " + error.message }, 500, cors);
    profiles.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const recipients = noticeRecipients(profiles, termsVersion, privacyVersion);
  const preview = buildNotice({ name: "Alex Example", effectiveDate: effective, termsVersion, privacyVersion });
  const phrase = sendPhrase(recipients.length, effective);

  const { data: prior } = await sbAdmin.from("legal_notice_log").select("sent_at,recipients,effective_date").eq("terms_version", termsVersion).limit(1);
  const already = (prior || [])[0] || null;

  if (body.send !== true) {
    return jsonRes({ ok: true, dry_run: true, today, effective_date: effective, days_notice: date.days,
      recipients: recipients.length, sample: recipients.slice(0, 5).map(r => r.email),
      already_sent: already, to_send: `{ "send": true, "confirm": "${phrase}" }`,
      subject: preview.subject, text: preview.text, html: preview.html }, 200, cors);
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  if (body.confirm !== phrase) return jsonRes({ ok: false, error: `Not sent. confirm must be exactly "${phrase}" — run the dry run again if the count changed.` }, 409, cors);
  if (already && body.resend !== true) return jsonRes({ ok: false, error: `Not sent. Version ${termsVersion} was already announced on ${already.sent_at} to ${already.recipients} accounts. Pass resend: true only if that is really intended.` }, 409, cors);
  const key = Deno.env.get("RESEND_API_KEY"), fromAddr = Deno.env.get("LEGAL_NOTICE_FROM");
  if (!key || !fromAddr) return jsonRes({ ok: false, error: "RESEND_API_KEY and LEGAL_NOTICE_FROM must be set as function secrets" }, 500, cors);
  const replyTo = Deno.env.get("LEGAL_NOTICE_REPLY_TO") || undefined;

  let sent = 0;
  const failed: string[] = [];
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map(r => {
      const m = buildNotice({ name: r.name, effectiveDate: effective, termsVersion, privacyVersion });
      return { from: fromAddr, to: [r.email], subject: m.subject, html: m.html, text: m.text, ...(replyTo ? { reply_to: replyTo } : {}) };
    });
    const resp = await fetch("https://api.resend.com/emails/batch", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (resp.ok) sent += batch.length;
    else failed.push(`batch ${i / 100 + 1}: HTTP ${resp.status}`);
  }
  await sbAdmin.from("legal_notice_log").insert({ terms_version: termsVersion, privacy_version: privacyVersion,
    effective_date: effective, recipients: sent, sent_by: user.id });
  return jsonRes({ ok: failed.length === 0, sent, failed,
    next: `Set WP_LEGAL.reacceptFrom = '${effective}' in legal.js and deploy, so existing users are asked to accept from that day.` }, failed.length ? 207 : 200, cors);
});
