-- Chute receivers as first-class equipment (chute package).
--
-- Receivers (what sits beneath a chute opening) become library records in a
-- new `chute_receiver` category, so footprints/heights are editable in Admin
-- without code changes and the Dev Summary receiver dropdown reads from the
-- library. Built-in RECV geometry stays in the app as the offline fallback,
-- same pattern as the vehicle library.
--
-- Columns: the table already has width_mm/depth_mm/height_mm, capacity_l,
-- compaction_ratio, streams and the `receiver` flag (reconcile invariant B).
-- Added here: inlet height (chute-angle geometry reads it), bin size/count
-- (index/carousel physically contain bins), power, and an active flag so
-- supplier-TBC placeholders can be seeded without appearing in pickers.

alter table equipment add column if not exists inlet_height_mm integer;
alter table equipment add column if not exists bin_size_l     integer;
alter table equipment add column if not exists bin_count      integer;
alter table equipment add column if not exists power_required text;
alter table equipment add column if not exists active         boolean default true;
alter table equipment add column if not exists notes          text;
-- the seed below upserts by code; make sure that key exists
create unique index if not exists equipment_code_key on equipment (code);

-- The table carries CHECK constraints whose allowed lists predate this
-- package (the first run failed on equipment_category_check). Rebuild any
-- check mentioning category or item_kind from the values ACTUALLY stored
-- plus the known sets — every existing row stays valid whatever vocabulary
-- it uses, and the new values become legal. Idempotent: a list that already
-- allows the new value is left alone.
do $$
declare
  rec record;
  vals text;
begin
  for rec in
    select conname, pg_get_constraintdef(oid) as def
      from pg_constraint
     where conrelid = 'public.equipment'::regclass and contype = 'c'
  loop
    if rec.def like '%category%' and rec.def not like '%chute_receiver%' then
      select coalesce(string_agg(distinct quote_literal(category), ', ') || ', ', '')
        into vals from public.equipment where category is not null;
      execute format('alter table public.equipment drop constraint %I', rec.conname);
      execute format(
        'alter table public.equipment add constraint %I check (category is null or category in (%s))',
        rec.conname,
        vals || '''bin'', ''compactor'', ''chute'', ''chute_receiver'', ''carousel'', ''other''');
    elsif rec.def like '%item_kind%' and rec.def not like '%Equipment%' then
      select coalesce(string_agg(distinct quote_literal(item_kind), ', ') || ', ', '')
        into vals from public.equipment where item_kind is not null;
      execute format('alter table public.equipment drop constraint %I', rec.conname);
      execute format(
        'alter table public.equipment add constraint %I check (item_kind is null or item_kind in (%s))',
        rec.conname,
        vals || '''Bin'', ''Equipment'', ''Fixture''');
    end if;
  end loop;
end $$;

-- Existing rows that ARE receivers: reclassify, keep everything else intact.
update equipment set category = 'chute_receiver', receiver = true,
                     bin_size_l = 1100, bin_count = 1
 where code = '1100l_bin_beneath_chute';

-- Placeholders for the Wastech units (no records exist yet): active=false and
-- dimensions null where unconfirmed, so nothing is guessed on a drawing —
-- Lachy confirms dimensions with the supplier and flips them active in Admin.
-- Compaction ratios are deliberately NULL, never fabricated (see CLAUDE.md):
-- the calculator shows "ratio required" until the real figure is entered.
-- Streams: anything containing a compactor is GENERAL WASTE ONLY.
insert into equipment (code, label, category, item_kind, receiver, collectable, active,
                       streams, bin_size_l, bin_count, notes)
values
  ('chute_index_2x1100',      '2×1100L bin index',              'chute_receiver', 'Equipment', true, false, false,
   array['garbage','recycling'], 1100, 2, 'Dimensions TBC with Wastech'),
  ('chute_carousel_4x1100',   '4×1100L bin carousel',           'chute_receiver', 'Equipment', true, false, false,
   array['garbage','recycling'], 1100, 4, 'Dimensions TBC with Wastech'),
  ('chute_comp_1100',         'Compactor + 1100L bin',          'chute_receiver', 'Equipment', true, false, false,
   array['garbage'], 1100, 1, 'Compaction ratio and dimensions TBC with Wastech'),
  ('chute_comp_index_2x1100', 'Compactor + 2×1100L index',      'chute_receiver', 'Equipment', true, false, false,
   array['garbage'], 1100, 2, 'Compaction ratio and dimensions TBC with Wastech'),
  ('chute_comp_carousel_4x1100','Compactor + 4×1100L carousel', 'chute_receiver', 'Equipment', true, false, false,
   array['garbage'], 1100, 4, 'Compaction ratio and dimensions TBC with Wastech')
on conflict (code) do nothing;
