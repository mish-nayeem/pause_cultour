-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- The Support page's Return & Exchange Portal: a customer finds their order
-- with the order number plus the email or phone they ordered with, and sends
-- a refund or exchange request. Requests land in order_returns, the same
-- table Admin → Orders → Refunds & returns already uses, and show up in
-- Admin → Support and on the Overview page until the admin has seen them.
--
-- The Support page copy itself lives in site_settings (key 'support_pages'
-- and 'support_portal') — that table already exists, nothing to add for it.

begin;

alter table order_returns add column if not exists kind text not null default 'return';
alter table order_returns add column if not exists source text not null default 'admin';
alter table order_returns add column if not exists items jsonb not null default '[]';
alter table order_returns add column if not exists details text;
alter table order_returns add column if not exists contact text;
alter table order_returns add column if not exists admin_note text;
alter table order_returns add column if not exists seen_at timestamptz;

create index if not exists order_returns_unseen_idx
  on order_returns (created_at) where seen_at is null and source = 'customer';

-- ---------------------------------------------------------------------------
-- Which order (if any) an order number + email/phone pair belongs to.
-- ---------------------------------------------------------------------------
-- Phones compare on the last nine digits, so 01712…, +8801712… and
-- 880 1712 … all match. Not callable from the browser — the two functions
-- below use it.

create or replace function public.support_match_order(p_order_id text, p_contact text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
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

revoke all on function public.support_match_order(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Check order": what the portal shows before the request form.
-- ---------------------------------------------------------------------------
-- Null for no match — the same answer for a wrong number and a wrong
-- email/phone, so it can't be used to find out which order numbers exist.
-- Only the first name, the items and the status go back; no address.

create or replace function public.support_find_order(p_order_id text, p_contact text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

grant execute on function public.support_find_order(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- "Send request": one refund or exchange request for a delivered order.
-- ---------------------------------------------------------------------------
-- p_items: [{ "product_name": "...", "size": "M", "qty": 1, "exchange_size": "L" }]
-- Only pieces that really are on the order are kept. One open request per
-- order at a time, so a double tap or a resend doesn't pile up duplicates.

create or replace function public.support_request_return(
  p_order_id text,
  p_contact text,
  p_kind text,
  p_reason text,
  p_items jsonb,
  p_details text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
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

grant execute on function public.support_request_return(text, text, text, text, jsonb, text) to anon, authenticated;

commit;
