-- ── Engaged projects get the paid AI allowance (2026-10-20, Lachy) ─────────
-- Every account uses WastePlanner's AI (no own-key path any more); the
-- allowance depends on the level:
--   free account            → a one-time trial of each AI tool
--   subscriber / staff      → paid limits (10 uses per tool per day)
--   Pro Waste-engaged project → paid limits for that project's owner and
--                               invited design team, whatever their own plan
--
-- 1. wp_entitlements: aiTier is 'paid' on an engaged project the caller can
--    see (same rule as canExport). Redefined here in full; everything but the
--    aiTier line is unchanged from sql/2026-10-18-access-tiers.sql.
-- 2. wp_ai_tier(project): the one question the ai-user edge function asks.
--    It runs as the CALLER (their JWT), so it can only answer for projects
--    that account can see — a project id the caller has no access to reads
--    as their own plan, never as 'paid'. ai-user must call it with the user's
--    token (not the service key), passing the ?project= the app sends.
--
-- Run after sql/2026-10-18-access-tiers.sql and
-- sql/2026-10-19-design-team-org-projects.sql.

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
    -- 2026-10-20: an engaged project carries the subscriber AI allowance
    'aiTier', case when v_staff or v_paid or v_engaged then 'paid' else 'free' end,
    'isEngaged', v_engaged,
    'readOnly', v_ended and not v_staff and not v_paid,
    'canView', v_view,
    'isOwner', v_owner,
    'isMember', v_member);
end;
$$;
grant execute on function public.wp_entitlements(text) to authenticated;

create or replace function public.wp_ai_tier(p_project text default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.wp_entitlements(nullif(p_project, '')) ->> 'aiTier', 'free');
$$;
revoke all on function public.wp_ai_tier(text) from public;
grant execute on function public.wp_ai_tier(text) to authenticated;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop function if exists public.wp_ai_tier(text);
-- then re-run section 8 of sql/2026-10-18-access-tiers.sql to restore
-- the previous wp_entitlements.
