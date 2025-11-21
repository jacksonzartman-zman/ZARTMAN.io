-- Adds customer-visible DFM notes support for quotes and ensures the admin view can read it.

alter table if exists public.quotes
  add column if not exists dfm_notes text;

comment on column public.quotes.dfm_notes is
  'Customer-visible design for manufacturability notes.';

-- Refresh/replace the quotes_with_uploads view if it does not automatically project the new column.
