-- WastePlanner — Package C2: storage policies for bulk guideline PDF uploads.
--
-- WHY THIS EXISTS
-- Guideline PDFs upload into the EXISTING 'project-plans' bucket under a
-- 'guidelines/<council_key>/...' prefix. Every existing path in that bucket is
-- '<auth.uid()>/...' and its policies are keyed on that first folder, so the
-- new prefix needs its own policies:
--   * any signed-in user may READ them (the checker cites them; consultants
--     open the source PDF to verify a clause);
--   * only staff may WRITE them (same admin gate the app uses:
--     profiles.is_staff).
-- Nothing here touches the per-user project paths or their policies.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

drop policy if exists "guidelines_read" on storage.objects;
create policy "guidelines_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-plans'
         and (storage.foldername(name))[1] = 'guidelines');

drop policy if exists "guidelines_admin_insert" on storage.objects;
create policy "guidelines_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans'
              and (storage.foldername(name))[1] = 'guidelines'
              and exists (select 1 from public.profiles p
                          where p.uuid = auth.uid() and p.is_staff = true));

-- Guideline PDFs are never overwritten or deleted (C1 versioning applies to
-- the files too) — deliberately NO update or delete policy for the prefix.

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select polname, polcmd from pg_policy
where polrelid = 'storage.objects'::regclass and polname like 'guidelines%';
