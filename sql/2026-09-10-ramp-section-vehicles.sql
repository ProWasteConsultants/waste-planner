-- Ramp section mode: longitudinal underside heights on the vehicle library.
--
-- The grade-clearance scan models the vehicle underside as three flat lines:
-- front-overhang underside, belly (between axles), rear-overhang underside.
-- The belly height already exists as contractors.ground_clearance_m; these two
-- complete the triple. All metres, like every other dimension in the table.
--
-- Null is a valid state: the scan falls back to per-category ASSUMED values
-- (WS_RAMP_SEC_DEFAULTS in the app) and flags the result as assumed — a
-- scrape verdict on a guessed sump height must never read as a verdict.

alter table contractors add column if not exists gc_front_m numeric;
alter table contractors add column if not exists gc_rear_m  numeric;

comment on column contractors.gc_front_m is 'Underside height at the front overhang tip, metres above ground on the flat (ramp section scan)';
comment on column contractors.gc_rear_m  is 'Underside height at the rear overhang tip, metres above ground on the flat (ramp section scan)';
