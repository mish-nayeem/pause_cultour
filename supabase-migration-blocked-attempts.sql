-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Run supabase-migration-rate-limiting.sql before this one — it's what
-- check_rate_limit() and public.client_ip() come from.
--
-- The rate limiter blocks a flood of fake orders, but it did that silently:
-- rate_limit_hits only ever recorded an IP and a bucket name, never which
-- phone number or email the attempt was actually made with. This adds a
-- second table that captures exactly that — who a blocked place_order call
-- claimed to be — and surfaces it on the admin panel's Orders → Security tab,
-- so a burst of fake-order attempts shows up as a readable list instead of
-- something only visible by querying rate_limit_hits by hand.

begin;

create table if not exists blocked_attempts (
  id         bigint generated always as identity primary key,
  action     text not null,
  ip         text,
  phone      text,
  email      text,
  name       text,
  created_at timestamptz not null default now()
);

create index if not exists blocked_attempts_created_idx on blocked_attempts (created_at desc);

alter table blocked_attempts enable row level security;

-- Only the admin reads this back. Nothing is granted for insert/update/
-- delete — place_order (security definer) is the only writer, the same way
-- it already writes to orders/order_items despite those having no anon or
-- authenticated insert policy either.
drop policy if exists "Signed-in admins read blocked attempts" on blocked_attempts;
create policy "Signed-in admins read blocked attempts"
  on blocked_attempts for select
  to authenticated
  using (public.is_admin());

-- place_order now logs who a rate-limited attempt claimed to be before
-- raising RATE_LIMITED.
create or replace function place_order(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o          jsonb := payload -> 'order';
  id_prefix  text  := case when (o ->> 'id_prefix') in ('PC', 'PM')
                        then o ->> 'id_prefix' else 'PC' end;
  new_id     text;
  attempt    int := 0;
  item       jsonb;
  cur_stock  jsonb;
  has_row    boolean;
  left_count int;
  want       int;
  size_key   text;
begin
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
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then
        raise exception 'ORDER_ID_COLLISION';
      end if;
    end;
  end loop;

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

commit;
