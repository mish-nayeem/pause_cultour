-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Phone notifications for the admin app: "🛍 New order" the moment an order
-- comes in. Then deploy supabase/functions/notify (Verify JWT off), and in
-- the admin press "Turn on notifications" on each phone. Safe to run twice.
--
--   push_config         the notification keys (VAPID) — made by the notify
--                       function itself; nobody else can read them
--   push_subscriptions  the phones that get notifications
--   push_sent           which orders were already announced (never twice)
--   trigger on orders   tells the notify function about each new order

begin;

create extension if not exists pg_net;

create table if not exists push_config (
  id           int primary key default 1 check (id = 1),
  public_key   text not null,
  private_jwk  jsonb not null,
  created_at   timestamptz not null default now()
);
alter table push_config enable row level security;
-- No policies: only the notify function (service role) reads or writes it.

create table if not exists push_subscriptions (
  endpoint      text primary key,
  p256dh        text not null,
  auth          text not null,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
alter table push_subscriptions enable row level security;
drop policy if exists "Admins see the notified phones" on push_subscriptions;
create policy "Admins see the notified phones"
  on push_subscriptions for select
  to authenticated
  using (public.is_admin());

create table if not exists push_sent (
  order_id  text primary key,
  sent_at   timestamptz not null default now()
);
alter table push_sent enable row level security;

-- Every new order → the notify function, in the background (pg_net sends it
-- after the order is saved). Anything going wrong here can never stop an
-- order from going through.
create or replace function public.notify_new_order()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  begin
    perform net.http_post(
      url := 'https://rzylwwrpzkqjyxxkstjo.supabase.co/functions/v1/notify',
      body := jsonb_build_object('action', 'order', 'order_id', new.id),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  exception when others then
    null;
  end;
  return new;
end;
$$;

drop trigger if exists orders_notify_new on orders;
create trigger orders_notify_new
  after insert on orders
  for each row execute function public.notify_new_order();

commit;
