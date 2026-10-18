-- WastePlanner — Access tiers: Free / Pro Waste project / Subscriber.
--
-- Three levels, resolved in this order (wp_entitlements below is the one
-- server-side statement of it; wpEntitlementsResolve in index.html mirrors it
-- for the UI and tests/access-tiers.test.js pins the two together):
--
--   1. SUBSCRIBER — profiles.tier is a paid tier ('standard', 'founding',
--      'council_paid'), or the account is staff. Unlimited projects, every
--      export, paid AI limits. Until Stripe is live, staff grant this by hand
--      (wp_staff_set_subscriber: tier 'standard', tier_source 'manual').
--   2. PRO WASTE PROJECT — projects.pwc_engaged = true. Exports on THAT
--      project for its owner and the design team the owner invites
--      (project_members), and it does not use the owner's free slot.
--      Only staff set or clear it (wp_set_engagement).
--   3. FREE — one project, every tool in-app, no exports.
--
-- When staff clear an engagement the project is READ-ONLY for anyone who is
-- not a subscriber or staff: still visible, never deleted, no edits (trigger
-- below) and no exports (wp_entitlements).
--
-- WHAT THE SERVER CAN AND CANNOT ENFORCE ABOUT EXPORTS: every export (sheet
-- PDF, DXF, PNG, compliance report) is rendered in the browser from data the
-- user can already read — there is no export endpoint to refuse. The caps and
-- the read-only rule hold here (triggers); export refusal is the client asking
-- this function. Hard export enforcement would need server-side rendering.
--
-- Builds on sql/2026-09-07-free-tier-enforcement.sql (projects_created,
-- wp_is_free_plan, the cap triggers). Idempotent. Run in the SQL editor as
-- postgres.

-- ── 1. Columns ───────────────────────────────────────────────────────────

alter table public.projects
  add column if not exists pwc_engaged boolean not null default false,
  add column if not exists engaged_at timestamptz,
  add column if not exists engaged_by uuid,
  add column if not exists pwc_job_number text,
  add column if not exists engagement_ended_at timestamptz;

-- Monotonic, like projects_created: incremented the FIRST time one of the
-- user's projects is engaged, never decremented. Free slots used =
-- projects_created - projects_engaged, so deleting an engaged project can
-- neither free a slot nor cost one.
alter table public.profiles
  add column if not exists projects_engaged integer not null default 0,
  add column if not exists tier_source text;

-- Not client-writable, or the cap is self-reported (same INVOKER pattern as
-- wp_protect_projects_created: wp_set_engagement's definer update passes).
create or replace function public.wp_protect_projects_engaged()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.projects_engaged is distinct from old.projects_engaged
     and current_user in ('anon', 'authenticated') then
    new.projects_engaged := old.projects_engaged;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_protect_projects_engaged on public.profiles;
create trigger trg_wp_protect_projects_engaged
  before update on public.profiles
  for each row execute function public.wp_protect_projects_engaged();

-- ── 2. Helpers (SECURITY DEFINER so RLS policies on projects can call them
--       without recursing into projects' own policies) ─────────────────────
-- Project ids are taken as TEXT and compared as id::text: older rows carry
-- Date.now() ids, newer ones UUIDs, so nothing here assumes the column type.

create or replace function public.wp_is_staff(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_staff from public.profiles where uuid = p_user), false);
$$;

create or replace function public.wp_is_paid(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(tier, 'none') in ('standard', 'founding', 'council_paid')
                   from public.profiles where uuid = p_user), false);
$$;

-- ── 3. Project team (design team on an engaged project) ──────────────────
-- project_id takes the projects.id column's own type, whatever it is.

do $$
declare v_type text;
begin
  select format_type(atttypid, atttypmod) into v_type
    from pg_attribute where attrelid = 'public.projects'::regclass and attname = 'id';
  execute format($t$
    create table if not exists public.project_members (
      id uuid primary key default gen_random_uuid(),
      project_id %s not null references public.projects(id) on delete cascade,
      email text not null check (char_length(email) between 3 and 254),
      user_id uuid,                       -- set when the invitee accepts
      invited_by uuid not null default auth.uid(),
      created_at timestamptz not null default now(),
      accepted_at timestamptz
    )$t$, v_type);
