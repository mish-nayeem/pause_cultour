-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- About us: each block gets its own heading, written separately from the
-- text under it (Admin → About us).

begin;

alter table about_blocks add column if not exists heading text not null default '';

commit;
