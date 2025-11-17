## Cloudflare Pages API Smoke Tests

Run these commands **after** deploying the latest changes to Cloudflare Pages. Replace the base domain if you are testing against a preview URL.

### Health Checks

```bash
curl -i https://zartman.io/api/ping
curl -i https://zartman.io/api/has-service-role
curl -i https://zartman.io/api/runtime
curl -i https://zartman.io/api/debug
```

Expected: HTTP 200 for each endpoint. `/api/ping` returns `pong:GET` as plain text, while the JSON endpoints include `ok: true`. `/api/has-service-role` responds with `hasServiceRole: true` when the Pages project is bound to `SUPABASE_SERVICE_ROLE_KEY`.

This file previously contained Cloudflare Pages smoke tests and has been removed as part of migration to Vercel.
