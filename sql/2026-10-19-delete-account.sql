-- WastePlanner — privileges for the delete-account edge function.
--
-- The function runs with the service key. service_role skips RLS but still
-- needs table privileges, and this project's tables do not grant them by
-- default (found 2026-10-19 with project-invite). These are exactly the
-- reads, updates and deletes supabase/functions/delete-account performs.
--
-- Idempotent. Run in the Supabase SQL editor as postgres.

grant select, update, delete on public.projects to service_role;
grant select, delete on public.profiles to service_role;
grant select, delete on public.project_members to service_role;
grant select, delete on public.org_members to service_role;
grant select, delete on public.org_invites to service_role;
grant select on public.orgs to service_role;

notify pgrst, 'reload schema';
