-- Phase 11.3: Instant STEP preview
-- Create private bucket for server-generated CAD previews.
--
-- NOTE: This uses Supabase Storage's `storage` schema.
-- Safe to run multiple times.

insert into storage.buckets (id, name, public, file_size_limit)
values ('cad_previews', 'cad_previews', false, 52428800)
on conflict (id) do nothing;

