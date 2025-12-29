// Supabase Edge Function: step-to-stl
// Probe-only build (no npm/jsr imports). Intentionally does NOT convert or upload anything.

const VERSION = "probe-v2" as const;

// On module init, log boot marker (if absent, runtime/bundle failed before handler).
console.log("[step-to-stl] boot", { ts: Date.now(), version: VERSION });

type JsonRecord = Record<string, unknown>;

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function shortRequestId(): string {
  try {
    // eslint-disable-next-line no-restricted-globals
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return Math.random().toString(16).slice(2, 10);
  }
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function encodePathSegments(path: string): string {
  // Encode each segment to avoid breaking URL paths with spaces/etc.
  return path
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
}

function jsonResponse(body: JsonRecord, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers ?? {});
  headers.set("Content-Type", "application/json");
  headers.set("x-step-to-stl-version", VERSION);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(JSON.stringify(body), { ...init, headers });
}

async function tryParseJsonBody(req: Request): Promise<JsonRecord | null> {
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as JsonRecord;
    return null;
  } catch {
    return null;
  }
}

function safeEnv(name: string): string {
  try {
    return Deno.env.get(name) ?? "";
  } catch {
    return "";
  }
}

async function storageDownloadProbe(params: { bucket: string; path: string }): Promise<{
  ok: boolean;
  status: number | null;
  bytes: number | null;
  contentType: string | null;
  error: string | null;
}> {
  const supabaseUrl = safeEnv("SUPABASE_URL");
  const serviceRoleKey = safeEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = safeEnv("SUPABASE_ANON_KEY");
  const supabaseKey = serviceRoleKey || anonKey;

  if (!supabaseUrl) {
    return { ok: false, status: null, bytes: null, contentType: null, error: "missing_env_SUPABASE_URL" };
  }
  if (!supabaseKey) {
    return {
      ok: false,
      status: null,
      bytes: null,
      contentType: null,
      error: "missing_env_SUPABASE_SERVICE_ROLE_KEY_or_SUPABASE_ANON_KEY",
    };
  }

  const base = supabaseUrl.replace(/\/+$/, "");
  const bucketEnc = encodeURIComponent(params.bucket);
  const pathEnc = encodePathSegments(params.path);
  const url = `${base}/storage/v1/object/${bucketEnc}/${pathEnc}`;

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
      },
    });

    const contentType = resp.headers.get("content-type");
    if (!resp.ok) {
      // Avoid returning HTML from upstream errors; just report status.
      return {
        ok: false,
        status: resp.status,
        bytes: null,
        contentType,
        error: `storage_download_failed_${resp.status}`,
      };
    }

    const buf = await resp.arrayBuffer();
    return { ok: true, status: resp.status, bytes: buf.byteLength, contentType, error: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: null, bytes: null, contentType: null, error: `storage_fetch_error:${msg}` };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { ...corsHeaders(), "x-step-to-stl-version": VERSION } });
  }

  const body = await tryParseJsonBody(req);
  const requestId = normalizeString(body?.requestId) || shortRequestId();
  const mode = normalizeString(body?.mode).toLowerCase();

  // Default mode: prove handler entry (no storage, no conversion).
  if (mode !== "probe") {
    return jsonResponse({
      ok: true,
      stage: "handler_entry",
      version: VERSION,
      requestId,
    });
  }

  const bucket = normalizeString(body?.bucket);
  const path = normalizePath(body?.path);

  if (!bucket || !path) {
    return jsonResponse({
      ok: false,
      stage: "storage_download",
      bytes: null,
      contentType: null,
      error: "missing_bucket_or_path",
      version: VERSION,
      requestId,
    });
  }

  const result = await storageDownloadProbe({ bucket, path });

  return jsonResponse({
    ok: result.ok,
    stage: "storage_download",
    bytes: result.bytes,
    contentType: result.contentType,
    status: result.status,
    error: result.error,
    version: VERSION,
    requestId,
  });
});

