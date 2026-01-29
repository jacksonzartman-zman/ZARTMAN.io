# CLOUD

## Standard local + CI checks

Required commands (run from repo root):
- `npm ci`
- `npx tsc --noEmit`
- `npm run lint` (uses Next.js ESLint). If this fails in CI, reproduce locally with Node 18+ after `npm ci` and run it from the repo root; load your `.env.local` if linted modules read env vars at import time.
- `npm run build`

## Demo checklist (Investor demo)

Pre-req: set `DEMO_MODE=true` (default is off). Demo tooling is **blocked in production** even if the flag is set.

### Customer flow checkpoints

1) Open the seeded workspace: `/customer/search?quote=<id>&demo=1`
2) Confirm the page renders (no crashes) and shows **2–3 offers** in **Offers returned** / **Compare offers**.
3) Open `/customer/quotes/<id>` and confirm Compare Offers + Decision CTAs render (even if destinations/activity are empty).
4) Click **Request introduction** and confirm the modal opens and submits without errors.

### Admin flow checkpoints

1) Log in, unlock admin, open `/admin/quotes`.
2) Confirm **Create demo search request** button appears only when `DEMO_MODE=true`.
3) Click it and confirm it redirects to the customer search page for the new quote.
4) Open `/admin/quotes/<id>` and confirm destinations/offers panels render (missing schema should degrade, not crash).

### Supplier flow checkpoints

1) From `/admin/quotes/<id>`, copy a provider offer link (token) if destinations exist.
2) Open `/provider/offer/<token>` and confirm the page renders and can submit/update an offer.

## Manual QA — Metasearch Smoke Test (10–15 minutes)

Goal: one checklist to validate the full metasearch loop end-to-end.

### Customer flow

1) Log in as a customer.
2) Homepage → pick process tab → upload STEP → start search → lands on
   `/customer/search?quote=<id>`.
3) Verify the search status card renders and does not show noisy recent
   searches.
4) Confirm the Search activity feed renders near the status card; refresh the
   page and ensure it updates (timestamps, new entries).
5) From results, open the quote detail page; confirm it is accessible, shows a
   consistent "Searching providers..." status, and includes the Search activity
   feed under the status card.
6) Confirm the estimate band renders with its disclaimer; ensure no
   ops_events insert failures are surfaced to the UI.
6.1) If offers exist: click "Request introduction" → submit the modal → confirm the success state ("We’ll connect you shortly") displays.

### Admin/Ops flow

7) Open admin quote detail → destination picker → add providers (eligible
   prioritized + show-all toggle).
8) Dispatch 1 email provider + 1 web-form provider; confirm ops inbox
   counts/timestamps update, then refresh the customer search/quote view to see
   dispatch-started entries in the activity feed.
9) Mark the web-form destination as submitted with notes; confirm
   submitted_at displays and ops inbox revalidates, then refresh the customer
   view to see the supplier submission entry.
10) Submit a provider offer (if available) and refresh the customer
   search/quote view to confirm an offer received/revised entry appears.
11) Confirm providers pipeline page can verify + activate a provider and show
   status timeline events.

### Smoke Test IDs

Paste identifiers used during QA for traceability:
- quoteId:
- providerId (email):
- providerId (web-form):

## Manual QA — Customer Teammate Invites (Phase 20.1.4) (5–10 minutes)

Goal: validate product-native team invites: create → (optional) email → accept → team membership.

1) Log in as a customer and open a quote page (e.g. `/customer/quotes/<id>`).
2) Click **Invite teammate** (the modal used for sharing a search request).
3) Enter an email (use a second account email you can log in with) and submit.
4) Confirm the modal shows an **Invited** success state.
5) If email is configured: open the invite email and click **Accept invite**.
   - If email is not configured: use the copied link (or copy from customer team page if available) and open it.
6) On `/customer/team/invite/[token]`:
   - If logged out, confirm it prompts login and login continues the accept flow (via `next=`).
   - If logged in as the invited email, confirm it accepts and redirects to the intended next page (defaults to `/customer`).
7) Verify the accepting user can now access the customer portal as a team member (team membership is `customer_team_members`).

Smoke Test IDs:
- invite token:
- team_id:

## Manual QA — Admin Discover Suppliers (5 minutes)

Goal: validate the “supplier discovered → provider pipeline” growth loop.

1) Log in as an admin.
2) Open `/admin/suppliers/discover`.
3) In **New supplier lead**, enter:
   - Company name (required)
   - Website (required)
   - Email (optional)
   - Select a few process/material tags
4) Click **Create discovered provider**.
5) Confirm a success banner appears and click **View discovered providers in pipeline →**.
6) Confirm the provider appears in `/admin/providers/pipeline` with:
   - Source shown as “Discovered”
   - Status: **Inactive** + **Unverified**
   - Directory hidden (if `show_in_directory` exists)
7) Expand **Ops timeline** for the row and confirm a `supplier_discovered` event is present (if the DB supports that event type).

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

Strict build guard:
- See `docs/STRICT_BUILD_GUARD_CHECKLIST.md` (covers union/status maps, typed empty arrays, and always running `npm run build`).

Common causes:
- TypeScript or ESLint errors during `npm run build`
- Missing/incorrect env vars (for example `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)
- Migrations applied out of order (views missing columns expected by `scripts/check-db-view-contract.mjs`)
