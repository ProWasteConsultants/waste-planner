-- ── Publish rates to calculator: the councils.published gate ───────────────
-- The publish-rates edge function writes waste_rates.json (the free
-- calculator on go.wasteplanner.au, the prowaste.au embed, the in-app
-- calculator and the WMP generator all read it) from res_rates / com_rates /
-- councils. Only councils marked published are listed in it, and only their
-- rates go out — a council being set up stays a draft until staff tick
-- "Listed on the free calculator" in Admin › Council & state database.
--
-- Every council that exists today is backfilled as published: they are all in
-- every picker now, and dropping one from the public file would break its
-- ?council= ad links. New councils start as drafts (default false).
--
-- The function reads with the calling staff member's token, so no
-- service_role grant is needed. Who may UPDATE councils is unchanged — the
-- existing policy that lets staff rename a council covers the new column.

alter table public.councils add column if not exists published boolean;
update public.councils set published = true where published is null;
alter table public.councils alter column published set default false;
alter table public.councils alter column published set not null;
