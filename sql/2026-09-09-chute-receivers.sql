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
  ('chute_index_2x1100',      '2×1100L bin index',              'chute_receiver', 'equipment', true, false, false,
   array['garbage','recycling'], 1100, 2, 'Dimensions TBC with Wastech'),
  ('chute_carousel_4x1100',   '4×1100L bin carousel',           'chute_receiver', 'equipment', true, false, false,
   array['garbage','recycling'], 1100, 4, 'Dimensions TBC with Wastech'),
  ('chute_comp_1100',         'Compactor + 1100L bin',          'chute_receiver', 'equipment', true, false, false,
   array['garbage'], 1100, 1, 'Compaction ratio and dimensions TBC with Wastech'),
  ('chute_comp_index_2x1100', 'Compactor + 2×1100L index',      'chute_receiver', 'equipment', true, false, false,
   array['garbage'], 1100, 2, 'Compaction ratio and dimensions TBC with Wastech'),
  ('chute_comp_carousel_4x1100','Compactor + 4×1100L carousel', 'chute_receiver', 'equipment', true, false, false,
   array['garbage'], 1100, 4, 'Compaction ratio and dimensions TBC with Wastech')
on conflict (code) do nothing;
