-- WastePlanner — storage policies for cached guideline thumbnails.
--
-- WHY THIS EXISTS
-- The compliance checker's guideline source card shows a page-1 thumbnail of
-- the council guideline PDF. It is rendered ONCE and cached as a PNG under
-- 'guideline-thumbs/<guideline_id>.png' in the existing 'project-plans'
-- bucket, so it is never re-rendered per visit. The guidelines/ prefix itself
-- is staff-insert-only (C2) and stays that way — thumbs get their own prefix
-- because any signed-in user may generate one (they are derived renders of a
-- document every signed-in user can already read, nothing more).
--
-- Without the insert policy the app still works: the render falls back to the
-- per-device IndexedDB cache, and only staff sessions populate the shared one.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

drop policy if exists "guideline_thumbs_read" on storage.objects;
create policy "guideline_thumbs_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'project-plans'
         and (storage.foldername(name))[1] = 'guideline-thumbs');

drop policy if exists "guideline_thumbs_insert" on storage.objects;
create policy "guideline_thumbs_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans'
              and (storage.foldername(name))[1] = 'guideline-thumbs');

-- Thumbs are immutable: a new guideline version has a new id, hence a new
-- path — deliberately NO update or delete policy.

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select polname, polcmd from pg_policy
where polrelid = 'storage.objects'::regclass and polname like 'guideline_thumbs%';
