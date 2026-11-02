-- WastePlanner — several guideline documents per council (or state).
--
-- WHY
-- A council can publish a DCP chapter AND a waste guide, separate residential
-- and commercial documents, an appendix, a checklist. The library used to
-- hold ONE current document per council: every upload became the next
-- version and superseded the last, so a second document replaced the first
-- and only the newest could be extracted.
--
-- WHAT
-- * council_guidelines gains a DOCUMENT identity inside the council:
--     doc_slot   — which document this row is a version of ('main' for every
--                  existing row, so nothing that exists changes);
--     doc_title  — its name ("DCP Part B3", "Waste Management Guide");
--     doc_kind   — guideline · dcp · appendix · checklist · reference;
--     applies_to — all · residential · commercial.
--   Versions now number and supersede PER DOCUMENT: (council_key, doc_slot,
--   version) is unique, and a new version of one document leaves the
--   council's other documents current.
-- * com_rates / res_rates gain source_doc ('<council_key>#<doc_slot>'): the
--   document an extracted rate came from. A re-read of one document can then
--   remove only ITS OWN rates — never a rate another document gave.
--
-- The app works before this runs (one document per council, as before) and
-- says so in the library. Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres, AFTER package-c1.

alter table public.council_guidelines
  add column if not exists doc_slot   text not null default 'main',
  add column if not exists doc_title  text,
  add column if not exists doc_kind   text not null default 'guideline',
  add column if not exists applies_to text not null default 'all';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'council_guidelines_doc_kind_chk') then
    alter table public.council_guidelines add constraint council_guidelines_doc_kind_chk
      check (doc_kind in ('guideline','dcp','appendix','checklist','reference'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'council_guidelines_applies_to_chk') then
    alter table public.council_guidelines add constraint council_guidelines_applies_to_chk
      check (applies_to in ('all','residential','commercial'));
  end if;
end $$;

-- versions are per DOCUMENT now
drop index if exists public.council_guidelines_key_version_uidx;
create unique index if not exists council_guidelines_key_slot_version_uidx
  on public.council_guidelines (council_key, doc_slot, version);

drop index if exists public.council_guidelines_live_idx;
create index if not exists council_guidelines_live_idx
  on public.council_guidelines (council_key, doc_slot)
  where superseded_at is null;

-- where an extracted rate came from
alter table public.com_rates add column if not exists source_doc text;
alter table public.res_rates add column if not exists source_doc text;

notify pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: every existing row on doc_slot 'main', one live row per document.
select council_key, doc_slot, count(*) filter (where superseded_at is null) as live_rows, max(version) as latest
from public.council_guidelines group by 1, 2 order by 1, 2;
