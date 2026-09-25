-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Run after supabase-migration-fix-rls-rate-limit.sql. Found while testing
-- that fix: the trigger was BEFORE INSERT, which fires — and commits its own
-- insert into rate_limit_hits — before the row is checked against the RLS
-- `with check` clause. rate_limit_ok() then saw its own not-yet-approved hit
-- already counted, so a real customer's exact 3rd review (or 5th wishlist
-- join) failed the check by one, having just recorded the hit that pushed it
-- over.
--
-- AFTER INSERT only fires once the row has actually passed every check and
-- been written, so the count it adds can never affect the check that just
-- let it through. Also clears the handful of hits and one test review this
-- debugging left behind.

begin;

drop trigger if exists wishlist_rate_limit_hit on wishlist;
create trigger wishlist_rate_limit_hit
  after insert on wishlist
  for each row execute function public.record_rate_limit_hit('wishlist_join', '3600');

drop trigger if exists product_reviews_rate_limit_hit on product_reviews;
create trigger product_reviews_rate_limit_hit
  after insert on product_reviews
  for each row execute function public.record_rate_limit_hit('product_review', '86400');

-- Test noise from debugging this, safe to clear.
delete from rate_limit_hits where bucket like 'product_review:%' or bucket like 'wishlist_join:%';
delete from product_reviews where customer_name in ('__migration_test__', '__migration_test2__', '__migration_test3__');

commit;
