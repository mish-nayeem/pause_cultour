


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."adjust_size_stock"("p_product_id" "text", "p_size" "text", "p_delta" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  cur jsonb;
  next_n int;
begin
  select stock into cur from products where id::text = p_product_id for update;
  if cur is null or not (cur ? p_size) then
    return null;
  end if;
  next_n := coalesce((cur ->> p_size)::int, 0) + p_delta;
  if next_n < 0 then
    raise exception 'Not enough stock: only % left in size %.', coalesce((cur ->> p_size)::int, 0), p_size;
  end if;
  update products set stock = jsonb_set(stock, array[p_size], to_jsonb(next_n)) where id::text = p_product_id;
  return next_n;
end;
$$;


ALTER FUNCTION "public"."adjust_size_stock"("p_product_id" "text", "p_size" "text", "p_delta" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_analytics"("p_days" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  n int := greatest(1, least(coalesce(p_days, 30), 365));
  since timestamptz := now() - make_interval(days => n);
  prev_since timestamptz := now() - make_interval(days => n * 2);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  with v as (
    select session_id, path, referrer, device, created_at
    from page_views
    where created_at >= since
  ),
  s as (
    select
      session_id,
      count(*) as views,
      bool_or(path like '/product/%') as saw_product,
      bool_or(path = '/cart') as saw_cart,
      bool_or(path = '/checkout') as saw_checkout,
      bool_or(path = '/order-confirmed') as ordered,
      (array_agg(path order by created_at))[1] as entry,
      (array_agg(referrer order by created_at))[1] as ref,
      (array_agg(device order by created_at))[1] as dev
    from v
    group by session_id
  )
  select jsonb_build_object(
    'days', n,
    'visitors', (select count(*) from s),
    'views', (select count(*) from v),
    'bounced', (select count(*) from s where views = 1),
    'prev_visitors', (
      select count(distinct session_id) from page_views
      where created_at >= prev_since and created_at < since
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d, 'visitors', vis, 'views', vw) order by d), '[]'::jsonb)
      from (
        select (created_at at time zone 'Asia/Dhaka')::date as d,
               count(distinct session_id) as vis, count(*) as vw
        from v group by 1
      ) x
    ),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'visitors', vis) order by h), '[]'::jsonb)
      from (
        select extract(hour from created_at at time zone 'Asia/Dhaka')::int as h,
               count(distinct session_id) as vis
        from v group by 1
      ) x
    ),
    'funnel', jsonb_build_object(
      'visited', (select count(*) from s),
      'product', (select count(*) from s where saw_product),
      'cart', (select count(*) from s where saw_cart),
      'checkout', (select count(*) from s where saw_checkout),
      'ordered', (select count(*) from s where ordered)
    ),
    'products', (
      select coalesce(jsonb_agg(jsonb_build_object('id', pid, 'views', vw, 'visitors', vis) order by vw desc), '[]'::jsonb)
      from (
        select split_part(split_part(substr(path, 10), '?', 1), '/', 1) as pid,
               count(*) as vw, count(distinct session_id) as vis
        from v where path like '/product/%'
        group by 1 order by 2 desc limit 40
      ) x
    ),
    'sources', (
      select coalesce(jsonb_agg(jsonb_build_object('source', src, 'visitors', c) order by c desc), '[]'::jsonb)
      from (
        select case
                 when ref is null or ref = '' then 'direct'
                 else regexp_replace(regexp_replace(lower(ref), '^[a-z]+://(www\.|m\.|l\.|lm\.|mobile\.)?', ''), '[/:?#].*$', '')
               end as src,
               count(*) as c
        from s group by 1 order by 2 desc limit 20
      ) x
    ),
    'devices', (
      select coalesce(jsonb_object_agg(coalesce(dev, 'unknown'), c), '{}'::jsonb)
      from (select dev, count(*) as c from s group by 1) x
    ),
    'pages', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'views', c)), '[]'::jsonb)
      from (select path, count(*) as c from v group by 1 order by 2 desc limit 300) x
    ),
    'entries', (
      select coalesce(jsonb_agg(jsonb_build_object('path', entry, 'entries', c, 'bounces', b)), '[]'::jsonb)
      from (select entry, count(*) as c, count(*) filter (where views = 1) as b from s group by 1) x
    )
  ) into result;

  return result;
end;
$_$;


ALTER FUNCTION "public"."admin_analytics"("p_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_customer_accounts"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'email', u.email,
        'joined_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'name', coalesce(p.name, u.raw_user_meta_data ->> 'full_name'),
        'phone', p.phone,
        'district', p.district,
        'thana', p.thana,
        'postcode', p.postcode,
        'address', p.address,
        'profile_updated_at', p.updated_at,
        'subscribed', exists (select 1 from subscribers s where lower(s.email) = lower(u.email))
      ) order by u.created_at desc), '[]'::jsonb)
    from auth.users u
    left join customer_profiles p on p.user_id = u.id
    where u.email is not null
  );
end;
$$;


