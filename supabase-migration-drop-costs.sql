-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Products → Cost & margin → Drop profit: the costs typed in by hand for
-- each drop, alongside the sales the site works out by itself.
--
--   kind 'ads'   — ad spend on a date (e.g. 7 Oct, ৳2,000, Facebook)
--   kind 'other' — anything else, named: production, shoot, packaging…
--
-- Admin only. Safe to run twice.

begin;

create table if not exists drop_costs (
  id          bigint generated always as identity primary key,
  drop_name   text not null,
  kind        text not null check (kind in ('ads', 'other')),
  label       text,
  amount      numeric not null check (amount >= 0),
  spent_on    date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists drop_costs_drop_idx on drop_costs (lower(drop_name), spent_on);

alter table drop_costs enable row level security;

drop policy if exists "Admins manage drop costs" on drop_costs;
create policy "Admins manage drop costs"
  on drop_costs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
