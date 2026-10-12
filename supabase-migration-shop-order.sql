-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Shop order: the admin drags products into the order the shop's ALL page
-- shows them. Category, NEW and drop pages keep newest upload first.

begin;

-- ---------------------------------------------------------------------------
-- Shop order (ALL page)
-- ---------------------------------------------------------------------------
-- shop_position: place on the ALL page, 1 = top. null = never placed (just
-- uploaded); those go above the placed ones, newest first.
alter table products add column if not exists shop_position int;

-- Saves the whole order in one go: ids in the order they should show.
create or replace function public.reorder_products(ids text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;

  update products p
     set shop_position = x.ord
    from unnest(ids) with ordinality as x(id, ord)
   where p.id = x.id;
end;
$$;

revoke all on function public.reorder_products(text[]) from public, anon;
grant execute on function public.reorder_products(text[]) to authenticated;

commit;
