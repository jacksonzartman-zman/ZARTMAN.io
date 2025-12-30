import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createReadOnlyAuthClient, getServerAuthUser, requireAdminUser } from "@/server/auth";
import { verifyPreviewToken, verifyPreviewTokenForUser } from "@/server/cadPreviewToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CadKind = "step" | "stl" | "obj" | "glb";

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024; // 50MB
const STEP_PREVIEW_BUCKET = "cad_previews";

function normalizeBucket(input: unknown): string {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return "";
  if (raw === "cad-uploads") return "cad_uploads";
  if (raw === "cad_uploads") return "cad_uploads";
  if (raw === "cad-previews") return "cad_previews";
  if (raw === "cad_previews") return "cad_previews";
  return raw;
}

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

function storageErrorForLog(err: unknown): { message?: string; status?: number; code?: string } | null {
  if (!err) return null;
  if (err instanceof Error) {
    const anyErr = err as any;
    const status =
      typeof anyErr?.status === "number"
        ? anyErr.status
        : typeof anyErr?.statusCode === "number"
          ? anyErr.statusCode
          : typeof anyErr?.context?.status === "number"
            ? anyErr.context.status
            : undefined;
    const code = typeof anyErr?.code === "string" ? anyErr.code : undefined;
    return { message: err.message, status, code };
  }
  if (typeof err === "object") {
    const anyErr = err as any;
    const message = typeof anyErr?.message === "string" ? anyErr.message : undefined;
    const status =
      typeof anyErr?.status === "number"
        ? anyErr.status
        : typeof anyErr?.statusCode === "number"
          ? anyErr.statusCode
          : typeof anyErr?.context?.status === "number"
            ? anyErr.context.status
            : undefined;
    const code = typeof anyErr?.code === "string" ? anyErr.code : undefined;
    return { message, status, code };
  }
  return { message: String(err) };
}

function getServiceSupabase(input: { requestId: string }):
  | { ok: true; client: SupabaseClient }
  | { ok: false; response: NextResponse } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || !serviceKey.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "server_misconfigured: missing service role key for token previews",
          requestId: input.requestId,
        },
        { status: 500 },
      ),
    };
  }
  if (!url || !url.trim()) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "server_misconfigured: missing NEXT_PUBLIC_SUPABASE_URL",
          requestId: input.requestId,
        },
        { status: 500 },
      ),
    };
  }
  return {
    ok: true,
    client: createClient(url, serviceKey, { auth: { persistSession: false } }),
  };
}

