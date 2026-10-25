-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Marketing, filled in by itself. Needs supabase-migration-marketing.sql
-- (ad_spend, email_campaigns, social_stats) run first. Safe to run twice.
--
--   meta_ad_daily    — Facebook / Instagram ad spend per day and campaign,
--                      pulled from Meta by the `marketing` edge function.
--   email_campaigns  — now also the campaigns sent from the admin through
--                      Brevo, with their numbers pulled back.
--   social_stats     — now also a daily Instagram / Facebook follower count
--                      pulled from Meta (source 'meta'); typed rows stay.
--
-- Deploy supabase/functions/marketing after running this.

begin;

create table if not exists meta_ad_daily (
  day            date not null,
  platform       text not null,          -- facebook | instagram | other
  campaign_name  text not null default '',
  spend          numeric not null default 0,
  impressions    bigint not null default 0,
  clicks         bigint not null default 0,
  synced_at      timestamptz not null default now(),
  primary key (day, platform, campaign_name)
);

alter table meta_ad_daily enable row level security;
drop policy if exists "Admins read Meta ad spend" on meta_ad_daily;
create policy "Admins read Meta ad spend"
  on meta_ad_daily for select
  to authenticated
  using (public.is_admin());

alter table email_campaigns add column if not exists brevo_id bigint;
alter table email_campaigns add column if not exists subject text;
alter table email_campaigns add column if not exists audience text;
alter table email_campaigns add column if not exists recipients int;
alter table email_campaigns add column if not exists status text;          -- typed | sent
alter table email_campaigns add column if not exists sent_at timestamptz;
alter table email_campaigns add column if not exists delivered int;
alter table email_campaigns add column if not exists opens int;
alter table email_campaigns add column if not exists clicks int;
alter table email_campaigns add column if not exists unsubscribes int;
alter table email_campaigns add column if not exists stats_at timestamptz;

alter table social_stats add column if not exists source text not null default 'manual';
alter table social_stats add column if not exists captured_on date;
alter table social_stats add column if not exists media_count int;
create unique index if not exists social_stats_daily_idx
  on social_stats (platform, captured_on) where source = 'meta';

commit;

-- ---------------------------------------------------------------------------
-- OPTIONAL — sync from Meta every morning by itself (after the function is
-- deployed and the Meta secrets are in). Needs the pg_cron and pg_net
-- extensions (Database → Extensions). Put your own project URL and the
-- MARKETING_CRON_SECRET you set in Edge Functions → Secrets, then run:
--
-- select cron.schedule('marketing-meta-sync', '15 0 * * *', $$
--   select net.http_post(
--     url := 'https://YOUR-PROJECT.supabase.co/functions/v1/marketing',
--     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'YOUR-MARKETING_CRON_SECRET'),
--     body := '{"action":"meta_sync","days":3}'::jsonb
--   );
-- $$);
-- ---------------------------------------------------------------------------
