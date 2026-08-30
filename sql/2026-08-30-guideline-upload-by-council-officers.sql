-- WastePlanner — OPTIONAL: let non-staff accounts store guideline PDFs.
--
-- WHY THIS EXISTS
-- The compliance checker's "Upload Council WMP Guidelines / Checklist" row now
-- stores the PDF itself in the shared library (bucket prefix 'guidelines/'),
-- not just extracted text in one browser. But C2's storage policy allows
-- INSERT into that prefix for STAFF ONLY:
--
--   guidelines_admin_insert ... and exists (select 1 from public.profiles p
--                                           where p.uuid = auth.uid()
--                                             and p.is_staff = true)
--
-- So for a council officer or a consultant, that upload is refused by RLS and
-- the checker falls back to "used for this scan only". That is correct
-- behaviour for the policy as written — the question is whether the policy is
-- what you want.
--
-- RUN THIS ONLY IF you want council officers (and other signed-in users) to be
-- able to add guideline documents themselves. It is a deliberate widening:
--
--   * any signed-in user could add a PDF under guidelines/<council_key>/;
--   * nothing they upload is CONSUMED by any tool until its requirements are
--     extracted and a staff reviewer approves them (C3), so the blast radius
--     is a document appearing in the library and in the checker's viewer;
--   * versions are never overwritten or deleted (C1), so a bad upload is
--     superseded, not destructive.
--
-- If you would rather keep uploads staff-only, do NOT run this — the app
-- already tells the user plainly when an upload could not be stored.
--
-- Idempotent — re-running is a no-op.

drop policy if exists "guidelines_user_insert" on storage.objects;
create policy "guidelines_user_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'project-plans'
              and (storage.foldername(name))[1] = 'guidelines');

-- The staff-only policy stays in place; PostgreSQL permits the action when
-- EITHER policy passes, so staff keep their existing route.

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select polname, polcmd from pg_policy
where polrelid = 'storage.objects'::regclass and polname like 'guidelines%';
