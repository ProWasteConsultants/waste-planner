// WastePlanner — crm-events Edge Function.
//
// Relays product events from the `events` table to the CRM webhook. This
// exists so the CRM secret NEVER ships to the browser: the client writes rows
// to `events` (anon key + RLS), and this function — holding the secret as an
// environment variable — forwards them.
//
// NOTE: edge functions are deployed from the Supabase project, not from this
// repository (same as create-subscription / ai-user / ai-extract). This file
// is the source of truth for what to deploy:
//
//   supabase functions deploy crm-events
//   supabase secrets set CRM_WEBHOOK_URL=https://…  CRM_WEBHOOK_SECRET=…
//
// WIRING — Database Webhook (recommended): in the Supabase dashboard,
// Database → Webhooks → create one on INSERT into public.events, type
// "Supabase Edge Function", target crm-events. Each insert then arrives here
// as {type:"INSERT", table:"events", record:{…}} with no client involvement.
//
// The function also accepts a direct POST of {record:{…}} carrying a valid
// service-role bearer, so a backfill script can replay missed rows. It never
// accepts unauthenticated posts: a forged event reaching the CRM would
// poison lead scoring silently.

const RELAYED = new Set([
  "signup",
  "calc_prefill_applied",
  "project_created",
  "compliance_run",
  "export",
  "paywall_shown",
  "subscribed",
]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const url = Deno.env.get("CRM_WEBHOOK_URL");
  const secret = Deno.env.get("CRM_WEBHOOK_SECRET");
  if (!url || !secret) {
    // Deliberately a hard error, not a silent drop: a misconfigured relay
    // that returns 200 loses every event with no trace.
    return new Response("relay not configured", { status: 500 });
  }

  // Database Webhooks call with the project's service key; direct calls must
  // carry it too. The anon key must NOT pass — that would let any visitor
  // pump forged events into the CRM.
  const auth = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const rec = payload.record;
  if (!rec || typeof rec.event !== "string") {
    return new Response("no record", { status: 400 });
  }
  if (!RELAYED.has(rec.event)) {
    // Not every product event is a CRM event — ack and drop the rest.
    return new Response("ignored", { status: 200 });
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // The CRM validates this shared secret; rotating it is a
      // `supabase secrets set` away and never touches the client bundle.
      "x-wp-webhook-secret": secret,
    },
    body: JSON.stringify({
      event: rec.event,
      user_id: rec.user_id ?? null,
      meta: rec.meta ?? {},
      created_at: rec.created_at ?? new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    // Non-2xx bubbles up so the webhook log shows the failure; Database
    // Webhooks don't retry, so check the log after CRM outages.
    return new Response(`crm relay failed: ${res.status}`, { status: 502 });
  }
  return new Response("ok", { status: 200 });
});
