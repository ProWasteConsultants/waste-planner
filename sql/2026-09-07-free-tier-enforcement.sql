-- WastePlanner — Free tier enforcement (server side).
--
-- The free plan is tier 'none' (what signup writes): ONE project ever, and
-- TWO compliance-checker runs per project. The client shows the same limits,
-- but client checks are UX only — anyone can call PostgREST directly with the
-- anon key and a session, so the caps must hold here.
--
-- WHY TRIGGERS AND NOT POLICIES: RLS policies are PERMISSIVE by default and
-- OR together. Adding a "free accounts limited to one project" INSERT policy
-- next to the existing owner-insert policy would not restrict anything — a
-- row passing either policy is allowed. A BEFORE trigger raises regardless of
-- which policy admitted the row, so the caps live in triggers.
--
-- "ONE PROJECT" MEANS ONE *CREATED*, EVER — deleting a project must not free
-- the slot, or the free plan is unlimited-with-extra-steps. So the count is a
-- monotonic profiles.projects_created counter kept by trigger, not a live
-- count(*) over the projects table.
--
-- NOT ENFORCED HERE (different systems own these — flagged, not faked):
--   * AI call limits — the ai-user edge function is the enforced truth.
--   * Tier changes on subscribe/cancel — the create-subscription edge
--     function + Stripe webhook write profiles.tier. Neither is in this repo.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

-- ── 1. Lifetime project counter ──────────────────────────────────────────

alter table public.profiles
  add column if not exists projects_created integer not null default 0;

-- Backfill for existing accounts: current live rows are the floor. This can
-- undercount for users who created-and-deleted before this migration; that is
-- accepted — the counter only needs to be honest from today forward.
update public.profiles p
set projects_created = greatest(p.projects_created, sub.n)
from (select user_id, count(*)::int as n from public.projects
      where user_id is not null group by user_id) sub
where sub.user_id = p.uuid and p.projects_created < sub.n;

-- ── 2. Free-plan predicate ───────────────────────────────────────────────

create or replace function public.wp_is_free_plan(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Missing profile row counts as free: a half-created account must not get
  -- more than the free plan. Staff are exempt (they test as any tier).
  select coalesce(
    (select coalesce(pr.tier, 'none') in ('none') and coalesce(pr.is_staff, false) = false
     from public.profiles pr where pr.uuid = p_user),
    true);
$$;

-- ── 3. Project cap: BEFORE INSERT on projects ────────────────────────────

create or replace function public.wp_enforce_project_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Org projects are seat-governed, not free-plan governed.
  if new.org_id is not null then
    return new;
  end if;
  if new.user_id is not null and public.wp_is_free_plan(new.user_id) then
    if (select coalesce(projects_created, 0) from public.profiles
        where uuid = new.user_id) >= 1 then
      raise exception 'free_plan_project_cap: the free plan includes one project — upgrade for unlimited projects'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_project_cap on public.projects;
create trigger trg_wp_project_cap
  before insert on public.projects
  for each row execute function public.wp_enforce_project_cap();

-- Counter increments AFTER insert (never on delete — the slot is spent).
create or replace function public.wp_count_project_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is not null then
    update public.profiles
    set projects_created = coalesce(projects_created, 0) + 1
    where uuid = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_count_project on public.projects;
create trigger trg_wp_count_project
  after insert on public.projects
  for each row execute function public.wp_count_project_created();

-- ── 4. Compliance-run cap: BEFORE UPDATE on projects ─────────────────────
-- The client persists each checker run by writing compliance_runs on the
-- project row. Free plan: 2 runs per project. The check only fires when the
-- counter moves upward, so unrelated project saves are untouched; it also
-- refuses to wind the counter BACK on a free account, which would otherwise
-- be the one-line bypass.

create or replace function public.wp_enforce_compliance_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is not null or new.user_id is null then
    return new;
  end if;
  if public.wp_is_free_plan(new.user_id) then
    if coalesce(new.compliance_runs, 0) > 2 then
      raise exception 'free_plan_compliance_cap: the free plan includes 2 compliance checks per project — upgrade for more'
        using errcode = 'P0001';
    end if;
    if coalesce(new.compliance_runs, 0) < coalesce(old.compliance_runs, 0) then
      new.compliance_runs := old.compliance_runs;  -- no resetting the meter
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_compliance_cap on public.projects;
create trigger trg_wp_compliance_cap
  before update on public.projects
  for each row execute function public.wp_enforce_compliance_cap();

-- ── 5. Grants ────────────────────────────────────────────────────────────
-- No new tables, so no new table GRANTs. The trigger functions run as their
-- definer; clients never call them directly. profiles.projects_created rides
-- the existing profiles grants — but the column must NOT be client-writable
-- or the cap is self-reported. Column-level UPDATE grants only bite if the
-- role's table-level UPDATE is revoked in favour of column lists; if your
-- profiles table still has a blanket UPDATE grant, the belt-and-braces guard
-- is the counter trigger below.

-- Deliberately SECURITY INVOKER: a direct PostgREST update runs this as
-- anon/authenticated and gets discarded, while the counting trigger's update
-- (issued from inside a SECURITY DEFINER function running as its owner) runs
-- it as that owner and passes. Making this DEFINER would erase exactly the
-- distinction it exists to draw.
create or replace function public.wp_protect_projects_created()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.projects_created is distinct from old.projects_created
     and current_user in ('anon', 'authenticated') then
    new.projects_created := old.projects_created;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_protect_projects_created on public.profiles;
create trigger trg_wp_protect_projects_created
  before update on public.profiles
  for each row execute function public.wp_protect_projects_created();

-- PostgREST caches schema — reload so the new column is served immediately.
notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop trigger if exists trg_wp_protect_projects_created on public.profiles;
-- drop trigger if exists trg_wp_compliance_cap on public.projects;
-- drop trigger if exists trg_wp_count_project on public.projects;
-- drop trigger if exists trg_wp_project_cap on public.projects;
-- drop function if exists public.wp_protect_projects_created();
-- drop function if exists public.wp_enforce_compliance_cap();
-- drop function if exists public.wp_count_project_created();
-- drop function if exists public.wp_enforce_project_cap();
-- drop function if exists public.wp_is_free_plan(uuid);
-- alter table public.profiles drop column if exists projects_created;
-- notify pgrst, 'reload schema';
