# STEP preview deployment (Supabase Edge Function: `step-to-stl`)

This production runbook is for fixing **STEP preview failures** where the app returns a 404 / `edge_function_not_found` (surfaced as `edge_function_not_deployed` in our API responses).

## Confirm which Supabase project production is using

1. Hit the admin-only env sanity endpoint:

- `GET /api/debug/supabase-env`

2. Confirm the hostnames match what you expect:

- `supabaseHost`: hostname parsed from `SUPABASE_URL`
- `supabaseHostEffective`: hostname the server client is actually using (based on `SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL`)
- `edgeUrl`: computed as `SUPABASE_URL + /functions/v1/step-to-stl` (with trailing slashes normalized)

If `supabaseHostEffective` is not the production Supabase project you expect, fix production environment variables first (wrong project = 404 even if another project has the function deployed).

## Deploy the Edge Function to the correct project

Prereqs:

- Supabase CLI installed (`supabase --version`)
- You have access to the target Supabase project

From the repo root:

```bash
supabase link --project-ref <ref>
supabase functions deploy step-to-stl
```

If the function requires secrets in that project, set them explicitly (example; only set what your function actually reads):

```bash
supabase secrets set SOME_SECRET_NAME=...
```

## Apply required SQL migrations in the same project

The STEP preview pipeline requires Storage buckets and policies in the **same** Supabase project:

- **`044_create_cad_previews_bucket.sql`**: creates the `cad_previews` bucket (preview output).
- **`045_storage_intake_upload_policies.sql`**: ensures `cad_uploads` bucket + required RLS/policies (preview input).

If you manage migrations via the Supabase CLI:

```bash
supabase db push
```

If migrations are applied manually in your org, ensure `sql/044_create_cad_previews_bucket.sql` and `sql/045_storage_intake_upload_policies.sql` are executed against the production database for this Supabase project.

## Verify end-to-end (production-safe)

1. Pick a real uploaded STEP file:

- `bucket=cad_uploads`
- `path=<the stored path to a .step or .stp file>`

2. Invoke the admin-only debug probe (it calls `functions.invoke("step-to-stl")`):

- `GET /api/debug/edge-step-to-stl?bucket=cad_uploads&path=<path>`

Expected results:

- `ok: true` and `data.ok: true`
- `functionName: "step-to-stl"`
- `supabaseHost`/`edgeUrl` point at the expected project

If you see `error: "edge_function_not_deployed"` with a 404 status inside the payload, the function is not deployed to that project (or you’re pointing at the wrong project).

3. Verify preview download works via the normal API:

- `GET /api/cad-preview?...` for the same STEP upload should return `model/stl` bytes (not 502).

4. Confirm Supabase Edge logs

In Supabase dashboard logs for Edge Functions, you should see:

- `[step-to-stl] start` for the request
- `[step-to-stl] ok` for the same request

Tip: our app logs include a `requestId` for `cad-preview` and `debug-edge-step-to-stl`; correlate by timestamp and file path.

