-- Adds notification preference flags for customers and suppliers.

alter table if exists public.customers
  add column if not exists notify_quote_messages boolean default true,
  add column if not exists notify_quote_winner boolean default true;

alter table if exists public.suppliers
  add column if not exists notify_quote_messages boolean default true,
  add column if not exists notify_quote_winner boolean default true;
