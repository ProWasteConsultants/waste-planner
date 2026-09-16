-- WastePlanner — removing a requirement DELETES it (2026-09-16).
--
-- WHY
-- Removing a row from a council's Requirements list used to park it as
-- status = 'rejected' ("kept for audit, never served"). Nobody reads that
-- audit, the rows are invisible in every tool, and they accumulate. The list
-- is the record: a removed requirement now leaves the database, singly or
-- as a ticked batch, after one confirmation that names what goes.
--
-- WHAT THIS DOES
-- * Deletes every row already parked as 'rejected' — they were never served
--   and never shown, so nothing visible changes.
-- * Nothing else: the staff policy (creq_staff_all, FOR ALL) and the DELETE
--   grant to authenticated already exist from package-c3, so the client's
--   .delete() works without a policy change. The status check keeps its
--   enum; 'rejected' is simply no longer written.
--
-- Idempotent — re-running is a no-op. Run AFTER 2026-09-15-requirements-list.

delete from public.council_requirements where status = 'rejected';
