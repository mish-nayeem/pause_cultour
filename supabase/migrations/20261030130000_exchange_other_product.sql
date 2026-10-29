-- Exchange for another product at the same price, when the size wanted
-- isn't in stock (Return & Exchange Portal and Admin → Support → Requests).
--   support_find_order     — each piece now says which product it is
--   support_request_return — a piece can ask for another product (same price only)
--   admin_process_return   — an exchange can move a piece to another product
-- Everything else in these functions is as it was (baseline).

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
      'exchange_size', nullif(left(trim(coalesce(x ->> 'exchange_size', '')), 20), ''),
      -- Exchanging for a different product: only one at the same price.
      'exchange_product_id', np.id,
      'exchange_product_name', np.name || case when coalesce(np.variant, '') <> '' then ' — ' || np.variant else '' end
    )), '[]'::jsonb)
  into v_items
  from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) x
  join lateral (
    select * from order_items oi
    where oi.order_id = v_id and oi.product_name = x ->> 'product_name' and oi.size = x ->> 'size'
    limit 1
  ) i on true
  left join lateral (
    select p.id, p.name, p.variant from products p
    where p.id = nullif(trim(coalesce(x ->> 'exchange_product_id', '')), '')
      and p.id <> i.product_id
      and p.price = i.price
    limit 1
  ) np on true;

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
      -- Another product in place of this one: only one at the same price.
      to_pid := nullif(trim(coalesce(x ->> 'to_product_id', '')), '');
      if to_pid is null or to_pid = oi.product_id then
        to_pid := oi.product_id;
        to_name := oi.product_name;
      else
        select p.name, p.price into to_name, to_price from products p where p.id = to_pid;
        if to_name is null then
          raise exception 'The product picked in place of % no longer exists.', oi.product_name;
        end if;
        if to_price is distinct from oi.price then
          raise exception 'Pick a product at the same price as % (%).', oi.product_name, oi.price;
        end if;
      end if;
      if to_pid = oi.product_id and to_size = oi.size then
        raise exception 'The new size for % is the same as the old one.', oi.product_name;
      end if;
      -- The new piece first, so a size that's run out stops it before
      -- anything has moved.
      left_to := public.adjust_size_stock(to_pid, to_size, -q);
      left_from := public.adjust_size_stock(oi.product_id, oi.size, q);

      -- The order follows: the whole line changes, or the exchanged pieces
      -- become a line of their own. "Exchanged from" names the old product
      -- too when it's a different one.
      if q = oi.qty and coalesce(oi.returned_qty, 0) = 0 and coalesce(oi.rejected_qty, 0) = 0 then
        update order_items
           set product_id = to_pid, product_name = to_name, size = to_size,
               exchanged_from = coalesce(exchanged_from, case when to_pid = oi.product_id then oi.size else oi.product_name || ' ' || oi.size end)
         where id = oi.id;
      else
        update order_items set qty = qty - q where id = oi.id;
        insert into order_items (order_id, product_id, product_name, size, price, qty, exchanged_from)
        values (oi.order_id, to_pid, to_name, to_size, oi.price, q,
                case when to_pid = oi.product_id then oi.size else oi.product_name || ' ' || oi.size end);
      end if;

      done := done || jsonb_build_object(
        'item_id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
        'to_product_id', to_pid, 'to_product_name', to_name,
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
