-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- Moves photo storage from Cloudinary to Supabase Storage. Run this before
-- deploying the site that uploads there. Existing Cloudinary photos keep
-- working until the admin panel's "Move images to Supabase" button copies
-- them over (edge function migrate-images-to-storage).

begin;

-- ---------------------------------------------------------------------------
-- Image storage — the public `images` bucket
-- ---------------------------------------------------------------------------
-- Product, hero and about-page photos, replacing Cloudinary. Public, so the
-- shop reads a photo by its URL with no login; only the admin can add,
-- replace or remove one. Resized copies come from Supabase's image
-- transformation endpoint (src/lib/images.js) rather than being stored.
--
-- 20 MB per file covers a full-size phone photo; image types only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,
  20971520,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- No SELECT policy for visitors: a public bucket serves each file by its URL
-- without one, and leaving it out stops anyone listing the whole bucket.
drop policy if exists "Admin reads images" on storage.objects;
create policy "Admin reads images"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'images' and public.is_admin());

drop policy if exists "Admin uploads images" on storage.objects;
create policy "Admin uploads images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'images' and public.is_admin());

drop policy if exists "Admin replaces images" on storage.objects;
create policy "Admin replaces images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'images' and public.is_admin())
  with check (bucket_id = 'images' and public.is_admin());

drop policy if exists "Admin deletes images" on storage.objects;
create policy "Admin deletes images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'images' and public.is_admin());

commit;
