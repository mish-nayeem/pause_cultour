-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- place_order takes a size's stock down the moment an order is placed —
-- correct, since COD orders are trusted right away. But cancelling an order
-- (a COD refusal, which src/lib/admin.js's whole customer risk-scoring
-- system exists because of) never gave that stock back. Over time, refused
-- orders alone could sink a size's count to 0 and show it "sold out" while
-- the pieces sit on the shelf.
--
-- This moves order status changes into a function that restores stock on
-- the transition INTO 'cancelled' (never on re-saving an already-cancelled
-- order, so nothing double-restores), and best-effort reverses it if an
-- admin corrects a mistaken cancel back to another status.

begin;

create or replace function update_order_status(p_order_id text, p_new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status text;
  item       record;
  cur_stock  jsonb;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select status into old_status from orders where id = p_order_id for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Cancelling: give back whatever this order took off the shelf. Guarded by
  -- old_status so cancelling an already-cancelled order is a no-op here.
  if p_new_status = 'cancelled' and old_status is distinct from 'cancelled' then
    for item in
      select product_id, size, qty from order_items where order_id = p_order_id
    loop
      select stock into cur_stock from products where id::text = item.product_id for update;

      -- Only add back into a size the product still tracks — an untracked
      -- product (no stock map) never had anything taken off it to begin with.
      if cur_stock is not null and cur_stock ? item.size then
        update products
           set stock = jsonb_set(
             stock,
             array[item.size],
             to_jsonb(coalesce((stock ->> item.size)::int, 0) + item.qty)
           )
         where id::text = item.product_id;
      end if;
    end loop;
  end if;

  -- Un-cancelling: an admin correcting a mistaken cancel, not a normal flow.
  -- Best-effort — floors at 0 instead of failing the status change if the
  -- size has since sold out through other orders.
  if old_status = 'cancelled' and p_new_status is distinct from 'cancelled' then
    for item in
      select product_id, size, qty from order_items where order_id = p_order_id
    loop
      select stock into cur_stock from products where id::text = item.product_id for update;

      if cur_stock is not null and cur_stock ? item.size then
        update products
           set stock = jsonb_set(
             stock,
             array[item.size],
             to_jsonb(greatest(0, coalesce((stock ->> item.size)::int, 0) - item.qty))
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

commit;
