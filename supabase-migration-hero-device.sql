-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Separate homepage hero photos for PC and for phones.

begin;

-- ---------------------------------------------------------------------------
-- Homepage hero: which screens a slide is for
-- ---------------------------------------------------------------------------
-- 'desktop' — PC, laptop and tablet; 'mobile' — phones only; 'all' — both
-- (every slide made before this existed). Picked in Admin → Homepage.
alter table hero_slides add column if not exists device text not null default 'all';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hero_slides_device_check') then
    alter table hero_slides add constraint hero_slides_device_check check (device in ('all', 'desktop', 'mobile'));
  end if;
end $$;

commit;
