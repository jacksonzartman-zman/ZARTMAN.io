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

