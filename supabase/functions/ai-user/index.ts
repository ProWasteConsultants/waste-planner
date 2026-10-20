// ── ai-user (v3) ────────────────────────────────────────────────────────────
// Subscriber + free-trial proxy to the Anthropic Messages API. Every account
// level uses this one service (there is no bring-your-own-key path in the app).
// Signed-out → 401 · Free account → 1 per tool lifetime · Paid → 10/day/tool
// v3 (2026-10-20): a call made from a Pro Waste-engaged project gets the paid
// limits too. The app sends the open project as ?project=<id>; the database
// decides (wp_ai_tier, sql/2026-10-20-engaged-ai.sql), asked with the USER's
// token, so it only says 'paid' for a project that account can see. Any
// error, or the SQL not run yet, leaves the account on its own plan.
// Source recorded in the repo 2026-10-20 (v2 was deployed without it).

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_EMAIL = "lachy@prowaste.au";
const KNOWN_TOOLS = new Set(["compliance", "extract", "general"]);

type Plan = { limit: number; lifetime: boolean };
const PAID_PLAN: Plan = { limit: 10, lifetime: false }; // per tool, per day
function planFor(tier: string, isStaff: boolean): Plan {
  if (isStaff) return { limit: 500, lifetime: false };
  if (tier === "standard" || tier === "founding" || tier === "council_paid") {
    return PAID_PLAN;
  }
  // Any other signed-in account (none / lite / unset): lifetime trial
  return { limit: 1, lifetime: true }; // per tool, ever
}

const MODEL_DEFAULT = "claude-sonnet-4-6";
const MODEL_ALLOWLIST = new Set([
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
  "claude-opus-4-5", // compliance deep scan
]);
const MAX_TOKENS_CAP = 12000;

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
    "Access-Control-Expose-Headers": "x-ai-used, x-ai-limit, x-ai-lifetime",
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

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return jsonRes({ error: "ANTHROPIC_API_KEY secret not set" }, 500, cors);

  // ── Session ──────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonRes({ error: "Create a free Waste Planner account to try the AI tools." }, 401, cors);
  }
  const sbUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session — please sign in again." }, 401, cors);

  // ── Plan ─────────────────────────────────────────────────────────────────
  const { data: profile } = await sbUser
    .from("profiles").select("tier, is_staff").eq("uuid", user.id).maybeSingle();
  const isStaff = profile?.is_staff === true || user.email === ADMIN_EMAIL;
  let plan = planFor(profile?.tier ?? "none", isStaff);

  // A Pro Waste-engaged project carries the paid limits for its owner and
  // design team. Only asked when the account's own plan is the free trial.
  const projectId = (new URL(req.url).searchParams.get("project") ?? "").slice(0, 100);
  if (projectId && plan.lifetime && !user.is_anonymous) {
    const { data: aiTier, error: tierErr } = await sbUser.rpc("wp_ai_tier", { p_project: projectId });
    if (!tierErr && aiTier === "paid") plan = PAID_PLAN;
  }

  // ── Parse body & tool tag ────────────────────────────────────────────────
  let body: { model?: string; max_tokens?: number; system?: string; messages?: unknown; tool?: string };
  try { body = await req.json(); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonRes({ error: "messages[] required" }, 400, cors);
  }
  const tool = body.tool && KNOWN_TOOLS.has(body.tool) ? body.tool : "general";

  // ── Consume quota (atomic, server-side) ──────────────────────────────────
  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: quota, error: quotaErr } = await sbAdmin
    .rpc("consume_ai_call", { p_user: user.id, p_tool: tool, p_limit: plan.limit, p_lifetime: plan.lifetime })
    .maybeSingle();
  if (quotaErr) return jsonRes({ error: "Usage check failed: " + quotaErr.message }, 500, cors);

  const q = quota as { allowed: boolean; used: number } | null;
  const usageHeaders = {
    ...cors,
    "x-ai-used": String(q?.used ?? 0),
    "x-ai-limit": String(plan.limit),
    "x-ai-lifetime": plan.lifetime ? "1" : "0",
  };
  if (!q?.allowed) {
    return jsonRes({
      error: plan.lifetime
        ? "You've used your free trial for this tool. Upgrade to a paid plan for daily AI use across the whole platform."
        : `Daily AI limit reached for this tool (${plan.limit}/day on your plan). Your limit resets at midnight.`,
    }, 429, usageHeaders);
  }

  // ── Constrain & forward ──────────────────────────────────────────────────
  const model = body.model && MODEL_ALLOWLIST.has(body.model) ? body.model : MODEL_DEFAULT;
  const max_tokens = Math.min(
    Number.isFinite(body.max_tokens as number) && (body.max_tokens as number) > 0
      ? (body.max_tokens as number) : 4096,
    MAX_TOKENS_CAP,
  );
  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens,
      ...(body.system ? { system: body.system } : {}),
      messages: body.messages, // `tool` tag deliberately not forwarded
    }),
  });
  const payload = await upstream.text();
  return new Response(payload, { status: upstream.status, headers: usageHeaders });
});
