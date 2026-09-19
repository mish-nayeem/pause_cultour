-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Two tables behind the Orders tab's new sub-tabs, neither of which existed
-- before: refund/return requests logged by hand, and abandoned carts, which
-- the storefront now records itself.

-- ---------------------------------------------------------------------------
-- 1. Refunds & returns
-- ---------------------------------------------------------------------------
-- Nothing on the storefront creates these — a return happens over a DM or a
-- call, same as a manual order, and gets logged from the admin panel by hand.
--
-- order_id  — the order this return is against
-- reason    — why, in the admin's own words
-- status    — 'open' until resolved
-- note      — how it was resolved (refund sent, replacement shipped, etc.)

create table if not exists order_returns (
  id bigint generated always as identity primary key,
  order_id text not null references orders(id) on delete cascade,
  reason text not null,
  status text not null default 'open',
  note text,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists order_returns_order_idx on order_returns (order_id);
create index if not exists order_returns_status_idx on order_returns (status);

alter table order_returns enable row level security;

-- Purely an internal tool — no customer ever reads or writes this table.
drop policy if exists "Signed-in admins manage returns" on order_returns;
create policy "Signed-in admins manage returns"
  on order_returns for all
  to authenticated
  using (true)
  with check (true);


-- ---------------------------------------------------------------------------
-- 2. Abandoned carts
-- ---------------------------------------------------------------------------
-- One row per browser that reached checkout with items in the cart, written
-- and updated by the browser itself as it types — see
-- src/lib/abandonedCart.js. Cleared (converted_order_id set) the moment that
-- same browser's order actually goes through, so a completed order never
-- shows up here as a loss.
--
-- session_id          — a random id the browser makes for itself and keeps
--                        in localStorage; this row's primary key
-- customer_name/phone — whatever's been typed so far, may be blank
-- items               — a snapshot of the cart, same shape as an order line
-- cart_value          — subtotal at last save
-- last_active         — bumped on every save; old and unconverted is "lost"
-- converted_order_id  — set once the same session places a real order

create table if not exists abandoned_carts (
  session_id text primary key,
  customer_name text,
  customer_phone text,
  items jsonb not null default '[]',
  cart_value numeric not null default 0,
  last_active timestamptz default now(),
  created_at timestamptz default now(),
  converted_order_id text references orders(id)
);

create index if not exists abandoned_carts_active_idx on abandoned_carts (last_active)
  where converted_order_id is null;

alter table abandoned_carts enable row level security;

-- The browser writes its own row by session id. There's no login on the
-- storefront to check ownership against, so in principle anyone who guessed
-- another session's id could overwrite it — but that id is a client-generated
-- random UUID, not a sequential or otherwise guessable one, so this is the
-- same trust model the wishlist's anon-insert policy already uses.
drop policy if exists "Anyone can save their own abandoned cart" on abandoned_carts;
create policy "Anyone can save their own abandoned cart"
  on abandoned_carts for insert
  to anon
  with check (true);

drop policy if exists "Anyone can update their own abandoned cart" on abandoned_carts;
create policy "Anyone can update their own abandoned cart"
  on abandoned_carts for update
  to anon
  using (true)
  with check (true);

-- Customers can't read this back at all — only the signed-in admin panel can.
drop policy if exists "Signed-in admins manage abandoned carts" on abandoned_carts;
create policy "Signed-in admins manage abandoned carts"
  on abandoned_carts for all
  to authenticated
  using (true)
  with check (true);
