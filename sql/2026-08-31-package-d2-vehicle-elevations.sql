-- WastePlanner — Package D2: vehicle side-elevation columns + `source`.
--
-- WHY THIS EXISTS
-- The contractors/vehicle table held plan-view dimensions only. A side
-- elevation needs vertical dimensions and the axle configuration (real
-- collection vehicles are not all 6x4 — the J.J. Richards 34m³ front lift is
-- a Scania P320 8x4 twin-steer). Where a value is unknown, leave it NULL: the
-- profile module falls back to a documented body-type default and the UI says
-- "± heights estimated" instead of implying authority.
--
-- UNITS: the new dimension columns are METRES, matching every existing
-- dimension column in this table (wheelbase_m, travel_height_m, …). The brief
-- named mm columns, but mixing units within one table is exactly the class of
-- error the streams column suffered — the profile module converts to mm at
-- the boundary instead.
--
-- DELIBERATELY NOT ADDED: turning_circle_kerb_mm / turning_circle_wall_mm.
-- The table already stores kerb_radius_m and wall_radius_m, and a circle is
-- an IDENTITY of its radius (⌀ = 2R — see wsCalibrationNumbers in CLAUDE.md).
-- A second column stating the same fact in different units would drift; the
-- title block prints 2 × the stored radius.
--
-- `source` — design vehicle vs contractor vehicle. A contractor's clearance
-- requirement quoted as though it were a design standard is a report error:
--   guideline    — AS 2890.2 / council / state design vehicles (the default
--                  the swept tool should assess against)
--   manufacturer — a manufacturer's dimensioned drawing of a real model
--   contractor   — one named operator's fleet / service envelope
-- NULL keeps the app's existing inference (council value or no company ⇒
-- guideline; company ⇒ contractor).
--
-- Idempotent — re-running is a no-op.
-- Run in the Supabase SQL editor as postgres.

alter table public.contractors add column if not exists operating_height_m numeric;
alter table public.contractors add column if not exists cab_height_m numeric;
alter table public.contractors add column if not exists body_height_m numeric;
alter table public.contractors add column if not exists front_axles integer;
alter table public.contractors add column if not exists front_axle_spread_m numeric;
alter table public.contractors add column if not exists rear_axles integer;
alter table public.contractors add column if not exists rear_axle_spread_m numeric;
alter table public.contractors add column if not exists source text
  check (source is null or source in ('guideline', 'manufacturer', 'contractor'));

-- ── VERIFY ──────────────────────────────────────────────────────────────────
select column_name from information_schema.columns
where table_name = 'contractors'
  and column_name in ('operating_height_m','cab_height_m','body_height_m',
    'front_axles','front_axle_spread_m','rear_axles','rear_axle_spread_m','source');