export async function GET(req: NextRequest) {
  const token = normalizeId(req.nextUrl.searchParams.get("token"));
  const kindParam = normalizeId(req.nextUrl.searchParams.get("kind"));
  const dispositionRaw = normalizeId(req.nextUrl.searchParams.get("disposition"));
  const disposition: "inline" | "attachment" =
    dispositionRaw === "attachment" ? "attachment" : "inline";

  let isAdmin = false;
  const requestId = shortRequestId();
  const log = (stage: string, extra?: Record<string, unknown>) => {
    console.log("[cad-preview]", {
      rid: requestId,
      stage,
      ...(extra ?? {}),
    });
  };
  log("hit", {
    hasToken: Boolean(token),
    kind: kindParam || null,
    disposition,
    ts: Date.now(),
  });

  // Consolidated intake preview path: token embeds bucket/path/exp/userId; kind passed explicitly.
  let bucket = normalizeBucket(req.nextUrl.searchParams.get("bucket"));
  let path = normalizePath(req.nextUrl.searchParams.get("path"));

  // Allow cheap reachability pings without auth and without token.
  // (If bucket/path were provided, we still require auth/admin below.)
  if (!token && !bucket && !path) {
    log("start", {
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

  const tokenPresent = Boolean(token);
  const storageClientResult = tokenPresent
    ? getServiceSupabase({ requestId })
    : ({ ok: true, client: await createReadOnlyAuthClient() } as const);
  if (!storageClientResult.ok) {
    log("response", { source: "server_misconfigured", tokenPresent: true });
    return storageClientResult.response;
  }
  const storageSupabase = storageClientResult.client;

  let decodedBucketBeforeNormalize: string | null = null;
  if (token) {
    const verified = verifyPreviewTokenForUser({ token, userId: user.id });
    if (!verified.ok) {
      log("start", {
        tokenPresent: true,
        bucket: bucket || null,
        path: path || null,
        kind: kindParam || null,
        invalidTokenReason: verified.reason,
      });
      return NextResponse.json({ error: "invalid_token" }, { status: 401 });
    }
    decodedBucketBeforeNormalize = verified.payload.b;
    bucket = normalizeBucket(verified.payload.b);
    path = verified.payload.p;
    log("token_decoded", {
      bucketBefore: decodedBucketBeforeNormalize,
      bucketAfter: bucket,
      path,
      kind: kindParam || null,
      disposition,
    });
  } else if (!isAdmin) {
    log("start", {
      tokenPresent: false,
      bucket: bucket || null,
      path: path || null,
      kind: kindParam || null,
    });
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  if (!bucket || !path) {
    log("start", {
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
      log("start", {
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
  log("start", {
    tokenPresent: Boolean(token),
    bucket,
    path,
    kind: inferredKind ?? null,
    disposition,
  });

  if (!inferredKind) {
    return NextResponse.json({ error: "unsupported_kind", requestId }, { status: 400 });
  }

  if (inferredKind === "step") {
    const fileName = path.split("/").pop() ?? null;
    const logStep = (stage: string, extra?: Record<string, unknown>) => {
      log(stage, {
        bucket,
        path,
        kind: "step",
        disposition,
        ...(extra ?? {}),
      });
    };

    try {
      // Product intent:
      // - Inline: render a server-generated STL preview (cached in cad_previews).
      // - Attachment: download the original STEP source file (STL is preview-only).
      if (disposition === "attachment") {
        logStep("storage_download_start", { target: "source_attachment", bucket, path });
        const { data: stepBlob, error: stepDownloadError } = await storageSupabase.storage
          .from(bucket)
          .download(path);
        if (stepDownloadError || !stepBlob) {
          logStep("storage_download_failed", {
            target: "source_attachment",
            bucket,
            path,
            error: storageErrorForLog(stepDownloadError) ?? safeErrorForLog(stepDownloadError),
          });
          return NextResponse.json(
            {
              error: "source_not_found",
              bucket,
              path,
              requestId,
            },
            { status: 404 },
          );
        }
        const safeName = fileName && fileName.trim() ? fileName.trim() : "file.step";
        return new NextResponse(stepBlob.stream(), {
          status: 200,
          headers: {
            "Content-Type": "application/step",
            "Content-Disposition": buildContentDisposition("attachment", safeName),
            "Cache-Control": "no-store",
          },
        });
      }

      // Deterministic preview location in `cad_previews`.
      const { buildStepStlPreviewPath } = await import("@/server/cad/stepToStl");
      const canonicalPreviewPath = buildStepStlPreviewPath({
        sourceBucket: bucket,
        sourcePath: path,
        sourceFileName: fileName,
      });
      const legacyPreviewPath =
        decodedBucketBeforeNormalize &&
        decodedBucketBeforeNormalize.trim() &&
        decodedBucketBeforeNormalize !== bucket
          ? buildStepStlPreviewPath({
              sourceBucket: decodedBucketBeforeNormalize,
              sourcePath: path,
              sourceFileName: fileName,
            })
          : null;

      // 1) Cache hit: if preview exists, serve it directly.
      logStep("storage_download_start", {
        target: "preview",
        bucket: STEP_PREVIEW_BUCKET,
        path: canonicalPreviewPath,
        previewBucket: STEP_PREVIEW_BUCKET,
        previewPath: canonicalPreviewPath,
        previewPathLegacy: legacyPreviewPath,
      });
      const { data: cachedBlob, error: cachedError } = await storageSupabase.storage
        .from(STEP_PREVIEW_BUCKET)
        .download(canonicalPreviewPath);
      if (!cachedError && cachedBlob) {
        const filename = `${(fileName ?? "preview").replace(/\.(step|stp)$/i, "")}.stl`;
        logStep("response", {
          source: "cache_hit",
          previewBucket: STEP_PREVIEW_BUCKET,
          previewPath: canonicalPreviewPath,
        });
        return new NextResponse(cachedBlob.stream(), {
          status: 200,
          headers: {
            "Content-Type": contentTypeFor("step"),
            "Content-Disposition": buildContentDisposition(disposition, filename),
            "Cache-Control": "no-store",
          },
        });
      }
      if (cachedError) {
        logStep("storage_download_failed", {
          target: "preview",
          bucket: STEP_PREVIEW_BUCKET,
          path: canonicalPreviewPath,
          error: storageErrorForLog(cachedError) ?? safeErrorForLog(cachedError),
        });
      }

      if (legacyPreviewPath) {
        const { data: legacyBlob, error: legacyError } = await storageSupabase.storage
          .from(STEP_PREVIEW_BUCKET)
          .download(legacyPreviewPath);
        if (!legacyError && legacyBlob) {
          const filename = `${(fileName ?? "preview").replace(/\.(step|stp)$/i, "")}.stl`;
          logStep("response", {
            source: "cache_hit_legacy_key",
            previewBucket: STEP_PREVIEW_BUCKET,
            previewPath: legacyPreviewPath,
          });
          return new NextResponse(legacyBlob.stream(), {
            status: 200,
            headers: {
              "Content-Type": contentTypeFor("step"),
              "Content-Disposition": buildContentDisposition(disposition, filename),
              "Cache-Control": "no-store",
            },
          });
        }
        if (legacyError) {
          logStep("storage_download_failed", {
            target: "preview_legacy_key",
            bucket: STEP_PREVIEW_BUCKET,
            path: legacyPreviewPath,
            error: storageErrorForLog(legacyError) ?? safeErrorForLog(legacyError),
          });
        }
      }

      // 2) Download source STEP file.
      logStep("storage_download_start", { target: "source", bucket, path });
      const { data: stepBlob, error: stepDownloadError } = await storageSupabase.storage.from(bucket).download(path);
      if (stepDownloadError || !stepBlob) {
        logStep("storage_download_failed", {
          target: "source",
          bucket,
          path,
          error: storageErrorForLog(stepDownloadError) ?? safeErrorForLog(stepDownloadError),
        });
        return NextResponse.json(
          {
            error: "source_not_found",
            bucket,
            path,
            requestId,
          },
          { status: 404 },
        );
      }
      if (typeof stepBlob.size === "number" && stepBlob.size > MAX_PREVIEW_BYTES) {
        logStep("response", { source: "source_too_large", bytes: stepBlob.size });
        return NextResponse.json({ error: "file_too_large", requestId }, { status: 413 });
      }

      const stepBytes = new Uint8Array(await stepBlob.arrayBuffer());

      // 3) Convert STEP -> STL (Node runtime).
      logStep("convert_step_to_stl", { bytes: stepBytes.byteLength });
      const { convertStepToBinaryStl } = await import("@/server/cad/stepToStl");
      const converted = await convertStepToBinaryStl(stepBytes, { rid: requestId });
      if (!converted.stl || converted.stl.byteLength <= 0) {
        logStep("response", { source: "conversion_failed", meshes: converted.meshes, triangles: converted.triangles });
        return NextResponse.json(
          {
            error: "conversion_failed",
            userMessage: `Unable to generate a STEP preview for this file. RequestId: ${requestId}`,
            requestId,
          },
          { status: 502 },
        );
      }

      // 4) Upload STL preview for cache.
      logStep("storage_upload", {
        previewBucket: STEP_PREVIEW_BUCKET,
        previewPath: canonicalPreviewPath,
        stlBytes: converted.stl.byteLength,
        meshes: converted.meshes,
        triangles: converted.triangles,
      });
      // supabase-js upload body should be Node-safe (Uint8Array/ArrayBuffer), not a Blob.
      // Buffer is a Uint8Array, but we pass an explicit view to keep types happy in Next.js Node runtime.
      const stlPayload = new Uint8Array(converted.stl.buffer, converted.stl.byteOffset, converted.stl.byteLength);
      const { error: uploadError } = await storageSupabase.storage
        .from(STEP_PREVIEW_BUCKET)
        .upload(canonicalPreviewPath, stlPayload, {
          contentType: "model/stl",
          upsert: true,
        });
      if (uploadError) {
        // Non-fatal: still return the STL for this request (preview caching failed).
        logStep("storage_upload", {
          ok: false,
          error: storageErrorForLog(uploadError) ?? safeErrorForLog(uploadError),
        });
      } else {
        logStep("storage_upload", { ok: true });
      }

      // 5) Stream response in the format expected by ThreeCadViewer (binary STL).
      const filename = `${(fileName ?? "preview").replace(/\.(step|stp)$/i, "")}.stl`;
      logStep("response", {
        source: "converted",
        previewBucket: STEP_PREVIEW_BUCKET,
        previewPath: canonicalPreviewPath,
        stlBytes: converted.stl.byteLength,
      });
      // NextResponse body must be Web-compatible (Uint8Array/ArrayBuffer), not Node Buffer.
      const body = new Uint8Array(converted.stl);
      return new NextResponse(body, {
        status: 200,
        headers: {
          "Content-Type": contentTypeFor("step"),
          "Content-Disposition": buildContentDisposition(disposition, filename),
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      logStep("response", { source: "exception", error: safeErrorForLog(err) });
      return NextResponse.json(
        {
          error: "step_preview_failed",
          userMessage: `STEP preview failed. RequestId: ${requestId}`,
          requestId,
        },
        { status: 502 },
      );
    }
  }

  log("storage_download_start", { bucket, path, kind: inferredKind, disposition });
  const { data: blob, error } = await storageSupabase.storage.from(bucket).download(path);
  if (error || !blob) {
    log("storage_download_failed", {
      target: "source",
      bucket,
      path,
      kind: inferredKind,
      disposition,
      error: storageErrorForLog(error) ?? safeErrorForLog(error),
    });
    return NextResponse.json({ error: "source_not_found", bucket, path, requestId }, { status: 404 });
  }
  if (typeof blob.size === "number" && blob.size > MAX_PREVIEW_BYTES) {
    return NextResponse.json({ error: "file_too_large", requestId }, { status: 413 });
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

