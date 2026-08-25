-- WastePlanner — Package C1: council_guidelines versioning.
--
-- WHY THIS EXISTS
-- The guidelines library used to hold ONE row per council, overwritten on each
-- upload (upsert on council_key). A compliance check or WMP could therefore
-- never say which document version it ran against, and an upload silently
-- destroyed the previous extraction. From C1 on:
--   * a new upload for an existing council is a NEW ROW with version = max+1;
--   * the old row gets superseded_at (never overwritten, never deleted);
--   * every consumer reads the latest non-superseded row;
--   * checks and WMP snapshots record the guideline id + version they used.
--
-- The old free-text `version` column (values like '2023') is PRESERVED as
-- `version_label`; the new integer `version` is an upload sequence per council
-- (1, 2, 3…) so "latest" is well-defined even when documents carry no year.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

-- ── 1. version: rename the free-text column, add the integer sequence ───────
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_name = 'council_guidelines' and column_name = 'version'
               and data_type <> 'integer') then
    alter table public.council_guidelines rename column version to version_label;
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_name = 'council_guidelines' and column_name = 'version') then
    alter table public.council_guidelines add column version integer not null default 1;
  end if;
end $$;

-- ── 2. the new lifecycle + provenance columns ───────────────────────────────
alter table public.council_guidelines
  add column if not exists effective_date date,
  add column if not exists superseded_at  timestamptz,
  add column if not exists source_url     text,
  add column if not exists uploaded_by    uuid,
  add column if not exists notes          text;

-- ── 3. council_key alone is no longer unique — (council_key, version) is ────
-- Drop whatever unique constraint/index enforces one-row-per-council; the
-- name is discovered, not assumed.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.council_guidelines'::regclass and contype = 'u'
      and (select array_agg(a.attname::text order by a.attname)
           from unnest(conkey) k
           join pg_attribute a on a.attrelid = conrelid and a.attnum = k) = array['council_key']
  loop
    execute format('alter table public.council_guidelines drop constraint %I', c.conname);
  end loop;
end $$;
drop index if exists council_guidelines_council_key_key;

create unique index if not exists council_guidelines_key_version_uidx
  on public.council_guidelines (council_key, version);

-- The hot query: latest live document per council.
create index if not exists council_guidelines_live_idx
  on public.council_guidelines (council_key)
  where superseded_at is null;

-- ── 4. GRANTs (RLS filters rows; it does not confer table privileges) ───────
grant select, insert, update, delete on public.council_guidelines to anon, authenticated;

-- ── 5. VERIFY ───────────────────────────────────────────────────────────────
-- Expect: every council exactly one live (superseded_at is null) row, version 1.
select council_key, count(*) filter (where superseded_at is null) as live_rows,
       max(version) as latest_version
from public.council_guidelines
group by council_key
order by council_key;
