-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Three tables/functions let an anonymous caller write to the database with
-- no login and no limit: wishlist signups, product reviews, and
-- place_order itself. Nothing stopped a script from calling any of them
-- thousands of times a minute — spam reviews on a product page, junk emails
-- flooding the wishlist (skewing the demand numbers the admin panel counts
-- on, and risking Brevo's sending reputation if send-restock-alert ever
-- mails them), or worst of all, fake orders run against a real product's
-- size to drain products.stock down to 0 and make it wrongly show
-- "sold out" to real customers — place_order actually decrements stock for
-- any well-formed request, spam or not.
--
-- This adds a simple per-IP, per-action limit inside Postgres itself. It
-- doesn't go through Cloudflare — the browser calls Supabase directly, so a
-- Cloudflare rule would never see these requests — it reads the caller's IP
-- the same way PostgREST/Supabase's own gateway exposes it to RLS policies.
--
-- Caveat, stated plainly: this raises the bar against a casual script
-- hitting these endpoints from one machine. It is not proof against a
-- determined attacker rotating through many IPs. That's an acceptable
-- trade-off for a small store — it stops the cheap, common version of this
-- abuse without adding a paid service.

begin;

-- ---------- Tracking table ----------
-- No policies granted to anon/authenticated — the only way in is through
-- check_rate_limit() below, which runs as security definer.

create table if not exists rate_limit_hits (
  id         bigint generated always as identity primary key,
  bucket     text not null,
  created_at timestamptz not null default now()
);

create index if not exists rate_limit_hits_bucket_idx on rate_limit_hits (bucket, created_at);

alter table rate_limit_hits enable row level security;

-- ---------- Who's calling ----------
-- Supabase's gateway appends the real connecting IP as the LAST entry in
-- x-forwarded-for — earlier entries can be whatever the caller's own request
-- claimed, so only the last one is trustworthy. Returns null (not
-- 'unknown') when the header is missing so callers can choose to fail open
-- rather than lump every such request into one shared bucket.

create or replace function public.client_ip()
returns text
language plpgsql
stable
as $$
declare
  raw   text;
  parts text[];
begin
  raw := current_setting('request.headers', true)::json ->> 'x-forwarded-for';
  if raw is null or trim(raw) = '' then
    return null;
  end if;

  parts := string_to_array(raw, ',');
  return trim(parts[array_length(parts, 1)]);
end;
$$;

