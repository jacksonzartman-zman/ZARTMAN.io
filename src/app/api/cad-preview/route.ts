import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import { verifyPreviewToken, verifyPreviewTokenForUser } from "@/server/cadPreviewToken";

export const dynamic = "force-dynamic";

type CadKind = "step" | "stl" | "obj" | "glb";

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // 50MB

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function shortRequestId(): string {
  // Short, log-friendly request id (not cryptographically meaningful).
  try {
    // eslint-disable-next-line no-restricted-globals
    const bytes = typeof crypto !== "undefined" && "getRandomValues" in crypto ? crypto.getRandomValues(new Uint8Array(6)) : null;
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

function inferCadKind(path: string, kindParam: string): CadKind | null {
  const raw = normalizeId(kindParam).toLowerCase();
  if (raw === "step" || raw === "stl" || raw === "obj" || raw === "glb") return raw as CadKind;
  const lower = (path ?? "").toLowerCase();
  if (lower.endsWith(".stl")) return "stl";
  if (lower.endsWith(".obj")) return "obj";
  if (lower.endsWith(".glb")) return "glb";
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  return null;
}

function contentTypeFor(kind: CadKind): string {
  if (kind === "stl") return "model/stl";
  if (kind === "obj") return "text/plain";
  if (kind === "glb") return "model/gltf-binary";
  if (kind === "step") return "model/stl";
  return "application/octet-stream";
}

function buildContentDisposition(disposition: "inline" | "attachment", filename: string | null): string {
  const safe = (filename ?? "").replace(/"/g, "").trim() || "file";
  return `${disposition}; filename="${safe}"`;
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
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
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
      // Common supabase-js Functions error fields:
      context: safeContext,
      details: anyErr?.details,
      hint: anyErr?.hint,
      code: anyErr?.code,
    };
  }
  return { message: String(err) };
}

export async function GET(req: NextRequest) {
  const token = normalizeId(req.nextUrl.searchParams.get("token"));
  const kindParam = normalizeId(req.nextUrl.searchParams.get("kind"));
  const dispositionRaw = normalizeId(req.nextUrl.searchParams.get("disposition"));
  const disposition: "inline" | "attachment" =
    dispositionRaw === "attachment" ? "attachment" : "inline";

  console.log("[cad-preview] hit", {
    hasToken: Boolean(token),
    kind: kindParam || null,
    ts: Date.now(),
  });

  let isAdmin = false;
  const requestId = shortRequestId();

  // Consolidated intake preview path: token embeds bucket/path/exp/userId; kind passed explicitly.
  let bucket = normalizeId(req.nextUrl.searchParams.get("bucket"));
  let path = normalizePath(req.nextUrl.searchParams.get("path"));

  // Allow cheap reachability pings without auth and without token.
  // (If bucket/path were provided, we still require auth/admin below.)
  if (!token && !bucket && !path) {
    console.log("[cad-preview] start", {
      rid: requestId,
      tokenPresent: false,
      bucket: null,
      path: null,
      kind: kindParam || null,
    });
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const { user } = await getServerAuthUser();
  if (!user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    await requireAdminUser();
    isAdmin = true;
  } catch {
    isAdmin = false;
  }

  if (token) {
    const verified = verifyPreviewTokenForUser({ token, userId: user.id });
    if (!verified.ok) {
      console.log("[cad-preview] start", {
        rid: requestId,
        tokenPresent: true,
        bucket: bucket || null,
        path: path || null,
        kind: kindParam || null,
        invalidTokenReason: verified.reason,
      });
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    bucket = verified.payload.b;
    path = verified.payload.p;
  } else if (!isAdmin) {
    console.log("[cad-preview] start", {
      rid: requestId,
      tokenPresent: false,
      bucket: bucket || null,
      path: path || null,
      kind: kindParam || null,
    });
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  if (!bucket || !path) {
    console.log("[cad-preview] start", {
      rid: requestId,
      tokenPresent: Boolean(token),
      bucket: bucket || null,
      path: path || null,
      kind: kindParam || null,
    });
    return NextResponse.json({ error: "missing_bucket_or_path" }, { status: 400 });
  }

  // Admin-only back-compat: if bucket/path were provided with a token, verify they match.
  if (token && isAdmin) {
    const verified = verifyPreviewToken({ token, userId: user.id, bucket, path });
    if (!verified.ok) {
      console.log("[cad-preview] start", {
        rid: requestId,
        tokenPresent: true,
        bucket,
        path,
        kind: kindParam || null,
        invalidTokenReason: verified.reason,
      });
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
  }

  const inferredKind = inferCadKind(path, kindParam);
  console.log("[cad-preview] start", {
    rid: requestId,
    tokenPresent: Boolean(token),
    bucket,
    path,
    kind: inferredKind ?? null,
  });

  if (!inferredKind) {
    return NextResponse.json({ error: "unsupported_kind" }, { status: 400 });
  }

  if (inferredKind === "step") {
    const functionName = "step-to-stl" as const;
    const supabaseUrl =
      process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ??
      null;
    const supabaseHost = safeSupabaseHost(supabaseUrl);
    const edgeUrl =
      supabaseUrl ? `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/${functionName}` : null;

    console.log("[cad-preview] step-to-stl invoke start", {
      rid: requestId,
      bucket,
      path,
      kind: "step",
      functionName,
      supabaseUrlSet: Boolean(supabaseUrl),
      supabaseHost,
      edgeUrl,
    });

    const fileName = path.split("/").pop() ?? null;
    let edgeStatus: number | null = null;
    let edgeBodyPreview: string | null = null;

    try {
      const { data, error: edgeError } = await supabaseServer.functions.invoke(functionName, {
        body: { bucket, path, fileName },
      });

      if (edgeError) {
        const anyErr = edgeError as any;
        edgeStatus = typeof anyErr?.context?.status === "number" ? anyErr.context.status : null;
        const body = anyErr?.context?.body;
        const bodyText =
          typeof body === "string" ? body : body != null ? JSON.stringify(body) : anyErr?.message ?? "";
        edgeBodyPreview = bodyText ? truncateText(bodyText, 500) : null;
        const edgeErrorCode =
          body && typeof body === "object" && typeof (body as any)?.error === "string"
            ? String((body as any).error)
            : null;
        const isEdgeFunctionNotFound =
          edgeStatus === 404 ||
          edgeErrorCode === "edge_function_not_found" ||
          (typeof bodyText === "string" && bodyText.includes("edge_function_not_found"));

        console.log("[cad-preview] step-to-stl invoke non-2xx", {
          rid: requestId,
          functionName,
          supabaseHost,
          edgeUrl,
          edgeStatus,
          edgeBodyPreview,
          edgeError: safeErrorForLog(edgeError),
        });

        if (isEdgeFunctionNotFound) {
          return NextResponse.json(
            {
              error: "edge_function_not_deployed",
              functionName,
              supabaseHost,
              action: "deploy step-to-stl to this project",
              requestId,
              edgeStatus,
            },
            { status: 502 },
          );
        }

        return NextResponse.json(
          {
            error: "edge_conversion_failed",
            requestId,
            edgeStatus,
            edgeBodyPreview: edgeBodyPreview ? truncateText(edgeBodyPreview, 500) : null,
          },
          { status: 502 },
        );
      }

      // Edge function returns 200 with { ok: true/false }.
      const ok = Boolean((data as any)?.ok === true);
      if (!ok) {
        const reason = typeof (data as any)?.reason === "string" ? (data as any).reason : "edge_not_ok";
        edgeStatus = 200;
        edgeBodyPreview = truncateText(JSON.stringify(data ?? null), 500);

        console.log("[cad-preview] step-to-stl invoke ok=false", {
          rid: requestId,
          functionName,
          supabaseHost,
          edgeUrl,
          edgeStatus,
          reason,
          edgeBodyPreview,
        });

        if (reason === "download_failed") {
          return NextResponse.json(
            { error: "source_not_found", bucket, path, requestId, edgeStatus, edgeBodyPreview },
            { status: 404 },
          );
        }

        return NextResponse.json(
          {
            error: "edge_conversion_failed",
            reason,
            requestId,
            edgeStatus,
            edgeBodyPreview,
          },
          { status: 502 },
        );
      }

      const previewBucketRaw = (data as any)?.previewBucket ?? (data as any)?.bucket;
      const previewPathRaw = (data as any)?.previewPath ?? (data as any)?.path;
      const previewBucket = typeof previewBucketRaw === "string" ? previewBucketRaw.trim() : "";
      const previewPath = typeof previewPathRaw === "string" ? previewPathRaw.trim() : "";
      if (!previewBucket || !previewPath) {
        edgeStatus = 200;
        edgeBodyPreview = truncateText(JSON.stringify(data ?? null), 500);
        console.log("[cad-preview] step-to-stl invoke missing preview location", {
          rid: requestId,
          functionName,
          supabaseHost,
          edgeUrl,
          edgeStatus,
          edgeBodyPreview,
        });
        return NextResponse.json(
          {
            error: "edge_conversion_failed",
            reason: "edge_missing_preview_location",
            requestId,
            edgeStatus,
            edgeBodyPreview,
          },
          { status: 502 },
        );
      }

      edgeStatus = 200;
      console.log("[cad-preview] step-to-stl invoke success", {
        rid: requestId,
        functionName,
        supabaseHost,
        edgeUrl,
        edgeStatus,
        previewBucket,
        previewPath,
      });

      const { data: blob, error } = await supabaseServer.storage
        .from(previewBucket)
        .download(previewPath);

      if (error || !blob) {
        return NextResponse.json(
          {
            error: "edge_conversion_failed",
            reason: "preview_download_failed",
            requestId,
            edgeStatus,
          },
          { status: 502 },
        );
      }

      if (typeof blob.size === "number" && blob.size > MAX_PREVIEW_BYTES) {
        return NextResponse.json({ error: "preview_too_large", requestId }, { status: 413 });
      }

      const filename = `${(path.split("/").pop() ?? "preview").replace(/\.(step|stp)$/i, "")}.stl`;
      return new NextResponse(blob.stream(), {
        status: 200,
        headers: {
          "Content-Type": contentTypeFor("step"),
          "Content-Disposition": buildContentDisposition(disposition, filename),
          "Cache-Control": "no-store",
        },
      });
    } catch (edgeInvokeThrown) {
      const thrownText = edgeInvokeThrown instanceof Error ? edgeInvokeThrown.message : String(edgeInvokeThrown);
      edgeBodyPreview = truncateText(thrownText, 500);
      console.log("[cad-preview] step-to-stl invoke threw", {
        rid: requestId,
        functionName,
        supabaseHost,
        edgeUrl,
        edgeStatus,
        edgeBodyPreview,
        edgeError: safeErrorForLog(edgeInvokeThrown),
      });
      return NextResponse.json(
        {
          error: "edge_conversion_failed",
          requestId,
          edgeStatus,
          edgeBodyPreview,
        },
        { status: 502 },
      );
    }
  }

  const { data: blob, error } = await supabaseServer.storage.from(bucket).download(path);
  if (error || !blob) {
    return NextResponse.json({ error: "source_not_found", bucket, path }, { status: 404 });
  }
  if (typeof blob.size === "number" && blob.size > MAX_PREVIEW_BYTES) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  const filename = path.split("/").pop() ?? "file";
  return new NextResponse(blob.stream(), {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(inferredKind),
      "Content-Disposition": buildContentDisposition(disposition, filename),
      "Cache-Control": "no-store",
    },
  });
}

