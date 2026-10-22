-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- An exchange now changes the order itself, and its delivery is counted.
--
--   The order's line changes size: S → L on the order, the packing slip and
--   the customer's My orders. Part of a line (1 of 2 pieces) splits into
--   its own line. order_items.exchanged_from keeps the size it was.
--   Stock moves as before: the new size comes out, the old one goes back.
--
--   The exchange parcel's delivery charge (80 in Dhaka, 150 outside, or
--   whatever is typed) goes to the courier. orders.exchange_fees adds it
--   up; orders.exchange_fee_unpaid is the part the shop paid itself (a
--   wrong item or a fault on our side), which comes off revenue.
--
-- Run after supabase-migration-returns-processing.sql and
-- supabase-migration-returned-status.sql. Safe to run twice.

begin;

alter table order_items add column if not exists exchanged_from text;
alter table order_items add column if not exists rejected_qty int not null default 0;
alter table orders add column if not exists exchange_fees numeric not null default 0;
alter table orders add column if not exists exchange_fee_unpaid numeric not null default 0;

-- The old five-argument version, so there's only one to call.
drop function if exists public.admin_process_return(bigint, text, jsonb, numeric, text);

-- p_items:
--   exchange: [{ "item_id": 12, "qty": 1, "to_size": "L" }]
--   refund:   [{ "item_id": 12, "qty": 1 }]
-- p_refund: taka given back (refund only).
-- p_fee: the exchange parcel's delivery charge; p_fee_paid: the customer
-- paid it (true) or the shop did (false). Everything in one go or not at all.
create or replace function public.admin_process_return(
  p_return_id bigint,
  p_action text,
  p_items jsonb,
  p_refund numeric,
  p_note text,
  p_fee numeric default 0,
  p_fee_paid boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if p_action = 'exchange' and fee > 0 then
    update orders
       set exchange_fees = exchange_fees + fee,
           exchange_fee_unpaid = exchange_fee_unpaid + case when coalesce(p_fee_paid, true) then 0 else fee end
     where id = ret.order_id;
  end if;

  result := jsonb_build_object(
    'action', p_action,
    'at', now(),
    'items', done,
    'refund', case when p_action = 'refund' then refund else 0 end,
    'fee', case when p_action = 'exchange' then fee else 0 end,
    'fee_paid', coalesce(p_fee_paid, true)
  );

  update order_returns
     set status = 'resolved', kind = p_action, resolution = result,
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         processed_at = now(), resolved_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_return_id;

  return result;
end;
$$;

revoke all on function public.admin_process_return(bigint, text, jsonb, numeric, text, numeric, boolean) from public, anon;
grant execute on function public.admin_process_return(bigint, text, jsonb, numeric, text, numeric, boolean) to authenticated;

commit;
