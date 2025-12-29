import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const FUNCTION_NAME = "step-to-stl" as const;

function shortRequestId(): string {
  try {
    // eslint-disable-next-line no-restricted-globals
    const bytes =
      typeof crypto !== "undefined" && "getRandomValues" in crypto
        ? crypto.getRandomValues(new Uint8Array(6))
        : null;
    if (bytes) {
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // ignore
  }
  return Math.random().toString(16).slice(2, 10);
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function truncateText(input: string, maxChars: number): string {
  if (!input) return "";
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars))}…`;
}

function safeSupabaseHost(supabaseUrl: string | null): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).host || null;
  } catch {
    return null;
  }
}

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function looksLikeHtml(bodyText: string, contentType: string | null): boolean {
  if (!bodyText) return false;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("text/html")) return true;
  const t = bodyText.trimStart().toLowerCase();
  return t.startsWith("<!doctype html") || t.startsWith("<html");
}

export async function GET(req: NextRequest) {
  const requestId = shortRequestId();

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized", requestId }, { status: 401 });
  }

  try {
    await requireAdminUser();
  } catch {
    return NextResponse.json({ error: "forbidden", requestId }, { status: 403 });
  }

  const bucketParam = normalizeId(req.nextUrl.searchParams.get("bucket"));
  const pathParam = normalizePath(req.nextUrl.searchParams.get("path"));
  const bucketEnv = normalizeId(process.env.EDGE_HEALTH_CANARY_BUCKET);
  const pathEnv = normalizePath(process.env.EDGE_HEALTH_CANARY_PATH);

  // Deterministic, production-safe "is it deployed?" check:
  // - If no canary is configured/passed, we still invoke the function with a known bucket and a nonsense path.
  // - The function will likely return `{ ok: false, reason: "download_failed" }`, which is still a healthy signal
  //   that the edge function exists and is reachable (as opposed to 404 edge_function_not_found).
  const isCanaryMode = Boolean((bucketParam && pathParam) || (bucketEnv && pathEnv));
  const bucket = bucketParam || bucketEnv || "cad_uploads";
  const path = pathParam || pathEnv || "__edge_health__/missing.step";

  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
    null;
  const supabaseHost = safeSupabaseHost(supabaseUrl);

  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, requestId, functionName: FUNCTION_NAME, error: "missing_SUPABASE_URL", supabaseHost },
      { status: 200 },
    );
  }

  const serviceRoleKey = normalizeId(process.env.SUPABASE_SERVICE_ROLE_KEY);
  const anonKey = normalizeId(process.env.SUPABASE_ANON_KEY);
  const supabaseKey = serviceRoleKey || anonKey;
  if (!supabaseKey) {
    return NextResponse.json(
      {
        ok: false,
        requestId,
        functionName: FUNCTION_NAME,
        error: "missing_SUPABASE_SERVICE_ROLE_KEY_or_SUPABASE_ANON_KEY",
        supabaseHost,
      },
      { status: 200 },
    );
  }

  const edgeUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${FUNCTION_NAME}`;

  let edgeStatus: number | null = null;
  let edgeHeaders: Record<string, string> | null = null;
  let edgeBodyPreview: string | null = null;
  let edgeJson: unknown | null = null;
  let edgeVersionHeader: string | null = null;

  try {
    const resp = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ bucket, path, requestId, mode: "probe" }),
    });

    edgeStatus = resp.status;
    edgeHeaders = headersToObject(resp.headers);
    edgeVersionHeader = edgeHeaders["x-step-to-stl-version"] ?? null;

    const contentType = resp.headers.get("content-type");
    const bodyText = await resp.text();
    edgeBodyPreview = bodyText ? truncateText(bodyText, 50_000) : null;

    try {
      edgeJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      edgeJson = null;
    }

    const didNotExecuteMessage =
      edgeStatus === 502 && looksLikeHtml(bodyText, contentType)
        ? "Function did not execute; likely runtime/bundle failure before handler."
        : null;

    const dataOk = Boolean((edgeJson as any)?.ok === true);
    const ok = isCanaryMode ? dataOk : true;

    const outHeaders = new Headers();
    if (edgeVersionHeader) outHeaders.set("x-step-to-stl-version", edgeVersionHeader);

    return NextResponse.json(
      {
        ok,
        requestId,
        functionName: FUNCTION_NAME,
        mode: isCanaryMode ? "canary" : "invoke_only",
        supabaseHost,
        edgeUrl,
        edgeStatus,
        edgeHeaders,
        edgeJson,
        edgeBodyPreview,
        didNotExecuteMessage,
      },
      { status: 200, headers: outHeaders },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        requestId,
        functionName: FUNCTION_NAME,
        mode: isCanaryMode ? "canary" : "invoke_only",
        supabaseHost,
        edgeUrl,
        edgeStatus,
        edgeHeaders,
        edgeBodyPreview: truncateText(msg, 500),
        edgeJson,
      },
      { status: 200 },
    );
  }
}

