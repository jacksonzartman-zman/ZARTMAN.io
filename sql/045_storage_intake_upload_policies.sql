-- Phase 11.4: Fix Supabase Storage RLS for /quote intake uploads.
--
-- Goal: allow authenticated users to upload their own CAD files to:
--   bucket: cad_uploads (private)
--   path:   uploads/intake/<auth.uid()>/...
--
-- Safe to run multiple times.

-- Ensure bucket exists (private).
insert into storage.buckets (id, name, public, file_size_limit)
values ('cad_uploads', 'cad_uploads', false, 52428800)
on conflict (id) do nothing;

-- Allow authenticated users to INSERT their own intake uploads.
drop policy if exists "intake_upload_insert_own" on storage.objects;
create policy "intake_upload_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'cad_uploads'
  and name like ('uploads/intake/' || auth.uid()::text || '/%')
);

-- Allow authenticated users to SELECT their own intake uploads (client-side verification flows).
drop policy if exists "intake_upload_select_own" on storage.objects;
create policy "intake_upload_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'cad_uploads'
  and name like ('uploads/intake/' || auth.uid()::text || '/%')
);

-- Allow authenticated users to DELETE their own intake uploads (cleanup on cancel).
drop policy if exists "intake_upload_delete_own" on storage.objects;
create policy "intake_upload_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'cad_uploads'
  and name like ('uploads/intake/' || auth.uid()::text || '/%')
);

