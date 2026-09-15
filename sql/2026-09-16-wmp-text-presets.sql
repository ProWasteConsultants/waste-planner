-- WastePlanner — WMP text-library presets, server-side and org-scoped.
--
-- A preset is a team asset — the house style for repeat WMP work — so it
-- lives here, visible to every member of the organisation, not in one
-- person's browser. (Presets shipped briefly in localStorage; the client
-- offers a one-time import of those, then never reads or writes them
-- again. See CLAUDE.md › "Where state lives".)
--
-- Scope: org_id set → shared by the org. org_id null → a personal preset,
-- owned by user_id (a user working outside any organisation). Same split
-- the projects table uses.
--
-- Permissions (the brief's recommendation): any member can CREATE; editing
-- or deleting a preset someone else created needs the org 'admin' role, so
-- one person cannot silently rewrite the team's standard. The creator may
-- always edit their own. RLS enforces it; the client only mirrors it for
-- the UI. Table-level GRANTs are here too — RLS filters rows, it does not
-- confer privileges.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

create table if not exists public.wmp_text_presets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references public.orgs(id) on delete cascade,   -- null = personal
  user_id     uuid not null,                                        -- owner of a personal preset; provenance on an org one
  name        text not null check (length(trim(name)) between 1 and 80),
  shape       jsonb,                    -- project-shape hint (built-in style), or null
  off         jsonb not null default '{}'::jsonb,   -- tag → true when off
  edit        jsonb not null default '{}'::jsonb,   -- tag → replacement body
  created_by  uuid not null,
  updated_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One name per org; one name per personal owner.
create unique index if not exists wmp_text_presets_org_name
  on public.wmp_text_presets (org_id, lower(name)) where org_id is not null;
create unique index if not exists wmp_text_presets_user_name
  on public.wmp_text_presets (user_id, lower(name)) where org_id is null;
create index if not exists wmp_text_presets_org on public.wmp_text_presets (org_id);

alter table public.wmp_text_presets enable row level security;

grant select, insert, update, delete on public.wmp_text_presets to authenticated;

-- Membership predicate, copied from how the app already scopes org rows.
create or replace function public.wp_is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = auth.uid());
$$;
create or replace function public.wp_is_org_admin(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org and m.user_id = auth.uid() and m.role = 'admin');
$$;
grant execute on function public.wp_is_org_member(uuid), public.wp_is_org_admin(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wmp_text_presets' and policyname='wmp_text_presets_read') then
    create policy "wmp_text_presets_read" on public.wmp_text_presets for select to authenticated
      using ((org_id is null and user_id = auth.uid()) or (org_id is not null and public.wp_is_org_member(org_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wmp_text_presets' and policyname='wmp_text_presets_insert') then
    create policy "wmp_text_presets_insert" on public.wmp_text_presets for insert to authenticated
      with check (created_by = auth.uid() and user_id = auth.uid()
                  and (org_id is null or public.wp_is_org_member(org_id)));
  end if;
  -- Edit / delete: the creator, or an org admin. Never a plain member on a
  -- colleague's preset.
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wmp_text_presets' and policyname='wmp_text_presets_update') then
    create policy "wmp_text_presets_update" on public.wmp_text_presets for update to authenticated
      using (created_by = auth.uid() or (org_id is not null and public.wp_is_org_admin(org_id)))
      with check (created_by = auth.uid() or (org_id is not null and public.wp_is_org_admin(org_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='wmp_text_presets' and policyname='wmp_text_presets_delete') then
    create policy "wmp_text_presets_delete" on public.wmp_text_presets for delete to authenticated
      using (created_by = auth.uid() or (org_id is not null and public.wp_is_org_admin(org_id)));
  end if;
end $$;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop table if exists public.wmp_text_presets;
-- drop function if exists public.wp_is_org_admin(uuid);
-- drop function if exists public.wp_is_org_member(uuid);
-- notify pgrst, 'reload schema';
