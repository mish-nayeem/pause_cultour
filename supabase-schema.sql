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

create policy "Anyone can place an order"
  on orders for insert
  to anon
  with check (true);

create policy "Anyone can add items to an order"
  on order_items for insert
  to anon
  with check (true);

-- No select/update/delete policies are created for the anon role on purpose —
-- that means customers (and anyone with just the public anon key) cannot
-- read back any order data, including their own, once submitted.
