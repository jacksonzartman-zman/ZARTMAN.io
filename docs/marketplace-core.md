# Marketplace Core Audit & Proposal

## Current State Snapshot

### Supabase tables and views in play today
- `quotes` (plus the `quotes_with_uploads` view) is the catch-all object for inbound RFQs, admin quotes, and supplier assignment data. Columns include `id`, `upload_id`, customer contact fields (`customer_name`, `email`, `company`), quote `status` (`submitted`, `in_review`, `quoted`, `approved`, `rejected`), pricing (`price`, `currency`, `target_date`), manufacturing guidance (`internal_notes`, `dfm_notes`), and supplier assignment hints (`assigned_supplier_email`, `assigned_supplier_name`).
- `uploads` stores the original intake form plus file metadata (`file_path`, `file_name`, `manufacturing_process`, `quantity`, compliance flags, etc.). Quote views join back here for intake context.
- `files` tracks Supabase storage uploads per quote (`storage_path`, `bucket_id`, `filename`, `mime`) and currently powers file previews inside quote workspaces.
- `quote_messages` (migration `005_add_quote_messages.sql`) gives a shared chat log tied to `quotes.id` with `author_type` enum-ish text.
- `customers` and `suppliers` (migration `006_portal_auth.sql`) connect Supabase auth users to business entities via `user_id`.
- `quote_suppliers` (legacy, columns visible in code: `quote_id`, `supplier_email`, optional `supplier_id`) maps suppliers—still email-based—for assignment visibility.
- `supplier_capabilities`, `supplier_documents`, and `supplier_bids` flesh out supplier profiles. `supplier_bids` carries `quote_id`, `supplier_id`, `unit_price`, `currency`, `lead_time_days`, `notes`, `status`.
- Various indexes exist around uploads and customers, but there are no RFQ-specific tables yet, and there is no normalized event log.

### Server-side behaviors
- Customer portal (`app/(portals)/customer/page.tsx`) loads the latest `quotes_with_uploads` rows for a customer email/domain to show metrics, open quotes, and activity. The `/customer/quotes/[id]` workspace page surfaces files, customer/admin messaging, and supplier bids via the existing tables. `/customer/quotes/page.tsx` is still a placeholder.
- Supplier portal (`app/(portals)/supplier/page.tsx`) authenticates suppliers, loads their profile (`suppliers`, `supplier_capabilities`, `supplier_documents`), runs `matchQuotesToSupplier` to surface open `quotes` whose `status` ∈ {`submitted`,`in_review`,`quoted`}, and lists bids from `supplier_bids`. There is no concept of a marketplace feed—everything is tied to the legacy quote objects.
- Server helpers live under `src/server/quotes/*`, `src/server/suppliers/*`, `src/server/customers/*`, and `src/server/activity.ts`. All of them reference `quotes` or `supplier_bids` directly, highlighting that RFQs and quotes are still conflated.

### Modeling gaps & risks
- **Overloaded `quotes` table**: It simultaneously represents the customer RFQ intake, the internal quote/offer, and the supplier assignment. Status fields come from the upload workflow and don’t map cleanly to a marketplace lifecycle (`draft → open → awarded → closed → cancelled`).
- **Supplier relationships rely on email strings** (`quote_suppliers`, `assigned_supplier_email`), so permissions can’t be enforced with foreign keys. There’s no direct link between a supplier and the RFQ records they bid on.
- **Bids lack RFQ context**: `supplier_bids` points at `quote_id` and assumes one quote per job. There’s no enforcement that only one winning bid exists, no currency normalization, and no relation between bids and uploaded files.
- **No RFQ-level file table**: Files stay tied to legacy `files.quote_id` / uploads, so a new marketplace RFQ can’t yet own its attachments.
- **Missing event stream**: Activity feeds are inferred from `quotes` timestamps and bid updates. There is no durable `rfq_events` history for auditing or driving notifications.
- **UI surface area**: Customers cannot create RFQs inside the portal (must use `/quote` intake), and suppliers don’t have an “open marketplace” feed or ability to submit bids except via the existing assignment-based flows.

## Proposed Marketplace Schema