end $$;

create or replace function public.wp_is_project_member(p_project text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members m
                 where m.project_id::text = p_project and m.user_id = p_user);
$$;

create or replace function public.wp_project_engaged(p_project text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select pwc_engaged from public.projects where id::text = p_project), false);
$$;

create or replace function public.wp_project_owner(p_project text)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from public.projects where id::text = p_project;
$$;

create unique index if not exists project_members_once
  on public.project_members (project_id, lower(email));
create index if not exists project_members_user on public.project_members (user_id);

alter table public.project_members enable row level security;
grant select, insert, delete on public.project_members to authenticated;

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members
  for select to authenticated
  using (user_id = auth.uid()
         or public.wp_project_owner(project_id::text) = auth.uid()
         or public.wp_is_staff(auth.uid()));

-- The owner invites, and only while the project is engaged (the team is part
-- of what engagement unlocks). Staff can invite on any engaged project.
drop policy if exists project_members_invite on public.project_members;
create policy project_members_invite on public.project_members
  for insert to authenticated
  with check (public.wp_project_engaged(project_id::text)
              and user_id is null and accepted_at is null
              and (public.wp_project_owner(project_id::text) = auth.uid()
                   or public.wp_is_staff(auth.uid())));

drop policy if exists project_members_remove on public.project_members;
create policy project_members_remove on public.project_members
  for delete to authenticated
  using (public.wp_project_owner(project_id::text) = auth.uid()
         or public.wp_is_staff(auth.uid()));

-- INVITATION EMAIL — one dashboard step this file cannot do: Database →
-- Webhooks → new webhook on INSERT into public.project_members, type
-- "Supabase Edge Function", target crm-events (the same function the events
-- and waitlist webhooks use). Each new row is relayed as event "team_invite"
-- with the invitee as the contact, and a CRM workflow on that event sends
-- the email. Removing and re-inviting someone sends it again.

-- Accept on sign-in: every pending invite to this account's CONFIRMED email.
-- An unconfirmed address could be anyone's, so it accepts nothing.
create or replace function public.wp_accept_project_invites()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_n integer;
begin
  select email into v_email from auth.users
   where id = auth.uid() and email_confirmed_at is not null;
  if v_email is null then return 0; end if;
  update public.project_members
     set user_id = auth.uid(), accepted_at = now()
   where user_id is null and lower(email) = lower(v_email);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
grant execute on function public.wp_accept_project_invites() to authenticated;

-- ── 4. Who can see / edit a project beyond its owner ─────────────────────
-- Permissive policies OR with the existing owner / org policies: these only
-- ever ADD visibility. Members see their project for as long as they are on
-- its team (read-only once engagement ends — the trigger in §6 refuses the
-- edit); staff see and edit every engaged project to prepare the WMP.

drop policy if exists projects_member_read on public.projects;
create policy projects_member_read on public.projects
  for select to authenticated
  using (public.wp_is_project_member(id::text, auth.uid()));

drop policy if exists projects_member_edit on public.projects;
create policy projects_member_edit on public.projects
  for update to authenticated
  using (pwc_engaged and public.wp_is_project_member(id::text, auth.uid()))
  with check (pwc_engaged and public.wp_is_project_member(id::text, auth.uid()));

drop policy if exists projects_staff_engaged_read on public.projects;
create policy projects_staff_engaged_read on public.projects
  for select to authenticated
  using ((pwc_engaged or engaged_at is not null) and public.wp_is_staff(auth.uid()));

drop policy if exists projects_staff_engaged_edit on public.projects;
create policy projects_staff_engaged_edit on public.projects
  for update to authenticated
  using (pwc_engaged and public.wp_is_staff(auth.uid()))
  with check (pwc_engaged and public.wp_is_staff(auth.uid()));

-- ── 4b. Plans and documents of a shared project ──────────────────────────
-- They live in the OWNER's folder of the project-plans bucket:
-- {owner}/{projectId}.pdf, {owner}/{projectId}.<stage>.pdf,
-- {owner}/{projectId}/docs/… The design team and staff read them; while the
-- project is engaged they may also write them (a re-issued plan). These ADD
-- to the bucket's existing own-folder policies.

