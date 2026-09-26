-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Fixes the Abandoned Cart list never filling up. Run after
-- supabase-migration-rate-limiting.sql (check_rate_limit comes from there).

begin;

-- The browser used to write abandoned_carts directly: an anon INSERT policy
-- plus an UPDATE policy of `using (true)`. The client saves with upsert, and
-- Postgres runs ON CONFLICT DO UPDATE only for a role that can also SELECT
-- the row — anon can't (and mustn't: the table holds names and phone
-- numbers), so every save failed with an RLS error that supabase-js returns
-- rather than throws, and nothing ever reached the admin panel. The UPDATE
-- policy also let anyone rewrite any row they could name.
--
-- These two functions replace both policies. They run as the owner, touch
-- only the one row for the session id passed in, and cap what gets stored.

drop policy if exists "Anyone can save their own abandoned cart" on abandoned_carts;
drop policy if exists "Anyone can update their own abandoned cart" on abandoned_carts;

create or replace function save_abandoned_cart(
  p_session_id text,
  p_name       text,
  p_phone      text,
  p_items      jsonb,
  p_cart_value numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
$$;

create or replace function mark_cart_converted(p_session_id text, p_order_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update abandoned_carts
     set converted_order_id = p_order_id
   where session_id = p_session_id
     and converted_order_id is null
     and exists (select 1 from orders where id = p_order_id);
end;
$$;

revoke all on function save_abandoned_cart(text, text, text, jsonb, numeric) from public;
grant execute on function save_abandoned_cart(text, text, text, jsonb, numeric) to anon, authenticated;
revoke all on function mark_cart_converted(text, text) from public;
grant execute on function mark_cart_converted(text, text) to anon, authenticated;

commit;
