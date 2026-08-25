-- WastePlanner — Package C3: structured council requirements + review queue.
--
-- WHY THIS EXISTS
-- Guideline PDFs are AI-scanned into candidate requirement rows, but nothing
-- machine-usable exists until a human approves each row. This table holds the
-- pipeline: rows arrive as 'proposed', every one pinned to the exact guideline
-- version (council_guideline_id) and carrying a clause_ref so the reviewer can
-- verify it against the source PDF. Only status='approved' rows are ever
-- consumed by any tool; extraction confidence is not approval.
--
-- Streams are CANONICAL ids only (garbage/recycling/fogo/glass/paper/soft) —
-- synonyms resolve at extraction, and a row whose stream cannot be resolved is
-- inserted as 'rejected', never guessed.
--
-- Idempotent — re-running is a no-op.
-- Run AFTER package-c1 (it references council_guidelines.id).

-- ── 0. council_guidelines must expose an `id` primary key ───────────────────
-- The live table's PK column may not be named `id` (e.g. the profiles-style
-- `uuid`, or the original `council_key`). The app reads `id` by name, and C1
-- versioning needs a surrogate key — one row PER VERSION means council_key can
-- no longer be the PK. Discover the actual PK and normalise, never assume.
do $$
declare pk_cols text[]; pk_name text;
begin
  -- already has an id column → nothing to do
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'council_guidelines'
               and column_name = 'id') then
    return;
  end if;

  select array_agg(a.attname::text order by k.ord) into pk_cols
  from pg_index i
  join lateral unnest(i.indkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
  where i.indrelid = 'public.council_guidelines'::regclass and i.indisprimary;

  -- profiles-style: a single uuid PK column named "uuid" → rename in place
  if pk_cols = array['uuid'] then
    alter table public.council_guidelines rename column "uuid" to id;
    return;
  end if;

  -- otherwise add a surrogate uuid id and promote it to the primary key.
  -- The old PK column (e.g. council_key) keeps its data; uniqueness of
  -- (council_key, version) is already enforced by C1's unique index.
  alter table public.council_guidelines
    add column id uuid not null default gen_random_uuid();

  select conname into pk_name from pg_constraint
  where conrelid = 'public.council_guidelines'::regclass and contype = 'p';
  if pk_name is not null then
    execute format('alter table public.council_guidelines drop constraint %I', pk_name);
  end if;

  alter table public.council_guidelines add primary key (id);
end $$;

-- The FK column must match council_guidelines.id's type exactly, so the type
-- is read, not assumed.
do $$
declare pk_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into pk_type
  from pg_attribute a
  where a.attrelid = 'public.council_guidelines'::regclass
    and a.attname = 'id' and not a.attisdropped;

  execute format($ct$
    create table if not exists public.council_requirements (
      id uuid primary key default gen_random_uuid(),
      council_guideline_id %s not null references public.council_guidelines(id) on delete restrict,
      requirement_type text not null check (requirement_type in
        ('generation_rate','room_dimension','aisle_width','chute_spec',
         'collection_limit','equipment_rule','stream_split','other')),
      use_class  text,
      stream     text check (stream is null or stream in
        ('garbage','recycling','fogo','glass','paper','soft')),
      value_num  numeric,
      unit       text,
      value_text text,
      clause_ref text not null,
      status     text not null default 'proposed'
                 check (status in ('proposed','approved','rejected')),
      reviewed_by uuid,
      reviewed_at timestamptz,
      created_at  timestamptz not null default now()
    )
  $ct$, pk_type);
end $$;

create index if not exists council_requirements_doc_status_idx
  on public.council_requirements (council_guideline_id, status);
create index if not exists council_requirements_type_idx
  on public.council_requirements (requirement_type) where status = 'approved';

-- ── RLS: everyone reads APPROVED rows; staff see and write everything ───────
alter table public.council_requirements enable row level security;

drop policy if exists "creq_approved_read" on public.council_requirements;
create policy "creq_approved_read" on public.council_requirements
  for select to anon, authenticated
  using (status = 'approved');

drop policy if exists "creq_staff_all" on public.council_requirements;
create policy "creq_staff_all" on public.council_requirements
  for all to authenticated
  using (exists (select 1 from public.profiles p
                 where p.uuid = auth.uid() and p.is_staff = true))
  with check (exists (select 1 from public.profiles p
                      where p.uuid = auth.uid() and p.is_staff = true));

-- ── GRANTs (RLS filters rows; it does not confer table privileges) ──────────
grant select on public.council_requirements to anon;
grant select, insert, update, delete on public.council_requirements to authenticated;

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: council_guidelines PK is now (id), and council_requirements exists.
select conname, pg_get_constraintdef(oid) from pg_constraint
where conrelid = 'public.council_guidelines'::regclass and contype = 'p';
select column_name, data_type from information_schema.columns
where table_name = 'council_requirements' order by ordinal_position;
