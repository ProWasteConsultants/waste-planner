// ── delete-account ──────────────────────────────────────────────────────────
// Self-service account deletion. The signed-in person deletes THEIR OWN
// account — nobody else's (an org admin removes a member from the org
// instead; that member keeps their own login). Called from Account Settings
// (wpDeleteAccount in index.html) with { confirm_email }.
//
// What happens, in this order — the refusals come first so nothing is half
// done:
//   1. The typed email must match the account's email.
//   2. REFUSED if they are the only admin of an organisation that has other
//      members (the same rule as leaving one) — promote someone first.
//   3. A personal Stripe subscription is cancelled immediately, so they are
//      never billed again. A failed cancel stops everything.
//   4. Projects are sorted three ways:
//      * ORGANISATION projects stay with the organisation, files and all.
//        Ownership passes to another member of that org (an admin first).
//      * PRO WASTE-ENGAGED projects (engaged_at set, ever) are KEPT for
//        PWC's professional records. Ownership passes to the staff member
//        who engaged it.
//      * Every other PERSONAL project is deleted, with its plans and
//        documents. Only files belonging to those projects are removed —
//        never "everything in their folder", because plans of org and
//        engaged projects live in the uploader's folder too.
//   5. Their design-team memberships, org memberships and pending invites
//      go; then their profile; then their login.
//
// Ownership is handed over BEFORE the login is deleted, so a foreign key
// from projects to auth.users can never take a kept project with it.
//
// Requires SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY and
// STRIPE_SECRET_KEY (all already set for the other functions), and the
// service_role grants in sql/2026-10-19-delete-account.sql. Deploy with
// "Verify JWT" on. This file is the source of truth for what to deploy.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const PLANS_BUCKET = "project-plans";

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

