// ── stripe-webhook ──────────────────────────────────────────────────────────
// Keeps profiles.tier in sync with Stripe. The critical path is CANCELLATION:
// when a subscription ends, the profile reverts to tier 'none' — the free
// plan. Projects stay readable and exportable (that is the free plan's
// promise); only the caps come back. Without this function a cancelled
// subscriber keeps their paid tier forever.
//
// DEPLOYMENT — three steps, in order:
//   1. Deploy this function with "Verify JWT" OFF. Stripe cannot send a
//      Supabase JWT; signature verification below is the auth instead.
//   2. Stripe Dashboard → Developers → Webhooks → Add endpoint:
//        URL:    https://<project-ref>.supabase.co/functions/v1/stripe-webhook
//        Events: customer.subscription.deleted, customer.subscription.updated
//      Then copy the endpoint's SIGNING SECRET (whsec_…).
//   3. Supabase → Edge Functions → Secrets → set STRIPE_WEBHOOK_SECRET to
//      that whsec_ value. (STRIPE_SECRET_KEY is already set.)
//
// ⚠ Test-mode and live-mode webhooks are SEPARATE in Stripe: at go-live,
// add the endpoint again in live mode and update STRIPE_WEBHOOK_SECRET to
// the live signing secret — same moment as the sk_live_ swap.
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
