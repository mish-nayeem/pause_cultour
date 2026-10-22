-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- A returned order's delivery charge: did the customer pay it?
--   true  — paid (or the bKash advance covered it): costs the shop nothing
--   false — unpaid: comes off the shop's revenue
--   null  — not set yet: the panel treats it as paid when the advance
--           covered the charge, unpaid otherwise
-- Set from the order sheet's Paid / Unpaid buttons. Safe to run twice.

begin;

alter table orders add column if not exists return_fee_paid boolean;

create or replace function public.admin_set_return_fee(p_order_id text, p_paid boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  update orders set return_fee_paid = p_paid where id = p_order_id;
end;
$$;

revoke all on function public.admin_set_return_fee(text, boolean) from public, anon;
grant execute on function public.admin_set_return_fee(text, boolean) to authenticated;

commit;
