-- Lets a signed-in customer see and remove their own wishlist rows.
--
-- A row is "theirs" when its email is the email on their account. Comparing
-- emails is only safe because Supabase's "Confirm email" setting is ON: without
-- it, someone could sign up with another person's address and read their list.
-- Keep that setting on (Authentication → Sign In / Providers → Email).
--
-- Run after supabase-migration-admin-only-rls.sql. Nobody else's rows are
-- reachable — a customer still can't read the table as a whole.

begin;

drop policy if exists "Customers read their own wishlist" on wishlist;
create policy "Customers read their own wishlist"
  on wishlist for select
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

drop policy if exists "Customers remove their own wishlist rows" on wishlist;
create policy "Customers remove their own wishlist rows"
  on wishlist for delete
  to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email'));

commit;
