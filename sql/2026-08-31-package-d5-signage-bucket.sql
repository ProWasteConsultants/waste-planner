-- WastePlanner — Package D5: the 'signage' bucket and its read policy.
--
-- WHY THIS EXISTS
-- Bin-room signage is an APP-LEVEL asset: one generic sign per waste stream,
-- uploaded once (not per project), attached to WMPs as an appendix. It lives
-- in its own Supabase Storage bucket, 'signage', versioned under a v1/ prefix
-- so a future pack goes to v2/ and switches with one constant instead of
-- overwriting files that issued WMPs point at.
--
-- THE TRAP THIS FILE CLOSES: a new bucket has NO read policy by default. The
-- bucket will exist, uploads will succeed, and every fetch will 404 until a
-- read policy is added — the same class of failure as a new table without a
-- GRANT. Run this before uploading the sign set.
--
-- FILENAME CONTRACT (enforced by the app, stated here for whoever uploads):
-- one PDF per sign, named for the CANONICAL STREAM ID — the same enum the
-- whole app uses (wsStreamId / council_requirements.stream):
--
--   signage/v1/garbage.pdf
--   signage/v1/recycling.pdf
--   signage/v1/fogo.pdf
--   signage/v1/glass.pdf
--   signage/v1/paper.pdf
--   signage/v1/soft.pdf
--   signage/v1/room.pdf      (optional general bin-room sign, attached when present)
--
-- Do NOT hand-name files ('commingled.pdf', 'general-waste.pdf'): the lookup
-- derives the filename from the stream enum, so a hand-named file is silently
-- never found and the appendix comes out short with no error.
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

insert into storage.buckets (id, name, public)
values ('signage', 'signage', true)
on conflict (id) do nothing;

-- Public read: the signs are generic per-stream artwork with no project data,
-- and the WMP assembler fetches them without caring who is signed in.
drop policy if exists "signage_public_read" on storage.objects;
create policy "signage_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'signage');

-- Only staff upload or replace the pack.
drop policy if exists "signage_admin_insert" on storage.objects;
create policy "signage_admin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'signage'
              and exists (select 1 from public.profiles p
                          where p.uuid = auth.uid() and p.is_staff = true));

drop policy if exists "signage_admin_update" on storage.objects;
create policy "signage_admin_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'signage'
         and exists (select 1 from public.profiles p
                     where p.uuid = auth.uid() and p.is_staff = true));

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select id, public from storage.buckets where id = 'signage';
select polname, polcmd from pg_policy
where polrelid = 'storage.objects'::regclass and polname like 'signage%';
