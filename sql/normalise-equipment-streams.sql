-- WastePlanner — normalise equipment.streams to canonical stream ids.
--
-- WHY THIS EXISTS
-- The `streams` column (text[]) has been written in three vocabularies over the
-- life of the table:
--   * canonical ids            'paper'
--   * WS_STREAMS labels        'Paper/Card'
--   * bin calculator names     'Paper & cardboard', 'General waste'
-- Only the first is canonical. Rows carrying the others used to resolve to "serves
-- no calculator stream", which silently REFUSED placement of those items — they
-- appeared in the picker and clicking the plan did nothing.
--
-- index.html now resolves all three at read time (wsStreamId), so the app works
-- against the data as it stands. This script is HYGIENE: it makes the stored data
-- match what the admin equipment editor writes from now on.
--
-- Idempotent — re-running is a no-op. Values it cannot resolve are left UNTOUCHED
-- rather than dropped, so nothing is lost silently.
--
-- Element order is sorted. That is safe: wsEquipAllowedStreams filters by
-- membership, and the assigned stream comes from WS_STREAMS order, never the
-- stored order.

-- ── 1. DRY RUN — check this output before running step 2 ────────────────────
with stream_alias(k, id) as (values
  ('garbage','garbage'),('recycling','recycling'),('fogo','fogo'),
  ('glass','glass'),('paper','paper'),('soft','soft'),('equip','equip'),
  ('papercard','paper'),('softplastics','soft'),
  ('gw','garbage'),('generalwaste','garbage'),('general','garbage'),
  ('residual','garbage'),('mixedwaste','garbage'),('putrescible','garbage'),
  ('cr','recycling'),('commingledrecycling','recycling'),('commingled','recycling'),
  ('comingled','recycling'),('recyclables','recycling'),('mixedrecycling','recycling'),
  ('foodorganics','fogo'),('gardenorganics','fogo'),('foodandgardenorganics','fogo'),
  ('organics','fogo'),('foodwaste','fogo'),('greenwaste','fogo'),
  ('card','paper'),('cardboard','paper'),('paperandcardboard','paper'),
  ('cardboardandpaper','paper'),('softplastic','soft'),
  ('equipment','equip'),('plant','equip')
)
select e.code, e.item_kind, e.streams as before,
       array_agg(distinct coalesce(a.id, s.raw) order by coalesce(a.id, s.raw)) as after
from public.equipment e
cross join lateral unnest(e.streams) as s(raw)
left join stream_alias a
  on a.k = regexp_replace(lower(replace(s.raw, '&', ' and ')), '[^a-z0-9]+', '', 'g')
where e.streams is not null and cardinality(e.streams) > 0
group by e.id, e.code, e.item_kind, e.streams
order by e.code;

-- Expected (as at 2026-08-24):
--   4500l_front_lift_bin  {"General waste","Commingled recycling"} -> {garbage,recycling}
--   bale_storage          {"Paper & cardboard"}                    -> {paper}
--   baler                 {"Paper & cardboard"}                    -> {paper}
--
-- If `after` still contains a free-text value, STOP. That value needs a decision,
-- not a guess — add it to the alias list deliberately, and mirror the addition in
-- WS_STREAM_ALIAS in index.html so the app and the data agree.

-- ── 2. APPLY — should report UPDATE 3 ──────────────────────────────────────
with stream_alias(k, id) as (values
  ('garbage','garbage'),('recycling','recycling'),('fogo','fogo'),
  ('glass','glass'),('paper','paper'),('soft','soft'),('equip','equip'),
  ('papercard','paper'),('softplastics','soft'),
  ('gw','garbage'),('generalwaste','garbage'),('general','garbage'),
  ('residual','garbage'),('mixedwaste','garbage'),('putrescible','garbage'),
  ('cr','recycling'),('commingledrecycling','recycling'),('commingled','recycling'),
  ('comingled','recycling'),('recyclables','recycling'),('mixedrecycling','recycling'),
  ('foodorganics','fogo'),('gardenorganics','fogo'),('foodandgardenorganics','fogo'),
  ('organics','fogo'),('foodwaste','fogo'),('greenwaste','fogo'),
  ('card','paper'),('cardboard','paper'),('paperandcardboard','paper'),
  ('cardboardandpaper','paper'),('softplastic','soft'),
  ('equipment','equip'),('plant','equip')
),
fixed as (
  select e.id as eq_id,
         array_agg(distinct coalesce(a.id, s.raw) order by coalesce(a.id, s.raw)) as streams
  from public.equipment e
  cross join lateral unnest(e.streams) as s(raw)
  left join stream_alias a
    on a.k = regexp_replace(lower(replace(s.raw, '&', ' and ')), '[^a-z0-9]+', '', 'g')
  where e.streams is not null and cardinality(e.streams) > 0
  group by e.id
)
update public.equipment e
set streams = f.streams
from fixed f
where e.id = f.eq_id
  and e.streams is distinct from f.streams;

-- ── 3. VERIFY ──────────────────────────────────────────────────────────────
select code, item_kind, streams
from public.equipment
where streams is not null and cardinality(streams) > 0
order by code;
