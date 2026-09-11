-- WastePlanner — landing-calculator leads: anonymous capture, claimed on signup.
--
-- The landing page's free calculator runs with no account. When the visitor
-- clicks through to lay the bins out, their calculation must survive the
-- anonymous → authenticated transition. The URL/sessionStorage handoff
-- (?calc=) still works and stays the fast path, but it dies with the tab: a
-- visitor who bails at the signup form and comes back tomorrow — or signs in
-- from another tab — used to lose the calculation. This table is the durable
-- half: an UNCLAIMED, SHORT-LIVED record keyed by a client-generated token,
-- claimed by whichever account first presents that token after sign-in.
--
-- The same shape serves any future pre-signup capture point (the QR bin-room
-- signage flow): create a lead wherever the anonymous input happens, link to
-- the app with ?lead=<token>, and the claim path below does the rest.
--
-- ACCESS IS RPC-ONLY. The token is the secret, and RLS cannot express "may
-- read the row whose token you know" without exposing the table to
-- enumeration — a SELECT policy usable by anon would let anyone crawl every
-- lead. So: RLS on, NO policies, NO table grants; the two SECURITY DEFINER
-- functions below are the entire API. create_calc_lead never overwrites an
-- existing token (a guessed token cannot clobber someone's lead), and
-- claim_calc_lead consumes atomically — first authenticated claimant wins,
-- re-claim by the same account is idempotent for retries.
--
-- Leads expire after 48 hours (the brief's 24–48h band, taking the generous
-- end: "come back tomorrow" must work across a weekend morning). Expired and
-- claimed rows are swept opportunistically on later inserts — no pg_cron
-- dependency. Payloads carry no PII: state, council, unit mix, tenancy uses.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

-- ── 1. Table ─────────────────────────────────────────────────────────────

create table if not exists public.calc_leads (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique
             check (char_length(token) between 16 and 80),
  payload    jsonb not null,
  source     text not null default 'landing_calc'
             check (char_length(source) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '48 hours',
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);

-- The insert guard counts recent rows; the sweep scans by expiry.
create index if not exists idx_calc_leads_created on public.calc_leads (created_at);
create index if not exists idx_calc_leads_expires on public.calc_leads (expires_at);

alter table public.calc_leads enable row level security;
-- Deliberately NO policies and NO table grants: see the header. Everything
-- goes through the two functions below.

-- ── 2. Create (anonymous) ────────────────────────────────────────────────

create or replace function public.create_calc_lead(
  p_token   text,
  p_payload jsonb,
  p_source  text default 'landing_calc'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Shape checks: the table constraints repeat these, but raising here gives
  -- the caller a real error instead of a constraint name.
  if p_token is null or char_length(p_token) not between 16 and 80
     or p_token !~ '^[A-Za-z0-9_-]+$' then
    raise exception 'calc_lead_bad_token' using errcode = 'P0001';
  end if;
  if p_payload is null or pg_column_size(p_payload) > 16384 then
    raise exception 'calc_lead_bad_payload' using errcode = 'P0001';
  end if;

  -- Storage guard against runaway anonymous inserts. 1000/hour is two orders
  -- of magnitude above real landing traffic; a flood hits this ceiling and
  -- the fast path (?calc= in the URL) still works for real visitors.
  if (select count(*) from calc_leads
      where created_at > now() - interval '1 hour') >= 1000 then
    raise exception 'calc_lead_rate_limited' using errcode = 'P0001';
  end if;

  -- Opportunistic sweep: expired-and-unclaimed rows are worthless; claimed
  -- rows have served their purpose and only need to linger long enough for
  -- same-user retries. Keeps the table at steady state without pg_cron.
  delete from calc_leads
  where (claimed_by is null and expires_at < now() - interval '7 days')
     or (claimed_at is not null and claimed_at < now() - interval '7 days');

  -- Never overwrite: a token collision (or a guess) must not replace a lead.
  insert into calc_leads (token, payload, source)
  values (p_token, p_payload, coalesce(nullif(trim(p_source), ''), 'landing_calc'))
  on conflict (token) do nothing;
end;
$$;

-- ── 3. Claim (authenticated) ─────────────────────────────────────────────

create or replace function public.claim_calc_lead(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  if auth.uid() is null then
    return null;  -- anonymous callers get nothing, not an oracle
  end if;
  update calc_leads
     set claimed_by = auth.uid(),
         claimed_at = coalesce(claimed_at, now())
   where token = p_token
     and expires_at > now()
     and (claimed_by is null or claimed_by = auth.uid())
  returning payload into v_payload;
  return v_payload;  -- null = unknown, expired, or already someone else's
end;
$$;

-- ── 4. Grants ────────────────────────────────────────────────────────────
-- Functions are the whole surface (see header — table has no grants at all).
-- create runs for anonymous landing visitors; claim needs a session.

revoke all on function public.create_calc_lead(text, jsonb, text) from public;
revoke all on function public.claim_calc_lead(text) from public;
grant execute on function public.create_calc_lead(text, jsonb, text) to anon, authenticated;
grant execute on function public.claim_calc_lead(text) to authenticated;

-- PostgREST caches schema — reload so the RPCs are served immediately.
notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop function if exists public.claim_calc_lead(text);
-- drop function if exists public.create_calc_lead(text, jsonb, text);
-- drop table if exists public.calc_leads;
-- notify pgrst, 'reload schema';
