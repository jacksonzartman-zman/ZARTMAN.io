-- 18.1.1 — Admin “award supplier” MVP (provider/offer)
--
-- Adds provider/offer award fields to public.quotes and projects them through
-- the standard quote views used by portals/admin.
--
-- Fields:
-- - awarded_provider_id (required for provider award)
-- - awarded_offer_id (nullable; optional award detail)
-- - award_notes (optional; internal/admin audit note)
--
-- Note: We intentionally do NOT add foreign keys here to keep migrations safe
-- across partial environments (some deployments may not have rfq_offers/providers yet).

alter table public.quotes
  add column if not exists awarded_provider_id uuid,
  add column if not exists awarded_offer_id uuid,
  add column if not exists award_notes text;

create index if not exists quotes_awarded_provider_id_idx
  on public.quotes (awarded_provider_id);

create index if not exists quotes_awarded_offer_id_idx
  on public.quotes (awarded_offer_id);

-- IMPORTANT:
-- Do NOT recreate views here.
--
-- Postgres does not allow `CREATE OR REPLACE VIEW` to insert new columns in the middle
-- of an existing view definition (it treats that as renaming columns by position).
-- Instead, application code reads these fields directly from `public.quotes`, while
-- existing UIs continue to rely on `awarded_at` for "awarded" state everywhere.