### `rfqs`
| Column | Notes |
| --- | --- |
| `id uuid primary key default gen_random_uuid()` | New RFQ identifier. |
| `customer_id uuid references public.customers(id)` | Links to authenticated customer accounts. |
| `upload_id uuid references public.uploads(id)` _(optional)_ | Lets us backfill or import legacy uploads. |
| `title text not null` | Short job title (can default to file name). |
| `description text not null` | Richer brief describing the work. |
| `status text not null default 'draft' check (status in ('draft','open','closed','awarded','cancelled'))` | Marketplace lifecycle. |
| `target_processes jsonb` | Array/object of requested manufacturing processes. |
| `target_materials jsonb` | Separate field so we can index/filter later. |
| `budget_currency text default 'USD'` & `budget_amount numeric` _(nullable)_ | Optional price guidance. |
| `lead_time_days integer` _(nullable)_ | Desired delivery timeline. |
| `created_at timestamptz default now()` / `updated_at timestamptz default now()` | Timestamps maintained via trigger or application code. |

_Mapping_: Existing `quotes` rows map 1:1 to future `rfqs`. `quotes.status` variants would translate to: `submitted/in_review/quoted → open`, `approved → awarded`, `rejected → closed`. `quotes.customer_id` migrates into the FK here, while `quotes.upload_id` would align with `rfqs.upload_id`.

### `rfq_files`
| Column | Notes |
| --- | --- |
| `id uuid primary key default gen_random_uuid()` | |
| `rfq_id uuid not null references public.rfqs(id) on delete cascade` | |
| `storage_key text not null` | Supabase storage path or S3 key. |
| `bucket_id text` | Optional bucket reference. |
| `file_name text` | Display label. |
| `file_type text check (file_type in ('cad','drawing','spec','other')) default 'other'` | Simple categorization for UI filters. |
| `created_at timestamptz default now()` | |

_Mapping_: Existing `files.quote_id` entries (and `uploads.file_path`) can be copied into `rfq_files` during migration with `rfqs.upload_id` to retain history. For now we simply create the table so the new RFQ flow can own its files independent of legacy quote IDs.

### `rfq_bids`
| Column | Notes |
| --- | --- |
| `id uuid primary key default gen_random_uuid()` | |
| `rfq_id uuid not null references public.rfqs(id) on delete cascade` | |
| `supplier_id uuid not null references public.suppliers(id) on delete cascade` | Enforces identity. |
| `price_total numeric` | Total proposed price (vs. unit). |
| `currency text not null default 'USD'` | Uppercased via constraint/trigger if needed. |
| `lead_time_days integer` | |
| `notes text` | |
| `status text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn'))` | Accept/reject flow. |
| `created_at timestamptz default now()` / `updated_at timestamptz default now()` | |
| Indexes on `(rfq_id)` and `(supplier_id)` for dashboards. |

_Mapping_: Current `supplier_bids` can be migrated later by pairing each legacy `quote_id` with the new `rfq_id`. Until then we keep `supplier_bids` for existing pages and introduce `rfq_bids` for the new marketplace commands.

### `rfq_events`
| Column | Notes |
| --- | --- |
| `id uuid primary key default gen_random_uuid()` |
| `rfq_id uuid not null references public.rfqs(id) on delete cascade` |
| `actor_type text not null check (actor_type in ('customer','supplier','system'))` |
| `actor_id uuid` | Nullable; points to `customers.id` or `suppliers.id` when available. |
| `event_type text not null` | Enumerate events such as `rfq_created`, `rfq_updated`, `bid_submitted`, `bid_accepted`, `bid_withdrawn`. |
| `payload jsonb` | Stores structured metadata for feeds/notifications. |
| `created_at timestamptz default now()` |

_Usage_: Replaces today’s inference-based activity feed with a durable audit log. Whenever we create an RFQ, submit/update a bid, or change statuses, we append an event row.

### Other considerations
- Add helper indexes: `rfqs_customer_id_status_idx` on `(customer_id, status)` and `rfq_bids_status_idx` on `(rfq_id, status)` to support listing open RFQs and active bids.
- Expose `rfqs.id` alongside legacy `quotes.id` in application code so we can progressively migrate customers/suppliers to the new experience.
- Keep the existing `quotes`, `supplier_bids`, `quote_messages`, and `quote_suppliers` tables untouched for now. We’ll backfill or sunset them after validating the new flow.

## Migration & Breaking-Change Notes
- New migration will **create** `rfqs`, `rfq_files`, `rfq_bids`, `rfq_events` if they do not exist, with the foreign keys described above and the recommended indexes.
- No tables are dropped or renamed. Legacy portals will keep functioning because their code continues to hit `quotes` and `supplier_bids`.
- Future migrations should copy data from `quotes` → `rfqs` and `supplier_bids` → `rfq_bids`, at which point we can flip feature flags in the portals to rely entirely on the new schema.
- Event ingestion requires application-layer changes (server functions in `src/server/marketplace/` and new UI endpoints) to write to the new tables consistently.
