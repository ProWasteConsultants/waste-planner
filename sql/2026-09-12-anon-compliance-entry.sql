-- WastePlanner — Anonymous compliance entry (server side).
--
-- The planner landing page (?check=wmp) opens the compliance checker in an
-- anonymous session: a REAL Supabase auth user minted by signInAnonymously(),
-- whose JWT carries role 'authenticated' plus the claim is_anonymous=true.
-- That design is deliberate — the ai-user edge function gets a verifiable
-- Bearer token to hang its one-run allowance on, instead of the client
-- self-reporting a cookie. This file is the database side of the fence:
-- an anonymous session may RUN ITS ONE CHECK and log funnel events, and may
-- do nothing else that costs storage or burns free-plan entitlements.
--
-- SETUP OUTSIDE SQL (flagged, not faked — different systems own these):
--   * Supabase Dashboard → Authentication → Providers → "Allow anonymous
--     sign-ins" must be ON, or the entry point falls back to signup-first
--     (the client handles that gracefully, but the offer stops being
--     "no account needed"). Consider enabling CAPTCHA on anonymous sign-ins
--     if bot-minted sessions ever show up in the events table.
--   * The ai-user edge function must grant a JWT with is_anonymous=true
--     exactly ONE lifetime 'compliance' call (keyed on the anon user id,
--     same mechanism as the free plan's 1-per-tool lifetime trial) and
--     refuse every other tool tag for anonymous users. The function is not
--     in this repo; until it ships that rule, an anonymous user with no
--     profile row falls into the free-account trial bucket — verify which
--     allowance it actually resolves before pointing ad spend at the page.
--
-- ACCEPTED LEAKAGE (decided in the feature brief): clearing browser storage
-- and re-entering mints a fresh anon user and a fresh free check. The goal
-- is lead generation, not airtight metering — each leaked check still costs
-- the leaker a signup prompt and us one capped AI call, and the per-user
-- server allowance means no single session can loop.
--
-- WHY TRIGGERS AND NOT POLICIES: same reasoning as the free-tier migration —
-- RLS policies are PERMISSIVE and OR together, so adding a "not anonymous"
-- INSERT policy next to the existing owner-insert policy restricts nothing.
-- A BEFORE trigger raises regardless of which policy admitted the row.
--
-- DELIBERATELY NOT BLOCKED: events INSERTs. The anonymous funnel
-- (anon_check_entry → anon_check_run → anon_gate_shown → signup) is the
-- entire point of the landing page, and events rows are cheap telemetry.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

-- ── 1. Anonymous JWT predicate ───────────────────────────────────────────

create or replace function public.wp_is_anon_jwt()
returns boolean
language sql
stable
as $$
  -- True only for a PostgREST request bearing is_anonymous=true. Internal
  -- callers (auth-admin triggers, service role, SQL editor) have no such
  -- claim and pass untouched.
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb
                    ->> 'is_anonymous', 'false') = 'true';
$$;

-- ── 2. No projects from anonymous sessions ───────────────────────────────
-- The client never offers project creation to a guest (the checker is the
-- only reachable screen), but the anon key + a guest session could call
-- PostgREST directly and mint free-plan projects without ever signing up.

create or replace function public.wp_block_anon_projects()
returns trigger
language plpgsql
as $$
begin
  if public.wp_is_anon_jwt() then
    raise exception 'anon_no_projects: create a free account to start a project'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_block_anon_projects on public.projects;
create trigger trg_wp_block_anon_projects
  before insert or update on public.projects
  for each row execute function public.wp_block_anon_projects();

-- ── 3. No profile writes from anonymous sessions ─────────────────────────
-- An anonymous auth user may get a profiles row from the signup trigger
-- (that trigger does not run as the anon JWT, so it is unaffected); what a
-- guest must not do is write profile fields — tier, roles and counters are
-- account furniture, and the guest has no account yet.

create or replace function public.wp_block_anon_profiles()
returns trigger
language plpgsql
as $$
begin
  if public.wp_is_anon_jwt() then
    raise exception 'anon_no_profile_writes: create a free account first'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_block_anon_profiles on public.profiles;
create trigger trg_wp_block_anon_profiles
  before insert or update on public.profiles
  for each row execute function public.wp_block_anon_profiles();

-- PostgREST caches schema — reload so the triggers bite immediately.
notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop trigger if exists trg_wp_block_anon_profiles on public.profiles;
-- drop trigger if exists trg_wp_block_anon_projects on public.projects;
-- drop function if exists public.wp_block_anon_profiles();
-- drop function if exists public.wp_block_anon_projects();
-- drop function if exists public.wp_is_anon_jwt();
-- notify pgrst, 'reload schema';
