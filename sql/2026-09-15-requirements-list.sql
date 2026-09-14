-- WastePlanner — the Requirements REVIEW QUEUE becomes a persistent,
-- always-editable Requirements LIST per council.
--
-- WHY
-- Rows used to arrive as 'proposed' and sat in a queue until each was
-- approved by hand. Nobody has time to approve 75 rows one by one, and the
-- queue hid what was actually in effect. Now every row in the list IS the
-- live data: extraction writes straight into it (append-only — it never
-- deletes or overwrites an existing row, so a requirement typed in from a
-- conversation with council survives every future extraction), and any row
-- can be added, edited inline or removed at any time with no approval step.
--
-- WHAT CHANGES IN THE DATA (no restructure)
-- * status keeps its column and its read policy: 'approved' now means "in
--   the list — live" (the anon/authenticated read policy already keys on it,
--   so every consumer keeps working unchanged); 'rejected' means "removed
--   from the list" (kept for audit, never served). 'proposed' is retired.
-- * Every existing 'proposed' row is promoted into the list — the queue is
--   not thrown away, it becomes visible and editable.
-- * source: where a row came from — 'extraction' (AI, from a document
--   version) or 'manual' (typed in). The list groups and filters on it, and
--   duplicate flagging is client-side, so nothing else is needed.
--
-- Idempotent — re-running is a no-op. Run AFTER package-c3.

alter table public.council_requirements
  add column if not exists source text not null default 'extraction'
    check (source in ('extraction','manual'));

update public.council_requirements set status = 'approved' where status = 'proposed';

create index if not exists council_requirements_source_idx
  on public.council_requirements (council_guideline_id, source) where status = 'approved';

notify pgrst, 'reload schema';

-- ── VERIFY ──────────────────────────────────────────────────────────────────
-- Expect: no 'proposed' rows remain, and every row has a source.
select status, source, count(*) from public.council_requirements group by 1, 2 order by 1, 2;
