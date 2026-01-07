## Canonical files backfill (portals)

### Why this exists

Customer + supplier portals show RFQ files **only** from canonical rows in `files_valid` (fallback `files`). Legacy quote fields like `quotes.file_name` / `quotes.file_names` are **display-only** and must never be used to guess Storage paths at read/preview time.

If historical quotes have `canonical_file_rows = 0`, portals will show **No files attached** (or **Files missing (needs backfill/re-upload)** if legacy filenames exist).

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
npx tsx scripts/backfill-canonical-quote-files.ts --dryRun --limit 5 --verbose
```

### Apply

```bash
npx tsx scripts/backfill-canonical-quote-files.ts --limit 500 --verbose
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

