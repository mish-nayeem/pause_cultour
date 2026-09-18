-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- UTM attribution: which reel, story or bio link an order actually came
-- from, instead of guessing from gut feel. Captured client-side off the
-- ?utm_* params on the link the customer clicked, carried through checkout,
-- and written onto the order.
--
-- The same statements also live in supabase-schema.sql, which is the full
-- picture of the database. This file is just the part that hasn't been run
-- yet, kept on its own so it can be copied in one go.
--
-- Safe to re-run — every statement is guarded. Nothing here touches existing
-- orders: the new columns are all nullable, so anything placed before this
-- ran just reads as "Direct / no link" in the admin panel.

alter table orders add column if not exists utm_source text;
alter table orders add column if not exists utm_medium text;
alter table orders add column if not exists utm_campaign text;
alter table orders add column if not exists utm_content text;
alter table orders add column if not exists utm_term text;

create index if not exists orders_utm_source_idx on orders (utm_source)
  where utm_source is not null;

-- place_order needs to know about the five new columns, or the values the
-- checkout sends never make it past the jsonb payload. Same function as
-- before, with utm_* added to the insert.

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

  for item in select * from jsonb_array_elements(payload -> 'items')
  loop
    size_key := item ->> 'size';
    want := (item ->> 'qty')::int;

    select p.stock, true into cur_stock, has_row
      from products p
     where p.id::text = item ->> 'product_id'
       for update;

    if not coalesce(has_row, false) then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

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
