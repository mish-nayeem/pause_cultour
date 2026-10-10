-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Lets Admin → Homepage edit the homepage ticker.

begin;

-- ---------------------------------------------------------------------------
-- Site settings
-- ---------------------------------------------------------------------------
-- Small bits of storefront copy the admin edits without a redeploy, one row
-- per key. Everyone can read them; only the admin writes.
--
-- ticker — the scrolling strip under the homepage hero: a JSON array of
--          lines, e.g. ["EID SALE 20% OFF", "CODE EID10 FOR 10% MORE"].
--          Missing or empty → the built-in brand lines.

create table if not exists site_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table site_settings enable row level security;

drop policy if exists "Anyone reads site settings" on site_settings;
create policy "Anyone reads site settings"
  on site_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "Signed-in admins manage site settings" on site_settings;
create policy "Signed-in admins manage site settings"
  on site_settings for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
