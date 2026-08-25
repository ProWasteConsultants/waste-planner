-- WastePlanner — Package C6: equipment spec-sheet proposals (staging).
--
-- WHY THIS EXISTS
-- Bulk-uploaded manufacturer spec sheets are AI-extracted into PROPOSALS, not
-- into the live equipment table. A human approves each proposal (with an
-- editable, permanent snake_case code) before anything is inserted into
-- `equipment`. Mirrors the C3 review-queue pattern.
--
-- DELIBERATE OMISSIONS — these columns do not exist here, so a proposal can
-- never carry them: streams, pairing_type, output_equipment_id, receiver,
-- collectable. They are design decisions, not spec-sheet facts, and are set
-- manually in the equipment admin AFTER approval.
--
-- The category check is COPIED from the live equipment_category_check
-- constraint at migration time — read, never invented. If that constraint is
-- ever changed, re-run this migration to re-sync (it re-applies the copy).
--
-- Idempotent — re-running is a no-op (the category check re-syncs).
-- Run in the Supabase SQL editor as postgres.

create table if not exists public.equipment_proposals (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,          -- the spec-sheet PDF this came from
  source_ref  text,                   -- where in the document, e.g. "dimensions table p.2"
  label       text not null,
  category    text,                   -- constrained below by the COPIED equipment check
  item_kind   text,                   -- 'Bin' | 'Equipment' (the loader's vocabulary)
  capacity_l  numeric,
  width_mm    integer,
  depth_mm    integer,
  height_mm   integer,
  footprint_m2 numeric,
  footprint_computed boolean not null default false,   -- true when derived from W×D, not stated
  compaction_ratio numeric,
  supplier_type text,
  company     text,
  website     text,
  phone       text,
  proposed_code text,                 -- editable before insert; permanent once approved
  status      text not null default 'proposed'
              check (status in ('proposed','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Copy the live equipment category constraint onto proposals.category.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def
  from pg_constraint
  where conrelid = 'public.equipment'::regclass
    and conname = 'equipment_category_check';
  if def is null then
    raise notice 'equipment_category_check not found — proposals.category left unconstrained';
    return;
  end if;
  if exists (select 1 from pg_constraint
             where conrelid = 'public.equipment_proposals'::regclass
               and conname = 'equipment_proposals_category_check') then
    alter table public.equipment_proposals drop constraint equipment_proposals_category_check;
  end if;
  -- category may be null on a proposal (reviewer assigns), so the copied
  -- check is wrapped to allow null
  execute format(
    'alter table public.equipment_proposals add constraint equipment_proposals_category_check check (category is null or %s)',
    regexp_replace(def, '^CHECK\s*\((.*)\)$', '\1'));
end $$;

create index if not exists equipment_proposals_status_idx
  on public.equipment_proposals (status, created_at);

-- ── RLS: staff-only, both directions — proposals feed an admin workflow and
-- nothing else ever reads them ───────────────────────────────────────────────
alter table public.equipment_proposals enable row level security;

drop policy if exists "eqp_staff_all" on public.equipment_proposals;
create policy "eqp_staff_all" on public.equipment_proposals
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.uuid = auth.uid() and p.is_staff = true))
  with check (exists (select 1 from public.profiles p
                      where p.uuid = auth.uid() and p.is_staff = true));

-- ── GRANTs (RLS filters rows; it does not confer table privileges) ──────────
grant select, insert, update, delete on public.equipment_proposals to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.equipment_proposals'::regclass and contype = 'c';
