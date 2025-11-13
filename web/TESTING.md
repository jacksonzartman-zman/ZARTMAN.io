## Cloudflare Pages API Smoke Tests

Run these commands **after** deploying the latest changes to Cloudflare Pages. Replace the base domain if you are testing against a preview URL.

### Health Checks

```bash
curl -i https://zartman.io/api/has-service-role
curl -i https://zartman.io/api/runtime
```

Expected: HTTP 200 with JSON showing `ok: true`. `has-service-role` includes `hasServiceRole: true` when the Pages project is bound to `SUPABASE_SERVICE_ROLE_KEY`.

### Multipart Upload

```bash
echo "test file from curl" > /tmp/test-upload.txt

curl -s -w "\nHTTP_STATUS=%{http_code}\n" \
  -F "file=@/tmp/test-upload.txt" \
  https://zartman.io/api/upload
```

Expected: HTTP 200 with JSON shaped like:

```json
{
  "ok": true,
  "key": "1731532800000_test-upload.txt",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/cad/1731532800000_test-upload.txt",
  "bucket": "cad",
  "size": 21,
  "contentType": "text/plain"
}
```

If the response contains `"ok": false`, check the `step` field to understand where it failed:

- `parse-form`: request was not `multipart/form-data` or missing a `file` field.
- `env-check`: the Pages deployment is missing `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY`.
- `read-file`: the edge runtime could not read the uploaded file payload.
- `supabase-upload`: Supabase returned an error (see the message and `details`).
- `unexpected`: an uncaught error occurred; redeploy or inspect Cloudflare logs for stack traces.

After a successful upload, confirm the object exists in the Supabase `cad` bucket and that Storage logs show an `upload` event.
