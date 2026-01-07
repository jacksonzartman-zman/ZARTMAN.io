## Canonical files backfill (portals)

### Why this exists

Customer + supplier portals show RFQ files **only** from canonical rows in `files_valid` (fallback `files`). Legacy quote fields like `quotes.file_name` / `quotes.file_names` are **display-only** and must never be used to guess Storage paths at read/preview time.

If historical quotes have `canonical_file_rows = 0`, portals will show **No files attached** (or **Files missing (needs backfill/re-upload)** if legacy filenames exist).

If portals show **0 files even after backfill**, ensure the loader fallback is deployed.

### Security note

This script uses the **Supabase service role** key. Run it only from a **secure environment** (Codespace or similarly locked down machine) and never paste the key into logs or tickets.

### One-time setup

- Install dependencies:

```bash
npm ci
```

- Ensure `tsx` exists (only if missing):

```bash
npm i -D tsx
```

### Dry-run (recommended)

```bash
npm run backfill:files:dry
```

### Apply

```bash
npm run backfill:files
```

## Backfill from uploads (recommended)

This mode backfills canonical rows deterministically from `quotes.upload_id -> uploads.file_path`, and resolves the Storage object key from `storage.objects` in the `cad_uploads` bucket.

### Single quote dry-run

```bash
npm run backfill:uploads:dry -- --quoteId <quote-uuid> --verbose
```

### Single quote apply

```bash
npm run backfill:uploads -- --quoteId <quote-uuid> --verbose
```

### Batch dry-run

```bash
npm run backfill:uploads:dry -- --limit 50 --verbose
```

### Batch apply

```bash
npm run backfill:uploads -- --limit 500 --verbose
```

### Single quote dry-run

```bash
npm run backfill:files:dry -- --quoteId <quote-uuid>
```

### Single quote apply

```bash
npm run backfill:files -- --quoteId <quote-uuid>
```

### Batch dry-run

```bash
npm run backfill:files:dry -- --limit 20 --verbose
```

### Batch apply

```bash
npm run backfill:files -- --limit 500 --verbose
```

### Verification SQL

- Canonical count per quote:

```sql
-- If `public.files_valid` exists:
select quote_id, count(*) as canonical_count
from public.files_valid
group by quote_id
order by canonical_count desc
limit 100;

-- If your env does not have `public.files_valid`, use `public.files`:
select quote_id, count(*) as canonical_count
from public.files
group by quote_id
order by canonical_count desc
limit 100;
```

- Show canonical rows for a specific quote_id:

```sql
-- Prefer files_valid if it exists in your env.
select *
from public.files_valid
where quote_id = '<quote-uuid>'

select *
from public.files
where quote_id = '<quote-uuid>'
```

- Check `storage.objects` presence by path:

```sql
select o.bucket_id, o.name, o.created_at
from storage.objects o
where o.bucket_id = 'cad_uploads'
  and o.name = '<storage-object-key>';
```

- Show recent quotes with **zero canonical file rows**:

```sql
select q.id, q.created_at
from public.quotes q
where not exists (select 1 from public.files_valid f where f.quote_id = q.id)
  and not exists (select 1 from public.files f where f.quote_id = q.id)
order by q.created_at desc
limit 50;
```

- After running the backfill script, the count returned by the query above should decrease.

