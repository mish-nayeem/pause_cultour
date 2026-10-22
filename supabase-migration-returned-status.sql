-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Two ways a parcel comes back, from the admin panel's order sheet:
--
--   Status "returned" — the whole parcel came back (the customer couldn't be
--     reached, or refused it). Like "cancelled", every piece goes back into
--     stock; moving it back to pending / shipped / delivered takes them out
--     again.
--
--   ✕ on one item — the customer took some pieces and handed the rest back
--     to the rider. That line's pieces go back into stock and stop counting
--     as sold (order_items.rejected_qty); the rest of the order is marked
--     delivered as usual. ✕ again (Undo) puts it back.
--
-- And for Orders → bKash check: admin_mark_confirmed clears a verified
-- order that has no email to send (the admin calls the customer instead).
--
-- Run after supabase-migration-returns-processing.sql (it uses
-- adjust_size_stock and returned_qty from there).

begin;

alter table order_items add column if not exists rejected_qty int not null default 0;

-- ---------------------------------------------------------------------------
-- update_order_status — cancelled AND returned give the stock back
-- ---------------------------------------------------------------------------
-- Only the pieces still out with the order move: a line already handed back
-- at the door (rejected_qty) or refunded (returned_qty) is back on the shelf
-- already and isn't counted twice.

create or replace function update_order_status(p_order_id text, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- Into cancelled/returned: the pieces come back. Out of it (a correction):
  -- they go out again, floored at 0 rather than failing the change.
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

revoke all on function update_order_status(text, text) from public;
grant execute on function update_order_status(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_reject_item — ✕ on one line of an order
-- ---------------------------------------------------------------------------
-- p_undo false: the line's pieces (whatever hasn't already come back) go back
-- into stock and onto rejected_qty. p_undo true: the reverse. Returns the
-- line's rejected_qty after the change.

create or replace function public.admin_reject_item(p_item_id bigint, p_undo boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $$
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
  -- A cancelled or returned order already put every piece back.
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
  -- Raises "Not enough stock" if those pieces have since been sold.
  perform public.adjust_size_stock(oi.product_id, oi.size, -q);
  update order_items set rejected_qty = 0 where id = oi.id;
  return 0;
end;
$$;

revoke all on function public.admin_reject_item(bigint, boolean) from public, anon;
grant execute on function public.admin_reject_item(bigint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- admin_mark_confirmed — bKash check's Confirm on an order with no email
-- ---------------------------------------------------------------------------

create or replace function public.admin_mark_confirmed(p_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update orders
     set customer_mail_sent_at = coalesce(customer_mail_sent_at, now())
   where id = p_order_id and advance_verified_at is not null;
end;
$$;

revoke all on function public.admin_mark_confirmed(text) from public, anon;
grant execute on function public.admin_mark_confirmed(text) to authenticated;

commit;
