-- WastePlanner — Library-driven bin sizes for the Bin Calculator.
--
-- The calculator's bin-size dropdown used to be a constant compiled into the
-- page; a 140L bin added to the equipment library for one council never
-- appeared. From this migration the library IS the bin list (item_kind
-- 'Bin', capacity_l > 0), and two flags shape how the calculator offers it:
--
--   is_common           The short default list every dropdown shows first
--                       ("Bins"). Everything else sits under "More sizes",
--                       still selectable, never cluttering the default.
--   collection_methods  Which collection methods may use this record —
--                       any of kerbside_individual, kerbside_shared, bulk,
--                       self_haul. EMPTY = no restriction beyond the method's
--                       own size rule (kerbside methods top out at 360L).
--                       A front-lift bin tagged {bulk} is simply not offered
--                       under a kerbside method.
--
-- The hard-coded sizes stay in the calculator as the OFFLINE FALLBACK only
-- (same contract as WS_VEH for vehicles): with no library reachable the tool
-- still works; with a library it is never consulted.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

alter table public.equipment
  add column if not exists is_common boolean not null default false;

alter table public.equipment
  add column if not exists collection_methods text[] not null default '{}';

-- Seed the "common" flag from what the dropdown showed before this change,
-- so day one looks the same as yesterday. Only when nothing is flagged yet —
-- a library that has already been curated is left alone.
update public.equipment
   set is_common = true
 where lower(coalesce(item_kind, 'Bin')) = 'bin'
   and capacity_l in (120, 240, 360, 660, 1100)
   and coalesce(active, true)
   and not exists (select 1 from public.equipment where is_common);

-- No new tables, so no new GRANTs: the columns ride the existing equipment
-- grants (anon/authenticated SELECT for the calculator, staff writes via the
-- admin table).

-- PostgREST caches schema — reload so the columns are served immediately.
notify pgrst, 'reload schema';

-- ── ROLLBACK ─────────────────────────────────────────────────────────────
-- alter table public.equipment drop column if exists collection_methods;
-- alter table public.equipment drop column if exists is_common;
-- notify pgrst, 'reload schema';
