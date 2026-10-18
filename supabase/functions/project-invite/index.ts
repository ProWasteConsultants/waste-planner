// ── project-invite ──────────────────────────────────────────────────────────
// Emails a design-team invitation for a Pro Waste-engaged project. The app
// calls it straight after the owner adds someone (projTeamInvite in
// index.html), passing the new project_members row id.
//
// HOW THE EMAIL GOES OUT: through Supabase Auth's own mailer — the same one
// that sends password resets — so it uses whatever SMTP the project already
// has and needs no new email account or secret.
//   * New to WastePlanner → auth.admin.inviteUserByEmail, i.e. the "Invite
//     user" email template. The project and inviter ride in the user's
//     metadata, so the template can say who invited them to what:
//       {{ if .Data.project_title }}{{ .Data.inviter_name }} has invited you
//       to {{ .Data.project_title }} on WastePlanner.{{ else }}You have been
//       invited to WastePlanner.{{ end }}  <a href="{{ .ConfirmationURL }}">…
//     (Supabase → Authentication → Email Templates → Invite user.)
//   * Already has an account → a sign-in link (the "Magic Link" template).
//     That template is generic; the project is waiting in their list either
//     way, accepted against their confirmed email on sign-in.
// Both links land on the Site URL set in Supabase Auth.
//
// WHO MAY TRIGGER IT: only the person who created the invite row (RLS lets
// only the owner of an engaged project, or staff, create one) or staff, and
// only once per row (notified_at) — so the function cannot be used to email
// arbitrary addresses, or to email one address repeatedly. Re-sending means
// removing the person and inviting them again.
//
// Requires secrets SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// (present in every Supabase function). Run sql/2026-10-18-access-tiers.sql
// first. Deploy with "Verify JWT" on. Edge functions deploy from the Supabase
// project, not this repo; this file is the source of truth for what to deploy.

import { createClient } from "npm:@supabase/supabase-js@2";

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

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "Sign-in required" }, 401, cors);
  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sbUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session" }, 401, cors);

  let body: { member_id?: string };
  try { body = await req.json(); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  if (!body.member_id) return jsonRes({ error: "member_id required" }, 400, cors);

  const sbAdmin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // ── The invite row, and the right to send it ─────────────────────────────
  // A failed read is reported with the database's own message — "not found"
  // would hide a key or permission problem behind a wrong diagnosis.
  const { data: m, error: mErr } = await sbAdmin.from("project_members")
    .select("id, project_id, email, invited_by, accepted_at, notified_at")
    .eq("id", body.member_id).maybeSingle();
  if (mErr) return jsonRes({ error: "could not read the invite: " + mErr.message }, 500, cors);
  if (!m) return jsonRes({ error: "invite " + body.member_id + " not found by the service key — check SUPABASE_SERVICE_ROLE_KEY and the service_role grant on project_members" }, 404, cors);
  const { data: me } = await sbAdmin.from("profiles")
    .select("is_staff, full_name, company_name").eq("uuid", user.id).maybeSingle();
  if (m.invited_by !== user.id && !me?.is_staff) return jsonRes({ error: "Not your invite" }, 403, cors);
  if (m.accepted_at) return jsonRes({ status: "already_joined" }, 200, cors);
  if (m.notified_at) return jsonRes({ status: "already_sent" }, 200, cors);

  const { data: project, error: pErr } = await sbAdmin.from("projects")
    .select("name, address, pwc_engaged").eq("id", m.project_id).maybeSingle();
  if (pErr) return jsonRes({ error: "could not read the project: " + pErr.message }, 500, cors);
  if (!project) return jsonRes({ error: "project " + m.project_id + " not visible to the service key — check the service_role grant on projects" }, 404, cors);
  if (!project.pwc_engaged) return jsonRes({ error: "The project is not engaged with Pro Waste" }, 409, cors);

  const { data: inviter } = m.invited_by === user.id
    ? { data: me }
    : await sbAdmin.from("profiles").select("full_name, company_name").eq("uuid", m.invited_by).maybeSingle();
  const title = (project.name && String(project.name).trim()) || project.address || "a project";
  const meta = {
    invited_to_project: m.project_id,
    project_title: title,
    inviter_name: inviter?.full_name || "A colleague",
    inviter_company: inviter?.company_name || "",
  };

  // ── Send: invite a new user; a sign-in link for an existing one ──────────
  let status = "invite";
  let sendErr: string | null = null;
  const inv = await sbAdmin.auth.admin.inviteUserByEmail(m.email, { data: meta });
  if (inv.error) {
    const exists = inv.error.status === 422 || /already|registered|exists/i.test(inv.error.message || "");
    if (exists) {
      status = "sign_in_link";
      const otp = await createClient(url, anonKey).auth.signInWithOtp({
        email: m.email,
        options: { shouldCreateUser: false },
      });
      if (otp.error) sendErr = otp.error.message;
    } else {
      sendErr = inv.error.message;
    }
  }

  if (sendErr) {
    await sbAdmin.from("project_members").update({ notify_status: "failed: " + sendErr.slice(0, 200) }).eq("id", m.id);
    return jsonRes({ status: "failed", error: sendErr }, 502, cors);
  }
  await sbAdmin.from("project_members")
    .update({ notified_at: new Date().toISOString(), notify_status: status }).eq("id", m.id);
  return jsonRes({ status }, 200, cors);
});
