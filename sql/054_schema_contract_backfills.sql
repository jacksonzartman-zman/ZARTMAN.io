-- Phase 17.2 Part 2: schema contract backfills / compatibility surfaces.
--
-- Goals:
-- - Safe to run when some relations do not exist.
-- - Prefer compatibility views / aliases over destructive schema changes.
-- - Keep existing deployments (old/new) working without immediate app changes.

-- 1) Compatibility VIEW for canonical file columns:
--    - Some deployments use:
--      - bucket_id vs storage_bucket_id
--      - storage_path vs file_path
--    - Expose a stable read surface as public.files_valid_compat with:
--      - bucket_id (coalesced)
--      - storage_path (coalesced)
--      - plus a small set of commonly-used passthrough columns
DO $$
DECLARE
  has_id boolean;
  has_quote_id boolean;
  has_filename boolean;
  has_mime boolean;
  has_size_bytes boolean;
  has_created_at boolean;
  has_bucket_id boolean;
  has_storage_bucket_id boolean;
  has_storage_path boolean;
  has_file_path boolean;

  sel_id text;
  sel_quote_id text;
  sel_filename text;
  sel_mime text;
  sel_size_bytes text;
  sel_created_at text;
  sel_bucket_id text;
  sel_storage_path text;
BEGIN
  IF to_regclass('public.files_valid') IS NULL THEN
    RAISE NOTICE 'files_valid_compat: public.files_valid missing; skipping';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'id'
  ) INTO has_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'quote_id'
  ) INTO has_quote_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'filename'
  ) INTO has_filename;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'mime'
  ) INTO has_mime;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'size_bytes'
  ) INTO has_size_bytes;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'created_at'
  ) INTO has_created_at;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'bucket_id'
  ) INTO has_bucket_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'storage_bucket_id'
  ) INTO has_storage_bucket_id;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'storage_path'
  ) INTO has_storage_path;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'files_valid' AND column_name = 'file_path'
  ) INTO has_file_path;

  sel_id := CASE WHEN has_id THEN 'id' ELSE 'null::text as id' END;
  sel_quote_id := CASE WHEN has_quote_id THEN 'quote_id' ELSE 'null::text as quote_id' END;
  sel_filename := CASE WHEN has_filename THEN 'filename' ELSE 'null::text as filename' END;
  sel_mime := CASE WHEN has_mime THEN 'mime' ELSE 'null::text as mime' END;
  sel_size_bytes := CASE WHEN has_size_bytes THEN 'size_bytes' ELSE 'null::bigint as size_bytes' END;
  sel_created_at := CASE WHEN has_created_at THEN 'created_at' ELSE 'null::timestamptz as created_at' END;

  sel_bucket_id := CASE
    WHEN has_bucket_id AND has_storage_bucket_id THEN 'coalesce(bucket_id, storage_bucket_id) as bucket_id'
    WHEN has_bucket_id THEN 'bucket_id'
    WHEN has_storage_bucket_id THEN 'storage_bucket_id as bucket_id'
    ELSE 'null::text as bucket_id'
  END;

  sel_storage_path := CASE
    WHEN has_storage_path AND has_file_path THEN 'coalesce(storage_path, file_path) as storage_path'
    WHEN has_storage_path THEN 'storage_path'
    WHEN has_file_path THEN 'file_path as storage_path'
    ELSE 'null::text as storage_path'
  END;

  EXECUTE format($f$
    CREATE OR REPLACE VIEW public.files_valid_compat AS
    SELECT
      %s,
      %s,
      %s,
      %s,
      %s,
      %s,
      %s,
      %s
    FROM public.files_valid
  $f$,
    sel_id,
    sel_quote_id,
    sel_filename,
    sel_mime,
    sel_size_bytes,
    sel_created_at,
    sel_bucket_id,
    sel_storage_path
  );
END
$$;

-- 2) Ensure public.quote_message_rollup exists only if public.quote_messages exists.
--    (Handled in sql/053_quote_message_rollup_view.sql; keep this migration consistent as a no-op.)

-- 3) Optional feature tables:
--    Intentionally NOT created here; these remain optional and are guarded by app schemaGate.

