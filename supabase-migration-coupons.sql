-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Coupons. Run after supabase-migration-bkash-verify.sql (this place_order
-- builds on that one), then deploy the new send-order-confirmation so the
-- emails show the discount.

begin;

-- ---------------------------------------------------------------------------
-- Coupons
-- ---------------------------------------------------------------------------
-- A code the customer types at checkout for money off the items (never the
-- delivery charge). Made and switched on/off in Admin → Marketing → Coupons.
--
-- kind               — 'percent' (value = 10 → 10% off) or 'fixed' (value = 200 → ৳200 off)
-- min_subtotal       — the items have to come to at least this
-- max_discount       — cap on a percent coupon (10% off, at most ৳500); null = no cap
-- usage_limit        — total orders that can use it; null = unlimited
-- per_customer_limit — orders per phone number; null = unlimited
-- starts_at/ends_at  — when it works; null = no limit that side
--
-- Visitors can't read this table — codes stay secret until someone types
-- one. check_coupon answers for a single code; place_order re-checks it and
-- works the discount out itself, so the browser's number is never trusted.
-- A cancelled order doesn't count as a use.

create table if not exists coupons (
  code text primary key check (code ~ '^[A-Z0-9_-]{3,24}$'),
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric not null check (value > 0),
  min_subtotal numeric not null default 0,
  max_discount numeric,
  usage_limit int,
  per_customer_limit int default 1,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz default now(),
  constraint coupons_percent_range check (kind <> 'percent' or value <= 100)
);

alter table coupons enable row level security;

drop policy if exists "Signed-in admins manage coupons" on coupons;
create policy "Signed-in admins manage coupons"
  on coupons for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table orders add column if not exists coupon_code text;
alter table orders add column if not exists discount_amount numeric not null default 0;

create index if not exists orders_coupon_code_idx on orders (coupon_code) where coupon_code is not null;

-- The discount a coupon gives on these items, or a tagged error saying why
-- it can't be used:
--   COUPON_INVALID        — no such code, or switched off
--   COUPON_NOT_STARTED    — before starts_at
--   COUPON_EXPIRED        — after ends_at
--   COUPON_MIN:<amount>   — items under min_subtotal
--   COUPON_USED_UP        — usage_limit reached
--   COUPON_ALREADY_USED   — this phone number has used it up
-- Phone numbers are compared on their last nine digits, so 017…, +88017…
-- and 88017… are the same customer.
create or replace function public.coupon_discount(p_code text, p_subtotal numeric, p_phone text)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c     coupons%rowtype;
  used  int;
  phone text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  d     numeric;
begin
  select * into c from coupons where code = upper(trim(p_code));

  if not found or not c.active then
    raise exception 'COUPON_INVALID';
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    raise exception 'COUPON_NOT_STARTED';
  end if;
  if c.ends_at is not null and now() > c.ends_at then
    raise exception 'COUPON_EXPIRED';
  end if;
  if p_subtotal < c.min_subtotal then
    raise exception 'COUPON_MIN:%', c.min_subtotal;
  end if;

  if c.usage_limit is not null then
    select count(*) into used from orders
     where coupon_code = c.code and status is distinct from 'cancelled';
    if used >= c.usage_limit then
      raise exception 'COUPON_USED_UP';
    end if;
  end if;

  if c.per_customer_limit is not null and phone <> '' then
    select count(*) into used from orders
     where coupon_code = c.code
       and status is distinct from 'cancelled'
       and right(regexp_replace(customer_phone, '\D', '', 'g'), 9) = phone;
    if used >= c.per_customer_limit then
      raise exception 'COUPON_ALREADY_USED';
    end if;
  end if;

  if c.kind = 'percent' then
    d := round(p_subtotal * c.value / 100);
    if c.max_discount is not null then
      d := least(d, c.max_discount);
    end if;
  else
    d := c.value;
  end if;

  return least(d, p_subtotal);
end;
$$;

revoke all on function public.coupon_discount(text, numeric, text) from public;

