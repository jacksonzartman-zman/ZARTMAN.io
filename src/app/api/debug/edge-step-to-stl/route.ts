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

function safeErrorForLog(err: unknown) {
  if (!err) return null;
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  if (typeof err === "object") {
    const anyErr = err as any;
    const safeContext =
      anyErr?.context && typeof anyErr.context === "object"
        ? {
            status: typeof anyErr.context.status === "number" ? anyErr.context.status : undefined,
            body: anyErr.context.body,
          }
        : undefined;
    return {
      name: typeof anyErr?.name === "string" ? anyErr.name : undefined,
      message: typeof anyErr?.message === "string" ? anyErr.message : undefined,
      context: safeContext,
      details: anyErr?.details,
      hint: anyErr?.hint,
      code: anyErr?.code,
    };
  }
  return { message: String(err) };
}

export async function GET(req: NextRequest) {
  const requestId = shortRequestId();
  const functionName = "step-to-stl" as const;

  const bucket = normalizeId(req.nextUrl.searchParams.get("bucket"));
  const path = normalizePath(req.nextUrl.searchParams.get("path"));
  const fileName = normalizeId(req.nextUrl.searchParams.get("fileName")) || null;

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized", requestId }, { status: 401 });
  }

  // Debug endpoint allows direct bucket/path probing; keep it admin-only.
  try {
    await requireAdminUser();
  } catch {
    return NextResponse.json({ error: "forbidden", requestId }, { status: 403 });
  }

  if (!bucket || !path) {
    return NextResponse.json({ error: "missing_bucket_or_path", requestId }, { status: 400 });
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
    null;
  const supabaseHost = safeSupabaseHost(supabaseUrl);
  const edgeUrl =
    supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}` : null;

  console.log("[debug-edge-step-to-stl] invoke start", {
    rid: requestId,
    userId: user.id,
    bucket,
    path,
    fileName,
    functionName,
    supabaseUrlSet: Boolean(supabaseUrl),
    supabaseHost,
    edgeUrl,
  });

  try {
    const { data, error: edgeError } = await supabaseServer.functions.invoke(functionName, {
      body: { bucket, path, fileName: fileName || undefined },
    });

    if (edgeError) {
      const anyErr = edgeError as any;
      const edgeStatus = typeof anyErr?.context?.status === "number" ? anyErr.context.status : null;
      const body = anyErr?.context?.body;
      const bodyText =
        typeof body === "string" ? body : body != null ? JSON.stringify(body) : anyErr?.message ?? "";
      const edgeBodyPreview = bodyText ? truncateText(bodyText, 500) : null;

      console.log("[debug-edge-step-to-stl] invoke non-2xx", {
        rid: requestId,
        functionName,
        supabaseHost,
        edgeUrl,
        edgeStatus,
        edgeBodyPreview,
        edgeError: safeErrorForLog(edgeError),
      });

      return NextResponse.json(
        {
          ok: false,
          status: edgeStatus,
          requestId,
          functionName,
          supabaseHost,
          edgeUrl,
          edgeBodyPreview,
          edgeError: safeErrorForLog(edgeError),
        },
        { status: 200 },
      );
    }

    const raw = truncateText(JSON.stringify(data ?? null), 50_000);
    console.log("[debug-edge-step-to-stl] invoke success", {
      rid: requestId,
      functionName,
      supabaseHost,
      edgeUrl,
      status: 200,
      ok: Boolean((data as any)?.ok === true),
    });

    return NextResponse.json(
      {
        ok: true,
        status: 200,
        requestId,
        functionName,
        supabaseHost,
        edgeUrl,
        data,
        raw,
      },
      { status: 200 },
    );
  } catch (edgeInvokeThrown) {
    const thrownText = edgeInvokeThrown instanceof Error ? edgeInvokeThrown.message : String(edgeInvokeThrown);
    const edgeBodyPreview = truncateText(thrownText, 500);

    console.log("[debug-edge-step-to-stl] invoke threw", {
      rid: requestId,
      functionName,
      supabaseHost,
      edgeUrl,
      edgeBodyPreview,
      edgeError: safeErrorForLog(edgeInvokeThrown),
    });

    return NextResponse.json(
      {
        ok: false,
        status: null,
        requestId,
        functionName,
        supabaseHost,
        edgeUrl,
        edgeBodyPreview,
        edgeError: safeErrorForLog(edgeInvokeThrown),
      },
      { status: 200 },
    );
  }
}