// The project a stored file belongs to: {uid}/{pid}.pdf, {uid}/{pid}.<stage>.pdf
// and {uid}/{pid}/docs/… all name it in the second path segment.
function storageProjectId(path: string): string {
  return (path.split("/")[1] || "").split(".")[0];
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405, cors);

  // ── Auth: the caller, and only the caller ────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "Sign-in required" }, 401, cors);
  const url = Deno.env.get("SUPABASE_URL")!;
  const sbUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session" }, 401, cors);
  if (user.is_anonymous) return jsonRes({ error: "A guest session has no account to delete" }, 400, cors);

  let body: { confirm_email?: string };
  try { body = await req.json(); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  const email = String(user.email || "").toLowerCase();
  if (!email || String(body.confirm_email || "").trim().toLowerCase() !== email) {
    return jsonRes({ error: "The email you typed doesn't match this account" }, 400, cors);
  }

  const sbAdmin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const uid = user.id;
  const fail = (step: string, e: { message?: string } | null) =>
    jsonRes({ error: step + (e?.message ? ": " + e.message : "") + ". Deletion stopped here; nothing after this step was changed. Contact lachy@prowaste.au." }, 500, cors);

  // ── 2. Sole admin of an org with other members? Refuse. ──────────────────
  const { data: myMemberships, error: memErr } = await sbAdmin
    .from("org_members").select("org_id, role").eq("user_id", uid);
  if (memErr) return fail("Could not read organisation memberships", memErr);
  const blocking: string[] = [];
  for (const m of myMemberships || []) {
    if (m.role !== "admin") continue;
    const { data: all, error } = await sbAdmin.from("org_members").select("user_id, role").eq("org_id", m.org_id);
    if (error) return fail("Could not read organisation members", error);
    const others = (all || []).filter((x) => x.user_id !== uid);
    if (others.length && !others.some((x) => x.role === "admin")) blocking.push(m.org_id);
  }
  if (blocking.length) {
    const { data: orgs } = await sbAdmin.from("orgs").select("id, name").in("id", blocking);
    const names = (orgs || []).map((o) => o.name).join(", ") || blocking.join(", ");
    return jsonRes({
      error: "You're the only admin of " + names + ". Make another member an admin (or remove the other members) first, then delete your account.",
      code: "sole_admin",
    }, 409, cors);
  }

  // ── 3. Cancel a personal Stripe subscription ─────────────────────────────
  const { data: profile } = await sbAdmin.from("profiles")
    .select("stripe_subscription_id, tier_source").eq("uuid", uid).maybeSingle();
  let cancelled = false;
  if (profile?.stripe_subscription_id) {
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) return jsonRes({ error: "Billing isn't configured, so the subscription can't be cancelled. Contact lachy@prowaste.au." }, 500, cors);
    try {
      const stripe = new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      cancelled = true;
    } catch (e) {
      const msg = e instanceof Stripe.errors.StripeError ? e.message : "cancel failed";
      // Already gone in Stripe is fine; anything else stops the deletion.
      if (!/No such subscription|canceled/i.test(msg)) {
        return jsonRes({ error: "Couldn't cancel your subscription (" + msg + "), so nothing was deleted. Contact lachy@prowaste.au." }, 502, cors);
      }
    }
  }

  // ── 4. Sort their projects ───────────────────────────────────────────────
  const { data: owned, error: projErr } = await sbAdmin.from("projects")
    .select("id, org_id, engaged_at, engaged_by").eq("user_id", uid);
  if (projErr) return fail("Could not read your projects", projErr);

  const orgKeep: { id: string; org_id: string }[] = [];
  const pwcKeep: { id: string; engaged_by: string | null }[] = [];
  const remove: string[] = [];
  for (const p of owned || []) {
    if (p.org_id) orgKeep.push(p);
    else if (p.engaged_at) pwcKeep.push(p);
    else remove.push(String(p.id));
  }

  // Hand over ownership of everything kept.
  for (const p of orgKeep) {
    const { data: ms } = await sbAdmin.from("org_members").select("user_id, role").eq("org_id", p.org_id);
    const others = (ms || []).filter((x) => x.user_id !== uid);
    const heir = (others.find((x) => x.role === "admin") || others[0])?.user_id ?? null;
    const { error } = await sbAdmin.from("projects").update({ user_id: heir }).eq("id", p.id);
    if (error) return fail("Could not hand over an organisation project", error);
  }
  for (const p of pwcKeep) {
    const { error } = await sbAdmin.from("projects").update({ user_id: p.engaged_by }).eq("id", p.id);
    if (error) return fail("Could not hand over a Pro Waste project", error);
  }

  // Delete the personal projects' files — theirs only — then the rows.
  let filesRemoved = 0;
  if (remove.length) {
    const doomed = new Set(remove);
    const paths: string[] = [];
    const { data: top } = await sbAdmin.storage.from(PLANS_BUCKET).list(uid, { limit: 1000 });
    for (const f of top || []) {
      const path = uid + "/" + f.name;
      if (!doomed.has(storageProjectId(path))) continue;
      if (f.id) { paths.push(path); continue; }               // a plan file
      const { data: docs } = await sbAdmin.storage.from(PLANS_BUCKET).list(path + "/docs", { limit: 1000 });
      for (const d of docs || []) paths.push(path + "/docs/" + d.name);
    }
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await sbAdmin.storage.from(PLANS_BUCKET).remove(paths.slice(i, i + 100));
      if (error) return fail("Could not delete your plan files", error);
      filesRemoved += Math.min(100, paths.length - i);
    }
    const { error } = await sbAdmin.from("projects").delete().in("id", remove);
    if (error) return fail("Could not delete your projects", error);
  }

  // ── 5. Memberships, invites, profile, login ──────────────────────────────
  await sbAdmin.from("project_members").delete().eq("user_id", uid);
  // Exact match on the stored (lower-cased) address — never ilike, where
  // an "_" in an email is a wildcard that could match someone else's.
  await sbAdmin.from("project_members").delete().eq("email", email);
  await sbAdmin.from("org_members").delete().eq("user_id", uid);
  await sbAdmin.from("org_invites").delete().eq("email", email);

  const { error: profErr } = await sbAdmin.from("profiles").delete().eq("uuid", uid);
  if (profErr) return fail("Could not delete your profile", profErr);
  const { error: authErr } = await sbAdmin.auth.admin.deleteUser(uid);
  if (authErr) return fail("Your data was removed but the login could not be deleted", authErr);

  return jsonRes({
    deleted: true,
    subscription_cancelled: cancelled,
    projects_deleted: remove.length,
    files_deleted: filesRemoved,
    kept_with_organisation: orgKeep.length,
    kept_for_pro_waste: pwcKeep.length,
  }, 200, cors);
});
