-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Drop lookbooks (Admin → Lookbook, /lookbook/<drop> on the site).

begin;

-- ---------------------------------------------------------------------------
-- Lookbook
-- ---------------------------------------------------------------------------
-- The photos on a drop's lookbook page (/lookbook/<drop>), made in Admin →
-- Lookbook. Each look is one photo, belonging to one drop, with the products
-- worn in it — tapping the photo lists those products, each a link to its
-- page. A drop with no looks yet shows its products' own photos instead.
--
-- drop_name   — which drop's lookbook (the same name as products.drop_name)
-- title       — optional caption, e.g. "Jorts and waffle crop top"
-- product_ids — the products in the photo, in the order they're listed

create table if not exists lookbook_looks (
  id bigint generated always as identity primary key,
  drop_name text not null,
  image_url text not null,
  title text not null default '',
  product_ids text[] not null default '{}',
  focus text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists lookbook_looks_drop_idx on lookbook_looks (drop_name, sort_order);

alter table lookbook_looks enable row level security;

drop policy if exists "Anyone reads visible looks" on lookbook_looks;
create policy "Anyone reads visible looks"
  on lookbook_looks for select
  to anon, authenticated
  using (active);

drop policy if exists "Signed-in admins manage looks" on lookbook_looks;
create policy "Signed-in admins manage looks"
  on lookbook_looks for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

commit;
