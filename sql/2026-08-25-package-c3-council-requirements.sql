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

-- The FK column must match council_guidelines' primary-key type exactly, so
-- the type is read, not assumed.
do $$
declare pk_type text;
begin
  select format_type(a.atttypid, a.atttypmod) into pk_type
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = 'public.council_guidelines'::regclass and i.indisprimary;

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
select column_name, data_type from information_schema.columns
where table_name = 'council_requirements' order by ordinal_position;
