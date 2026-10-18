-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Admin → Support → Returns & exchanges: completing a request updates the
-- stock and the sales figures, and keeps a record of what was done.
--
--   Exchange — each piece's old size goes back into stock (+), the size it's
--              swapped for comes out (−). Total stock and the sale's value
--              stay the same.
--   Refund   — the pieces go back into stock (+), they no longer count as
--              sold (order_items.returned_qty), and the refunded amount comes
--              off the order's revenue (orders.refunded_amount).
--   Reject   — nothing changes but the request's status.
--
-- What was done is stored on the request (order_returns.resolution) with
-- the time, next to the order it belongs to. Needs
-- supabase-migration-support.sql run first.

begin;

alter table orders add column if not exists refunded_amount numeric not null default 0;
alter table order_items add column if not exists returned_qty int not null default 0;
alter table order_returns add column if not exists resolution jsonb;
alter table order_returns add column if not exists processed_at timestamptz;

-- Adds `delta` to one size of one product, if that product keeps a count
-- for that size. Returns the new count, or null for an untracked size.
create or replace function public.adjust_size_stock(p_product_id text, p_size text, p_delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
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

revoke all on function public.adjust_size_stock(text, text, int) from public, anon, authenticated;

-- p_items:
--   exchange: [{ "item_id": 12, "qty": 1, "to_size": "L" }]
--   refund:   [{ "item_id": 12, "qty": 1 }]
-- item_id is the order_items row. p_refund is the taka given back (refund
-- only). Everything happens in one go or not at all.
create or replace function public.admin_process_return(
  p_return_id bigint,
  p_action text,
  p_items jsonb,
  p_refund numeric,
  p_note text
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
  done jsonb := '[]'::jsonb;
  left_from int;
  left_to int;
  refund numeric := greatest(coalesce(p_refund, 0), 0);
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

    q := least(greatest(coalesce((x ->> 'qty')::int, 0), 0), oi.qty - oi.returned_qty);
    if q = 0 then
      continue;
    end if;

    if p_action = 'exchange' then
      if coalesce(trim(x ->> 'to_size'), '') = '' then
        raise exception 'Pick the new size for %.', oi.product_name;
      end if;
      if trim(x ->> 'to_size') = oi.size then
        raise exception 'The new size for % is the same as the old one.', oi.product_name;
      end if;
      -- The new size first, so a size that's run out stops it before
      -- anything has moved.
      left_to := public.adjust_size_stock(oi.product_id, trim(x ->> 'to_size'), -q);
      left_from := public.adjust_size_stock(oi.product_id, oi.size, q);
      done := done || jsonb_build_object(
        'item_id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
        'qty', q, 'from_size', oi.size, 'to_size', trim(x ->> 'to_size'),
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

  result := jsonb_build_object(
    'action', p_action,
    'at', now(),
    'items', done,
    'refund', case when p_action = 'refund' then refund else 0 end
  );

  update order_returns
     set status = 'resolved', kind = p_action, resolution = result,
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         processed_at = now(), resolved_at = now(), seen_at = coalesce(seen_at, now())
   where id = p_return_id;

  return result;
end;
$$;

revoke all on function public.admin_process_return(bigint, text, jsonb, numeric, text) from public, anon;
grant execute on function public.admin_process_return(bigint, text, jsonb, numeric, text) to authenticated;

commit;
