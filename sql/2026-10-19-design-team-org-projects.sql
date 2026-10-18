-- WastePlanner — Design team on ORGANISATION projects (follows
-- sql/2026-10-18-access-tiers.sql, which must have run first).
--
-- The first version let only a project's creator (projects.user_id) or
-- staff manage its design team. On an organisation project that is wrong:
-- the project belongs to the org, so any member of that org may invite,
-- see and remove the design team — the same people who can already open and
-- edit the project. Staff keep their access on every engaged project.
--
-- Idempotent. Run in the Supabase SQL editor as postgres.

-- Is this user a member of the org that owns the project? (false for a
-- personal project)
create or replace function public.wp_project_org_member(p_project text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.projects pr
                 join public.org_members om on om.org_id = pr.org_id
                 where pr.id::text = p_project and om.user_id = p_user);
$$;

-- Who manages a project's design team: its creator, a member of its org,
-- or staff.
create or replace function public.wp_project_team_manager(p_project text, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.wp_project_owner(p_project) = p_user
      or public.wp_project_org_member(p_project, p_user)
      or public.wp_is_staff(p_user);
$$;

drop policy if exists project_members_read on public.project_members;
create policy project_members_read on public.project_members
  for select to authenticated
  using (user_id = auth.uid()
         or public.wp_project_team_manager(project_id::text, auth.uid()));

drop policy if exists project_members_invite on public.project_members;
create policy project_members_invite on public.project_members
  for insert to authenticated
  with check (public.wp_project_engaged(project_id::text)
              and user_id is null and accepted_at is null and notified_at is null
              and public.wp_project_team_manager(project_id::text, auth.uid()));

drop policy if exists project_members_remove on public.project_members;
create policy project_members_remove on public.project_members
  for delete to authenticated
  using (public.wp_project_team_manager(project_id::text, auth.uid()));

-- The project-invite edge function reads the invite row and stamps
-- notified_at with the service key. service_role skips RLS but still needs
-- table privileges, which a table created by a migration may not have.
grant select, update on public.project_members to service_role;

notify pgrst, 'reload schema';

-- ── ROLLBACK (back to creator-or-staff) ───────────────────────────────────
-- Re-run §3 of sql/2026-10-18-access-tiers.sql, then:
-- drop function if exists public.wp_project_team_manager(text, uuid);
-- drop function if exists public.wp_project_org_member(text, uuid);
