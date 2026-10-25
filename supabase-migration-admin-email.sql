-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Moves the admin to contact.pausecultour@gmail.com. Every admin-only rule
-- (orders, products, images, settings…) asks public.is_admin(), so this one
-- function is all the database needs. From the moment it runs, only that
-- email can use the admin panel.
--
-- Also change, in the same sitting:
--   Cloudflare → the site → Settings → Variables: VITE_ADMIN_EMAIL, then redeploy
--   Supabase → Edge Functions → Secrets: ADMIN_EMAIL (and ADMIN_NOTIFY_EMAIL)

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(lower(auth.jwt() ->> 'email') = 'contact.pausecultour@gmail.com', false)
$$;
