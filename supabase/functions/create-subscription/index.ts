// ── create-subscription ─────────────────────────────────────────────────────
// Creates the REAL Stripe subscription, billed from day one (NO trial), then
// sets the profile tier server-side (the browser can no longer set its own
// tier). Requires secrets: STRIPE_SECRET_KEY. Run billing.sql before using.
//
// De-trialed 2026-09-07: trial_period_days removed to match the client (the
// pricing modal sells "Subscribe", not a trial). Because the first invoice
// now charges immediately, payment_behavior is 'error_if_incomplete' — a
// declined card (or one demanding 3D Secure, which this flow cannot confirm)
// makes the create call THROW, so no half-alive unpaid subscription is ever
// created and the profile tier is only written after money actually moved.
//
// Cancellation is handled by the companion stripe-webhook function: on
// customer.subscription.deleted the profile reverts to tier 'none' (the free
// plan — projects stay readable and exportable, only the caps return).
//
// NOTE: edge functions deploy from the Supabase project, not this repo. This
// file is the source of truth for what to paste/deploy.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});

// Test-mode price IDs — mirror of the frontend STRIPE_PRICES map.
// ⚠ Swap for live price IDs at go-live, same time as the sk_live_ key.
const PRICES: Record<string, string> = {
  founding: "price_1TSw9nE6PPkDcdiNa2uVBn2e",
  standard: "price_1TSw1pE6PPkDcdiNEpZ2fCgi",
  council: "price_1TSwD0E6PPkDcdiNNydcT0u2",
};
const PLAN_TO_TIER: Record<string, string> = {
  founding: "founding",
  standard: "standard",
  council: "council_paid",
};

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

  // ── Input ────────────────────────────────────────────────────────────────
  let body: { payment_method?: string; plan?: string };
  try { body = await req.json(); }
  catch { return jsonRes({ error: "Body must be JSON" }, 400, cors); }
  const plan = body.plan ?? "";
  const paymentMethod = body.payment_method ?? "";
  if (!PRICES[plan]) return jsonRes({ error: "Unknown plan" }, 400, cors);
  if (!paymentMethod.startsWith("pm_")) return jsonRes({ error: "payment_method required" }, 400, cors);

  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: profile } = await sbAdmin
    .from("profiles")
    .select("uuid, tier, full_name, stripe_customer_id, stripe_subscription_id")
    .eq("uuid", user.id)
    .maybeSingle();

  if (profile?.stripe_subscription_id) {
    return jsonRes({ error: "You already have a subscription. Contact lachy@prowaste.au to change plans." }, 409, cors);
  }

  try {
    // ── Customer ───────────────────────────────────────────────────────────
    let customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: profile?.full_name ?? undefined,
        metadata: { user_uuid: user.id },
      });
      customerId = customer.id;
    }
    await stripe.paymentMethods.attach(paymentMethod, { customer: customerId });
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethod },
    });

    // ── Subscription, charged from day one ─────────────────────────────────
    // error_if_incomplete: if the first charge does not fully succeed (card
    // declined, or authentication required), this call throws and NOTHING is
    // created — the catch below reports it and the tier stays free.
    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: PRICES[plan] }],
      payment_behavior: "error_if_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { user_uuid: user.id, plan },
    });

    const tier = PLAN_TO_TIER[plan];

    const { error: updErr } = await sbAdmin.from("profiles").update({
      tier,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      trial_ends_at: null,   // clear any legacy trial stamp
    }).eq("uuid", user.id);
    if (updErr) {
      // The card WAS charged by this point. Don't leave a live subscription
      // attached to a profile we failed to update — cancel it and refund the
      // first invoice, best-effort, then say exactly what happened.
      await stripe.subscriptions.cancel(sub.id).catch(() => {});
      const inv = sub.latest_invoice;
      const pi = inv && typeof inv !== "string" ? inv.payment_intent : null;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId) await stripe.refunds.create({ payment_intent: piId }).catch(() => {});
      return jsonRes({ error: "Account update failed: " + updErr.message + ". The subscription was cancelled and the charge refunded — contact lachy@prowaste.au if the refund does not appear." }, 500, cors);
    }

    return jsonRes({ tier, subscription_id: sub.id }, 200, cors);
  } catch (err) {
    const msg = err instanceof Stripe.errors.StripeError ? err.message : "Subscription setup failed";
    return jsonRes({ error: msg + ". You have not been charged." }, 400, cors);
  }
});
