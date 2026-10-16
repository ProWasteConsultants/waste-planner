-- WastePlanner — "Register interest" waitlist (2026-10-16).
--
-- WHY
-- While the coming-soon launch gate is on (WP_COMING_SOON, gate 10 in
-- CLAUDE.md) visitors can't sign up. The coming-soon card collects their
-- interest instead, so there is a list to tell on launch day.
--
-- ACCESS
-- Insert: anyone (anon or signed in) — it is a public form. Nobody can read
-- the list back through the API except PWC staff (profiles.is_staff); a
-- visitor cannot see who else registered. No update/delete from the API.
-- Duplicates: one row per email (case-insensitive). A second registration
-- hits the unique index and the client treats that as "already registered".
--
-- CRM (optional): Database → Webhooks → on INSERT into public.waitlist,
-- type "Supabase Edge Function", target crm-events — the same relay the
-- events table uses. It forwards each entry as event "waitlist_join".

create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null check (length(email) between 3 and 254 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null default '' check (length(name) <= 120),
  company text not null default '' check (length(company) <= 160),
  role text not null default '' check (length(role) <= 40),
  attribution jsonb,                       -- first-touch UTM / referrer, as captured client-side
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_lower on public.waitlist (lower(email));

alter table public.waitlist enable row level security;

drop policy if exists "waitlist_insert" on public.waitlist;
create policy "waitlist_insert" on public.waitlist for insert to anon, authenticated
  with check (attribution is null or pg_column_size(attribution) < 4096);

drop policy if exists "waitlist_staff_read" on public.waitlist;
create policy "waitlist_staff_read" on public.waitlist for select to authenticated
  using (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff = true));

-- GRANTs (RLS filters rows; it does not confer table privileges)
grant insert on public.waitlist to anon, authenticated;
grant select on public.waitlist to authenticated;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop table if exists public.waitlist;
-- notify pgrst, 'reload schema';
