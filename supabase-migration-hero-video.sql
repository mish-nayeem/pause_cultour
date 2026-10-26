-- ===========================================================================
-- RUN THIS ONCE, WHOLE FILE, IN: Supabase Dashboard → SQL Editor → New query
-- ===========================================================================
-- The homepage hero video (Admin → Website → Homepage → Hero video): a public
-- `videos` bucket the admin uploads to. The video's address itself is kept in
-- site_settings ('hero_video'), so nothing else changes. Safe to run twice.
--
-- 50 MB per file is Supabase's limit on the free plan — but keep a hero video
-- far smaller (3–8 MB): every visitor downloads it, and the free plan has
-- 5 GB of downloads a month for everything.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Admin reads videos" on storage.objects;
create policy "Admin reads videos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'videos' and public.is_admin());

drop policy if exists "Admin uploads videos" on storage.objects;
create policy "Admin uploads videos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'videos' and public.is_admin());

drop policy if exists "Admin replaces videos" on storage.objects;
create policy "Admin replaces videos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'videos' and public.is_admin())
  with check (bucket_id = 'videos' and public.is_admin());

drop policy if exists "Admin deletes videos" on storage.objects;
create policy "Admin deletes videos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'videos' and public.is_admin());

commit;
