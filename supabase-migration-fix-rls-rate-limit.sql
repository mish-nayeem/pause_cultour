-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Bug found while testing: check_rate_limit() both reads AND writes
-- (deletes expired hits, inserts a new one) inside an RLS `with check`
-- clause. Postgres does not guarantee a policy predicate is evaluated
-- exactly once per row — a single real INSERT to wishlist or
-- product_reviews could evaluate it two, three, four times, each one
-- silently counting as a separate "hit". A customer's very first review
-- could already look like their fourth, and get wrongly rate-limited.
--
-- place_order is unaffected — it calls check_rate_limit as a single
-- explicit plpgsql statement, not as an RLS predicate, so it only ever runs
-- once per call regardless of how Postgres plans anything else.
--
-- Fix: split into two functions.
--   rate_limit_ok()         — STABLE, read-only. Safe for Postgres to call
--                              any number of times; used in the RLS
--                              `with check` itself.
--   record_rate_limit_hit() — a BEFORE INSERT trigger function. Postgres
--                              guarantees a row-level trigger fires exactly
--                              once per row, so the actual counting happens
--                              here instead.
-- check_rate_limit() itself is untouched — place_order keeps using it.

begin;

create or replace function public.rate_limit_ok(action text, max_count int, window_seconds int)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ip   text := public.client_ip();
  hits int;
begin
  if ip is null then
    return true;
  end if;

  select count(*) into hits
    from rate_limit_hits
   where bucket = action || ':' || ip
     and created_at > now() - (window_seconds || ' seconds')::interval;

  return hits < max_count;
end;
$$;

revoke all on function public.rate_limit_ok(text, int, int) from public;
grant execute on function public.rate_limit_ok(text, int, int) to anon, authenticated;

-- One trigger function shared by both tables — TG_ARGV[0] is the bucket
-- name, TG_ARGV[1] the window in seconds (old hits for this bucket are
-- cleared here too, on the one guaranteed-single write instead of on every
-- read).
create or replace function public.record_rate_limit_hit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ip             text := public.client_ip();
  action         text := TG_ARGV[0];
  window_seconds int  := TG_ARGV[1]::int;
  bucket_key     text;
begin
  if ip is not null then
    bucket_key := action || ':' || ip;

    delete from rate_limit_hits
     where bucket = bucket_key
       and created_at < now() - (window_seconds || ' seconds')::interval;

    insert into rate_limit_hits (bucket) values (bucket_key);
  end if;

  return new;
end;
$$;

-- ---------- Wishlist: 5 joins per IP per hour ----------

drop policy if exists "Anyone can join the wishlist" on wishlist;
create policy "Anyone can join the wishlist"
  on wishlist for insert
  to anon, authenticated
  with check (public.rate_limit_ok('wishlist_join', 5, 3600));

drop trigger if exists wishlist_rate_limit_hit on wishlist;
create trigger wishlist_rate_limit_hit
  before insert on wishlist
  for each row execute function public.record_rate_limit_hit('wishlist_join', '3600');

-- ---------- Reviews: 3 per IP per day ----------

drop policy if exists "Anyone can leave a review" on product_reviews;
create policy "Anyone can leave a review"
  on product_reviews for insert
  to anon, authenticated
  with check (public.rate_limit_ok('product_review', 3, 86400));

drop trigger if exists product_reviews_rate_limit_hit on product_reviews;
create trigger product_reviews_rate_limit_hit
  before insert on product_reviews
  for each row execute function public.record_rate_limit_hit('product_review', '86400');

commit;
