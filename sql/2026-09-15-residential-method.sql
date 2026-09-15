-- WastePlanner — every signed-in user's calculator reads the council
-- RESIDENTIAL METHOD.
--
-- Most councils publish a residential generation rate and the rate tables
-- already serve them. Some publish a stepped bin-provision TABLE instead
-- (dwelling-count bands fixing bin counts and sizes per stream, e.g.
-- Northern Beaches Appendix A). Which shape a council uses is stored per
-- council in waste_meta (field_key 'residential_method'), entered and
-- reviewed in Admin › Council & state database › Residential method.
--
-- The Bin Calculator reads it for EVERY signed-in user — not just staff —
-- for the same reason it reads the kerbside service: that is who runs the
-- projects. waste_meta also holds council officer contacts, which must NOT
-- open up with it, so this is a PERMISSIVE policy scoped to the one
-- field_key: it adds read access to that row and nothing else, whatever the
-- table's other policies say. (If RLS is not enabled on waste_meta at all,
-- this changes nothing and does no harm.)
--
-- The review gate is in the DATA, not in this policy: a row is served only
-- when its JSON carries "status":"live", which a person sets in the admin
-- panel after checking the bands against the council's document. Extraction
-- only ever writes "status":"draft". Reading a draft is harmless — the
-- calculator ignores it and the admin panel is where it is meant to be seen.
--
-- Symptom without it: a non-staff user selects a stepped-table council and
-- the calculator silently falls back to generation rates (or to the state
-- row), reporting "no council-specific method found" while an admin sees the
-- method fine.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

grant select on public.waste_meta to anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'waste_meta'
                   and policyname = 'waste_meta_residential_method_read') then
    create policy "waste_meta_residential_method_read" on public.waste_meta
      for select to anon, authenticated
      using (field_key = 'residential_method');
  end if;
end $$;

-- The councils registry backs the value → label match, exactly as it does
-- for the kerbside service; restated here so a fresh project has both halves.
grant select on public.councils to anon, authenticated;

notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- drop policy if exists "waste_meta_residential_method_read" on public.waste_meta;
-- notify pgrst, 'reload schema';
