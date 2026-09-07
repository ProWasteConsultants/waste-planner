// ── stripe-webhook ──────────────────────────────────────────────────────────
// Keeps profiles.tier in sync with Stripe. The critical path is CANCELLATION:
// when a subscription ends, the profile reverts to tier 'none' — the free
// plan. Projects stay readable and exportable (that is the free plan's
// promise); only the caps come back. Without this function a cancelled
// subscriber keeps their paid tier forever.
//
// HOW STRIPE REACHES THIS FUNCTION (as wired 2026-09-07, verified end to
// end in the sandbox): Stripe does NOT post to the Supabase URL directly.
// The project's edge-function gateway requires an `apikey` HEADER on every
// request (query params are ignored; the "Verify JWT" toggle does not lift
// this), and Stripe webhooks cannot send custom headers. So a tiny
// Cloudflare Worker relays in between:
//
//   Stripe event destination "wasteplanner-tier-sync"
//     → https://ancient-silence-b9ee.lachysharris.workers.dev   (Worker)
//     → https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//
// The Worker (Cloudflare account that also serves the waste-rates file;
// worker name shows as wp-stripe-webhook / ancient-silence-b9ee) forwards
// the raw body + stripe-signature header and adds
// `apikey: <sb_publishable_… key>` from its SUPABASE_ANON_KEY secret. The
// legacy eyJ anon key is REJECTED by this gateway — it must be the
// new-format publishable key. The Worker adds no security and needs none:
// the Stripe signature check below is the auth, exactly as if Stripe
// posted here directly.
//
// DEPLOYMENT — in order:
//   1. Deploy this function with "Verify JWT" OFF (signature verification
//      below is the real auth), and paste THIS code over the hello-world
//      template Supabase seeds new functions with.
//   2. The Cloudflare Worker (already deployed): forwards POSTs verbatim,
//      secret SUPABASE_ANON_KEY = the sb_publishable_ key.
//   3. Stripe → Workbench → Webhooks → event destination with events
//      customer.subscription.deleted + customer.subscription.updated,
//      endpoint URL = the WORKER URL. Copy its SIGNING SECRET (whsec_…).
//   4. Supabase → Edge Functions → Secrets → STRIPE_WEBHOOK_SECRET = that
//      whsec_ value. (STRIPE_SECRET_KEY is already set.)
//
// ⚠ Test-mode (sandbox) and live-mode webhooks are SEPARATE in Stripe: at
// go-live, create the event destination again in live mode — SAME worker
// URL, it is environment-agnostic — and update STRIPE_WEBHOOK_SECRET to
// the live destination's signing secret, same moment as the sk_live_ swap.
//
// Every request is verified against the signing secret, so a forged POST
// cannot flip anyone's tier. Rows are matched by stripe_subscription_id, so
// a stale event about an old subscription cannot clobber a newer one.

import Stripe from "npm:stripe@17";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Mirror of create-subscription's map — keep the two in sync.
const PLAN_TO_TIER: Record<string, string> = {
  founding: "founding",
  standard: "standard",
  council: "council_paid",
};

// Subscription statuses that mean "no longer entitled to a paid tier".
const DEAD = new Set(["canceled", "unpaid", "incomplete_expired"]);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const whSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  const sig = req.headers.get("stripe-signature");
  if (!whSecret) return new Response("STRIPE_WEBHOOK_SECRET not set", { status: 500 });
  if (!sig) return new Response("missing signature", { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, sig, whSecret, undefined, cryptoProvider);
  } catch {
    return new Response("bad signature", { status: 400 });
  }

  if (event.type !== "customer.subscription.deleted" &&
      event.type !== "customer.subscription.updated") {
    return new Response("ignored", { status: 200 });
  }

  const sub = event.data.object as Stripe.Subscription;
  const sbAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  if (event.type === "customer.subscription.deleted" || DEAD.has(sub.status)) {
    // Revert to the free plan. Matching on stripe_subscription_id means this
    // only touches the profile still pointing at THIS subscription — if the
    // user already re-subscribed, the new subscription's id is on the row and
    // this late event matches nothing, which is correct.
    const { error } = await sbAdmin.from("profiles").update({
      tier: "none",
      stripe_subscription_id: null,
      trial_ends_at: null,
    }).eq("stripe_subscription_id", sub.id);
    if (error) return new Response("profile update failed: " + error.message, { status: 500 });
    return new Response("downgraded", { status: 200 });
  }

  // updated + alive: re-assert the tier from the subscription's own plan
  // metadata (covers plan changes made in the Stripe dashboard).
  const tier = PLAN_TO_TIER[sub.metadata?.plan ?? ""];
  if (tier && (sub.status === "active" || sub.status === "trialing" || sub.status === "past_due")) {
    const { error } = await sbAdmin.from("profiles").update({ tier })
      .eq("stripe_subscription_id", sub.id);
    if (error) return new Response("profile update failed: " + error.message, { status: 500 });
  }
  return new Response("ok", { status: 200 });
});
