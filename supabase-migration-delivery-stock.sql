-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Everything the delivery charge, the outside-Dhaka bKash advance and the
-- per-size stock count need. Safe to re-run — every statement is guarded.
--
-- The same statements also live in supabase-schema.sql, which is the full
-- picture of the database. This file is just the part that hasn't been run
-- yet, kept on its own so it can be copied in one go.
--
-- Nothing here touches existing rows: the new columns are all nullable, so
-- orders taken before delivery charges existed stay exactly as they are, and
-- products with no stock map keep selling with no limit, as they do today.


-- ---------------------------------------------------------------------------
-- 1. Delivery charge and the outside-Dhaka advance
-- ---------------------------------------------------------------------------
-- delivery_zone   — 'inside' or 'outside' (Dhaka)
-- delivery_fee    — what was charged for delivery on this order (80 / 120)
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
-- 2. Per-size stock
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
-- 3. place_order — the only way an order gets written
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
    total, advance_amount, advance_method, advance_trx_id
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
    o ->> 'advance_trx_id'
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


-- ---------------------------------------------------------------------------
-- 4. Close the old door
-- ---------------------------------------------------------------------------
-- These two policies let the checkout insert straight into the tables, back
-- when it wrote the order itself. While either exists, anyone holding the
-- public anon key can write an order that never passed the stock check —
-- which is the one thing place_order exists to prevent.
--
-- Safe to run here because the storefront isn't open to customers yet: there
-- is no browser out there still holding a build that inserts directly. Once
-- the site is live, dropping these would break a checkout mid-flight for
-- anyone on a cached older build, so it would want its own quiet moment.

drop policy if exists "Anyone can place an order" on orders;
drop policy if exists "Anyone can add items to an order" on order_items;


-- ---------------------------------------------------------------------------
-- 5. Wishlist / restock demand
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
-- 6. Courier hand-off
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
