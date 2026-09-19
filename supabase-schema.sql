-- Run this in Supabase Dashboard → SQL Editor → New query
-- Creates the tables needed for COD orders from the Pause checkout page.

create table if not exists orders (
  id text primary key,
  customer_name text not null,
  customer_phone text not null,
  customer_address text not null,
  customer_area text not null,
  customer_note text,
  subtotal numeric not null,
  status text default 'pending',
  created_at timestamptz default now()
);

create table if not exists order_items (
  id bigint generated always as identity primary key,
  order_id text references orders(id) on delete cascade,
  product_id text not null,
  product_name text not null,
  size text not null,
  price numeric not null,
  qty int not null
);

-- ---------------------------------------------------------------------------
-- Delivery charge and the outside-Dhaka advance
-- ---------------------------------------------------------------------------
-- Added after the first orders were already taken, so every column is
-- nullable and the old rows stay readable — they predate delivery charges.
--
-- delivery_zone   — 'inside' or 'outside' (Dhaka)
-- delivery_fee    — what was charged for delivery on this order
-- total           — subtotal + delivery_fee, the whole order value
-- advance_amount  — paid up front by bKash; 0 for a plain COD order
-- advance_trx_id  — the bKash transaction id the customer typed in
--
-- The rider collects total - advance_amount at the door.

alter table orders add column if not exists delivery_zone text;
alter table orders add column if not exists delivery_fee numeric default 0;
alter table orders add column if not exists total numeric;
alter table orders add column if not exists advance_amount numeric default 0;
alter table orders add column if not exists advance_method text;
alter table orders add column if not exists advance_trx_id text;

-- One bKash receipt, one order. Without this the same transaction id could be
-- pasted onto order after order, since the checkout can't verify it with bKash
-- itself. Case-insensitive, because the id gets typed by hand.
create unique index if not exists orders_advance_trx_id_idx
  on orders (upper(advance_trx_id))
  where advance_trx_id is not null;


-- ---------------------------------------------------------------------------
-- UTM attribution
-- ---------------------------------------------------------------------------
-- Which reel, story or bio link an order actually came from — captured
-- client-side off the ?utm_* params on the link the customer clicked, carried
-- through checkout, and written onto the order here. Nullable: an order
-- placed by typing the URL directly, or from before this existed, just has
-- nothing to show and reads as "Direct / no link" in the admin panel.

alter table orders add column if not exists utm_source text;
alter table orders add column if not exists utm_medium text;
alter table orders add column if not exists utm_campaign text;
alter table orders add column if not exists utm_content text;
alter table orders add column if not exists utm_term text;

create index if not exists orders_utm_source_idx on orders (utm_source)
  where utm_source is not null;


-- Row Level Security: customers get no direct access to orders at all.
-- They cannot read, edit or delete them — including their own — and they
-- cannot insert one either. Orders are created only through place_order()
-- further down this file, which is the function that checks stock before it
-- writes anything.
--
-- You read and manage orders yourself from the admin panel or the Supabase
-- Table Editor, both of which use your logged-in account.

alter table orders enable row level security;
alter table order_items enable row level security;

-- These two policies used to let the checkout insert straight into the tables,
-- back when it wrote the order itself. They are dropped rather than created:
-- while either one exists, anyone holding the public anon key can write an
-- order that never passed the stock check, which is exactly what place_order
-- exists to prevent. Dropping is safe to re-run.

drop policy if exists "Anyone can place an order" on orders;
drop policy if exists "Anyone can add items to an order" on order_items;

-- With RLS on and no policy naming the anon role, the only way in is the
-- security-definer function below.


-- ---------------------------------------------------------------------------
-- Per-size stock
-- ---------------------------------------------------------------------------
-- stock — how many pieces of each size are left, as a jsonb map:
--           {"S": 4, "M": 0, "L": 2}
--
-- A size with 0 left sells out on its own, so `sizes_out` goes back to being
-- what it was meant for: a manual override for a size you want off the page
-- even though the pieces exist.
--
-- Left null, the product is untracked and behaves exactly as it did before
-- stock existed — nothing about the old catalog breaks.

alter table products add column if not exists stock jsonb;