ALTER FUNCTION "public"."admin_customer_accounts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_mark_confirmed"("p_order_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update orders
     set customer_mail_sent_at = coalesce(customer_mail_sent_at, now())
   where id = p_order_id and advance_verified_at is not null;
end;
$$;


ALTER FUNCTION "public"."admin_mark_confirmed"("p_order_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_process_return"("p_return_id" bigint, "p_action" "text", "p_items" "jsonb", "p_refund" numeric, "p_note" "text", "p_fee" numeric DEFAULT 0, "p_fee_paid" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ret order_returns%rowtype;
  x jsonb;
  oi order_items%rowtype;
  q int;
  free_qty int;
  to_size text;
  done jsonb := '[]'::jsonb;
  left_from int;
  left_to int;
  refund numeric := greatest(coalesce(p_refund, 0), 0);
  fee numeric := greatest(coalesce(p_fee, 0), 0);
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into ret from order_returns where id = p_return_id for update;
  if not found then
    raise exception 'That request no longer exists.';
  end if;
  if ret.status not in ('open', 'approved') then
    raise exception 'This request has already been %.', ret.status;
  end if;

  if p_action = 'reject' then
    update order_returns
       set status = 'rejected', admin_note = nullif(trim(coalesce(p_note, '')), ''),
           resolution = jsonb_build_object('action', 'reject', 'at', now()),
           processed_at = now(), resolved_at = now(), seen_at = coalesce(seen_at, now())
     where id = p_return_id;
    return jsonb_build_object('action', 'reject');
  end if;

  if p_action not in ('exchange', 'refund') then
    raise exception 'Choose exchange, refund or reject.';
  end if;

  for x in select * from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end)
  loop
    select * into oi from order_items
     where id = (x ->> 'item_id')::bigint and order_id = ret.order_id
     for update;
    if not found then
      raise exception 'A piece in this request isn''t on order %.', ret.order_id;
    end if;

    -- Pieces on this line still with the customer.
    free_qty := oi.qty - coalesce(oi.returned_qty, 0) - coalesce(oi.rejected_qty, 0);
    q := least(greatest(coalesce((x ->> 'qty')::int, 0), 0), free_qty);
    if q = 0 then
      continue;
    end if;

    if p_action = 'exchange' then
      to_size := trim(coalesce(x ->> 'to_size', ''));
      if to_size = '' then
        raise exception 'Pick the new size for %.', oi.product_name;
      end if;
      if to_size = oi.size then
        raise exception 'The new size for % is the same as the old one.', oi.product_name;
      end if;
      -- The new size first, so a size that's run out stops it before
      -- anything has moved.
      left_to := public.adjust_size_stock(oi.product_id, to_size, -q);
      left_from := public.adjust_size_stock(oi.product_id, oi.size, q);

      -- The order follows: the whole line changes size, or the exchanged
      -- pieces become a line of their own.
      if q = oi.qty and coalesce(oi.returned_qty, 0) = 0 and coalesce(oi.rejected_qty, 0) = 0 then
        update order_items
           set size = to_size, exchanged_from = coalesce(exchanged_from, oi.size)
         where id = oi.id;
      else
        update order_items set qty = qty - q where id = oi.id;
        insert into order_items (order_id, product_id, product_name, size, price, qty, exchanged_from)
        values (oi.order_id, oi.product_id, oi.product_name, to_size, oi.price, q, oi.size);
      end if;

      done := done || jsonb_build_object(
        'item_id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
        'qty', q, 'from_size', oi.size, 'to_size', to_size,
        'from_left', left_from, 'to_left', left_to
      );
    else
      left_from := public.adjust_size_stock(oi.product_id, oi.size, q);
      update order_items set returned_qty = returned_qty + q where id = oi.id;
      done := done || jsonb_build_object(
        'item_id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
        'qty', q, 'size', oi.size, 'price', oi.price, 'left', left_from
      );
    end if;
  end loop;

  if jsonb_array_length(done) = 0 then
    raise exception 'Pick at least one piece.';
  end if;

  if p_action = 'refund' and refund > 0 then
    update orders set refunded_amount = refunded_amount + refund where id = ret.order_id;
  end if;

  -- The exchange parcel's delivery: always the courier's; ours to bear
  -- only when the customer didn't pay it.
  if p_action in ('exchange', 'refund') and fee > 0 then -- refund pickup patched
    update orders
       set exchange_fees = exchange_fees + fee,
           exchange_fee_unpaid = exchange_fee_unpaid + case when p_action = 'refund' or not coalesce(p_fee_paid, true) then fee else 0 end
     where id = ret.order_id;
  end if;

  result := jsonb_build_object(
    'action', p_action,
    'at', now(),
    'items', done,
    'refund', case when p_action = 'refund' then refund else 0 end,
    'fee', fee,
    'fee_paid', case when p_action = 'refund' then false else coalesce(p_fee_paid, true) end
  );

  update order_returns
     set status = 'resolved', kind = p_action, resolution = result,
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         processed_at = now(), resolved_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_return_id;

  return result;
end;
$$;


ALTER FUNCTION "public"."admin_process_return"("p_return_id" bigint, "p_action" "text", "p_items" "jsonb", "p_refund" numeric, "p_note" "text", "p_fee" numeric, "p_fee_paid" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_reject_item"("p_item_id" bigint, "p_undo" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  oi     order_items%rowtype;
  st     text;
  q      int;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into oi from order_items where id = p_item_id for update;
  if not found then
    raise exception 'That item is no longer on the order.';
  end if;

  select status into st from orders where id = oi.order_id for update;
  if st in ('cancelled', 'returned') then
    raise exception 'This order is %, so its pieces are already back in stock.', st;
  end if;

  if not p_undo then
    q := oi.qty - coalesce(oi.returned_qty, 0) - coalesce(oi.rejected_qty, 0);
    if q <= 0 then
      return oi.rejected_qty;
    end if;
    perform public.adjust_size_stock(oi.product_id, oi.size, q);
    update order_items set rejected_qty = rejected_qty + q where id = oi.id;
    return oi.rejected_qty + q;
  end if;

  q := coalesce(oi.rejected_qty, 0);
  if q = 0 then
    return 0;
  end if;
  perform public.adjust_size_stock(oi.product_id, oi.size, -q);
  update order_items set rejected_qty = 0 where id = oi.id;
  return 0;
end;
$$;


ALTER FUNCTION "public"."admin_reject_item"("p_item_id" bigint, "p_undo" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_return_fee"("p_order_id" "text", "p_paid" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update orders set return_fee_paid = p_paid where id = p_order_id;
end;
$$;


ALTER FUNCTION "public"."admin_set_return_fee"("p_order_id" "text", "p_paid" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_utm_visits"("p_from" timestamp with time zone, "p_to" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
        'source', s.utm_source,
        'campaign', s.utm_campaign,
        'visits', s.visits
      )), '[]'::jsonb)
    from (
      select utm_source, utm_campaign, count(distinct session_id) as visits
        from page_views
       where utm_source is not null
         and created_at >= p_from
         and created_at < p_to
       group by utm_source, utm_campaign
    ) s
  );
end;
$$;


ALTER FUNCTION "public"."admin_utm_visits"("p_from" timestamp with time zone, "p_to" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ip         text := public.client_ip();
  bucket_key text;
  hits       int;
begin
  if ip is null then
    return true;
  end if;

  bucket_key := action || ':' || ip;

  delete from rate_limit_hits
   where bucket = bucket_key
     and created_at < now() - (window_seconds || ' seconds')::interval;

  select count(*) into hits from rate_limit_hits where bucket = bucket_key;

  if hits >= max_count then
    return false;
  end if;

  insert into rate_limit_hits (bucket) values (bucket_key);
  return true;
end;
$$;


ALTER FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."client_ip"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  raw   text;
  parts text[];
begin
  raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  if raw is null or trim(raw) = '' then
    return null;
  end if;

  parts := string_to_array(raw, ',');
  return trim(parts[array_length(parts, 1)]);
end;
$$;


ALTER FUNCTION "public"."client_ip"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'contact.pausecultour@gmail.com', false)
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."launch_cutoff"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select now() + case
    when auth.uid() is not null then make_interval(mins => greatest(0, coalesce(
      (select round((value #>> '{}')::numeric * 60)::int from site_settings where key = 'early_access_hours'),
      0)))
    else interval '0'
  end;
$$;


ALTER FUNCTION "public"."launch_cutoff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update abandoned_carts
     set converted_order_id = p_order_id
   where session_id = p_session_id
     and converted_order_id is null
     and exists (select 1 from orders where id = p_order_id);
end;
$$;


ALTER FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."my_orders"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.created_at desc), '[]'::jsonb)
  from (
    select
      o.id, o.status, o.created_at, o.subtotal, o.discount_amount, o.delivery_fee,
      o.total, o.advance_amount, o.customer_name, o.customer_phone,
      o.customer_address, o.customer_area, o.consignment_id, o.courier,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'product_id', i.product_id, 'product_name', i.product_name,
          'size', i.size, 'qty', i.qty, 'price', i.price
        ) order by i.id), '[]'::jsonb)
        from order_items i where i.order_id = o.id) as items
    from orders o
    where auth.uid() is not null
      and coalesce(auth.jwt() ->> 'email', '') <> ''
      and lower(o.customer_email) = lower(auth.jwt() ->> 'email')
  ) x;
$$;


