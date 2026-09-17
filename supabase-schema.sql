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

-- Row Level Security: customers can only INSERT (place an order).
-- They cannot read, edit, or delete orders — including other people's.
-- You'll read/manage orders yourself from the Supabase dashboard (Table Editor),
-- which uses your logged-in account and bypasses these customer-facing policies.

alter table orders enable row level security;
alter table order_items enable row level security;

-- Every policy is dropped first so this whole file can be re-run safely. The
-- Supabase SQL editor runs the script as one transaction, so a "policy already
-- exists" error part-way down would roll back everything below it too.

drop policy if exists "Anyone can place an order" on orders;
create policy "Anyone can place an order"
  on orders for insert
  to anon
  with check (true);

drop policy if exists "Anyone can add items to an order" on order_items;
create policy "Anyone can add items to an order"
  on order_items for insert
  to anon
  with check (true);

-- No select/update/delete policies are created for the anon role on purpose —
-- that means customers (and anyone with just the public anon key) cannot
-- read back any order data, including their own, once submitted.


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
