import { NextResponse } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const FUNCTION_NAME = "step-to-stl" as const;

function shortRequestId(): string {
  try {
    // eslint-disable-next-line no-restricted-globals
    const bytes =
      typeof crypto !== "undefined" && "getRandomValues" in crypto ? crypto.getRandomValues(new Uint8Array(6)) : null;
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

function truncateText(input: string, maxChars: number): string {
  if (!input) return "";
  if (input.length <= maxChars) return input;
  return `${input.slice(0, Math.max(0, maxChars))}…`;
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

export async function GET() {
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

  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
    null;

  if (!supabaseUrl) {
    return NextResponse.json({ ok: false, requestId, functionName: FUNCTION_NAME, error: "missing_SUPABASE_URL" }, { status: 200 });
  }

  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const anonKey = (process.env.SUPABASE_ANON_KEY ?? "").trim();
  const supabaseKey = serviceRoleKey || anonKey;
  if (!supabaseKey) {
    return NextResponse.json(
      { ok: false, requestId, functionName: FUNCTION_NAME, error: "missing_SUPABASE_SERVICE_ROLE_KEY_or_SUPABASE_ANON_KEY" },
      { status: 200 },
    );
  }

  const edgeUrl = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${FUNCTION_NAME}`;

  try {
    const resp = await fetch(edgeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: supabaseKey,
        authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ requestId }),
    });

    const status = resp.status;
    const edgeHeaders = headersToObject(resp.headers);
    const edgeVersionHeader = edgeHeaders["x-step-to-stl-version"] ?? null;

    const contentType = resp.headers.get("content-type");
    const bodyText = await resp.text();

    let parsedJson: unknown | null = null;
    try {
      parsedJson = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsedJson = null;
    }

    const didNotExecuteMessage =
      status === 502 && looksLikeHtml(bodyText, contentType)
        ? "Function did not execute; likely runtime/bundle failure before handler."
        : null;

    const outHeaders = new Headers();
    if (edgeVersionHeader) outHeaders.set("x-step-to-stl-version", edgeVersionHeader);

    return NextResponse.json(
      {
        ok: true,
        requestId,
        functionName: FUNCTION_NAME,
        edgeUrl,
        status,
        headers: edgeHeaders,
        body: truncateText(bodyText, 50_000),
        json: parsedJson,
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
        edgeUrl,
        status: null,
        error: truncateText(msg, 500),
      },
      { status: 200 },
    );
  }
}