ALTER FUNCTION "public"."my_orders"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_new_order"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
begin
  begin
    perform net.http_post(
      url := 'https://rzylwwrpzkqjyxxkstjo.supabase.co/functions/v1/notify',
      body := jsonb_build_object('action', 'order', 'order_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;


ALTER FUNCTION "public"."notify_new_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."place_order"("payload" "jsonb") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
  db_drop       text;
  db_publish    timestamptz;
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
    select p.stock, p.price, p.drop_name, p.publish_at, true into cur_stock, db_price, db_drop, db_publish, has_row
      from products p
     where p.id::text = item ->> 'product_id'
       for update;

    if not coalesce(has_row, false) then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

    -- Scheduled for later (products.publish_at): not on sale yet, however
    -- the request got hold of its id. The admin can still enter a DM sale.
    if db_publish is not null and db_publish > public.launch_cutoff() and not public.is_admin() then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

    -- A running sale (Admin → Marketing → Sales) lowers the shelf price for
    -- as long as it lasts; the storefront shows the same number.
    db_price := public.sale_price(db_price, item ->> 'product_id', db_drop);

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
$_$;


ALTER FUNCTION "public"."place_order"("payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ip   text := public.client_ip();
  hits int;
begin
  if ip is null then
    return true;
  end if;

  select count(*) into hits
    from rate_limit_hits
   where bucket = action || ':' || ip
     and created_at > now() - (window_seconds || ' seconds')::interval;

  return hits < max_count;
end;
$$;


ALTER FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_rate_limit_hit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  ip             text := public.client_ip();
  action         text := TG_ARGV[0];
  window_seconds int  := TG_ARGV[1]::int;
  bucket_key     text;
begin
  if ip is not null then
    bucket_key := action || ':' || ip;

    delete from rate_limit_hits
     where bucket = bucket_key
       and created_at < now() - (window_seconds || ' seconds')::interval;

    insert into rate_limit_hits (bucket) values (bucket_key);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."record_rate_limit_hit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reorder_products"("ids" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  update products p
     set shop_position = x.ord
    from unnest(ids) with ordinality as x(id, ord)
   where p.id = x.id;
end;
$$;


ALTER FUNCTION "public"."reorder_products"("ids" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  pct int;
begin
  select max(s.percent) into pct
    from sales s
   where s.active
     and s.starts_at <= now()
     and s.ends_at > now()
     and (
       (s.drop_name is null and coalesce(cardinality(s.product_ids), 0) = 0)
       or (s.drop_name is not null and s.drop_name = p_drop)
       or p_product_id = any(s.product_ids)
     );

  if pct is null then
    return p_price;
  end if;

  return round(p_price * (100 - pct) / 100);
end;
$$;


ALTER FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
begin
  -- crypto.randomUUID() in src/lib/abandonedCart.js — anything else is not
  -- from the checkout page.
  if p_session_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'BAD_SESSION';
  end if;

  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or jsonb_array_length(p_items) > 50 then
    raise exception 'BAD_ITEMS';
  end if;

  -- Only a brand-new session counts against the limit: one real checkout
  -- saves the same row over and over as the customer types, which is fine.
  -- 20 new carts per IP per hour is far past any real shopper.
  if not exists (select 1 from abandoned_carts where session_id = p_session_id)
     and not public.check_rate_limit('abandoned_cart', 20, 3600) then
    raise exception 'RATE_LIMITED';
  end if;

  insert into abandoned_carts (session_id, customer_name, customer_phone, items, cart_value, last_active)
  values (
    p_session_id,
    nullif(left(trim(p_name), 100), ''),
    nullif(left(trim(p_phone), 30), ''),
    p_items,
    greatest(coalesce(p_cart_value, 0), 0),
    now()
  )
  on conflict (session_id) do update
     set customer_name  = excluded.customer_name,
         customer_phone = excluded.customer_phone,
         items          = excluded.items,
         cart_value     = excluded.cart_value,
         last_active    = now()
   -- A session that already ordered stays counted as converted.
   where abandoned_carts.converted_order_id is null;
end;
$_$;


ALTER FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_find_order"("p_order_id" "text", "p_contact" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id text := public.support_match_order(p_order_id, p_contact);
  v_out jsonb;
begin
  if v_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'placed_at', o.created_at,
    'first_name', split_part(trim(o.customer_name), ' ', 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_name', i.product_name, 'size', i.size, 'qty', i.qty, 'price', i.price
      ) order by i.id)
      from order_items i where i.order_id = o.id
    ), '[]'::jsonb),
    'open_request', (
      select jsonb_build_object('id', r.id, 'kind', r.kind, 'status', r.status, 'created_at', r.created_at)
      from order_returns r
      where r.order_id = o.id and r.status in ('open', 'approved')
      order by r.created_at desc
      limit 1
    )
  ) into v_out
  from orders o
  where o.id = v_id;

  return v_out;
end;
$$;


ALTER FUNCTION "public"."support_find_order"("p_order_id" "text", "p_contact" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_match_order"("p_order_id" "text", "p_contact" "text") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_contact text := lower(trim(coalesce(p_contact, '')));
  v_digits text := right(regexp_replace(v_contact, '\D', '', 'g'), 9);
  v_id text;
begin
  if length(v_contact) < 5 or coalesce(trim(p_order_id), '') = '' then
    return null;
  end if;

  select o.id into v_id
  from orders o
  where o.id = upper(trim(p_order_id))
    and (
      (position('@' in v_contact) > 0 and lower(trim(coalesce(o.customer_email, ''))) = v_contact)
      or (position('@' in v_contact) = 0 and length(v_digits) = 9
          and right(regexp_replace(o.customer_phone, '\D', '', 'g'), 9) = v_digits)
    );

  return v_id;
end;
$$;


ALTER FUNCTION "public"."support_match_order"("p_order_id" "text", "p_contact" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id text := public.support_match_order(p_order_id, p_contact);
  v_status text;
  v_items jsonb;
  v_new bigint;
begin
  if v_id is null then
    raise exception 'We couldn''t find an order with those details.';
  end if;

  if p_kind not in ('refund', 'exchange') then
    raise exception 'Choose refund or exchange.';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Tell us the reason.';
  end if;

  select status into v_status from orders where id = v_id;
  if v_status is distinct from 'delivered' then
    raise exception 'Requests open once the order has been delivered.';
  end if;

  if exists (select 1 from order_returns where order_id = v_id and status in ('open', 'approved')) then
    raise exception 'There is already an open request for this order — we''ll be in touch.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_name', i.product_name,
      'size', i.size,
      'qty', least(greatest(coalesce((x ->> 'qty')::int, 1), 1), i.qty),
      'exchange_size', nullif(left(trim(coalesce(x ->> 'exchange_size', '')), 20), '')
    )), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
  join lateral (
    select * from order_items oi
    where oi.order_id = v_id and oi.product_name = x ->> 'product_name' and oi.size = x ->> 'size'
    limit 1
  ) i on true;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Pick at least one item.';
  end if;

  insert into order_returns (order_id, reason, kind, source, items, details, contact)
  values (
    v_id,
    left(trim(p_reason), 200),
    p_kind,
    'customer',
    v_items,
    nullif(left(trim(coalesce(p_details, '')), 1000), ''),
    left(trim(p_contact), 120)
  )
  returning id into v_new;

  return jsonb_build_object('id', v_new);
end;
$$;


ALTER FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  old_status text;
  was_off    boolean;
  now_off    boolean;
  item       record;
  cur_stock  jsonb;
  n          int;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  if p_new_status not in ('pending', 'shipped', 'delivered', 'cancelled', 'returned') then
    raise exception 'BAD_STATUS:%', p_new_status;
  end if;

  select status into old_status from orders where id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  was_off := old_status in ('cancelled', 'returned');
  now_off := p_new_status in ('cancelled', 'returned');

  if was_off is distinct from now_off then
    for item in
      select product_id, size, qty - coalesce(returned_qty, 0) - coalesce(rejected_qty, 0) as out_qty
        from order_items
       where order_id = p_order_id
    loop
      n := greatest(item.out_qty, 0);
      continue when n = 0;

      select stock into cur_stock from products where id::text = item.product_id for update;

      if cur_stock is not null and cur_stock ? item.size then
        update products
           set stock = jsonb_set(
             stock,
             array[item.size],
             to_jsonb(greatest(0, coalesce((stock ->> item.size)::int, 0) + case when now_off then n else -n end))
           )
         where id::text = item.product_id;
      end if;
    end loop;
  end if;

  update orders set status = p_new_status where id = p_order_id;
end;
$$;


ALTER FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_advance"("p_trx" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  -- Same cleaning as the panel's cleanTrxId: drop a pasted "TrxID" label,
  -- then anything that isn't a letter or digit.
  clean text := upper(regexp_replace(
    regexp_replace(coalesce(p_trx, ''), '^\s*trx\s*id\s*[:.#-]?\s*', '', 'i'),
    '[^A-Za-z0-9]', '', 'g'));
  o     orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into o
    from orders
   where upper(advance_trx_id) = clean
     and coalesce(advance_amount, 0) > 0
   for update;

  if not found or clean = '' then
    raise exception 'TRX_NOT_FOUND';
  end if;

  if o.advance_verified_at is not null then
    raise exception 'ALREADY_VERIFIED:%', o.id;
  end if;

  if o.status = 'cancelled' then
    raise exception 'ORDER_CANCELLED:%', o.id;
  end if;

  update orders set advance_verified_at = now() where id = o.id;
  return o.id;
end;
$$;


ALTER FUNCTION "public"."verify_advance"("p_trx" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."abandoned_carts" (
    "session_id" "text" NOT NULL,
    "customer_name" "text",
    "customer_phone" "text",
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cart_value" numeric DEFAULT 0 NOT NULL,
    "last_active" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "converted_order_id" "text"
);


ALTER TABLE "public"."abandoned_carts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."about_blocks" (
    "id" bigint NOT NULL,
    "image_url" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "heading" "text" DEFAULT ''::"text" NOT NULL
);


ALTER TABLE "public"."about_blocks" OWNER TO "postgres";


ALTER TABLE "public"."about_blocks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."about_blocks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ad_spend" (
    "id" bigint NOT NULL,
    "channel" "text" NOT NULL,
    "spend" numeric DEFAULT 0 NOT NULL,
    "revenue" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."ad_spend" OWNER TO "postgres";


ALTER TABLE "public"."ad_spend" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ad_spend_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."admin_notice_state" (
    "key" "text" NOT NULL,
    "read_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."admin_notice_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."blocked_attempts" (
    "id" bigint NOT NULL,
    "action" "text" NOT NULL,
    "ip" "text",
    "phone" "text",
    "email" "text",
    "name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."blocked_attempts" OWNER TO "postgres";


ALTER TABLE "public"."blocked_attempts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."blocked_attempts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."coupon_stats" (
    "id" bigint NOT NULL,
    "code" "text" NOT NULL,
    "uses" integer DEFAULT 0 NOT NULL,
    "revenue" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."coupon_stats" OWNER TO "postgres";


ALTER TABLE "public"."coupon_stats" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."coupon_stats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."coupons" (
    "code" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "value" numeric NOT NULL,
    "min_subtotal" numeric DEFAULT 0 NOT NULL,
    "max_discount" numeric,
    "usage_limit" integer,
    "per_customer_limit" integer DEFAULT 1,
    "starts_at" timestamp with time zone,
    "ends_at" timestamp with time zone,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "coupons_code_check" CHECK (("code" ~ '^[A-Z0-9_-]{3,24}$'::"text")),
    CONSTRAINT "coupons_kind_check" CHECK (("kind" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "coupons_percent_range" CHECK ((("kind" <> 'percent'::"text") OR ("value" <= (100)::numeric))),
    CONSTRAINT "coupons_value_check" CHECK (("value" > (0)::numeric))
);


ALTER TABLE "public"."coupons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."customer_profiles" (
    "user_id" "uuid" NOT NULL,
    "email" "text",
    "name" "text",
    "phone" "text",
    "district" "text",
    "thana" "text",
    "postcode" "text",
    "address" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."customer_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drop_costs" (
    "id" bigint NOT NULL,
    "drop_name" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "label" "text",
    "amount" numeric NOT NULL,
    "spent_on" "date" DEFAULT CURRENT_DATE NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "drop_costs_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "drop_costs_kind_check" CHECK (("kind" = ANY (ARRAY['ads'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."drop_costs" OWNER TO "postgres";


ALTER TABLE "public"."drop_costs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."drop_costs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."email_campaigns" (
    "id" bigint NOT NULL,
    "campaign" "text" NOT NULL,
    "open_rate" numeric DEFAULT 0 NOT NULL,
    "click_rate" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "brevo_id" bigint,
    "subject" "text",
    "audience" "text",
    "recipients" integer,
    "status" "text",
    "sent_at" timestamp with time zone,
    "delivered" integer,
    "opens" integer,
    "clicks" integer,
    "unsubscribes" integer,
    "stats_at" timestamp with time zone
);


ALTER TABLE "public"."email_campaigns" OWNER TO "postgres";


ALTER TABLE "public"."email_campaigns" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."email_campaigns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."hero_slides" (
    "id" bigint NOT NULL,
    "label" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "focus" "text" DEFAULT 'center'::"text" NOT NULL,
    "device" "text" DEFAULT 'all'::"text" NOT NULL,
    CONSTRAINT "hero_slides_device_check" CHECK (("device" = ANY (ARRAY['all'::"text", 'desktop'::"text", 'mobile'::"text"])))
);


ALTER TABLE "public"."hero_slides" OWNER TO "postgres";


ALTER TABLE "public"."hero_slides" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."hero_slides_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."lookbook_looks" (
    "id" bigint NOT NULL,
    "drop_name" "text" NOT NULL,
    "image_url" "text" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "product_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "focus" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "item_labels" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."lookbook_looks" OWNER TO "postgres";


ALTER TABLE "public"."lookbook_looks" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."lookbook_looks_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."meta_ad_daily" (
    "day" "date" NOT NULL,
    "platform" "text" NOT NULL,
    "campaign_name" "text" DEFAULT ''::"text" NOT NULL,
    "spend" numeric DEFAULT 0 NOT NULL,
    "impressions" bigint DEFAULT 0 NOT NULL,
    "clicks" bigint DEFAULT 0 NOT NULL,
    "synced_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."meta_ad_daily" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."nav_categories" (
    "id" bigint NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0,
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "menu" "text" DEFAULT 'shop'::"text" NOT NULL
);


ALTER TABLE "public"."nav_categories" OWNER TO "postgres";


ALTER TABLE "public"."nav_categories" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."nav_categories_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" bigint NOT NULL,
    "order_id" "text",
    "product_id" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "size" "text" NOT NULL,
    "price" numeric NOT NULL,
    "qty" integer NOT NULL,
    "returned_qty" integer DEFAULT 0 NOT NULL,
    "rejected_qty" integer DEFAULT 0 NOT NULL,
    "exchanged_from" "text"
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


ALTER TABLE "public"."order_items" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."order_items_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."order_returns" (
    "id" bigint NOT NULL,
    "order_id" "text" NOT NULL,
    "reason" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "resolved_at" timestamp with time zone,
    "kind" "text" DEFAULT 'return'::"text" NOT NULL,
    "source" "text" DEFAULT 'admin'::"text" NOT NULL,
    "items" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "details" "text",
    "contact" "text",
    "admin_note" "text",
    "seen_at" timestamp with time zone,
    "resolution" "jsonb",
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."order_returns" OWNER TO "postgres";


ALTER TABLE "public"."order_returns" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."order_returns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "customer_phone" "text" NOT NULL,
    "customer_address" "text" NOT NULL,
    "customer_area" "text" NOT NULL,
    "customer_note" "text",
    "subtotal" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "customer_email" "text",
    "delivery_zone" "text",
    "delivery_fee" numeric DEFAULT 0,
    "total" numeric,
    "advance_amount" numeric DEFAULT 0,
    "advance_method" "text",
    "advance_trx_id" "text",
    "courier" "text",
    "consignment_id" "text",
    "courier_status" "text",
    "courier_synced_at" timestamp with time zone,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "utm_term" "text",
    "confirmation_sent_at" timestamp with time zone,
    "advance_verified_at" timestamp with time zone,
    "customer_mail_sent_at" timestamp with time zone,
    "coupon_code" "text",
    "discount_amount" numeric DEFAULT 0 NOT NULL,
    "refunded_amount" numeric DEFAULT 0 NOT NULL,
    "return_fee_paid" boolean,
    "exchange_fees" numeric DEFAULT 0 NOT NULL,
    "exchange_fee_unpaid" numeric DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."page_views" (
    "id" bigint NOT NULL,
    "session_id" "text" NOT NULL,
    "path" "text" NOT NULL,
    "referrer" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "device" "text",
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text"
);


ALTER TABLE "public"."page_views" OWNER TO "postgres";


ALTER TABLE "public"."page_views" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."page_views_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."product_reviews" (
    "id" bigint NOT NULL,
    "product_id" "text" NOT NULL,
    "customer_name" "text" NOT NULL,
    "rating" integer NOT NULL,
    "comment" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "product_reviews_rating_check" CHECK ((("rating" >= 1) AND ("rating" <= 5)))
);


ALTER TABLE "public"."product_reviews" OWNER TO "postgres";


ALTER TABLE "public"."product_reviews" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."product_reviews_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "text" NOT NULL,
    "sku" "text" NOT NULL,
    "name" "text" NOT NULL,
    "variant" "text" NOT NULL,
    "price" numeric NOT NULL,
    "drop_name" "text" NOT NULL,
    "is_new" boolean DEFAULT false,
    "featured" boolean DEFAULT false,
    "images" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "sizes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "sizes_out" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text",
    "details" "text",
    "size_chart" "jsonb",
    "colour_group" "text",
    "stock" "jsonb",
    "cost" numeric,
    "publish_at" timestamp with time zone,
    "shop_position" integer
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_config" (
    "id" integer DEFAULT 1 NOT NULL,
    "public_key" "text" NOT NULL,
    "private_jwk" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "push_config_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."push_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_sent" (
    "order_id" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."push_sent" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "label" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limit_hits" (
    "id" bigint NOT NULL,
    "bucket" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rate_limit_hits" OWNER TO "postgres";


ALTER TABLE "public"."rate_limit_hits" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."rate_limit_hits_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."sales" (
    "id" bigint NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "percent" integer NOT NULL,
    "drop_name" "text",
    "product_ids" "text"[],
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "sales_percent_check" CHECK ((("percent" >= 1) AND ("percent" <= 90))),
    CONSTRAINT "sales_window" CHECK (("ends_at" > "starts_at"))
);


ALTER TABLE "public"."sales" OWNER TO "postgres";


ALTER TABLE "public"."sales" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."sales_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."site_settings" (
    "key" "text" NOT NULL,
    "value" "jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."site_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."social_stats" (
    "id" bigint NOT NULL,
    "platform" "text" NOT NULL,
    "followers" integer DEFAULT 0 NOT NULL,
    "engagement_rate" numeric DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "captured_on" "date",
    "media_count" integer
);


ALTER TABLE "public"."social_stats" OWNER TO "postgres";


ALTER TABLE "public"."social_stats" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."social_stats_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subscribers" (
    "id" bigint NOT NULL,
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subscribers" OWNER TO "postgres";


ALTER TABLE "public"."subscribers" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."subscribers_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."wishlist" (
    "id" bigint NOT NULL,
    "product_id" "text" NOT NULL,
    "product_name" "text" NOT NULL,
    "size" "text",
    "email" "text" NOT NULL,
    "notified_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."wishlist" OWNER TO "postgres";


ALTER TABLE "public"."wishlist" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."wishlist_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."abandoned_carts"
    ADD CONSTRAINT "abandoned_carts_pkey" PRIMARY KEY ("session_id");



ALTER TABLE ONLY "public"."about_blocks"
    ADD CONSTRAINT "about_blocks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ad_spend"
    ADD CONSTRAINT "ad_spend_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_notice_state"
    ADD CONSTRAINT "admin_notice_state_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."blocked_attempts"
    ADD CONSTRAINT "blocked_attempts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupon_stats"
    ADD CONSTRAINT "coupon_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."coupons"
    ADD CONSTRAINT "coupons_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."drop_costs"
    ADD CONSTRAINT "drop_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_campaigns"
    ADD CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hero_slides"
    ADD CONSTRAINT "hero_slides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lookbook_looks"
    ADD CONSTRAINT "lookbook_looks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."meta_ad_daily"
    ADD CONSTRAINT "meta_ad_daily_pkey" PRIMARY KEY ("day", "platform", "campaign_name");



ALTER TABLE ONLY "public"."nav_categories"
    ADD CONSTRAINT "nav_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_returns"
    ADD CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."page_views"
    ADD CONSTRAINT "page_views_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_reviews"
    ADD CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_config"
    ADD CONSTRAINT "push_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_sent"
    ADD CONSTRAINT "push_sent_pkey" PRIMARY KEY ("order_id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("endpoint");



ALTER TABLE ONLY "public"."rate_limit_hits"
    ADD CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales"
    ADD CONSTRAINT "sales_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."site_settings"
    ADD CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."social_stats"
    ADD CONSTRAINT "social_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."subscribers"
    ADD CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."wishlist"
    ADD CONSTRAINT "wishlist_pkey" PRIMARY KEY ("id");



CREATE INDEX "abandoned_carts_active_idx" ON "public"."abandoned_carts" USING "btree" ("last_active") WHERE ("converted_order_id" IS NULL);



CREATE INDEX "blocked_attempts_created_idx" ON "public"."blocked_attempts" USING "btree" ("created_at" DESC);



CREATE INDEX "drop_costs_drop_idx" ON "public"."drop_costs" USING "btree" ("lower"("drop_name"), "spent_on");



CREATE INDEX "lookbook_looks_drop_idx" ON "public"."lookbook_looks" USING "btree" ("drop_name", "sort_order");



CREATE INDEX "order_returns_order_idx" ON "public"."order_returns" USING "btree" ("order_id");



CREATE INDEX "order_returns_status_idx" ON "public"."order_returns" USING "btree" ("status");



CREATE INDEX "order_returns_unseen_idx" ON "public"."order_returns" USING "btree" ("created_at") WHERE (("seen_at" IS NULL) AND ("source" = 'customer'::"text"));



CREATE UNIQUE INDEX "orders_advance_trx_id_idx" ON "public"."orders" USING "btree" ("upper"("advance_trx_id")) WHERE ("advance_trx_id" IS NOT NULL);



CREATE INDEX "orders_consignment_idx" ON "public"."orders" USING "btree" ("consignment_id") WHERE ("consignment_id" IS NOT NULL);



CREATE INDEX "orders_coupon_code_idx" ON "public"."orders" USING "btree" ("coupon_code") WHERE ("coupon_code" IS NOT NULL);



CREATE INDEX "orders_utm_source_idx" ON "public"."orders" USING "btree" ("utm_source") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "page_views_created_idx" ON "public"."page_views" USING "btree" ("created_at");



CREATE INDEX "page_views_created_session_idx" ON "public"."page_views" USING "btree" ("created_at", "session_id");



CREATE INDEX "page_views_session_idx" ON "public"."page_views" USING "btree" ("session_id");



CREATE INDEX "page_views_utm_idx" ON "public"."page_views" USING "btree" ("utm_source", "created_at") WHERE ("utm_source" IS NOT NULL);



CREATE INDEX "product_reviews_product_idx" ON "public"."product_reviews" USING "btree" ("product_id");



CREATE INDEX "products_colour_group_idx" ON "public"."products" USING "btree" ("colour_group");



CREATE INDEX "rate_limit_hits_bucket_idx" ON "public"."rate_limit_hits" USING "btree" ("bucket", "created_at");



CREATE UNIQUE INDEX "social_stats_daily_idx" ON "public"."social_stats" USING "btree" ("platform", "captured_on") WHERE ("source" = 'meta'::"text");



CREATE UNIQUE INDEX "wishlist_open_request_idx" ON "public"."wishlist" USING "btree" ("product_id", COALESCE("size", ''::"text"), "lower"("email")) WHERE ("notified_at" IS NULL);



CREATE INDEX "wishlist_product_idx" ON "public"."wishlist" USING "btree" ("product_id");



CREATE OR REPLACE TRIGGER "orders_notify_new" AFTER INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."notify_new_order"();



CREATE OR REPLACE TRIGGER "product_reviews_rate_limit_hit" AFTER INSERT ON "public"."product_reviews" FOR EACH ROW EXECUTE FUNCTION "public"."record_rate_limit_hit"('product_review', '3600');



CREATE OR REPLACE TRIGGER "wishlist_rate_limit_hit" AFTER INSERT ON "public"."wishlist" FOR EACH ROW EXECUTE FUNCTION "public"."record_rate_limit_hit"('wishlist_join', '3600');



ALTER TABLE ONLY "public"."abandoned_carts"
    ADD CONSTRAINT "abandoned_carts_converted_order_id_fkey" FOREIGN KEY ("converted_order_id") REFERENCES "public"."orders"("id");



ALTER TABLE ONLY "public"."customer_profiles"
    ADD CONSTRAINT "customer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_returns"
    ADD CONSTRAINT "order_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



CREATE POLICY "Admin can delete hero slides" ON "public"."hero_slides" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin can delete products" ON "public"."products" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin can insert hero slides" ON "public"."hero_slides" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can insert products" ON "public"."products" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin can update hero slides" ON "public"."hero_slides" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'contact.pausecultour@gmail.com'::"text"));



CREATE POLICY "Admin can update orders" ON "public"."orders" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'contact.pausecultour@gmail.com'::"text"));