-- The checkout's "Apply" button. Rate-limited (20 tries per IP per hour) so
-- nobody can sit guessing codes; returns the code and what it takes off.
create or replace function public.check_coupon(p_code text, p_subtotal numeric, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  d numeric;
begin
  if not public.check_rate_limit('coupon_check', 20, 3600) then
    raise exception 'RATE_LIMITED';
  end if;

  d := public.coupon_discount(p_code, p_subtotal, p_phone);
  return jsonb_build_object('code', upper(trim(p_code)), 'discount', d);
end;
$$;

revoke all on function public.check_coupon(text, numeric, text) from public;
grant execute on function public.check_coupon(text, numeric, text) to anon, authenticated;

-- place_order: the same function, now taking a coupon off the items.
create or replace function place_order(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o          jsonb := payload -> 'order';
  -- Generated below, not trusted from the caller — a client-made-up id
  -- (the old 'PC' + Math.random() over 6 digits, ~900,000 possibilities)
  -- was small enough to brute-force against send-order-confirmation's
  -- unauthenticated orderId lookup. 'PC' (storefront) or 'PM' (manual/DM
  -- sale) is still the caller's choice; anything else collapses to 'PC'.
  id_prefix  text  := case when (o ->> 'id_prefix') in ('PC', 'PM')
                        then o ->> 'id_prefix' else 'PC' end;
  new_id     text;
  attempt    int := 0;
  item       jsonb;
  cur_stock  jsonb;
  -- Not called `found`: plpgsql owns that name, and a SELECT INTO that
  -- matches nothing leaves this null rather than false, so it is read
  -- through coalesce below.
  has_row    boolean;
  left_count int;
  want       int;
  size_key   text;
  -- Money is worked out here from the products table, not taken from the
  -- caller. The cart's prices, subtotal and total all come from the browser,
  -- where devtools can set a 3200 taka piece to 1 — so every one of them is
  -- recomputed below and the order refused if what was sent doesn't match.
  db_price      numeric;
  calc_subtotal numeric := 0;
  zone_key      text;
  zone_fee      numeric;
  zone_advance  numeric;
  calc_total    numeric;
  calc_advance  numeric;
  -- Coupon: the code as typed, and the money off it gives (0 without one).
  coupon        text := nullif(upper(trim(coalesce(o ->> 'coupon_code', ''))), '');
  calc_discount numeric := 0;
begin
  -- Admin's own manual-order entry (ManualOrderForm.jsx) calls this same
  -- function from a signed-in session while working through a batch of DM
  -- sales — is_admin() skips the limit entirely rather than risking a
  -- lockout mid-batch. A real shopper places one order per cart, not eight
  -- in an hour, so this only ever bites a script.
  if not public.is_admin() and not public.check_rate_limit('place_order', 8, 3600) then
    insert into blocked_attempts (action, ip, phone, email, name)
    values (
      'place_order',
      public.client_ip(),
      o ->> 'customer_phone',
      o ->> 'customer_email',
      o ->> 'customer_name'
    );
    raise exception 'RATE_LIMITED';
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

    -- A zero or negative qty would put stock back on the shelf and knock
    -- money off the subtotal.
    if want is null or want < 1 then
      raise exception 'INVALID_QTY:%', item ->> 'product_name';
    end if;

    -- FOR UPDATE holds the row until this transaction ends, so a second
    -- checkout for the same product waits here instead of reading the same
    -- count and selling the same piece twice.
    select p.stock, p.price, true into cur_stock, db_price, has_row
      from products p
     where p.id::text = item ->> 'product_id'
       for update;

    if not coalesce(has_row, false) then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

    -- The line's price has to be the shelf price. A mismatch is either a
    -- tampered request or a cart saved before the price was changed — either
    -- way, not an order to take at the price the browser says.
    if (item ->> 'price')::numeric is distinct from db_price then
      raise exception 'PRICE_CHANGED:%', item ->> 'product_name';
    end if;

    calc_subtotal := calc_subtotal + db_price * want;

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

  -- A coupon is re-checked here and its discount worked out from the real
  -- subtotal. The row is locked first, so two orders racing for a coupon's
  -- last use can't both get it.
  if coupon is not null then
    perform 1 from coupons where code = coupon for update;
    calc_discount := public.coupon_discount(coupon, calc_subtotal, o ->> 'customer_phone');
  end if;

  -- The same delivery rule as src/lib/delivery.js (quote / zoneForDistrict):
  -- Dhaka district is COD at 80, everywhere else is 120 with a 200 bKash
  -- advance, never more than the order itself. Change both together.
  if (o ->> 'customer_area') = 'Dhaka' then
    zone_key := 'inside';  zone_fee := 80;  zone_advance := 0;
  else
    zone_key := 'outside'; zone_fee := 120; zone_advance := 200;
  end if;

  calc_total   := calc_subtotal - calc_discount + zone_fee;
  calc_advance := least(zone_advance, calc_total);

  if (o ->> 'subtotal')::numeric       is distinct from calc_subtotal
     or (o ->> 'delivery_zone')        is distinct from zone_key
     or (o ->> 'delivery_fee')::numeric   is distinct from zone_fee
     or coalesce((o ->> 'discount_amount')::numeric, 0) is distinct from calc_discount
     or (o ->> 'total')::numeric          is distinct from calc_total
     or (o ->> 'advance_amount')::numeric is distinct from calc_advance then
    raise exception 'PRICE_MISMATCH';
  end if;

  -- Outside Dhaka the bKash advance is the order, and the checkout page
  -- won't submit without its transaction id — but that check lived only in
  -- the browser. A storefront order skipping it is refused here too. The
  -- admin's manual form is exempt: a DM sale can be entered before the
  -- advance arrives, with the id filled in later.
  if calc_advance > 0 and not public.is_admin()
     and coalesce(o ->> 'advance_trx_id', '') !~ '^[A-Z0-9]{8,16}$' then
    raise exception 'TRX_REQUIRED';
  end if;

  -- Id generated here, retried only on the (extremely unlikely) collision —
  -- the stock already taken above is never double-counted since only this
  -- insert, not the loop above it, runs again.
  loop
    new_id := id_prefix || lpad(floor(random() * 10000000000)::bigint::text, 10, '0');

    begin
      insert into orders (
        id, customer_name, customer_phone, customer_email, customer_address,
        customer_area, customer_note, subtotal, delivery_zone, delivery_fee,
        total, advance_amount, advance_method, advance_trx_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        advance_verified_at, coupon_code, discount_amount
      ) values (
        new_id,
        o ->> 'customer_name',
        o ->> 'customer_phone',
        o ->> 'customer_email',
        o ->> 'customer_address',
        o ->> 'customer_area',
        o ->> 'customer_note',
        calc_subtotal,
        zone_key,
        zone_fee,
        calc_total,
        calc_advance,
        o ->> 'advance_method',
        o ->> 'advance_trx_id',
        o ->> 'utm_source',
        o ->> 'utm_medium',
        o ->> 'utm_campaign',
        o ->> 'utm_content',
        o ->> 'utm_term',
        -- A DM sale the admin typed in is already checked against bKash;
        -- a storefront one waits in Orders → bKash check.
        case when calc_advance > 0 and public.is_admin() then now() end,
        coupon,
        calc_discount
      );
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then
        raise exception 'ORDER_ID_COLLISION';
      end if;
    end;
  end loop;

  -- Aliased `e`, not `item`: `item` is a variable in this function, and a
  -- table alias by the same name would be read as the variable — every line
  -- would come out as a copy of the last one the loop looked at.
  insert into order_items (order_id, product_id, product_name, size, price, qty)
  select
    new_id,
    e.value ->> 'product_id',
    e.value ->> 'product_name',
    e.value ->> 'size',
    -- Checked equal to products.price in the loop above, so the stored line
    -- price is the shelf price.
    (e.value ->> 'price')::numeric,
    (e.value ->> 'qty')::int
  from jsonb_array_elements(payload -> 'items') as e;

  return new_id;
end;
$$;


revoke all on function place_order(jsonb) from public;
grant execute on function place_order(jsonb) to anon, authenticated;

commit;