-- ---------------------------------------------------------------------------
-- place_order — the only way an order gets written
-- ---------------------------------------------------------------------------
-- The checkout used to insert the order, then the items, as two separate
-- calls, and nothing stopped two people buying the last piece of the same size
-- at the same moment. This does the lot in one transaction: it locks each
-- product row, refuses the order if a size can't cover the quantity asked for,
-- writes the order and its items, and only then takes the pieces off the
-- shelf. Either all of that happens or none of it does.
--
-- It runs as the owner (security definer) because customers have no update
-- rights on products — they can't move stock any other way than by ordering.

create or replace function place_order(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o          jsonb := payload -> 'order';
  new_id     text  := o ->> 'id';
  item       jsonb;
  cur_stock  jsonb;
  -- Not called `found`: plpgsql owns that name, and a SELECT INTO that
  -- matches nothing leaves this null rather than false, so it is read
  -- through coalesce below.
  has_row    boolean;
  left_count int;
  want       int;
  size_key   text;
begin
  if new_id is null then
    raise exception 'MISSING_ORDER_ID';
  end if;

  if jsonb_typeof(payload -> 'items') <> 'array'
     or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'EMPTY_CART';
  end if;

  -- Stock first: no order row is written for a cart that can't be filled.
  for item in select * from jsonb_array_elements(payload -> 'items')
  loop
    size_key := item ->> 'size';
    want := (item ->> 'qty')::int;

    -- FOR UPDATE holds the row until this transaction ends, so a second
    -- checkout for the same product waits here instead of reading the same
    -- count and selling the same piece twice.
    select p.stock, true into cur_stock, has_row
      from products p
     where p.id::text = item ->> 'product_id'
       for update;

    if not coalesce(has_row, false) then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

    -- A product with no stock map is untracked: it sells as it always did.
    if cur_stock is not null then
      left_count := coalesce((cur_stock ->> size_key)::int, 0);

      if left_count < want then
        raise exception 'SOLD_OUT:%:%', item ->> 'product_name', size_key;
      end if;

      update products
         set stock = jsonb_set(stock, array[size_key], to_jsonb(left_count - want))
       where id::text = item ->> 'product_id';
    end if;
  end loop;

  insert into orders (
    id, customer_name, customer_phone, customer_email, customer_address,
    customer_area, customer_note, subtotal, delivery_zone, delivery_fee,
    total, advance_amount, advance_method, advance_trx_id,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term
  ) values (
    new_id,
    o ->> 'customer_name',
    o ->> 'customer_phone',
    o ->> 'customer_email',
    o ->> 'customer_address',
    o ->> 'customer_area',
    o ->> 'customer_note',
    (o ->> 'subtotal')::numeric,
    o ->> 'delivery_zone',
    (o ->> 'delivery_fee')::numeric,
    (o ->> 'total')::numeric,
    (o ->> 'advance_amount')::numeric,
    o ->> 'advance_method',
    o ->> 'advance_trx_id',
    o ->> 'utm_source',
    o ->> 'utm_medium',
    o ->> 'utm_campaign',
    o ->> 'utm_content',
    o ->> 'utm_term'
  );

  -- Aliased `e`, not `item`: `item` is a variable in this function, and a
  -- table alias by the same name would be read as the variable — every line
  -- would come out as a copy of the last one the loop looked at.
  insert into order_items (order_id, product_id, product_name, size, price, qty)
  select
    new_id,
    e.value ->> 'product_id',
    e.value ->> 'product_name',
    e.value ->> 'size',
    (e.value ->> 'price')::numeric,
    (e.value ->> 'qty')::int
  from jsonb_array_elements(payload -> 'items') as e;

  return new_id;
end;
$$;

revoke all on function place_order(jsonb) from public;
grant execute on function place_order(jsonb) to anon, authenticated;


-- The old anon INSERT policies are dropped in the RLS section above, so this
-- function is the only path that can create an order.


-- ---------------------------------------------------------------------------
-- Courier hand-off
-- ---------------------------------------------------------------------------
-- Filled in when an order is pushed to a courier from the admin panel. The
-- columns exist ahead of the integration itself so nothing has to change in
-- the database the day the API keys arrive — only the edge function does.
--
-- courier            — 'pathao' | 'steadfast' | 'redx'
-- consignment_id     — whatever the courier calls its tracking number
-- courier_status     — the courier's own wording, last time we asked
-- courier_synced_at  — when we last asked

alter table orders add column if not exists courier text;
alter table orders add column if not exists consignment_id text;
alter table orders add column if not exists courier_status text;
alter table orders add column if not exists courier_synced_at timestamptz;

create index if not exists orders_consignment_idx on orders (consignment_id)
  where consignment_id is not null;


-- ---------------------------------------------------------------------------
-- Wishlist / restock demand
-- ---------------------------------------------------------------------------
-- A sold-out size has nowhere for a customer to go, so the product page asks
-- for an email instead: one row per person per size they're waiting on. It is
-- the demand signal for the next production run as much as a mailing list —
-- the admin panel counts the rows to show what people are actually asking for.
--
-- size          — the size they want; null means the whole product
-- notified_at   — set when the "it's back" mail goes out, so nobody is mailed
--                 twice for the same restock

create table if not exists wishlist (
  id bigint generated always as identity primary key,
  product_id text not null,
  product_name text not null,
  size text,
  email text not null,
  notified_at timestamptz,
  created_at timestamptz default now()
);

-- One person, one size, one open request. Only unnotified rows are covered:
-- once the mail has gone out, that person is free to join the queue again the
-- next time the size sells out.
create unique index if not exists wishlist_open_request_idx
  on wishlist (product_id, coalesce(size, ''), lower(email))
  where notified_at is null;

create index if not exists wishlist_product_idx on wishlist (product_id);

alter table wishlist enable row level security;

-- Customers can join the list and nothing else. They can't read it back, so
-- one person can't harvest anyone else's address — the product page remembers
-- locally that they signed up.

drop policy if exists "Anyone can join the wishlist" on wishlist;
create policy "Anyone can join the wishlist"
  on wishlist for insert
  to anon
  with check (true);

drop policy if exists "Signed-in admins manage the wishlist" on wishlist;
create policy "Signed-in admins manage the wishlist"
  on wishlist for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- Shop menu categories
-- ---------------------------------------------------------------------------
-- Backs both nav dropdowns: SHOP and DROPS. It's a table of its own rather
-- than a scan of the catalog, so an entry can be taken off the menu the moment
-- it sells out without deleting the products sitting behind it. While a menu
-- has no rows it falls back to what the catalog contains, so the site keeps
-- working until the first row is added.
--
-- menu = 'shop'  → the label matches a product's category
-- menu = 'drops' → the label matches a product's drop name

create table if not exists nav_categories (
  id bigint generated always as identity primary key,
  label text not null,
  menu text not null default 'shop',
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz default now()
);

-- Separate from the create above so an install made before DROPS existed picks
-- the column up on a re-run. Existing rows are all SHOP categories.
alter table nav_categories add column if not exists menu text not null default 'shop';

alter table nav_categories enable row level security;

-- Customers only ever see the visible rows; hidden ones aren't sent to the
-- browser at all. Managing the list requires a signed-in admin account.

drop policy if exists "Anyone can read the visible shop menu" on nav_categories;
create policy "Anyone can read the visible shop menu"
  on nav_categories for select
  to anon
  using (active = true);

drop policy if exists "Signed-in admins manage the shop menu" on nav_categories;
create policy "Signed-in admins manage the shop menu"
  on nav_categories for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- Product page extras
-- ---------------------------------------------------------------------------
-- details      — the bullet copy behind the DETAILS panel, one bullet per line.
-- size_chart   — this product's own measurements, because a jacket and a tee
--                don't share a chart. Shape:
--                {"columns":["S","M"],
--                 "rows":[{"label":"CHEST","values":["52","55"]}],
--                 "notes":["Measured flat, in cm"]}
-- colour_group — products sharing a value are the same piece in another colour
--                and list each other on the product page. Leave it empty for a
--                product that comes in one colour only.

alter table products add column if not exists details text;
alter table products add column if not exists size_chart jsonb;
alter table products add column if not exists colour_group text;

create index if not exists products_colour_group_idx on products (colour_group);


-- ---------------------------------------------------------------------------
-- About page
-- ---------------------------------------------------------------------------
-- The /about page is a stack of image + text blocks rather than fixed copy, so
-- the story can be rewritten and reshot from the admin panel without a deploy.
-- Each row is one photo with the words that sit under it.

create table if not exists about_blocks (
  id bigint generated always as identity primary key,
  image_url text not null,
  description text,
  sort_order int default 0,
  active boolean default true,
  created_at timestamptz default now()
);

alter table about_blocks enable row level security;

drop policy if exists "Anyone can read the visible about page" on about_blocks;
create policy "Anyone can read the visible about page"
  on about_blocks for select
  to anon
  using (active = true);

drop policy if exists "Signed-in admins manage the about page" on about_blocks;
create policy "Signed-in admins manage the about page"
  on about_blocks for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- Refunds & returns
-- ---------------------------------------------------------------------------
-- Nothing on the storefront creates these — a return happens over a DM or a
-- call, same as a manual order, and gets logged from the admin panel by hand.

create table if not exists order_returns (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  note text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists order_returns_order_idx on order_returns (order_id);
create index if not exists order_returns_status_idx on order_returns (status);

alter table order_returns enable row level security;

drop policy if exists "Signed-in admins manage returns" on order_returns;
create policy "Signed-in admins manage returns"
  on order_returns for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- Abandoned carts
-- ---------------------------------------------------------------------------
-- One row per browser that reached checkout with items in the cart, written
-- and updated by the browser itself as it types — see
-- src/lib/abandonedCart.js. Cleared (converted_order_id set) the moment that
-- same browser's order actually goes through.

create table if not exists abandoned_carts (
  session_id text primary key,
  customer_name text,
  customer_phone text,
  items jsonb not null default '[]',
  cart_value numeric not null default 0,
  last_active timestamptz default now(),
  created_at timestamptz default now(),
  converted_order_id text references orders(id)
);

create index if not exists abandoned_carts_active_idx on abandoned_carts (last_active)
  where converted_order_id is null;

alter table abandoned_carts enable row level security;

drop policy if exists "Anyone can save their own abandoned cart" on abandoned_carts;
create policy "Anyone can save their own abandoned cart"
  on abandoned_carts for insert
  to anon
  with check (true);

drop policy if exists "Anyone can update their own abandoned cart" on abandoned_carts;
create policy "Anyone can update their own abandoned cart"
  on abandoned_carts for update
  to anon
  using (true)
  with check (true);

drop policy if exists "Signed-in admins manage abandoned carts" on abandoned_carts;
create policy "Signed-in admins manage abandoned carts"
  on abandoned_carts for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- Cost per product
-- ---------------------------------------------------------------------------
-- What it actually cost to make or buy in, for the Products tab's margin
-- panel. Left null skips a product there rather than showing a false margin.

alter table products add column if not exists cost numeric;


-- ---------------------------------------------------------------------------
-- Product reviews
-- ---------------------------------------------------------------------------
-- Anyone can leave one from the product page — no login, no purchase check,
-- same trust level as the wishlist signup.

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


-- ---------------------------------------------------------------------------
-- Marketing (manual entry)
-- ---------------------------------------------------------------------------
-- Four small tables behind Marketing's sub-tabs — typed in by hand, nothing
-- here calls an ad/email/social API yet.

create table if not exists ad_spend (
  id bigint generated always as identity primary key,
  channel text not null,
  spend numeric not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists email_campaigns (
  id bigint generated always as identity primary key,
  campaign text not null,
  open_rate numeric not null default 0,
  click_rate numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists social_stats (
  id bigint generated always as identity primary key,
  platform text not null,
  followers int not null default 0,
  engagement_rate numeric not null default 0,
  created_at timestamptz default now()
);

create table if not exists coupon_stats (
  id bigint generated always as identity primary key,
  code text not null,
  uses int not null default 0,
  revenue numeric not null default 0,
  created_at timestamptz default now()
);

alter table ad_spend enable row level security;
alter table email_campaigns enable row level security;
alter table social_stats enable row level security;
alter table coupon_stats enable row level security;

drop policy if exists "Signed-in admins manage ad spend" on ad_spend;
create policy "Signed-in admins manage ad spend"
  on ad_spend for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage email campaigns" on email_campaigns;
create policy "Signed-in admins manage email campaigns"
  on email_campaigns for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage social stats" on social_stats;
create policy "Signed-in admins manage social stats"
  on social_stats for all to authenticated using (true) with check (true);

drop policy if exists "Signed-in admins manage coupon stats" on coupon_stats;
create policy "Signed-in admins manage coupon stats"
  on coupon_stats for all to authenticated using (true) with check (true);