CREATE POLICY "Admin can update products" ON "public"."products" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ((("auth"."jwt"() ->> 'email'::"text") = 'contact.pausecultour@gmail.com'::"text"));



CREATE POLICY "Admin can view hero slides" ON "public"."hero_slides" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin can view order items" ON "public"."order_items" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin can view orders" ON "public"."orders" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin can view subscribers" ON "public"."subscribers" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin reads the mailing list" ON "public"."subscribers" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admin removes from the mailing list" ON "public"."subscribers" FOR DELETE TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins manage drop costs" ON "public"."drop_costs" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins read Meta ad spend" ON "public"."meta_ad_daily" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins read page views" ON "public"."page_views" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Admins see the notified phones" ON "public"."push_subscriptions" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



CREATE POLICY "Anyone can join the mailing list" ON "public"."subscribers" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Anyone can join the wishlist" ON "public"."wishlist" FOR INSERT TO "authenticated", "anon" WITH CHECK (("public"."rate_limit_ok"('wishlist_join'::"text", 5, 3600) AND ((("auth"."jwt"() ->> 'email'::"text") IS NULL) OR ("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))));



CREATE POLICY "Anyone can leave a review" ON "public"."product_reviews" FOR INSERT TO "authenticated", "anon" WITH CHECK ("public"."rate_limit_ok"('product_review'::"text", 3, 3600));



