-- Makes customer accounts safe.
--
-- Until now every "admin" policy said `to authenticated using (true)` — fine
-- while the only login was the owner's, but once customers can create accounts
-- a customer would be "authenticated" too and could read and rewrite all of it.
-- This narrows every one of those to the admin's email (the same check the
-- orders / products / subscribers / hero_slides policies already use).
--
-- It also lets a logged-in customer do what a visitor can: the public policies
-- were written for the `anon` role only, and a signed-in customer is
-- `authenticated`, not `anon` — without this they would see an empty shop.
--
-- Run once in the Supabase SQL editor. All-or-nothing: if any line fails,
-- nothing is changed.

begin;

-- ---------- One place that says who the admin is ----------

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'mish.nayeem@gmail.com', false)
$$;

-- ---------- Admin-only: were `to authenticated using (true)` ----------

drop policy if exists "Signed-in admins manage abandoned carts" on abandoned_carts;
create policy "Signed-in admins manage abandoned carts"
  on abandoned_carts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage the about page" on about_blocks;
create policy "Signed-in admins manage the about page"
  on about_blocks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage ad spend" on ad_spend;
create policy "Signed-in admins manage ad spend"
  on ad_spend for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage coupon stats" on coupon_stats;
create policy "Signed-in admins manage coupon stats"
  on coupon_stats for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage email campaigns" on email_campaigns;
create policy "Signed-in admins manage email campaigns"
  on email_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage the shop menu" on nav_categories;
create policy "Signed-in admins manage the shop menu"
  on nav_categories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage returns" on order_returns;
create policy "Signed-in admins manage returns"
  on order_returns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins read page views" on page_views;
create policy "Signed-in admins read page views"
  on page_views for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage reviews" on product_reviews;
create policy "Signed-in admins manage reviews"
  on product_reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage social stats" on social_stats;
create policy "Signed-in admins manage social stats"
  on social_stats for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Signed-in admins manage the wishlist" on wishlist;
create policy "Signed-in admins manage the wishlist"
  on wishlist for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- Inserts whose check clause wasn't visible: pin it to the admin ----------

drop policy if exists "Admin can insert products" on products;
create policy "Admin can insert products"
  on products for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admin can insert hero slides" on hero_slides;
create policy "Admin can insert hero slides"
  on hero_slides for insert to authenticated
  with check (public.is_admin());

-- ---------- Public policies: a signed-in customer gets the same as a visitor ----------

alter policy "Anyone can view products" on products to anon, authenticated;
alter policy "Anyone can view hero slides" on hero_slides to anon, authenticated;
alter policy "Anyone can read the visible shop menu" on nav_categories to anon, authenticated;
alter policy "Anyone can read the visible about page" on about_blocks to anon, authenticated;
alter policy "Anyone can read reviews" on product_reviews to anon, authenticated;
alter policy "Anyone can leave a review" on product_reviews to anon, authenticated;
alter policy "Anyone can join the wishlist" on wishlist to anon, authenticated;
alter policy "Anyone can log a page view" on page_views to anon, authenticated;
alter policy "Anyone can save their own abandoned cart" on abandoned_carts to anon, authenticated;
alter policy "Anyone can update their own abandoned cart" on abandoned_carts to anon, authenticated;

commit;
