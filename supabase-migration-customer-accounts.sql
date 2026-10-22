-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Customer accounts. Safe to run twice.
--
--   customer_profiles     — a signed-in customer's details (name, phone,
--                           address…), saved from checkout and the Account
--                           page, so the next checkout fills itself.
--   my_orders()           — the signed-in customer's own orders, matched by
--                           the account's email.
--   admin_customer_accounts() — Admin → Customers → Accounts: every account
--                           with its details, for email marketing.
--   Early access          — members (signed in) see and can buy a scheduled
--                           product this many hours before everyone else:
--                           site_settings 'early_access_hours' (0 = off),
--                           set from the same Admin page.

begin;

-- ---------------------------------------------------------------------------
-- customer_profiles
-- ---------------------------------------------------------------------------

create table if not exists customer_profiles (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text,
  phone       text,
  district    text,
  thana       text,
  postcode    text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table customer_profiles enable row level security;

drop policy if exists "Customers read their own profile" on customer_profiles;
create policy "Customers read their own profile"
  on customer_profiles for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Customers add their own profile" on customer_profiles;
create policy "Customers add their own profile"
  on customer_profiles for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "Customers change their own profile" on customer_profiles;
create policy "Customers change their own profile"
  on customer_profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- my_orders — the signed-in customer's orders, by the account's email
-- ---------------------------------------------------------------------------
-- The email on a login is one the customer proved they own (they typed the
-- code it was sent), so matching orders on it shows them nobody else's.

create or replace function public.my_orders()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
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

revoke all on function public.my_orders() from public, anon;
grant execute on function public.my_orders() to authenticated;

-- ---------------------------------------------------------------------------
-- admin_customer_accounts — every account, with its details
-- ---------------------------------------------------------------------------
-- auth.users isn't readable from the browser, so the sign-up and last
-- sign-in times come through here. Orders are matched in the panel, from
-- the orders it already has.

create or replace function public.admin_customer_accounts()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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

revoke all on function public.admin_customer_accounts() from public, anon;
grant execute on function public.admin_customer_accounts() to authenticated;

-- ---------------------------------------------------------------------------
-- Early access for members
-- ---------------------------------------------------------------------------
-- launch_cutoff(): the moment up to which a scheduled product counts as
-- live for whoever is asking. Everyone: now. A signed-in customer: now plus
-- site_settings 'early_access_hours'.

create or replace function public.launch_cutoff()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select now() + case
    when auth.uid() is not null then make_interval(mins => greatest(0, coalesce(
      (select round((value #>> '{}')::numeric * 60)::int from site_settings where key = 'early_access_hours'),
      0)))
    else interval '0'
  end;
$$;

grant execute on function public.launch_cutoff() to anon, authenticated;

drop policy if exists "Anyone can view products" on products;
create policy "Anyone can view products"
  on products for select
  to anon, authenticated
  using (publish_at is null or publish_at <= public.launch_cutoff() or public.is_admin());

-- place_order refuses a product that isn't live yet; the same check now
-- uses launch_cutoff(), so a member can buy in their early window. Patched
-- in place rather than rewritten, so nothing else in it changes.
do $$
declare
  src text := pg_get_functiondef('public.place_order(jsonb)'::regprocedure);
  old_check text := 'db_publish > now() and not public.is_admin()';
  new_check text := 'db_publish > public.launch_cutoff() and not public.is_admin()';
begin
  if position(new_check in src) > 0 then
    return; -- already patched
  end if;
  if position(old_check in src) = 0 then
    raise exception 'place_order has no launch check to patch — run supabase-migration-scheduled-products.sql first';
  end if;
  execute replace(src, old_check, new_check);
end $$;

commit;
