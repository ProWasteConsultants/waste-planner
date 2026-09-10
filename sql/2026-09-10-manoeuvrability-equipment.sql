-- Manoeuvrability: turning behaviour on the equipment library.
--
-- The wheel-through check uses a two-tier model — small MGBs pivot almost on
-- their own castors, big bins and compactor bins turn wide on an effective
-- radius. Size-based defaults cover rows that leave these null (and the check
-- says the behaviour is assumed); these columns are the per-record override
-- for plant with unusual geometry (compactor bins, balers).
--
-- turn_type: 'pivot' | 'wide' (anything else is ignored and the default
-- applies — the app validates on save). turn_radius_mm: effective turning
-- radius, read only when turn_type = 'wide'.

alter table equipment add column if not exists turn_type       text;
alter table equipment add column if not exists turn_radius_mm  integer;

comment on column equipment.turn_type      is 'Manoeuvrability tier: pivot (turns on the spot) or wide (needs a turning radius); null = size-based default';
comment on column equipment.turn_radius_mm is 'Effective turning radius in mm, used when turn_type = wide; null = default for its size';