CREATE POLICY "Anyone can log a page view" ON "public"."page_views" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Anyone can read reviews" ON "public"."product_reviews" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can read the visible about page" ON "public"."about_blocks" FOR SELECT TO "authenticated", "anon" USING (("active" = true));



CREATE POLICY "Anyone can read the visible shop menu" ON "public"."nav_categories" FOR SELECT TO "authenticated", "anon" USING (("active" = true));



CREATE POLICY "Anyone can subscribe" ON "public"."subscribers" FOR INSERT TO "authenticated", "anon" WITH CHECK (true);



CREATE POLICY "Anyone can view hero slides" ON "public"."hero_slides" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone can view products" ON "public"."products" FOR SELECT TO "authenticated", "anon" USING ((("publish_at" IS NULL) OR ("publish_at" <= "public"."launch_cutoff"()) OR "public"."is_admin"()));



CREATE POLICY "Anyone reads live sales" ON "public"."sales" FOR SELECT TO "authenticated", "anon" USING (("active" AND ("ends_at" > "now"())));



CREATE POLICY "Anyone reads site settings" ON "public"."site_settings" FOR SELECT TO "authenticated", "anon" USING (true);



CREATE POLICY "Anyone reads visible looks" ON "public"."lookbook_looks" FOR SELECT TO "authenticated", "anon" USING ("active");



