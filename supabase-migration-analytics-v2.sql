-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Admin → Analytics, made fuller.
--
-- 1. page_views.device — phone, tablet or computer, sent by the storefront
--    with each page view (src/lib/analytics.js).
-- 2. admin_analytics(days) — every visitor figure the Analytics tab shows,
--    added up in the database and sent as one small answer. Before, the
--    panel downloaded every page view of the last 30 days and counted them
--    in the browser; that gets slow as traffic grows, and Supabase only
--    sends 1,000 rows at a time, so busy months were being cut short.
--    Only the admin can call it.

begin;

alter table page_views add column if not exists device text;

create index if not exists page_views_created_session_idx on page_views (created_at, session_id);

create or replace function public.admin_analytics(p_days int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  n int := greatest(1, least(coalesce(p_days, 30), 365));
  since timestamptz := now() - make_interval(days => n);
  prev_since timestamptz := now() - make_interval(days => n * 2);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  with v as (
    select session_id, path, referrer, device, created_at
    from page_views
    where created_at >= since
  ),
  s as (
    select
      session_id,
      count(*) as views,
      bool_or(path like '/product/%') as saw_product,
      bool_or(path = '/cart') as saw_cart,
      bool_or(path = '/checkout') as saw_checkout,
      bool_or(path = '/order-confirmed') as ordered,
      (array_agg(path order by created_at))[1] as entry,
      (array_agg(referrer order by created_at))[1] as ref,
      (array_agg(device order by created_at))[1] as dev
    from v
    group by session_id
  )
  select jsonb_build_object(
    'days', n,
    'visitors', (select count(*) from s),
    'views', (select count(*) from v),
    'bounced', (select count(*) from s where views = 1),
    'prev_visitors', (
      select count(distinct session_id) from page_views
      where created_at >= prev_since and created_at < since
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'visitors', vis, 'views', vw) order by d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Dhaka')::date as d,
               count(distinct session_id) as vis, count(*) as vw
        from v group by 1
      ) x
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'visitors', vis) order by h), '[]'::jsonb)
      from (
        select extract(hour from created_at at time zone 'Asia/Dhaka')::int as h,
               count(distinct session_id) as vis
        from v group by 1
      ) x
    ),
    'funnel', jsonb_build_object(
      'visited', (select count(*) from s),
      'product', (select count(*) from s where saw_product),
      'cart', (select count(*) from s where saw_cart),
      'checkout', (select count(*) from s where saw_checkout),
      'ordered', (select count(*) from s where ordered)
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'views', vw, 'visitors', vis) order by vw desc), '[]'::jsonb)
      from (
        select split_part(split_part(substr(path, 10), '?', 1), '/', 1) as pid,
               count(*) as vw, count(distinct session_id) as vis
        from v where path like '/product/%'
        group by 1 order by 2 desc limit 40
      ) x
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', src, 'visitors', c) order by c desc), '[]'::jsonb)
      from (
        select case
                 when ref is null or ref = '' then 'direct'
                 else regexp_replace(regexp_replace(lower(ref), '^[a-z]+://(www\.|m\.|l\.|lm\.|mobile\.)?', ''), '[/:?#].*$', '')
               end as src,
               count(*) as c
        from s group by 1 order by 2 desc limit 20
      ) x
    ),
    'devices', (
      select coalesce(jsonb_object_agg(coalesce(dev, 'unknown'), c), '{}'::jsonb)
      from (select dev, count(*) as c from s group by 1) x
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', c)), '[]'::jsonb)
      from (select path, count(*) as c from v group by 1 order by 2 desc limit 300) x
    ),
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object('path', entry, 'entries', c, 'bounces', b)), '[]'::jsonb)
      from (select entry, count(*) as c, count(*) filter (where views = 1) as b from s group by 1) x
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_analytics(int) from public, anon;
grant execute on function public.admin_analytics(int) to authenticated;

commit;
