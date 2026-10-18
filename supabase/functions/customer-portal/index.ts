// ── customer-portal ─────────────────────────────────────────────────────────
// Creates a Stripe Customer Portal session for the signed-in user, so they
// can cancel, update their card, or view invoices — self-service. Outcomes
// flow back through the stripe-webhook function automatically.
// Uses the existing STRIPE_SECRET_KEY secret — nothing new to set.
//
// NOTE: edge functions deploy from the Supabase project, not this repo. This
// file records what is deployed (copied from the dashboard 2026-10-19).
// Plan switching inside the portal only appears if it is enabled in Stripe:
// Settings → Billing → Customer portal (allow cancel + switch plans, and list
// the WastePlanner prices).

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});

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
  if (!Deno.env.get("STRIPE_SECRET_KEY")) return jsonRes({ error: "STRIPE_SECRET_KEY secret not set" }, 500, cors);

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return jsonRes({ error: "Sign-in required" }, 401, cors);
  const sbUser = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !user) return jsonRes({ error: "Invalid or expired session" }, 401, cors);

  // ── Find their Stripe customer ───────────────────────────────────────────
  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await sbAdmin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("uuid", user.id)
    .maybeSingle();

  if (!profile?.stripe_customer_id) {
    return jsonRes({ error: "No billing account found — you don't have an active subscription." }, 404, cors);
  }

  // ── Create the portal session ────────────────────────────────────────────
  try {
    const origin = req.headers.get("origin");
    const returnUrl = origin && corsHeaders(origin)["Access-Control-Allow-Origin"] === origin
      ? origin : ALLOWED_ORIGINS[1];
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: returnUrl,
    });
    return jsonRes({ url: session.url }, 200, cors);
  } catch (err) {
    const msg = err instanceof Stripe.errors.StripeError ? err.message : "Portal session failed";
    return jsonRes({ error: msg }, 400, cors);
  }
});
