-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Undoes supabase-migration-review-moderation.sql — reviews go straight back
-- to showing on the product page the moment they're posted, no admin
-- approval step. The rate limit itself stays (still the real protection
-- against spam), just tightened from 3/day to 3/hour per IP.

begin;

-- Public read: back to everything, not just 'approved'.
drop policy if exists "Anyone can read approved reviews" on product_reviews;
create policy "Anyone can read reviews"
  on product_reviews for select
  to anon, authenticated
  using (true);

-- status is no longer read by any policy — drop it, and the trigger that
-- inserted with it as the default.
alter table product_reviews drop column if exists status;

-- 3 per IP per hour (was 3 per day).
drop policy if exists "Anyone can leave a review" on product_reviews;
create policy "Anyone can leave a review"
  on product_reviews for insert
  to anon, authenticated
  with check (public.rate_limit_ok('product_review', 3, 3600));

drop trigger if exists product_reviews_rate_limit_hit on product_reviews;
create trigger product_reviews_rate_limit_hit
  after insert on product_reviews
  for each row execute function public.record_rate_limit_hit('product_review', '3600');

commit;
