# CLOUD

## Standard local + CI checks

Required commands (run from repo root):
- `npm ci`
- `npx tsc --noEmit`
- `npm run lint` (uses Next.js ESLint). If this fails in CI, reproduce locally with Node 18+ after `npm ci` and run it from the repo root; load your `.env.local` if linted modules read env vars at import time.
- `npm run build`

## Manual QA — Metasearch Smoke Test (10–15 minutes)

Goal: one checklist to validate the full metasearch loop end-to-end.

### Customer flow

1) Log in as a customer.
2) Homepage → pick process tab → upload STEP → start search → lands on
   `/customer/search?quote=<id>`.
3) Verify the search status card renders and does not show noisy recent
   searches.
4) From results, open the quote detail page; confirm it is accessible and shows
   a consistent "Searching providers..." status.
5) Confirm the estimate band renders with its disclaimer; ensure no
   ops_events insert failures are surfaced to the UI.

### Admin/Ops flow

6) Open admin quote detail → destination picker → add providers (eligible
   prioritized + show-all toggle).
7) Dispatch 1 email provider + 1 web-form provider; confirm ops inbox
   counts/timestamps update.
8) Mark the web-form destination as submitted with notes; confirm
   submitted_at displays and ops inbox revalidates.
9) Confirm providers pipeline page can verify + activate a provider and show
   status timeline events.

### Smoke Test IDs

Paste identifiers used during QA for traceability:
- quoteId:
- providerId (email):
- providerId (web-form):

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
