-- The Return & Exchange Portal shows an exchange's full sum — the price
-- difference plus the second parcel's delivery — so support_find_order now
-- says whether the order was inside or outside Dhaka. Otherwise as before.

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
    -- Inside or outside Dhaka: what an exchange's second parcel costs.
    'delivery_zone', o.delivery_zone,
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
