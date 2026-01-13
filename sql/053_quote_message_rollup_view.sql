-- Phase 18.3.1: Quote message rollups for "needs reply" + inbox sorting.
-- View name: public.quote_message_rollup
--
-- Defensive behavior:
-- - If public.quote_messages does not exist, no-op.
-- - If role column is `sender_role` OR legacy `author_type`, support either.
-- - Idempotent: CREATE OR REPLACE VIEW.
--
-- Notes:
-- - Phase 18.3.2: "system" is NOT treated as admin; track it separately.
-- - Reads happen via service role in app code; view doesn't change RLS expectations.

DO $$
DECLARE
  role_col text;
BEGIN
  -- No-op if the backing table isn't present (older/dev environments).
  IF to_regclass('public.quote_messages') IS NULL THEN
    RAISE NOTICE 'quote_message_rollup: public.quote_messages missing; skipping view creation';
    RETURN;
  END IF;

  -- Support schema variants: prefer sender_role, fall back to author_type.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quote_messages'
      AND column_name = 'sender_role'
  ) THEN
    role_col := 'sender_role';
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'quote_messages'
      AND column_name = 'author_type'
  ) THEN
    role_col := 'author_type';
  ELSE
    RAISE NOTICE 'quote_message_rollup: no sender_role/author_type column; skipping view creation';
    RETURN;
  END IF;

  EXECUTE format($f$
    CREATE OR REPLACE VIEW public.quote_message_rollup AS
    SELECT
      quote_id,
      max(created_at) FILTER (WHERE lower(%1$I) = 'admin') AS last_admin_at,
      max(created_at) FILTER (WHERE lower(%1$I) = 'system') AS last_system_at,
      max(created_at) FILTER (WHERE lower(%1$I) = 'customer') AS last_customer_at,
      max(created_at) FILTER (WHERE lower(%1$I) = 'supplier') AS last_supplier_at,
      max(created_at) AS last_message_at
    FROM public.quote_messages
    GROUP BY quote_id
  $f$, role_col);
END
$$;

