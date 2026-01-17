-- Phase 24: Capture offer selection confirmation details.

alter table if exists public.quotes
  add column if not exists po_number text null,
  add column if not exists ship_to text null,
  add column if not exists inspection_requirements text null,
  add column if not exists selection_confirmed_at timestamptz null;

notify pgrst, 'reload schema';
