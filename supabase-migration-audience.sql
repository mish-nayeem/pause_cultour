-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Admin → Marketing → Customers & emails: the admin reads (and can remove)
-- the mailing list; anyone — a visitor or a signed-in customer — can join it
-- (the footer's JOIN and checkout's "Email me with news and offers").

begin;

create table if not exists subscribers (
  id bigint generated always as identity primary key,
  email text not null unique,
  created_at timestamptz default now()
);

alter table subscribers add column if not exists created_at timestamptz default now();

alter table subscribers enable row level security;

drop policy if exists "Anyone can join the mailing list" on subscribers;
create policy "Anyone can join the mailing list"
  on subscribers for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Admin reads the mailing list" on subscribers;
create policy "Admin reads the mailing list"
  on subscribers for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admin removes from the mailing list" on subscribers;
create policy "Admin removes from the mailing list"
  on subscribers for delete
  to authenticated
  using (public.is_admin());

commit;
