-- Exchanges between products of any price (Return & Exchange Portal and
-- Admin → Support → Requests).
--   * A dearer product: the customer owes the difference — the rider
--     collects it with the second parcel (orders.exchange_extra, counted as
--     revenue; the courier keeps 1% of it like any cash it collects).
--   * A cheaper one: we owe it back — sent by bKash by hand to the number the
--     customer gave (order_returns.refund_to), counted as refunded.
-- support_find_order  — each piece says which product it is
-- support_request_return — a piece can ask for another product; p_refund_to
-- admin_process_return   — the piece moves product, price and stock
-- admin_mark_exchange_refund — the admin marks the refund as sent
-- Everything else in these functions is as it was (baseline).

alter table public.orders add column if not exists exchange_extra numeric not null default 0;
alter table public.order_returns add column if not exists refund_to text;

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
        'product_id', i.product_id, 'product_name', i.product_name, 'size', i.size, 'qty', i.qty, 'price', i.price
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


drop function if exists public.support_request_return(text, text, text, text, jsonb, text);

CREATE OR REPLACE FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text", "p_refund_to" "text" DEFAULT NULL) RETURNS "jsonb"
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
      'exchange_size', nullif(left(trim(coalesce(x ->> 'exchange_size', '')), 20), ''),
      -- Exchanging for a different product (any price): which one, and
      -- what it sells for now, against what was paid for this piece.
      'price', i.price,
      'exchange_product_id', np.id,
      'exchange_product_name', np.name || case when coalesce(np.variant, '') <> '' then ' — ' || np.variant else '' end,
      'exchange_price', case when np.id is not null then public.sale_price(np.price, np.id, np.drop_name) end
    )), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
  join lateral (
    select * from order_items oi
    where oi.order_id = v_id and oi.product_name = x ->> 'product_name' and oi.size = x ->> 'size'
    limit 1
  ) i on true
  left join lateral (
    select p.id, p.name, p.variant, p.price, p.drop_name from products p
    where p.id = nullif(trim(coalesce(x ->> 'exchange_product_id', '')), '')
      and p.id <> i.product_id
    limit 1
  ) np on true;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Pick at least one item.';
  end if;

  insert into order_returns (order_id, reason, kind, source, items, details, contact, refund_to)
  values (
    v_id,
    left(trim(p_reason), 200),
    p_kind,
    'customer',
    v_items,
    nullif(left(trim(coalesce(p_details, '')), 1000), ''),
    left(trim(p_contact), 120),
    -- The bKash number a price difference is refunded to, when there is one.
    nullif(left(regexp_replace(coalesce(p_refund_to, ''), '[^0-9+]', '', 'g'), 20), '')
  )
  returning id into v_new;

  return jsonb_build_object('id', v_new);
end;
$$;

REVOKE ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text", "p_refund_to" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text", "p_refund_to" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text", "p_refund_to" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."support_request_return"("p_order_id" "text", "p_contact" "text", "p_kind" "text", "p_reason" "text", "p_items" "jsonb", "p_details" "text", "p_refund_to" "text") TO "service_role";

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
  to_pid text;
  to_name text;
  to_price numeric;
  to_drop text;
  new_price numeric;
  -- An exchange to a dearer product: the customer owes the difference (the
  -- rider collects it with the second parcel). A cheaper one: we owe it
  -- back, sent by bKash by hand. Summed over the pieces.
  price_diff numeric := 0;
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
      -- Another product in place of this one, at whatever it sells for now.
      to_pid := nullif(trim(coalesce(x ->> 'to_product_id', '')), '');
      if to_pid is null or to_pid = oi.product_id then
        to_pid := oi.product_id;
        to_name := oi.product_name;
        new_price := oi.price;
      else
        select p.name, p.price, p.drop_name into to_name, to_price, to_drop from products p where p.id = to_pid;
        if to_name is null then
          raise exception 'The product picked in place of % no longer exists.', oi.product_name;
        end if;
        new_price := public.sale_price(to_price, to_pid, to_drop);
      end if;
      if to_pid = oi.product_id and to_size = oi.size then
        raise exception 'The new size for % is the same as the old one.', oi.product_name;
      end if;
      -- The new piece first, so a size that's run out stops it before
      -- anything has moved.
      left_to := public.adjust_size_stock(to_pid, to_size, -q);
      left_from := public.adjust_size_stock(oi.product_id, oi.size, q);
      price_diff := price_diff + (new_price - oi.price) * q;

      -- The order follows: the whole line changes, or the exchanged pieces
      -- become a line of their own — at the new product's price. "Exchanged
      -- from" names the old product too when it's a different one.
      if q = oi.qty and coalesce(oi.returned_qty, 0) = 0 and coalesce(oi.rejected_qty, 0) = 0 then
        update order_items
           set product_id = to_pid, product_name = to_name, size = to_size, price = new_price,
               exchanged_from = coalesce(exchanged_from, case when to_pid = oi.product_id then oi.size else oi.product_name || ' ' || oi.size end)
         where id = oi.id;
      else
        update order_items set qty = qty - q where id = oi.id;
        insert into order_items (order_id, product_id, product_name, size, price, qty, exchanged_from)
        values (oi.order_id, to_pid, to_name, to_size, new_price, q,
                case when to_pid = oi.product_id then oi.size else oi.product_name || ' ' || oi.size end);
      end if;

      done := done || jsonb_build_object(
        'item_id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
        'to_product_id', to_pid, 'to_product_name', to_name,
        'qty', q, 'from_size', oi.size, 'to_size', to_size,
        'from_price', oi.price, 'to_price', new_price,
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

  -- The price difference of an exchange: owed by the customer it's extra
  -- revenue (collected by the rider); owed to them it's refunded.
  if p_action = 'exchange' and price_diff > 0 then
    update orders set exchange_extra = exchange_extra + price_diff where id = ret.order_id;
  elsif p_action = 'exchange' and price_diff < 0 then
    update orders set refunded_amount = refunded_amount - price_diff where id = ret.order_id;
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
    'fee_paid', case when p_action = 'refund' then false else coalesce(p_fee_paid, true) end,
    'price_diff', case when p_action = 'exchange' then price_diff else 0 end,
    'extra_due', case when p_action = 'exchange' then greatest(price_diff, 0) else 0 end,
    'refund_due', case when p_action = 'exchange' then greatest(-price_diff, 0) else 0 end,
    'refund_to', ret.refund_to
  );

  update order_returns
     set status = 'resolved', kind = p_action, resolution = result,
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         processed_at = now(), resolved_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_return_id;

  return result;
end;
$$;


CREATE OR REPLACE FUNCTION "public"."admin_mark_exchange_refund"("p_return_id" bigint, "p_trx" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_out jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update order_returns
     set resolution = coalesce(resolution, '{}'::jsonb)
       || jsonb_build_object('refund_sent_at', now(), 'refund_trx', nullif(left(trim(coalesce(p_trx, '')), 40), ''))
   where id = p_return_id
  returning resolution into v_out;
  if v_out is null then
    raise exception 'That request no longer exists.';
  end if;
  return v_out;
end;
$$;

REVOKE ALL ON FUNCTION "public"."admin_mark_exchange_refund"("p_return_id" bigint, "p_trx" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_mark_exchange_refund"("p_return_id" bigint, "p_trx" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_exchange_refund"("p_return_id" bigint, "p_trx" "text") TO "service_role";
