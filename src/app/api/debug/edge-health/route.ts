import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";
import { supabaseServer } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  const requestId = shortRequestId();
  const functionName = "step-to-stl" as const;

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized", requestId }, { status: 401 });
  }

  try {
    await requireAdminUser();
  } catch {
    return NextResponse.json({ error: "forbidden", requestId }, { status: 403 });
  }

  const bucket =
    normalizeId(req.nextUrl.searchParams.get("bucket")) ||
    normalizeId(process.env.EDGE_HEALTH_CANARY_BUCKET);
  const path =
    normalizePath(req.nextUrl.searchParams.get("path")) ||
    normalizePath(process.env.EDGE_HEALTH_CANARY_PATH);

  if (!bucket || !path) {
    return NextResponse.json(
      {
        ok: false,
        error: "missing_bucket_or_path",
        requestId,
        functionName,
        hint:
          "Pass ?bucket=<bucket>&path=<path> (or set EDGE_HEALTH_CANARY_BUCKET/EDGE_HEALTH_CANARY_PATH on the app).",
      },
      { status: 400 },
    );
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
    null;
  const supabaseHost = safeSupabaseHost(supabaseUrl);

  let edgeStatus: number | null = null;
  let edgeBodyPreview: string | null = null;

  const { data, error: edgeError } = await supabaseServer.functions.invoke(functionName, {
    body: { bucket, path, requestId },
  });

  if (edgeError) {
    const anyErr = edgeError as any;
    edgeStatus = typeof anyErr?.context?.status === "number" ? anyErr.context.status : null;
    const body = anyErr?.context?.body;
    const bodyText =
      typeof body === "string" ? body : body != null ? JSON.stringify(body) : anyErr?.message ?? "";
    edgeBodyPreview = bodyText ? truncateText(bodyText, 500) : null;

    return NextResponse.json(
      {
        ok: false,
        requestId,
        functionName,
        supabaseHost,
        edgeStatus,
        edgeBodyPreview,
      },
      { status: 200 },
    );
  }

  const ok = Boolean((data as any)?.ok === true);
  if (!ok) {
    edgeStatus = 200;
    edgeBodyPreview = truncateText(JSON.stringify(data ?? null), 500);
    return NextResponse.json(
      {
        ok: false,
        requestId,
        functionName,
        supabaseHost,
        edgeStatus,
        edgeBodyPreview,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      requestId,
      functionName,
      supabaseHost,
      edgeStatus: 200,
    },
    { status: 200 },
  );
}

