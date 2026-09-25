-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Reviews used to go straight from the product page's form onto the product
-- page itself — nobody looked at one before a stranger did. This adds a
-- status column: new reviews land in 'pending' and only show publicly once
-- an admin approves them from the admin panel's Customers → Reviews tab.
--
-- Existing reviews are grandfathered in as 'approved' in the same
-- transaction the column is added, so nothing already live on a product page
-- vanishes the moment this runs — only reviews submitted from here on start
-- in 'pending'. Safe to re-run: the backfill only ever happens the one time
-- the column doesn't exist yet.

begin;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'product_reviews' and column_name = 'status'
  ) then
    alter table product_reviews add column status text not null default 'pending';
    update product_reviews set status = 'approved';
  end if;
end $$;

alter table product_reviews drop constraint if exists product_reviews_status_check;
alter table product_reviews add constraint product_reviews_status_check
  check (status in ('pending', 'approved', 'rejected'));

create index if not exists product_reviews_status_idx on product_reviews (status);

-- Customers and visitors only ever see approved reviews. An authenticated
-- admin still sees every status — "Signed-in admins manage reviews"
-- (for all, using is_admin()) already grants that, and Postgres OR's
-- multiple permissive SELECT policies together for the same role.
drop policy if exists "Anyone can read reviews" on product_reviews;
create policy "Anyone can read approved reviews"
  on product_reviews for select
  to anon, authenticated
  using (status = 'approved');

commit;
