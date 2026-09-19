-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Behind Products' new "Cost & margin" sub-tab and the Customers tab's
-- "Reviews" sub-tab.

-- ---------------------------------------------------------------------------
-- 1. Cost per product
-- ---------------------------------------------------------------------------
-- What it actually cost to make or buy in — set once per product in the
-- product form, next to price. Left null for anything not filled in yet, so
-- the margin panel just skips those rather than showing a false 100% margin.

alter table products add column if not exists cost numeric;


-- ---------------------------------------------------------------------------
-- 2. Product reviews
-- ---------------------------------------------------------------------------
-- Anyone can leave one from the product page — no login, no purchase check,
-- same trust level as the wishlist signup. A rating with no comment is still
-- worth keeping; a comment always comes with a rating.
--
-- product_id     — which product
-- customer_name  — whatever they typed
-- rating         — 1 to 5
-- comment        — optional

create table if not exists product_reviews (
  id bigint generated always as identity primary key,
  product_id text not null,
  customer_name text not null,
  rating int not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz default now()
);

create index if not exists product_reviews_product_idx on product_reviews (product_id);

alter table product_reviews enable row level security;

-- Customers can post and read reviews (they show on the product page) but
-- never edit or delete one — including their own — once it's in.
drop policy if exists "Anyone can read reviews" on product_reviews;
create policy "Anyone can read reviews"
  on product_reviews for select
  to anon
  using (true);

drop policy if exists "Anyone can leave a review" on product_reviews;
create policy "Anyone can leave a review"
  on product_reviews for insert
  to anon
  with check (true);

drop policy if exists "Signed-in admins manage reviews" on product_reviews;
create policy "Signed-in admins manage reviews"
  on product_reviews for all
  to authenticated
  using (true)
  with check (true);
