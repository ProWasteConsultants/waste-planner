-- WastePlanner — C&D stages, step 2: the facilities table and council C&D
-- profiles move server-side (2026-09-17).
--
-- WHY
-- Destinations and recyclers are PICKED, not typed: the site-preparation and
-- construction stage records reference facilities by name, and the appendix
-- and the council form print them. Council profiles set the diversion
-- target, the recovery factor for unseparated recycling, the under-10 m³
-- tick rule and which renderers apply. Both were a JSON seed in index.html
-- (still the offline fallback); the live lists are these tables.
--
-- Read: every signed-in user (nothing sensitive — public facility details).
-- Write: PWC staff (profiles.is_staff), the same gate as council_requirements.
-- Licence numbers stay NULL until checked against the EPA public register;
-- renderers print "EPL TBC" while null.

create table if not exists public.cd_facilities (
  id text primary key,
  name text not null,
  address text not null default '',
  region text not null default 'central_coast',
  streams text[] not null default '{}',
  licence_no text,
  phone text not null default '',
  url text not null default '',
  notes text not null default '',
  status text not null default 'tbc' check (status in ('verified','tbc','closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cd_council_profiles (
  id text primary key,
  name text not null,
  match text not null default '',
  diversion_target int not null default 80,
  unseparated_factor numeric not null default 0.8,
  tick_under10 boolean not null default true,
  renderers text[] not null default '{docx}',
  material_rows jsonb,          -- optional: the council's own row order / labels over the 20-row superset
  mandatory jsonb,              -- optional: field keys the council requires
  updated_at timestamptz not null default now()
);

alter table public.cd_facilities enable row level security;
alter table public.cd_council_profiles enable row level security;

drop policy if exists "cdf_read" on public.cd_facilities;
create policy "cdf_read" on public.cd_facilities for select to authenticated using (true);
drop policy if exists "cdf_staff_all" on public.cd_facilities;
create policy "cdf_staff_all" on public.cd_facilities for all to authenticated
  using (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff = true))
  with check (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff = true));

drop policy if exists "cdp_read" on public.cd_council_profiles;
create policy "cdp_read" on public.cd_council_profiles for select to authenticated using (true);
drop policy if exists "cdp_staff_all" on public.cd_council_profiles;
create policy "cdp_staff_all" on public.cd_council_profiles for all to authenticated
  using (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff = true))
  with check (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff = true));

-- GRANTs (RLS filters rows; it does not confer table privileges)
grant select, insert, update, delete on public.cd_facilities to authenticated;
grant select, insert, update, delete on public.cd_council_profiles to authenticated;

-- Seed: the verified Central Coast set (licence numbers null until verified).
insert into public.cd_facilities (id, name, address, region, streams, licence_no, url, notes, status) values
  ('buttonderry', 'Buttonderry Waste Management Facility', 'Hue Hue Road, Jilliby NSW', 'central_coast', '{residual,timber_clean,garden,mixed,other}', null, '', 'Central Coast Council landfill and resource recovery (Council)', 'verified'),
  ('woywoy', 'Woy Woy Waste Management Facility', 'Nagari Road, Woy Woy NSW', 'central_coast', '{asbestos,residual,hazardous}', null, '', 'Central Coast Council; asbestos accepted (bookings)', 'verified'),
  ('rcp_gosford', 'Recycled Concrete Products', '18a Tathra Street, West Gosford NSW', 'central_coast', '{concrete,bricks,tiles,excavation}', null, 'recycledconcrete.com.au', 'Crushed into recycled aggregate and road base', 'verified'),
  ('north_wyong', 'North Wyong Recycling', 'North Wyong NSW', 'central_coast', '{mixed,garden,timber_clean,concrete,bricks}', null, 'northwyongrecycling.com.au', 'Mixed C&D sorting; mulch', 'verified'),
  ('kariong_sand', 'Kariong Sand & Soil Supplies', 'Somersby NSW', 'central_coast', '{excavation}', null, '', 'Recycled fill, sand and soil blends', 'tbc'),
  ('iq_renew', 'IQ Renew MRF', 'Somersby NSW', 'central_coast', '{mixed,glass}', null, '', 'Materials recovery facility (packaging)', 'verified'),
  ('regyp', 'REGYP', 'Belrose / Mayfield West NSW', 'central_coast', '{plasterboard}', null, 'regyp.com.au', 'Plasterboard recycling — recycled gypsum', 'verified')
on conflict (id) do nothing;

insert into public.cd_council_profiles (id, name, match, diversion_target, unseparated_factor, tick_under10, renderers) values
  ('central_coast', 'Central Coast Council', 'central coast', 80, 0.8, true, '{docx,pdf}'),
  ('default', 'NSW — EPA better practice', '', 80, 0.8, true, '{docx}')
on conflict (id) do nothing;
