-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Behind Analytics' four sub-tabs. Location map and Sold by category read
-- straight off orders (already real) — this table is the one genuinely new
-- piece, logged by the storefront itself on every page it renders. See
-- src/lib/analytics.js and src/components/PageViewTracker.jsx.

-- session_id — a random id the browser makes for itself and keeps in
--              sessionStorage (cleared when the tab closes, unlike the
--              abandoned-cart id, since a "session" for traffic purposes is
--              meant to reset the way it does in any analytics tool)
-- path       — the route visited, e.g. "/" or "/product/pc231"
-- referrer   — document.referrer, blank for a direct visit

create table if not exists page_views (
  id bigint generated always as identity primary key,
  session_id text not null,
  path text not null,
  referrer text,
  created_at timestamptz default now()
);

create index if not exists page_views_session_idx on page_views (session_id);
create index if not exists page_views_created_idx on page_views (created_at);

alter table page_views enable row level security;

-- The storefront only ever writes; nobody reads this back except the signed-in
-- admin, so a visitor's own browsing history stays theirs.
drop policy if exists "Anyone can log a page view" on page_views;
create policy "Anyone can log a page view"
  on page_views for insert
  to anon
  with check (true);

drop policy if exists "Signed-in admins read page views" on page_views;
create policy "Signed-in admins read page views"
  on page_views for all
  to authenticated
  using (true)
  with check (true);