create or replace function public.wp_storage_project_id(p_name text)
returns text language sql immutable as $$
  select split_part(split_part(p_name, '/', 2), '.', 1);
$$;

create or replace function public.wp_can_open_shared(p_project text, p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects pr
                  where pr.id::text = p_project and pr.user_id::text = p_folder
                    and (public.wp_is_project_member(p_project, auth.uid())
                         or ((pr.pwc_engaged or pr.engaged_at is not null) and public.wp_is_staff(auth.uid()))));
$$;

create or replace function public.wp_can_edit_shared(p_project text, p_folder text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects pr
                  where pr.id::text = p_project and pr.user_id::text = p_folder and pr.pwc_engaged
                    and (public.wp_is_project_member(p_project, auth.uid())
                         or public.wp_is_staff(auth.uid())));
$$;

drop policy if exists project_plans_shared_read on storage.objects;
create policy project_plans_shared_read on storage.objects
  for select to authenticated
  using (bucket_id = 'project-plans'
         and public.wp_can_open_shared(public.wp_storage_project_id(name), (storage.foldername(name))[1]));

drop policy if exists project_plans_shared_write on storage.objects;
create policy project_plans_shared_write on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans'
              and public.wp_can_edit_shared(public.wp_storage_project_id(name), (storage.foldername(name))[1]));

drop policy if exists project_plans_shared_update on storage.objects;
create policy project_plans_shared_update on storage.objects
  for update to authenticated
  using (bucket_id = 'project-plans'
         and public.wp_can_edit_shared(public.wp_storage_project_id(name), (storage.foldername(name))[1]));

-- ── 5. Project cap: engaged projects do not use the free slot ────────────
-- Replaces the 2026-09-07 trigger function. Two changes:
--  * slots used = projects_created - projects_engaged;
--  * an upsert of an EXISTING row is not a new project. BEFORE INSERT
--    triggers fire on INSERT … ON CONFLICT DO UPDATE even when the row ends
--    up updated, so saveProjectToDB's upsert of a free user's one project
--    used to hit the cap on every save.

create or replace function public.wp_enforce_project_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is not null then
    return new;
  end if;
  if exists (select 1 from public.projects where id = new.id) then
    return new;   -- upsert of a project that already exists
  end if;
  if new.user_id is not null and public.wp_is_free_plan(new.user_id) then
    if (select coalesce(projects_created, 0) - coalesce(projects_engaged, 0)
          from public.profiles where uuid = new.user_id) >= 1 then
      raise exception 'free_plan_project_cap: the free plan includes one project — subscribe, or engage Pro Waste for a project'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

-- Engagement fields are staff-set only. A client write (owner, member, or a
-- direct PostgREST call) keeps the old values; wp_set_engagement runs as its
-- definer and passes. Same SECURITY INVOKER pattern as
-- wp_protect_projects_created. On INSERT a client can never create a row
-- already engaged.
create or replace function public.wp_protect_engagement()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pwc_engaged := false;
    new.engaged_at := null;
    new.engaged_by := null;
    new.pwc_job_number := null;
    new.engagement_ended_at := null;
    return new;
  end if;
  new.pwc_engaged := old.pwc_engaged;
  new.engaged_at := old.engaged_at;
  new.engaged_by := old.engaged_by;
  new.pwc_job_number := old.pwc_job_number;
  new.engagement_ended_at := old.engagement_ended_at;
  return new;
end;
$$;

drop trigger if exists trg_wp_protect_engagement on public.projects;
create trigger trg_wp_protect_engagement
  before insert or update on public.projects
  for each row execute function public.wp_protect_engagement();

-- ── 6. Read-only after engagement ends ───────────────────────────────────
-- A project whose engagement was cleared takes no client edits from anyone
-- but a subscriber or staff. Nothing is deleted; the row stays readable.

