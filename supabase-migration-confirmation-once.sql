-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Run BEFORE deploying the new send-order-confirmation — the function writes
-- this column, and without it every confirmation would fail.
--
-- send-order-confirmation is callable without a login (a customer isn't
-- signed in at checkout) and used to resend both mails on every call with a
-- known order id. It now marks the order here the first time and sends
-- nothing after that.

begin;

alter table orders add column if not exists confirmation_sent_at timestamptz;

-- Orders from before this existed already had their confirmation — mark
-- them, or each could still be sent once more.
update orders set confirmation_sent_at = created_at where confirmation_sent_at is null;

commit;