-- ---------- The limiter itself ----------
-- true = allowed (and this call counts as one hit). false = over the limit.
-- Fails open (returns true, doesn't count a hit) when the IP can't be
-- determined at all — a missing header should never be the reason a real
-- customer's checkout is blocked.
--
-- Old hits for this bucket are deleted on every call rather than run from a
-- separate cron job, so the table never grows past what's needed to answer
-- "how many hits in the current window" — cheap at this table's size.

create or replace function public.check_rate_limit(
  action text,
  max_count int,
  window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ip         text := public.client_ip();
  bucket_key text;
  hits       int;
begin
  if ip is null then
    return true;
  end if;

  bucket_key := action || ':' || ip;

  delete from rate_limit_hits
   where bucket = bucket_key
     and created_at < now() - (window_seconds || ' seconds')::interval;

  select count(*) into hits from rate_limit_hits where bucket = bucket_key;

  if hits >= max_count then
    return false;
  end if;

  insert into rate_limit_hits (bucket) values (bucket_key);
  return true;
end;
$$;

revoke all on function public.check_rate_limit(text, int, int) from public;
grant execute on function public.check_rate_limit(text, int, int) to anon, authenticated;

-- ---------- Wishlist: 5 joins per IP per hour ----------

drop policy if exists "Anyone can join the wishlist" on wishlist;
create policy "Anyone can join the wishlist"
  on wishlist for insert
  to anon, authenticated
  with check (public.check_rate_limit('wishlist_join', 5, 3600));

-- ---------- Reviews: 3 per IP per day ----------

drop policy if exists "Anyone can leave a review" on product_reviews;
create policy "Anyone can leave a review"
  on product_reviews for insert
  to anon, authenticated
  with check (public.check_rate_limit('product_review', 3, 86400));

-- ---------- place_order: 8 per IP per hour, admin exempt ----------
-- The admin's own manual-order entry (ManualOrderForm.jsx) calls this same
-- function from a signed-in session while working through a batch of DM
-- sales — is_admin() being true skips the limit entirely rather than
-- risking the admin locking themselves out mid-batch. A real shopper places
-- one order per cart, not eight in an hour, so this only ever bites a script.

create or replace function place_order(payload jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  o          jsonb := payload -> 'order';
  id_prefix  text  := case when (o ->> 'id_prefix') in ('PC', 'PM')
                        then o ->> 'id_prefix' else 'PC' end;
  new_id     text;
  attempt    int := 0;
  item       jsonb;
  cur_stock  jsonb;
  has_row    boolean;
  left_count int;
  want       int;
  size_key   text;
begin
  if not public.is_admin() and not public.check_rate_limit('place_order', 8, 3600) then
    raise exception 'RATE_LIMITED';
  end if;

  if jsonb_typeof(payload -> 'items') <> 'array'
     or jsonb_array_length(payload -> 'items') = 0 then
    raise exception 'EMPTY_CART';
  end if;

  for item in select * from jsonb_array_elements(payload -> 'items')
  loop
    size_key := item ->> 'size';
    want := (item ->> 'qty')::int;

    select p.stock, true into cur_stock, has_row
      from products p
     where p.id::text = item ->> 'product_id'
       for update;

    if not coalesce(has_row, false) then
      raise exception 'UNAVAILABLE:%', item ->> 'product_name';
    end if;

    if cur_stock is not null then
      left_count := coalesce((cur_stock ->> size_key)::int, 0);

      if left_count < want then
        raise exception 'SOLD_OUT:%:%', item ->> 'product_name', size_key;
      end if;

      update products
         set stock = jsonb_set(stock, array[size_key], to_jsonb(left_count - want))
       where id::text = item ->> 'product_id';
    end if;
  end loop;

  loop
    new_id := id_prefix || lpad(floor(random() * 10000000000)::bigint::text, 10, '0');

    begin
      insert into orders (
        id, customer_name, customer_phone, customer_email, customer_address,
        customer_area, customer_note, subtotal, delivery_zone, delivery_fee,
        total, advance_amount, advance_method, advance_trx_id,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term
      ) values (
        new_id,
        o ->> 'customer_name',
        o ->> 'customer_phone',
        o ->> 'customer_email',
        o ->> 'customer_address',
        o ->> 'customer_area',
        o ->> 'customer_note',
        (o ->> 'subtotal')::numeric,
        o ->> 'delivery_zone',
        (o ->> 'delivery_fee')::numeric,
        (o ->> 'total')::numeric,
        (o ->> 'advance_amount')::numeric,
        o ->> 'advance_method',
        o ->> 'advance_trx_id',
        o ->> 'utm_source',
        o ->> 'utm_medium',
        o ->> 'utm_campaign',
        o ->> 'utm_content',
        o ->> 'utm_term'
      );
      exit;
    exception when unique_violation then
      attempt := attempt + 1;
      if attempt >= 5 then
        raise exception 'ORDER_ID_COLLISION';
      end if;
    end;
  end loop;

  insert into order_items (order_id, product_id, product_name, size, price, qty)
  select
    new_id,
    e.value ->> 'product_id',
    e.value ->> 'product_name',
    e.value ->> 'size',
    (e.value ->> 'price')::numeric,
    (e.value ->> 'qty')::int
  from jsonb_array_elements(payload -> 'items') as e;

  return new_id;
end;
$$;

revoke all on function place_order(jsonb) from public;
grant execute on function place_order(jsonb) to anon, authenticated;

commit;
