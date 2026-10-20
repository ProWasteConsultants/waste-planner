-- ── Terms of Service / Privacy Policy acceptance ────────────────────────────
-- What each person has agreed to, and when. The current versions live in
-- legal.js (WP_LEGAL); this records acceptance of them.
--
-- profiles.terms_version / privacy_version / terms_accepted_at — the versions
-- the account last accepted and the SERVER time it did so. They are written
-- only through wp_accept_terms() (SECURITY DEFINER, stamps now()): a trigger
-- discards any direct client write to the three columns, so an acceptance
-- time can never be typed in or backdated from the browser — the same guard
-- projects_created / projects_engaged already have.
--
-- legal_acceptances — one row per acceptance (sign-up, and each re-accept
-- after a new version), so the history survives the profile moving on to a
-- newer version. The owner reads their own rows; staff read all.
--
-- Run before the release that asks for acceptance. Until then the app's
-- sign-up still works (the record call fails quietly and is retried at the
-- next sign-in) and nobody is locked out.

alter table public.profiles add column if not exists terms_version text;
alter table public.profiles add column if not exists privacy_version text;
alter table public.profiles add column if not exists terms_accepted_at timestamptz;

create table if not exists public.legal_acceptances (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  source text not null default 'app'          -- 'signup' | 'reaccept' | 'app'
);
create index if not exists legal_acceptances_user_idx on public.legal_acceptances (user_id, accepted_at desc);
alter table public.legal_acceptances enable row level security;
grant select on public.legal_acceptances to authenticated;
drop policy if exists "legal_acceptances_read" on public.legal_acceptances;
create policy "legal_acceptances_read" on public.legal_acceptances for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff));
-- the account-deletion function reads/deletes as service_role
grant select, delete on public.legal_acceptances to service_role;

-- Direct client writes to the acceptance columns are discarded (insert and
-- update). SECURITY INVOKER on purpose — see wp_protect_projects_created.
create or replace function public.wp_protect_legal_acceptance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.terms_version := null; new.privacy_version := null; new.terms_accepted_at := null;
    else
      new.terms_version := old.terms_version;
      new.privacy_version := old.privacy_version;
      new.terms_accepted_at := old.terms_accepted_at;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_wp_protect_legal_acceptance on public.profiles;
create trigger trg_wp_protect_legal_acceptance
  before insert or update on public.profiles
  for each row execute function public.wp_protect_legal_acceptance();

-- The one way acceptance is recorded: the signed-in account, the versions it
-- agreed to, the server's clock.
create or replace function public.wp_accept_terms(p_terms text, p_privacy text, p_source text default 'app')
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Guest sessions cannot accept terms'; end if;
  if coalesce(p_terms, '') !~ '^[0-9]+(\.[0-9]+)*$' or coalesce(p_privacy, '') !~ '^[0-9]+(\.[0-9]+)*$' then
    raise exception 'Version must look like 2.0';
  end if;
  update public.profiles
     set terms_version = p_terms, privacy_version = p_privacy, terms_accepted_at = t
   where uuid = auth.uid();
  if not found then raise exception 'No profile for this account yet'; end if;
  insert into public.legal_acceptances (user_id, terms_version, privacy_version, accepted_at, source)
  values (auth.uid(), p_terms, p_privacy, t,
          case when p_source in ('signup', 'reaccept') then p_source else 'app' end);
  return t;
end;
$$;
revoke all on function public.wp_accept_terms(text, text, text) from public;
grant execute on function public.wp_accept_terms(text, text, text) to authenticated;

-- One row per notice email sent by the legal-notice edge function (counts
-- only — never addresses). The function refuses a second send for the same
-- Terms version unless told to resend. Written by the service role; staff read.
create table if not exists public.legal_notice_log (
  id bigint generated always as identity primary key,
  sent_at timestamptz not null default now(),
  terms_version text not null,
  privacy_version text not null,
  effective_date date not null,
  recipients integer not null,
  sent_by uuid references auth.users(id) on delete set null
);
alter table public.legal_notice_log enable row level security;
grant select on public.legal_notice_log to authenticated;
grant select, insert on public.legal_notice_log to service_role;
grant select on public.profiles to service_role;
drop policy if exists "legal_notice_log_staff_read" on public.legal_notice_log;
create policy "legal_notice_log_staff_read" on public.legal_notice_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.uuid = auth.uid() and p.is_staff));

notify pgrst, 'reload schema';

-- ── ROLLBACK
-- drop table if exists public.legal_notice_log; ─────────────────────────────────────────────────────────────
-- drop function if exists public.wp_accept_terms(text, text, text);
-- drop trigger if exists trg_wp_protect_legal_acceptance on public.profiles;
-- drop function if exists public.wp_protect_legal_acceptance();
-- drop table if exists public.legal_acceptances;
-- alter table public.profiles drop column if exists terms_accepted_at,
--   drop column if exists privacy_version, drop column if exists terms_version;