create or replace function public.wp_enforce_ended_read_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.pwc_engaged = false and old.engagement_ended_at is not null
     and auth.uid() is not null
     and not public.wp_is_staff(auth.uid())
     and not public.wp_is_paid(auth.uid()) then
    raise exception 'project_read_only: engagement with Pro Waste has ended — this project is read-only without a subscription'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_wp_ended_read_only on public.projects;
create trigger trg_wp_ended_read_only
  before update on public.projects
  for each row execute function public.wp_enforce_ended_read_only();

-- An engaged project's compliance checks are not capped at the free plan's
-- two: engagement is full access on that project. And the cap now fires only
-- when the counter MOVES UP past it, as its 2026-09-07 comment always said —
-- otherwise every save of a project that ran 5 checks while engaged would be
-- refused as "over the cap" once the engagement ended.
create or replace function public.wp_enforce_compliance_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is not null or new.user_id is null or old.pwc_engaged then
    return new;
  end if;
  if public.wp_is_free_plan(new.user_id) then
    if coalesce(new.compliance_runs, 0) > 2
       and coalesce(new.compliance_runs, 0) > coalesce(old.compliance_runs, 0) then
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

-- ── 7. Staff actions ─────────────────────────────────────────────────────

-- Mark / clear engagement. The first engagement of a project credits its
-- owner's free slot (projects_engaged), once, ever.
create or replace function public.wp_set_engagement(p_project text, p_engaged boolean, p_job_number text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.projects%rowtype;
begin
  if not public.wp_is_staff(auth.uid()) then
    raise exception 'staff_only: only Pro Waste staff can change engagement' using errcode = '42501';
  end if;
  select * into r from public.projects where id::text = p_project for update;
  if not found then
    raise exception 'project_not_found' using errcode = 'P0002';
  end if;
  if p_engaged then
    if r.engaged_at is null and r.user_id is not null then
      update public.profiles set projects_engaged = coalesce(projects_engaged, 0) + 1
       where uuid = r.user_id;
    end if;
    update public.projects
       set pwc_engaged = true,
           engaged_at = coalesce(r.engaged_at, now()),
           engaged_by = auth.uid(),
           pwc_job_number = coalesce(nullif(trim(p_job_number), ''), r.pwc_job_number),
           engagement_ended_at = null
     where id::text = p_project;
  else
    update public.projects
       set pwc_engaged = false,
           engagement_ended_at = case when r.pwc_engaged then now() else r.engagement_ended_at end
     where id::text = p_project;
  end if;
  select * into r from public.projects where id::text = p_project;
  return jsonb_build_object('pwc_engaged', r.pwc_engaged, 'engaged_at', r.engaged_at,
    'engaged_by', r.engaged_by, 'pwc_job_number', r.pwc_job_number,
    'engagement_ended_at', r.engagement_ended_at);
end;
$$;
grant execute on function public.wp_set_engagement(text, boolean, text) to authenticated;

-- Manual subscriber grant while billing is in Stripe test mode. 'standard' is
-- the paid tier the ai-user function already serves paid limits to;
-- tier_source 'manual' marks it as granted by hand. The stripe-webhook only
-- ever matches rows by stripe_subscription_id, so it cannot revoke a manual
-- grant, and revoking here never touches a real Stripe subscriber.
create or replace function public.wp_staff_set_subscriber(p_email text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_row public.profiles%rowtype;
begin
  if not public.wp_is_staff(auth.uid()) then
    raise exception 'staff_only: only Pro Waste staff can grant a subscription' using errcode = '42501';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'user_not_found: no account with that email' using errcode = 'P0002';
  end if;
  select * into v_row from public.profiles where uuid = v_uid;
  if p_on then
    if v_row.stripe_subscription_id is null then
      update public.profiles set tier = 'standard', tier_source = 'manual' where uuid = v_uid;
    end if;
  else
    update public.profiles set tier = 'none', tier_source = null
     where uuid = v_uid and tier_source = 'manual';
  end if;
  select * into v_row from public.profiles where uuid = v_uid;
  return jsonb_build_object('uuid', v_uid, 'tier', v_row.tier, 'tier_source', v_row.tier_source);
end;
$$;
grant execute on function public.wp_staff_set_subscriber(text, boolean) to authenticated;

-- ── 8. Entitlements: the single server-side statement ────────────────────
-- { plan, canCreateProject, canExport, aiTier, isEngaged, readOnly,
--   canView, isOwner, isMember }. p_project may be null (no project open).

create or replace function public.wp_entitlements(p_project text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean := public.wp_is_staff(auth.uid());
  v_paid boolean := public.wp_is_paid(auth.uid());
  v_prof public.profiles%rowtype;
  r public.projects%rowtype;
  v_owner boolean := false;
  v_member boolean := false;
  v_view boolean := false;
  v_engaged boolean := false;
  v_ended boolean := false;
  v_plan text;
begin
  select * into v_prof from public.profiles where uuid = v_uid;
  if p_project is not null then
    select * into r from public.projects where id::text = p_project;
    if found then
      v_owner := r.user_id = v_uid;
      v_member := public.wp_is_project_member(p_project, v_uid);
      v_view := v_owner or v_member or v_staff
        or (r.org_id is not null and exists (select 1 from public.org_members om
                                              where om.org_id = r.org_id and om.user_id = v_uid));
      v_engaged := r.pwc_engaged and v_view;
      v_ended := not r.pwc_engaged and r.engagement_ended_at is not null;
    end if;
  end if;
  -- subscriber → engaged project → free
  v_plan := case when v_staff then 'staff'
                 when v_paid then 'subscriber'
                 when v_engaged then 'engaged'
                 else 'free' end;
  return jsonb_build_object(
    'plan', v_plan,
    'canCreateProject', v_staff or v_paid
      or (coalesce(v_prof.projects_created, 0) - coalesce(v_prof.projects_engaged, 0)) < 1,
    'canExport', v_staff or v_paid or v_engaged,
    'aiTier', case when v_staff or v_paid then 'paid' else 'free' end,
    'isEngaged', v_engaged,
    'readOnly', v_ended and not v_staff and not v_paid,
    'canView', v_view,
    'isOwner', v_owner,
    'isMember', v_member);
end;
$$;
grant execute on function public.wp_entitlements(text) to authenticated;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop function if exists public.wp_entitlements(text);
-- drop function if exists public.wp_staff_set_subscriber(text, boolean);
-- drop function if exists public.wp_set_engagement(text, boolean, text);
-- drop trigger if exists trg_wp_ended_read_only on public.projects;
-- drop function if exists public.wp_enforce_ended_read_only();
-- drop trigger if exists trg_wp_protect_engagement on public.projects;
-- drop function if exists public.wp_protect_engagement();
-- drop policy if exists projects_staff_engaged_edit on public.projects;
-- drop policy if exists projects_staff_engaged_read on public.projects;
-- drop policy if exists projects_member_edit on public.projects;
-- drop policy if exists projects_member_read on public.projects;
-- drop policy if exists project_plans_shared_update on storage.objects;
-- drop policy if exists project_plans_shared_write on storage.objects;
-- drop policy if exists project_plans_shared_read on storage.objects;
-- drop function if exists public.wp_can_edit_shared(text, text);
-- drop function if exists public.wp_can_open_shared(text, text);
-- drop function if exists public.wp_storage_project_id(text);
-- drop function if exists public.wp_accept_project_invites();
-- drop table if exists public.project_members;
-- drop function if exists public.wp_project_owner(text);
-- drop function if exists public.wp_project_engaged(text);
-- drop function if exists public.wp_is_project_member(text, uuid);
-- drop function if exists public.wp_is_paid(uuid);
-- drop function if exists public.wp_is_staff(uuid);
-- drop trigger if exists trg_wp_protect_projects_engaged on public.profiles;
-- drop function if exists public.wp_protect_projects_engaged();
-- alter table public.profiles drop column if exists projects_engaged;
-- alter table public.projects drop column if exists engagement_ended_at, drop column if exists pwc_job_number,
--   drop column if exists engaged_by, drop column if exists engaged_at, drop column if exists pwc_engaged;
-- Then re-run sql/2026-09-07-free-tier-enforcement.sql §3–4 to restore the old trigger bodies.
-- notify pgrst, 'reload schema';
