-- Adds richer RFQ intake metadata to the uploads table so the admin UI
-- can surface structured contact, process, and compliance data.

alter table if exists public.uploads
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists phone text,
  add column if not exists manufacturing_process text,
  add column if not exists quantity text,
  add column if not exists shipping_postal_code text,
  add column if not exists export_restriction text,
  add column if not exists rfq_reason text,
  add column if not exists itar_acknowledged boolean default false,
  add column if not exists terms_accepted boolean default false;
