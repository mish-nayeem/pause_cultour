-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Visits by tracked link. A visit (a browser session) that landed through a
-- link with ?utm_source= now keeps that source, medium and campaign on its
-- page views, so Overview → Order sources can show, per source and per
-- campaign: visits → orders, the conversion rate, sales and revenue.
--
-- Also tightens page_views: before, any signed-in account could read every
-- page view; now only the admin can, while anyone (signed in or not) can
-- still log their own visit. Safe to run twice.

begin;

alter table page_views add column if not exists utm_source text;
alter table page_views add column if not exists utm_medium text;
alter table page_views add column if not exists utm_campaign text;

create index if not exists page_views_utm_idx on page_views (utm_source, created_at) where utm_source is not null;

drop policy if exists "Anyone can log a page view" on page_views;
create policy "Anyone can log a page view"
  on page_views for insert
  to anon, authenticated
  with check (true);

drop policy if exists "Signed-in admins read page views" on page_views;
drop policy if exists "Admins read page views" on page_views;
create policy "Admins read page views"
  on page_views for select
  to authenticated
  using (public.is_admin());

-- Visits (sessions) per source and campaign between two moments.
create or replace function public.admin_utm_visits(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'source', s.utm_source,
        'campaign', s.utm_campaign,
        'visits', s.visits
      )), '[]'::jsonb)
    from (
      select utm_source, utm_campaign, count(distinct session_id) as visits
        from page_views
       where utm_source is not null
         and created_at >= p_from
         and created_at < p_to
       group by utm_source, utm_campaign
    ) s
  );
end;
$$;

revoke all on function public.admin_utm_visits(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_utm_visits(timestamptz, timestamptz) to authenticated;

commit;
