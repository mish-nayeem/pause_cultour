-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Run after supabase-migration-security-audit.sql (this is the same
-- place_order, plus one check).
--
-- Outside Dhaka the checkout page won't submit without a bKash transaction
-- id, but only the browser checked that — a request sent by hand could place
-- an outside-Dhaka order with no advance at all. place_order now refuses one
-- (TRX_REQUIRED) unless the id looks like a bKash TrxID. The admin's manual
-- order form is exempt, so a DM sale can still be entered before the advance
-- arrives.

begin;

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

  -- The same delivery rule as src/lib/delivery.js (quote / zoneForDistrict):
  -- Dhaka district is COD at 80, everywhere else is 120 with a 200 bKash
  -- advance, never more than the order itself. Change both together.
  if (o ->> 'customer_area') = 'Dhaka' then
    zone_key := 'inside';  zone_fee := 80;  zone_advance := 0;
  else
    zone_key := 'outside'; zone_fee := 120; zone_advance := 200;
  end if;

  calc_total   := calc_subtotal + zone_fee;
  calc_advance := least(zone_advance, calc_total);

  if (o ->> 'subtotal')::numeric       is distinct from calc_subtotal
     or (o ->> 'delivery_zone')        is distinct from zone_key
     or (o ->> 'delivery_fee')::numeric   is distinct from zone_fee
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
        utm_source, utm_medium, utm_campaign, utm_content, utm_term
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
        o ->> 'utm_term'
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
