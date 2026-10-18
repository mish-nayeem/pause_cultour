-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Admin → Overview → Notifications: which new orders and refund / exchange
-- requests the admin has checked (read_at) or deleted from the list
-- (dismissed_at). One row per notification, keyed 'order:<id>' or
-- 'return:<id>'; a notification with no row is unread. Kept in the database
-- rather than the browser so the phone and the laptop agree.
--
-- Two rows of its own:
--   '__since' — read_at is when notifications start (the list doesn't
--               fill up with every order ever placed the first time)
--   '__seen'  — read_at is when the list was last opened (the red count on
--               the bell is what came in after it)

begin;

create table if not exists admin_notice_state (
  key text primary key,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz default now()
);

alter table admin_notice_state enable row level security;

drop policy if exists "Signed-in admins manage notice state" on admin_notice_state;
create policy "Signed-in admins manage notice state"
  on admin_notice_state for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
