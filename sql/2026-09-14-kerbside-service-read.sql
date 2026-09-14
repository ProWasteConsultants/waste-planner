-- WastePlanner — every signed-in user's calculator reads the council
-- kerbside service.
--
-- The Kerbside collection service grid (Admin › Council & state database)
-- stores one JSON row per council in waste_meta (field_key
-- 'kerbside_schedule'). The Bin Calculator reads it for EVERY signed-in
-- user — not just staff — because that is who runs kerbside projects.
-- waste_meta also holds council officer contacts, which must NOT open up
-- with it, so this is a PERMISSIVE policy scoped to the one field_key:
-- it adds read access to that row and nothing else, whatever the table's
-- other policies say. (If RLS is not enabled on waste_meta at all, this
-- changes nothing and does no harm.)
--
-- Symptom without it: a non-staff user selects a kerbside method and the
-- Collection line reads "no kerbside service recorded … 0 councils
-- loaded" while an admin sees the service fine.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

grant select on public.waste_meta to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'waste_meta'
                   and policyname = 'waste_meta_kerbside_service_read') then
    create policy "waste_meta_kerbside_service_read" on public.waste_meta
      for select to anon, authenticated
      using (field_key = 'kerbside_schedule');
  end if;
end $$;

-- The councils registry backs the value → label match; it is already read
-- by every council picker in the app, restated here so a fresh project has
-- both halves.
grant select on public.councils to anon, authenticated;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop policy if exists "waste_meta_kerbside_service_read" on public.waste_meta;
-- notify pgrst, 'reload schema';
