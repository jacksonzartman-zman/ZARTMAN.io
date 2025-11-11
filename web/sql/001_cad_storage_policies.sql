-- 001_cad_storage_policies.sql
-- RLS policies for storage.objects to enforce per-user access to 'cad' bucket

-- read own files
DROP POLICY IF EXISTS cad_read_own ON storage.objects;
CREATE POLICY cad_read_own
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'cad'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- upload/write in own folder
DROP POLICY IF EXISTS cad_write_own ON storage.objects;
CREATE POLICY cad_write_own
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'cad'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- allow updates only in your folder
DROP POLICY IF EXISTS cad_update_own ON storage.objects;
CREATE POLICY cad_update_own
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'cad'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'cad'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- allow deletes only in your folder
DROP POLICY IF EXISTS cad_delete_own ON storage.objects;
CREATE POLICY cad_delete_own
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'cad'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Notes:
-- 1) Run this in the Supabase SQL editor or via psql connected to your Supabase Postgres.
-- 2) Service-role key bypasses RLS; use it only on trusted server-side code.
-- 3) Ensure the 'cad' bucket is private to prevent unauthenticated direct object access.
