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

async function callStepToStlEdge(input: { bucket: string; path: string; fileName?: string | null }) {
  const baseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL ||
    "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl) {
    return { ok: false as const, reason: "missing_supabase_url" };
  }
  if (!serviceRole) {
    return { ok: false as const, reason: "missing_service_role_key" };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/step-to-stl`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceRole}`,
    },
    body: JSON.stringify({
      bucket: input.bucket,
      path: input.path,
      fileName: input.fileName ?? undefined,
    }),
  });

  const json = (await res.json().catch(() => null)) as
    | {
        ok?: unknown;
        previewBucket?: unknown;
        previewPath?: unknown;
        bytes?: unknown;
        reason?: unknown;
      }
    | null;

  if (!json || json.ok !== true) {
    return {
      ok: false as const,
      reason: typeof json?.reason === "string" ? json.reason : `edge_not_ok_${res.status}`,
    };
  }

  const previewBucket = typeof json.previewBucket === "string" ? json.previewBucket.trim() : "";
  const previewPath = typeof json.previewPath === "string" ? json.previewPath.trim() : "";
  if (!previewBucket || !previewPath) {
    return { ok: false as const, reason: "edge_missing_preview_location" };
  }

  return { ok: true as const, previewBucket, previewPath };
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
    const result = await callStepToStlEdge({ bucket, path, fileName: path.split("/").pop() ?? null });
    if (!result.ok) {
      if (result.reason === "download_failed") {
        return NextResponse.json(
          { error: "source_not_found", bucket, path },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "edge_conversion_failed", reason: result.reason },
        { status: 502 },
      );
    }

    const { data: blob, error } = await supabaseServer.storage
      .from(result.previewBucket)
      .download(result.previewPath);

    if (error || !blob) {
      return NextResponse.json(
        { error: "edge_conversion_failed", reason: "preview_download_failed" },
        { status: 502 },
      );
    }

    if (typeof blob.size === "number" && blob.size > MAX_PREVIEW_BYTES) {
      return NextResponse.json({ error: "preview_too_large" }, { status: 413 });
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

