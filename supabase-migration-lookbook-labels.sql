-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Lookbook: the name shown for each tagged product can be typed by hand.
-- Run after supabase-migration-lookbook.sql.

begin;

-- { "<product id>": "Name shown on the photo" }. A product with no entry
-- shows its own name.
alter table lookbook_looks add column if not exists item_labels jsonb not null default '{}';

commit;
