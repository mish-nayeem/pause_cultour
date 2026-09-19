-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Four small tables behind Marketing's sub-tabs. All of it is typed in by
-- hand for now — nothing here calls Facebook, Brevo or any other API yet, so
-- every row is exactly what the admin panel was told, not a live number.
-- Tracked Links (Marketing's fifth sub-tab) already has its own real data
-- and needs nothing new here.

create table if not exists ad_spend (
  id bigint generated always as identity primary key,
  channel text not null,
  spend numeric not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists email_campaigns (
  id bigint generated always as identity primary key,
  campaign text not null,
  open_rate numeric not null default 0,
  click_rate numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists social_stats (
  id bigint generated always as identity primary key,
  platform text not null,
  followers int not null default 0,
  engagement_rate numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists coupon_stats (
  id bigint generated always as identity primary key,
  code text not null,
  uses int not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz default now()
);

-- All four are purely internal — no customer-facing page reads or writes any
-- of them, so admin-only is the whole policy.
alter table ad_spend enable row level security;
alter table email_campaigns enable row level security;
alter table social_stats enable row level security;
alter table coupon_stats enable row level security;

drop policy if exists "Signed-in admins manage ad spend" on ad_spend;
create policy "Signed-in admins manage ad spend"
  on ad_spend for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage email campaigns" on email_campaigns;
create policy "Signed-in admins manage email campaigns"
  on email_campaigns for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage social stats" on social_stats;
create policy "Signed-in admins manage social stats"
  on social_stats for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage coupon stats" on coupon_stats;
create policy "Signed-in admins manage coupon stats"
  on coupon_stats for all to authenticated using (true) with check (true);
