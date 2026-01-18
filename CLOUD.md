# CLOUD

## Standard local + CI checks

Required commands (run from repo root):
- `npm ci`
- `npx tsc --noEmit`
- `npm run lint` (uses Next.js ESLint). If this fails in CI, reproduce locally with Node 18+ after `npm ci` and run it from the repo root; load your `.env.local` if linted modules read env vars at import time.
- `npm run build`

## Manual QA (10 minutes)

- Customer: submit intake → lands on `/customer/search?quote=<id>` → verify status card + filters render
- Quote detail: "Searching providers..." panel renders with counts + refresh button
- Offers compare: change sort dropdown; confirm URL query updates and persists on refresh
- Invite supplier: submit invite; confirm success toast/copy; verify ops event present (if timeline exists)
- Admin: providers review page shows customer-invite filter; mark contacted works; ops event logged
- Provider: open provider offer link; submit offer; verify confirmation and revision behavior

## DB-contract checks

Optional check:
- `node scripts/check-db-view-contract.mjs`

Required environment variables:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Supabase migrations (local)

No Supabase CLI migration workflow is tracked in this repo (no `supabase/migrations` or `supabase/config.toml`). Schema SQL lives in `sql/` and `web/sql/` and is applied manually (Supabase SQL editor or running the scripts against your local DB).

## When Vercel fails

Where to find logs:
- Vercel Dashboard → Project → Deployments → Build Logs
- Vercel Dashboard → Project → Deployments → Runtime Logs (Functions/Edge)

Common causes:
- TypeScript or ESLint errors during `npm run build`
- Missing/incorrect env vars (for example `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Migrations applied out of order (views missing columns expected by `scripts/check-db-view-contract.mjs`)
