// ── publish-rates ───────────────────────────────────────────────────────────
// WastePlanner is the ONE place generation rates and council lists are
// edited. This function reads them (res_rates, com_rates, councils), builds
// waste_rates.json — the file the free calculator on go.wasteplanner.au, the
// prowaste.au embed, the in-app calculator and the WMP generator all read —
// validates it, and only then writes it to R2:
//
//   1. staff only (profiles.is_staff, read with the caller's own token)
//   2. build + validate (rates.mjs, shared with the landing backup script and
//      the tests); any error → 422 with every error, nothing written
//   3. read the live file; a council in it that the new file drops → 409
//      naming them, unless the caller confirms those exact values
//      (`confirm_removed`) — values are the ?council= in ad links
//   4. live file → waste_rates.prev.json (the rollback), then the new file →
//      waste_rates.json. Both application/json, Cache-Control: no-cache.
//
// Only councils with councils.published = true are listed, and only their
// rates go out (sql/2026-10-19-publish-rates.sql adds the column).
//
// Secrets (Supabase → Edge Functions → Secrets — never in the frontend):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// plus the platform's SUPABASE_URL / SUPABASE_ANON_KEY. No service key: every
// read runs as the calling staff member, under the same RLS as the admin.
//
// Body (JSON, optional): { dry_run?: boolean, confirm_removed?: string[] }
// Deploy with Verify JWT on: supabase functions deploy publish-rates

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildRates, validateRates, diffRates, ratesCounts } from "./rates.mjs";
import { r2Client } from "./r2.mjs";

const LIVE_KEY = "waste_rates.json";
const PREV_KEY = "waste_rates.prev.json";

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
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };
}
function jsonRes(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers });
}

// PostgREST caps a select at 1000 rows; a council rate table alone can pass
// 100, so every table is read page by page rather than trusting one call.
// deno-lint-ignore no-explicit-any
async function readAll(make: () => any, table: string): Promise<any[]> {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().range(from, from + 999);
    if (error) throw new Error(`could not read ${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) return out;
  }
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return jsonRes({ error: "POST only" }, 405, cors);

  // ── Auth: staff only ─────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "Sign-in required" }, 401, cors);
  const sbUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session" }, 401, cors);
  const { data: me } = await sbUser.from("profiles").select("is_staff").eq("uuid", user.id).maybeSingle();
  if (!me?.is_staff) return jsonRes({ error: "Publishing rates is for Pro Waste staff only" }, 403, cors);

  let body: { dry_run?: boolean; confirm_removed?: string[] } = {};
  try { const t = await req.text(); if (t.trim()) body = JSON.parse(t); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  const dryRun = body.dry_run === true;

  const cfg = {
    accountId: Deno.env.get("R2_ACCOUNT_ID") ?? "",
    accessKeyId: Deno.env.get("R2_ACCESS_KEY_ID") ?? "",
    secretAccessKey: Deno.env.get("R2_SECRET_ACCESS_KEY") ?? "",
    bucket: Deno.env.get("R2_BUCKET") ?? "",
  };
  const missing = Object.entries({ R2_ACCOUNT_ID: cfg.accountId, R2_ACCESS_KEY_ID: cfg.accessKeyId, R2_SECRET_ACCESS_KEY: cfg.secretAccessKey, R2_BUCKET: cfg.bucket })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return jsonRes({ ok: false, error: "R2 secrets not set: " + missing.join(", ") }, 500, cors);

  // ── Read WastePlanner's tables ───────────────────────────────────────────
  let councils, resRates, comRates;
  try {
    councils = await readAll(() => sbUser.from("councils").select("state,value,label,published").order("state").order("value"), "councils");
    resRates = await readAll(() => sbUser.from("res_rates").select("state,council_value,unit_type,stream,l_per_week")
      .order("state").order("council_value", { nullsFirst: true }).order("unit_type").order("stream"), "res_rates");
    comRates = await readAll(() => sbUser.from("com_rates").select("state,council_value,use_code,stream,rate,unit_value,unit")
      .order("state").order("council_value", { nullsFirst: true }).order("use_code").order("stream"), "com_rates");
  } catch (e) {
    const msg = (e as Error).message;
    const hint = /published/.test(msg) ? " — run sql/2026-10-19-publish-rates.sql (adds councils.published) first" : "";
    return jsonRes({ ok: false, error: msg + hint }, 500, cors);
  }

  // ── Build + validate: nothing is written unless the file is clean ────────
  const { json, skipped } = buildRates({ councils, resRates, comRates });
  const errors = validateRates(json);
  const counts = ratesCounts(json);
  if (errors.length) return jsonRes({ ok: false, code: "invalid", errors, skipped, counts }, 422, cors);

  // ── Compare with the live file ───────────────────────────────────────────
  const r2 = r2Client(cfg);
  let prevText: string | null;
  try { prevText = await r2.getText(LIVE_KEY); }
  catch (e) { return jsonRes({ ok: false, error: (e as Error).message }, 502, cors); }
  let prev = null;
  try { prev = prevText ? JSON.parse(prevText) : null; } catch { prev = null; }
  const changes = diffRates(prev, json);
  const confirmed = new Set(Array.isArray(body.confirm_removed) ? body.confirm_removed : []);
  const unconfirmed = changes.removedCouncils.filter((c) => !confirmed.has(c.key));
  if (unconfirmed.length) {
    return jsonRes({ ok: false, code: "removals", removed: unconfirmed, changes, counts, skipped }, 409, cors);
  }
  const text = JSON.stringify(json);
  if (dryRun) return jsonRes({ ok: true, dry_run: true, version: json.version, bytes: text.length, counts, changes, skipped }, 200, cors);

  // ── Publish: keep the rollback, then replace ─────────────────────────────
  try {
    if (prevText) await r2.putJson(PREV_KEY, prevText);
    await r2.putJson(LIVE_KEY, text);
  } catch (e) {
    return jsonRes({ ok: false, error: (e as Error).message + " — the live file was not replaced" }, 502, cors);
  }
  return jsonRes({
    ok: true, version: json.version, published_at: json.version, bytes: text.length,
    counts, changes, skipped, previous_version: prev?.version ?? null,
  }, 200, cors);
});
