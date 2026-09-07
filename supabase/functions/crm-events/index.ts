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
//
// CRM-SIDE VERIFICATION: the shared secret travels BOTH as the
// x-wp-webhook-secret header AND as a top-level `secret` field in the JSON
// body. Inbound-webhook triggers in CORE/GoHighLevel-style CRMs often cannot
// read custom headers, but every one of them can filter on a body field —
// add a workflow condition `secret equals <your value>` as the first step
// and drop anything else.
//
// ENRICHMENT: events store only user_id client-side. A CRM workflow that
// creates or updates a contact needs email and name, so before relaying we
// look the sender up in `profiles` (service role — RLS does not apply) and
// attach email / name / company / tier. A missing profile row degrades to
// nulls rather than dropping the event.

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

  // Look the user up so the CRM gets a contact, not just a UUID. Best-effort:
  // an enrichment failure must not lose the event.
  let profile: {
    email?: string;
    full_name?: string;
    company_name?: string;
    tier?: string;
  } = {};
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl && rec.user_id) {
    try {
      const q = new URL(`${supabaseUrl}/rest/v1/profiles`);
      q.searchParams.set("uuid", `eq.${rec.user_id}`);
      q.searchParams.set("select", "email,full_name,company_name,tier");
      q.searchParams.set("limit", "1");
      const pr = await fetch(q, {
        headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
      });
      if (pr.ok) profile = (await pr.json())?.[0] ?? {};
    } catch {
      // fall through with an unenriched event
    }
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
      // Duplicated from the header for CRMs whose inbound-webhook triggers
      // can only filter on body fields (see CRM-SIDE VERIFICATION above).
      secret,
      event: rec.event,
      user_id: rec.user_id ?? null,
      email: profile.email ?? null,
      name: profile.full_name ?? null,
      company: profile.company_name ?? null,
      tier: profile.tier ?? null,
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
