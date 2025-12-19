-- Phase 8: supplier bid workspace drafts
-- Stores per-supplier per-quote bid workspace state (draft JSONB)

create table if not exists public.quote_supplier_bid_drafts (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (quote_id, supplier_id)
);

create index if not exists quote_supplier_bid_drafts_quote_id_idx
  on public.quote_supplier_bid_drafts (quote_id);

create index if not exists quote_supplier_bid_drafts_supplier_id_idx
  on public.quote_supplier_bid_drafts (supplier_id);
