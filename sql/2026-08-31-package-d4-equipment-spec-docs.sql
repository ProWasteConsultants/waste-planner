-- WastePlanner — Package D4: store equipment spec-sheet SOURCE DOCUMENTS.
--
-- WHY THIS EXISTS
-- The C6 bulk upload extracted field values from manufacturer spec sheets but
-- kept only the FILENAME (equipment_proposals.source_file). The PDF itself was
-- never stored, which makes "append the equipment's specification document to
-- the WMP as an appendix" (D4 producer 2) impossible for anything uploaded so
-- far. This migration adds the storage step:
--   * equipment_proposals.source_path — where the uploaded spec PDF lives in
--     the 'project-plans' bucket ('equipment-specs/...' prefix);
--   * equipment.spec_doc_path — carried onto the library row at approval, so
--     the WMP appendix producer can fetch the document for any placed item.
-- Rows that predate this migration have NULL paths and are skipped silently by
-- the appendix producer — never errored.
--
-- Storage policies mirror the C2 guidelines prefix exactly: any signed-in user
-- may read (the WMP assembler downloads them), only staff may write (same
-- admin gate as the equipment tab).
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

alter table public.equipment_proposals add column if not exists source_path text;
alter table public.equipment add column if not exists spec_doc_path text;

drop policy if exists "equipment_specs_read" on storage.objects;
create policy "equipment_specs_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-plans'
         and (storage.foldername(name))[1] = 'equipment-specs');

drop policy if exists "equipment_specs_admin_insert" on storage.objects;
create policy "equipment_specs_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans'
              and (storage.foldername(name))[1] = 'equipment-specs'
              and exists (select 1 from public.profiles p
                          where p.uuid = auth.uid() and p.is_staff = true));

-- Spec sheets are never overwritten or deleted once a WMP may cite them —
-- deliberately NO update or delete policy for the prefix.

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select polname, polcmd from pg_policy
where polrelid = 'storage.objects'::regclass and polname like 'equipment_specs%';
select column_name from information_schema.columns
where table_name in ('equipment', 'equipment_proposals')
  and column_name in ('spec_doc_path', 'source_path');
