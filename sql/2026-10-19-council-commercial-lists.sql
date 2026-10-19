-- ── Per-council commercial lists + typed-in uses ─────────────────────────────
-- Admin › Council & state database › Commercial rates.
--
-- councils.com_own — the council publishes its OWN commercial list. When it
-- is true and the council has com_rates rows, those rows are the complete
-- list for that council: waste_rates.json marks the council profile
-- `comList: "own"`, and the calculators use the council's uses and rates in
-- place of the state's rather than merging them over it. When it is false
-- (every existing council — their rows were entered as overrides, e.g.
-- Randwick's restaurant-only figure) the rows stay overrides on the state
-- list, exactly as before. A council with no commercial rows uses the state
-- list either way. Set by the admin toggle, and by guideline extraction when
-- it syncs the council's list to the document.
--
-- com_uses.metric / default_days — what a use is counted in ("m² (NLA)",
-- "Beds (no.)") and its default days a week. A use typed in by hand, or
-- created by extraction, is not in the calculator's built-in COMM table, so
-- it publishes with these under USES and every calculator reading the file
-- offers it. Null on a built-in use = the calculator's own value.
--
-- No new table, so no new GRANTs; who may write councils / com_uses is
-- unchanged (staff already add uses from the rates report).

alter table public.councils add column if not exists com_own boolean;
update public.councils set com_own = false where com_own is null;
alter table public.councils alter column com_own set default false;
alter table public.councils alter column com_own set not null;

alter table public.com_uses add column if not exists metric text;
alter table public.com_uses add column if not exists default_days integer;
alter table public.com_uses drop constraint if exists com_uses_default_days_check;
alter table public.com_uses add constraint com_uses_default_days_check
  check (default_days is null or default_days between 1 and 7);