CREATE POLICY "Customers add their own profile" ON "public"."customer_profiles" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Customers change their own profile" ON "public"."customer_profiles" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "Customers read their own profile" ON "public"."customer_profiles" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));



CREATE POLICY "Customers read their own wishlist" ON "public"."wishlist" FOR SELECT TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "Customers remove their own wishlist rows" ON "public"."wishlist" FOR DELETE TO "authenticated" USING (("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))));



CREATE POLICY "Signed-in admins manage abandoned carts" ON "public"."abandoned_carts" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage ad spend" ON "public"."ad_spend" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage coupon stats" ON "public"."coupon_stats" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage coupons" ON "public"."coupons" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage email campaigns" ON "public"."email_campaigns" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage looks" ON "public"."lookbook_looks" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage notice state" ON "public"."admin_notice_state" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage returns" ON "public"."order_returns" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage reviews" ON "public"."product_reviews" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage sales" ON "public"."sales" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage site settings" ON "public"."site_settings" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage social stats" ON "public"."social_stats" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage the about page" ON "public"."about_blocks" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage the shop menu" ON "public"."nav_categories" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins manage the wishlist" ON "public"."wishlist" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Signed-in admins read blocked attempts" ON "public"."blocked_attempts" FOR SELECT TO "authenticated" USING ("public"."is_admin"());



ALTER TABLE "public"."abandoned_carts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."about_blocks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ad_spend" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_notice_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."blocked_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupon_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."coupons" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."customer_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."drop_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."email_campaigns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hero_slides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."lookbook_looks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."meta_ad_daily" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."nav_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_returns" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."page_views" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_reviews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_sent" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limit_hits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."sales" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."site_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."social_stats" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscribers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."wishlist" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































REVOKE ALL ON FUNCTION "public"."adjust_size_stock"("p_product_id" "text", "p_size" "text", "p_delta" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."adjust_size_stock"("p_product_id" "text", "p_size" "text", "p_delta" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_analytics"("p_days" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_analytics"("p_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_analytics"("p_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_customer_accounts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_customer_accounts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_customer_accounts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_mark_confirmed"("p_order_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_mark_confirmed"("p_order_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_confirmed"("p_order_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_process_return"("p_return_id" bigint, "p_action" "text", "p_items" "jsonb", "p_refund" numeric, "p_note" "text", "p_fee" numeric, "p_fee_paid" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_process_return"("p_return_id" bigint, "p_action" "text", "p_items" "jsonb", "p_refund" numeric, "p_note" "text", "p_fee" numeric, "p_fee_paid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_process_return"("p_return_id" bigint, "p_action" "text", "p_items" "jsonb", "p_refund" numeric, "p_note" "text", "p_fee" numeric, "p_fee_paid" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_reject_item"("p_item_id" bigint, "p_undo" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_reject_item"("p_item_id" bigint, "p_undo" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_reject_item"("p_item_id" bigint, "p_undo" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_set_return_fee"("p_order_id" "text", "p_paid" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_set_return_fee"("p_order_id" "text", "p_paid" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_return_fee"("p_order_id" "text", "p_paid" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_utm_visits"("p_from" timestamp with time zone, "p_to" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_utm_visits"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_utm_visits"("p_from" timestamp with time zone, "p_to" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_coupon"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_rate_limit"("action" "text", "max_count" integer, "window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."client_ip"() TO "anon";
GRANT ALL ON FUNCTION "public"."client_ip"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."client_ip"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."coupon_discount"("p_code" "text", "p_subtotal" numeric, "p_phone" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."launch_cutoff"() TO "anon";
GRANT ALL ON FUNCTION "public"."launch_cutoff"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."launch_cutoff"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_cart_converted"("p_session_id" "text", "p_order_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."my_orders"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."my_orders"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."my_orders"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_new_order"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_new_order"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_new_order"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."place_order"("payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."place_order"("payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."place_order"("payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."place_order"("payload" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rate_limit_ok"("action" "text", "max_count" integer, "window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."record_rate_limit_hit"() TO "anon";
GRANT ALL ON FUNCTION "public"."record_rate_limit_hit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_rate_limit_hit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reorder_products"("ids" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reorder_products"("ids" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reorder_products"("ids" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sale_price"("p_price" numeric, "p_product_id" "text", "p_drop" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."save_abandoned_cart"("p_session_id" "text", "p_name" "text", "p_phone" "text", "p_items" "jsonb", "p_cart_value" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."support_find_order"("p_order_id" "text", "p_contact" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."support_find_order"("p_order_id" "text", "p_contact" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_find_order"("p_order_id" "text", "p_contact" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."support_match_order"("p_order_id" "text", "p_contact" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_match_order"("p_order_id" "text", "p_contact" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_order_status"("p_order_id" "text", "p_new_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_advance"("p_trx" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_advance"("p_trx" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_advance"("p_trx" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_advance"("p_trx" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."abandoned_carts" TO "anon";
GRANT ALL ON TABLE "public"."abandoned_carts" TO "authenticated";
GRANT ALL ON TABLE "public"."abandoned_carts" TO "service_role";



GRANT ALL ON TABLE "public"."about_blocks" TO "anon";
GRANT ALL ON TABLE "public"."about_blocks" TO "authenticated";
GRANT ALL ON TABLE "public"."about_blocks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."about_blocks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."about_blocks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."about_blocks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ad_spend" TO "anon";
GRANT ALL ON TABLE "public"."ad_spend" TO "authenticated";
GRANT ALL ON TABLE "public"."ad_spend" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ad_spend_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ad_spend_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ad_spend_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."admin_notice_state" TO "anon";
GRANT ALL ON TABLE "public"."admin_notice_state" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_notice_state" TO "service_role";



GRANT ALL ON TABLE "public"."blocked_attempts" TO "anon";
GRANT ALL ON TABLE "public"."blocked_attempts" TO "authenticated";
GRANT ALL ON TABLE "public"."blocked_attempts" TO "service_role";



GRANT ALL ON SEQUENCE "public"."blocked_attempts_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."blocked_attempts_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."blocked_attempts_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."coupon_stats" TO "anon";
GRANT ALL ON TABLE "public"."coupon_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."coupon_stats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."coupon_stats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."coupon_stats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."coupon_stats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."coupons" TO "anon";
GRANT ALL ON TABLE "public"."coupons" TO "authenticated";
GRANT ALL ON TABLE "public"."coupons" TO "service_role";



GRANT ALL ON TABLE "public"."customer_profiles" TO "anon";
GRANT ALL ON TABLE "public"."customer_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."customer_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."drop_costs" TO "anon";
GRANT ALL ON TABLE "public"."drop_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."drop_costs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."drop_costs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."drop_costs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."drop_costs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."email_campaigns" TO "anon";
GRANT ALL ON TABLE "public"."email_campaigns" TO "authenticated";
GRANT ALL ON TABLE "public"."email_campaigns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."email_campaigns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."email_campaigns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."email_campaigns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."hero_slides" TO "anon";
GRANT ALL ON TABLE "public"."hero_slides" TO "authenticated";
GRANT ALL ON TABLE "public"."hero_slides" TO "service_role";



GRANT ALL ON SEQUENCE "public"."hero_slides_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."hero_slides_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."hero_slides_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."lookbook_looks" TO "anon";
GRANT ALL ON TABLE "public"."lookbook_looks" TO "authenticated";
GRANT ALL ON TABLE "public"."lookbook_looks" TO "service_role";



GRANT ALL ON SEQUENCE "public"."lookbook_looks_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."lookbook_looks_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."lookbook_looks_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."meta_ad_daily" TO "anon";
GRANT ALL ON TABLE "public"."meta_ad_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."meta_ad_daily" TO "service_role";



GRANT ALL ON TABLE "public"."nav_categories" TO "anon";
GRANT ALL ON TABLE "public"."nav_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."nav_categories" TO "service_role";



GRANT ALL ON SEQUENCE "public"."nav_categories_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."nav_categories_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."nav_categories_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "anon";
GRANT ALL ON TABLE "public"."order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."order_items" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_items_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."order_returns" TO "anon";
GRANT ALL ON TABLE "public"."order_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."order_returns" TO "service_role";



GRANT ALL ON SEQUENCE "public"."order_returns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."order_returns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."order_returns_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."orders" TO "anon";
GRANT ALL ON TABLE "public"."orders" TO "authenticated";
GRANT ALL ON TABLE "public"."orders" TO "service_role";



GRANT ALL ON TABLE "public"."page_views" TO "anon";
GRANT ALL ON TABLE "public"."page_views" TO "authenticated";
GRANT ALL ON TABLE "public"."page_views" TO "service_role";



GRANT ALL ON SEQUENCE "public"."page_views_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."page_views_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."page_views_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."product_reviews" TO "anon";
GRANT ALL ON TABLE "public"."product_reviews" TO "authenticated";
GRANT ALL ON TABLE "public"."product_reviews" TO "service_role";



GRANT ALL ON SEQUENCE "public"."product_reviews_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."product_reviews_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."product_reviews_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."push_config" TO "anon";
GRANT ALL ON TABLE "public"."push_config" TO "authenticated";
GRANT ALL ON TABLE "public"."push_config" TO "service_role";



GRANT ALL ON TABLE "public"."push_sent" TO "anon";
GRANT ALL ON TABLE "public"."push_sent" TO "authenticated";
GRANT ALL ON TABLE "public"."push_sent" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limit_hits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limit_hits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limit_hits" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rate_limit_hits_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rate_limit_hits_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rate_limit_hits_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."sales" TO "anon";
GRANT ALL ON TABLE "public"."sales" TO "authenticated";
GRANT ALL ON TABLE "public"."sales" TO "service_role";



GRANT ALL ON SEQUENCE "public"."sales_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."sales_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."sales_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."site_settings" TO "anon";
GRANT ALL ON TABLE "public"."site_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."site_settings" TO "service_role";



GRANT ALL ON TABLE "public"."social_stats" TO "anon";
GRANT ALL ON TABLE "public"."social_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."social_stats" TO "service_role";



GRANT ALL ON SEQUENCE "public"."social_stats_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."social_stats_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."social_stats_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscribers" TO "anon";
GRANT ALL ON TABLE "public"."subscribers" TO "authenticated";
GRANT ALL ON TABLE "public"."subscribers" TO "service_role";



GRANT ALL ON SEQUENCE "public"."subscribers_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."subscribers_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."subscribers_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."wishlist" TO "anon";
GRANT ALL ON TABLE "public"."wishlist" TO "authenticated";
GRANT ALL ON TABLE "public"."wishlist" TO "service_role";



GRANT ALL ON SEQUENCE "public"."wishlist_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."wishlist_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."wishlist_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";



































drop extension if exists "pg_net";

create extension if not exists "pg_net" with schema "public";

drop policy "Anyone can read the visible about page" on "public"."about_blocks";

drop policy "Anyone can view hero slides" on "public"."hero_slides";

drop policy "Anyone reads visible looks" on "public"."lookbook_looks";

drop policy "Anyone can read the visible shop menu" on "public"."nav_categories";

drop policy "Anyone can log a page view" on "public"."page_views";

drop policy "Anyone can leave a review" on "public"."product_reviews";

drop policy "Anyone can read reviews" on "public"."product_reviews";

drop policy "Anyone can view products" on "public"."products";

drop policy "Anyone reads live sales" on "public"."sales";

drop policy "Anyone reads site settings" on "public"."site_settings";

drop policy "Anyone can join the mailing list" on "public"."subscribers";

drop policy "Anyone can subscribe" on "public"."subscribers";

drop policy "Anyone can join the wishlist" on "public"."wishlist";


  create policy "Anyone can read the visible about page"
  on "public"."about_blocks"
  as permissive
  for select
  to anon, authenticated
using ((active = true));



  create policy "Anyone can view hero slides"
  on "public"."hero_slides"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Anyone reads visible looks"
  on "public"."lookbook_looks"
  as permissive
  for select
  to anon, authenticated
using (active);



  create policy "Anyone can read the visible shop menu"
  on "public"."nav_categories"
  as permissive
  for select
  to anon, authenticated
using ((active = true));



  create policy "Anyone can log a page view"
  on "public"."page_views"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "Anyone can leave a review"
  on "public"."product_reviews"
  as permissive
  for insert
  to anon, authenticated
with check (public.rate_limit_ok('product_review'::text, 3, 3600));



  create policy "Anyone can read reviews"
  on "public"."product_reviews"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Anyone can view products"
  on "public"."products"
  as permissive
  for select
  to anon, authenticated
using (((publish_at IS NULL) OR (publish_at <= public.launch_cutoff()) OR public.is_admin()));



  create policy "Anyone reads live sales"
  on "public"."sales"
  as permissive
  for select
  to anon, authenticated
using ((active AND (ends_at > now())));



  create policy "Anyone reads site settings"
  on "public"."site_settings"
  as permissive
  for select
  to anon, authenticated
using (true);



  create policy "Anyone can join the mailing list"
  on "public"."subscribers"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "Anyone can subscribe"
  on "public"."subscribers"
  as permissive
  for insert
  to anon, authenticated
with check (true);



  create policy "Anyone can join the wishlist"
  on "public"."wishlist"
  as permissive
  for insert
  to anon, authenticated
with check ((public.rate_limit_ok('wishlist_join'::text, 5, 3600) AND (((auth.jwt() ->> 'email'::text) IS NULL) OR (lower(email) = lower((auth.jwt() ->> 'email'::text))))));



  create policy "Admin deletes images"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'images'::text) AND public.is_admin()));



  create policy "Admin deletes videos"
  on "storage"."objects"
  as permissive
  for delete
  to authenticated
using (((bucket_id = 'videos'::text) AND public.is_admin()));



  create policy "Admin reads images"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'images'::text) AND public.is_admin()));



  create policy "Admin reads videos"
  on "storage"."objects"
  as permissive
  for select
  to authenticated
using (((bucket_id = 'videos'::text) AND public.is_admin()));



  create policy "Admin replaces images"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'images'::text) AND public.is_admin()))
with check (((bucket_id = 'images'::text) AND public.is_admin()));



  create policy "Admin replaces videos"
  on "storage"."objects"
  as permissive
  for update
  to authenticated
using (((bucket_id = 'videos'::text) AND public.is_admin()))
with check (((bucket_id = 'videos'::text) AND public.is_admin()));



  create policy "Admin uploads images"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'images'::text) AND public.is_admin()));



  create policy "Admin uploads videos"
  on "storage"."objects"
  as permissive
  for insert
  to authenticated
with check (((bucket_id = 'videos'::text) AND public.is_admin()));



