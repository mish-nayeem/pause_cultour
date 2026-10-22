-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- A refund's pickup: the courier charges for the parcel that brings the
-- piece back (80 in Dhaka, 150 outside, or whatever is typed). The shop
-- always pays that one, so it's added to the order's second-parcel charges
-- (orders.exchange_fees) and to what the shop carried
-- (orders.exchange_fee_unpaid), which comes off revenue.
--
-- Patches admin_process_return in place (from
-- supabase-migration-exchange-updates-order.sql — run that first).
-- Safe to run twice.

begin;

do $$
declare
  fn  text := 'public.admin_process_return(bigint, text, jsonb, numeric, text, numeric, boolean)';
  src text;
begin
  src := pg_get_functiondef(fn::regprocedure);

  if position('-- refund pickup patched' in src) > 0 then
    return;
  end if;

  if position('if p_action = ''exchange'' and fee > 0 then' in src) = 0 then
    raise exception 'admin_process_return is not the expected version — run supabase-migration-exchange-updates-order.sql first';
  end if;

  src := replace(src,
    'if p_action = ''exchange'' and fee > 0 then',
    'if p_action in (''exchange'', ''refund'') and fee > 0 then -- refund pickup patched');
  src := replace(src,
    'exchange_fee_unpaid = exchange_fee_unpaid + case when coalesce(p_fee_paid, true) then 0 else fee end',
    'exchange_fee_unpaid = exchange_fee_unpaid + case when p_action = ''refund'' or not coalesce(p_fee_paid, true) then fee else 0 end');
  src := replace(src,
    '''fee'', case when p_action = ''exchange'' then fee else 0 end',
    '''fee'', fee');
  src := replace(src,
    '''fee_paid'', coalesce(p_fee_paid, true)',
    '''fee_paid'', case when p_action = ''refund'' then false else coalesce(p_fee_paid, true) end');

  execute src;
end $$;

commit;
