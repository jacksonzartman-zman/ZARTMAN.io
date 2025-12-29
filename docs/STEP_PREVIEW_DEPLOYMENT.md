# STEP preview deployment (Supabase Edge Function: `step-to-stl`)

This production runbook is for fixing **STEP preview failures** where `/api/cad-preview` returns `502` with:

- `error: "edge_function_not_deployed"`
- `edgeStatus: 404`
- `functionName: "step-to-stl"`

The root cause is almost always one of:

- **The Edge Function isn’t deployed** to the production Supabase project.
- **We deployed to the wrong Supabase project** (host mismatch vs production `SUPABASE_URL`).

## 1) Confirm production Supabase host matches `SUPABASE_URL` (hostname only)

You want the **hostname** (no protocol, no path), e.g.:

- `qslztdkptpklopyedkfd.supabase.co`

### From the running production app (admin-only, deterministic)

Open:

- `GET /api/debug/supabase-env`

Confirm:

- `supabaseHost`: hostname parsed from `SUPABASE_URL` (this is the authoritative “prod host”)
- `supabaseHostEffective`: hostname the server client is actually using (should match)

If these don’t match the Supabase project you intend to use, **fix production env vars first** (deploying the function to a different project will still 404).

### Derive the project ref from the hostname

For standard Supabase hosted projects:

- project ref = the subdomain before `.supabase.co`
- example: `qslztdkptpklopyedkfd.supabase.co` → project ref `qslztdkptpklopyedkfd`

## 2) Link Supabase CLI to the production project

Prereqs:

- Supabase CLI installed locally (or use CI)
- Access to the target Supabase project

From the repo root:

```bash
supabase link --project-ref <PROJECT_REF_FROM_PROD_HOST>
```

Repo script equivalent (expects env var):

```bash
SUPABASE_PROJECT_REF=<ref> npm run supabase:link
```

## 3) Deploy the Edge Function (`step-to-stl`)

From the repo root:

```bash
supabase functions deploy step-to-stl
```

Repo script equivalent (forces target project; expects env var):

```bash
SUPABASE_PROJECT_REF=<ref> npm run supabase:deploy:step-to-stl
```

## 4) Required Edge Function secrets (and safe setup)

`supabase/functions/step-to-stl` reads these secrets at runtime:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (**recommended**) or `SUPABASE_ANON_KEY`

Notes:

- If `SUPABASE_SERVICE_ROLE_KEY` is set, the function **requires** `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Our server-side invocations use the service role key, so production should set it.

### Safe secrets setting (avoid pasting secrets into shell history)

Preferred approach: export secrets into your shell environment via your password manager, then run:

```bash
supabase secrets set \
  --project-ref <PROJECT_REF_FROM_PROD_HOST> \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_SERVICE_ROLE_KEY="$SUPABASE_SERVICE_ROLE_KEY"
```

If you must use a file, use a local, uncommitted env file and load it into your shell before running `supabase secrets set`. Do **not** commit secrets to git.

## 5) Verify deployment (production-safe, deterministic)

All endpoints below are **admin-only**.

### (a) Supabase host sanity

- `GET /api/debug/supabase-env`
- Confirm `supabaseHost` matches production hostname.

### (b) Edge function reachability / health

- `GET /api/debug/edge-health`

Expected:

- `ok: true`
- `edgeStatus: 200`
- `mode: "invoke_only"` (meaning: “function exists and can be invoked”, even if the canary object is missing)

If it returns `ok: false` with `edgeStatus: 404`, the function is not deployed to that Supabase project.

### (c) Direct probe with a known STEP upload (must be non-404)

Pick a known-good STEP upload:

- `bucket=cad_uploads`
- `path=<stored path to a .step or .stp>`

Then call:

- `GET /api/debug/edge-step-to-stl?bucket=cad_uploads&path=<path>`

Expected:

- `ok: true`
- response contains `data` (the edge function response)
- If the edge function was missing, this endpoint will surface `error: "edge_function_not_deployed"` and a 404 status in the payload.

### (d) Where to check Supabase Edge logs

In the Supabase Dashboard for the production project:

- **Logs → Edge Functions**
- Filter/select function: `step-to-stl`

You should see logs like:

- `[step-to-stl] start`
- `[step-to-stl] ok`

Tip: `/api/cad-preview` includes a `requestId`. Use it + timestamp/path to correlate app logs with Supabase Edge logs.

## GitHub Actions: required secrets for auto-deploy on `main`

The deploy workflow expects these repository secrets:

- `SUPABASE_ACCESS_TOKEN`: Supabase personal access token (CLI auth)
- `SUPABASE_PROJECT_REF`: the production project ref (derived from production `SUPABASE_URL` hostname)

Function runtime secrets (like `SUPABASE_SERVICE_ROLE_KEY`) are **Supabase project secrets** and must be managed via `supabase secrets set` (not printed in CI logs).

