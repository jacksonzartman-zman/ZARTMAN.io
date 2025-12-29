// Supabase Edge Function: step-to-stl
//
// Converts a STEP/STP file (including ZIP member uploads) to a binary STL preview,
// stored in a dedicated bucket for reliable browser rendering.
//
// Env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY
//
// Request (new, intake-friendly):
//   { "bucket": string, "path": string, "fileName"?: string }
//
// Back-compat (portal fileId-based preview):
//   { "quoteUploadFileId": string }
//
// Response (200):
//   { ok: true, quoteUploadFileId, bucket, path }
//   { ok: false, quoteUploadFileId, reason }

import { createClient } from "jsr:@supabase/supabase-js@2";

type QuoteUploadFileRow = {
  id: string;
  upload_id: string;
  quote_id: string;
  path: string;
  filename: string;
  extension: string | null;
  is_from_archive: boolean;
};

type UploadRow = {
  id: string;
  file_path: string | null;
};

type FilesRow = {
  filename: string;
  storage_path: string;
  bucket_id: string | null;
  mime: string | null;
};

const PREVIEW_BUCKET = "cad_previews";
const PREVIEW_PREFIX = "step-stl";
const MAX_CONVERT_BYTES = 50 * 1024 * 1024; // 50MB

const STEP_TO_STL_VERSION = "1";

// Can't-lie boot marker: if you never see this, module init/imports/runtime are failing.
console.log("[step-to-stl] boot", { ts: Date.now(), version: STEP_TO_STL_VERSION });

type DiagnosticsStage = "parse_request" | "env_check" | "storage_download" | "conversion" | "response";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePath(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function normalizeExtension(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function parseStoragePath(storagePath: string): { bucket: string; key: string } | null {
  const trimmed = storagePath.trim().replace(/^\/+/, "");
  if (!trimmed) return null;
  const idx = trimmed.indexOf("/");
  if (idx <= 0) return null;
  const bucket = trimmed.slice(0, idx).trim();
  const key = trimmed.slice(idx + 1).trim();
  if (!bucket || !key) return null;
  return { bucket, key };
}

function isStepExtension(ext: string | null): boolean {
  return ext === "step" || ext === "stp";
}

function compactErrorReason(err: unknown): string {
  if (!err) return "unknown_error";
  if (err instanceof Error) return err.message || "error";
  return String(err).slice(0, 240);
}

function safeErrorName(err: unknown): string {
  if (!err) return "unknown_error";
  if (err instanceof Error) return err.name || "Error";
  return typeof err === "string" ? "Error" : "Error";
}

function safeErrorMessage(err: unknown): string {
  if (!err) return "unknown_error";
  if (err instanceof Error) return err.message || "error";
  return String(err);
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function computeTriangleNormal(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const nx = aby * acz - abz * acy;
  const ny = abz * acx - abx * acz;
  const nz = abx * acy - aby * acx;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (!len || !Number.isFinite(len)) {
    return { nx: 0, ny: 0, nz: 0 };
  }
  return { nx: nx / len, ny: ny / len, nz: nz / len };
}

function encodeBinaryStlFromOcctMeshes(meshes: any[]): Uint8Array | null {
  const safeMeshes = Array.isArray(meshes) ? meshes : [];
  let triangleCount = 0;

  for (const mesh of safeMeshes) {
    const pos = mesh?.attributes?.position?.array ?? mesh?.attributes?.position;
    if (!pos) continue;
    const positions = pos instanceof Float32Array ? pos : new Float32Array(pos as ArrayLike<number>);
    const idx = mesh?.index?.array ?? mesh?.index;
    if (idx) {
      const indices =
        idx instanceof Uint32Array || idx instanceof Uint16Array ? idx : new Uint32Array(idx as ArrayLike<number>);
      triangleCount += Math.floor(indices.length / 3);
    } else {
      triangleCount += Math.floor(positions.length / 9);
    }
  }

  if (triangleCount <= 0) return null;

  const totalBytes = 84 + triangleCount * 50;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);

  // 80-byte header
  const headerText = "step-to-stl (occt-import-js)";
  for (let i = 0; i < Math.min(80, headerText.length); i += 1) {
    out[i] = headerText.charCodeAt(i) & 0xff;
  }

  view.setUint32(80, triangleCount, true);

  let offset = 84;

  for (const mesh of safeMeshes) {
    const pos = mesh?.attributes?.position?.array ?? mesh?.attributes?.position;
    if (!pos) continue;
    const positions = pos instanceof Float32Array ? pos : new Float32Array(pos as ArrayLike<number>);
    const idx = mesh?.index?.array ?? mesh?.index;
    const hasIndex = Boolean(idx);
    const indices = hasIndex
      ? idx instanceof Uint32Array || idx instanceof Uint16Array
        ? (idx as Uint32Array | Uint16Array)
        : new Uint32Array(idx as ArrayLike<number>)
      : null;

    const writeTriangle = (ia: number, ib: number, ic: number) => {
      const ax = positions[ia * 3 + 0] ?? 0;
      const ay = positions[ia * 3 + 1] ?? 0;
      const az = positions[ia * 3 + 2] ?? 0;
      const bx = positions[ib * 3 + 0] ?? 0;
      const by = positions[ib * 3 + 1] ?? 0;
      const bz = positions[ib * 3 + 2] ?? 0;
      const cx = positions[ic * 3 + 0] ?? 0;
      const cy = positions[ic * 3 + 1] ?? 0;
      const cz = positions[ic * 3 + 2] ?? 0;

      const { nx, ny, nz } = computeTriangleNormal(ax, ay, az, bx, by, bz, cx, cy, cz);

      view.setFloat32(offset + 0, nx, true);
      view.setFloat32(offset + 4, ny, true);
      view.setFloat32(offset + 8, nz, true);

      view.setFloat32(offset + 12, ax, true);
      view.setFloat32(offset + 16, ay, true);
      view.setFloat32(offset + 20, az, true);

      view.setFloat32(offset + 24, bx, true);
      view.setFloat32(offset + 28, by, true);
      view.setFloat32(offset + 32, bz, true);

      view.setFloat32(offset + 36, cx, true);
      view.setFloat32(offset + 40, cy, true);
      view.setFloat32(offset + 44, cz, true);

      view.setUint16(offset + 48, 0, true);
      offset += 50;
    };

    if (indices && indices.length >= 3) {
      for (let i = 0; i + 2 < indices.length; i += 3) {
        writeTriangle(indices[i]!, indices[i + 1]!, indices[i + 2]!);
      }
    } else {
      const vertexCount = Math.floor(positions.length / 3);
      for (let i = 0; i + 2 < vertexCount; i += 3) {
        writeTriangle(i, i + 1, i + 2);
      }
    }
  }

  return out;
}

async function ensurePreviewBucketExists(supabase: ReturnType<typeof createClient>) {
  try {
    const { error } = await supabase.storage.createBucket(PREVIEW_BUCKET, {
      public: false,
      fileSizeLimit: null,
    } as any);
    // Ignore if already exists.
    if (error && !String((error as any)?.message ?? "").toLowerCase().includes("already exists")) {
      console.warn("[step-to-stl] bucket create warning", { bucket: PREVIEW_BUCKET, error });
    }
  } catch (error) {
    // Best-effort. Bucket may already exist or API may be restricted.
    console.warn("[step-to-stl] bucket ensure failed", { bucket: PREVIEW_BUCKET, error });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  const makeJsonResponse = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json", ...corsHeaders() } });

  const shortRequestId = () => {
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return Math.random().toString(16).slice(2, 10);
    }
  };

  let requestId = shortRequestId();
  let stage: DiagnosticsStage = "parse_request";

  let quoteUploadFileId = "";
  let intakeBucket = "";
  let intakePath = "";
  let previewPath = "";
  let mode: "intake" | "fileId" | "missing" | "probe" = "missing";

  const stageLog = (event: "start" | "end", extra?: Record<string, unknown>) => {
    console.log("[step-to-stl] stage", {
      event,
      stage,
      requestId,
      ...extra,
    });
  };

  try {
    stage = "parse_request";
    stageLog("start");

    const body = (await req.json().catch(() => null)) as
      | { quoteUploadFileId?: unknown; bucket?: unknown; path?: unknown; fileName?: unknown; requestId?: unknown; mode?: unknown }
      | null;

    const providedRequestId = normalizeId(body?.requestId);
    if (providedRequestId) requestId = providedRequestId;

    quoteUploadFileId = normalizeId(body?.quoteUploadFileId);
    intakeBucket = normalizeId(body?.bucket);
    intakePath = normalizePath(body?.path);
    const requestedMode = normalizeId(body?.mode).toLowerCase();

    if (requestedMode === "probe") {
      mode = "probe";
    } else {
      mode = intakeBucket && intakePath ? "intake" : quoteUploadFileId ? "fileId" : "missing";
    }

    stageLog("end", { mode, hasBucketPath: Boolean(intakeBucket && intakePath), hasQuoteUploadFileId: Boolean(quoteUploadFileId) });

    if (mode === "missing") {
      return makeJsonResponse(
        {
          ok: false,
          error: "missing_params",
          stage,
          requestId,
          message: "Provide { bucket, path } or { quoteUploadFileId } (or mode='probe' with bucket/path).",
          reason: "missing_bucket_path_or_quoteUploadFileId",
        },
        200,
      );
    }

    if (mode === "probe" && !(intakeBucket && intakePath)) {
      return makeJsonResponse(
        {
          ok: false,
          error: "missing_params",
          stage,
          requestId,
          message: "Probe mode requires { bucket, path }.",
        },
        200,
      );
    }

    stage = "env_check";
    stageLog("start");

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const missingEnv: string[] = [];
    if (!supabaseUrl) missingEnv.push("SUPABASE_URL");
    if (!serviceRoleKey && !anonKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY");
    if (missingEnv.length > 0) {
      stageLog("end", { ok: false, missingEnv });
      return makeJsonResponse(
        {
          ok: false,
          error: "missing_env",
          stage,
          requestId,
          message: `Missing required env var(s): ${missingEnv.join(", ")}`,
          missingEnv,
        },
        200,
      );
    }

    // If service role is configured, require it as bearer token.
    if (serviceRoleKey) {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${serviceRoleKey}`) {
        stageLog("end", { ok: false, reason: "unauthorized" });
        return makeJsonResponse(
          {
            ok: false,
            error: "unauthorized",
            stage,
            requestId,
            message: "Unauthorized.",
            reason: "unauthorized",
          },
          401,
        );
      }
    }

    const supabaseKey = serviceRoleKey || anonKey;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    stageLog("end", { ok: true });

    // Probe mode: prove storage access + function handler entry without doing conversion.
    if (mode === "probe") {
      stage = "storage_download";
      stageLog("start", { bucket: intakeBucket, path: intakePath });

      const { data: downloaded, error: downloadError } = await supabase.storage.from(intakeBucket).download(intakePath);
      if (downloadError || !downloaded) {
        stageLog("end", { ok: false, reason: "download_failed" });
        return makeJsonResponse(
          {
            ok: false,
            error: "download_failed",
            stage,
            requestId,
            message: "Storage download failed (probe).",
          },
          200,
        );
      }

      const buf = await downloaded.arrayBuffer();
      const contentType = typeof (downloaded as any)?.type === "string" && (downloaded as any).type ? (downloaded as any).type : null;
      stageLog("end", { ok: true, bytes: buf.byteLength, contentType });

      return makeJsonResponse(
        {
          ok: true,
          stage,
          requestId,
          bytes: buf.byteLength,
          contentType,
        },
        200,
      );
    }

    // New intake mode: bucket/path -> deterministic preview path.
    if (mode === "intake") {
      const previewHash = await sha256Hex(`${intakeBucket}:${intakePath}`);
      previewPath = `${PREVIEW_PREFIX}/${previewHash}.stl`;
      console.log("[step-to-stl] start", { requestId, mode, bucket: intakeBucket, path: intakePath, outBucket: PREVIEW_BUCKET, outPath: previewPath });

      // Idempotency: if preview already exists, return immediately.
      stage = "storage_download";
      stageLog("start", { kind: "idempotency_check", outBucket: PREVIEW_BUCKET, outPath: previewPath });
      const { data: existing, error: existingError } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .download(previewPath);
      if (!existingError && existing) {
        const size = (existing as any)?.size;
        stageLog("end", { ok: true, kind: "idempotency_check", bytes: typeof size === "number" ? size : null });
        stage = "response";
        stageLog("start");
        console.log("[step-to-stl] ok", {
          requestId,
          outBucket: PREVIEW_BUCKET,
          outPath: previewPath,
          bytes: typeof size === "number" ? size : null,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            previewBucket: PREVIEW_BUCKET,
            previewPath,
            bytes: typeof size === "number" ? size : null,
            requestId,
            stage: "response",
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } },
        );
      }

      stageLog("end", { ok: true, kind: "idempotency_check", hit: false });

      stage = "storage_download";
      stageLog("start", { kind: "intake_download", bucket: intakeBucket, path: intakePath });
      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(intakeBucket)
        .download(intakePath);

      if (downloadError || !downloaded) {
        stageLog("end", { ok: false, reason: "download_failed" });
        return makeJsonResponse(
          { ok: false, error: "download_failed", stage, requestId, message: "Storage download failed.", reason: "download_failed" },
          200,
        );
      }

      const stepBytes = new Uint8Array(await downloaded.arrayBuffer());
      stageLog("end", { ok: true, bytes: stepBytes.byteLength });
      if (!stepBytes || stepBytes.byteLength === 0) {
        return makeJsonResponse({ ok: false, error: "empty", stage, requestId, message: "Downloaded file is empty.", reason: "empty" }, 200);
      }
      if (stepBytes.byteLength > MAX_CONVERT_BYTES) {
        return makeJsonResponse(
          { ok: false, error: "file_too_large", stage, requestId, message: "File too large to convert.", reason: "file_too_large" },
          200,
        );
      }

      stage = "conversion";
      stageLog("start", { kind: "occt_import_and_parse" });
      const { default: occtImportJs } = await import("npm:occt-import-js@0.0.23");
      const occt = await occtImportJs();
      const result = (occt as any)?.ReadStepFile?.(stepBytes, null);
      if (!result?.success) {
        stageLog("end", { ok: false, reason: "step_parse_failed" });
        return makeJsonResponse(
          { ok: false, error: "step_parse_failed", stage, requestId, message: "STEP parse failed.", reason: "step_parse_failed" },
          200,
        );
      }

      const stlBytes = encodeBinaryStlFromOcctMeshes(result.meshes);
      if (!stlBytes || stlBytes.byteLength === 0) {
        stageLog("end", { ok: false, reason: "no_triangles" });
        return makeJsonResponse({ ok: false, error: "no_triangles", stage, requestId, message: "No triangles produced.", reason: "no_triangles" }, 200);
      }
      stageLog("end", { ok: true, stlBytes: stlBytes.byteLength });

      stage = "response";
      stageLog("start", { kind: "upload_preview", outBucket: PREVIEW_BUCKET, outPath: previewPath });
      await ensurePreviewBucketExists(supabase);

      const { error: uploadError } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .upload(previewPath, stlBytes, { contentType: "model/stl", upsert: true });

      if (uploadError) {
        stageLog("end", { ok: false, reason: "preview_upload_failed" });
        return makeJsonResponse(
          { ok: false, error: "preview_upload_failed", stage, requestId, message: "Preview upload failed.", reason: "preview_upload_failed" },
          200,
        );
      }

      stageLog("end", { ok: true, bytes: stlBytes.byteLength });
      console.log("[step-to-stl] ok", { requestId, outBucket: PREVIEW_BUCKET, outPath: previewPath, bytes: stlBytes.byteLength });
      return makeJsonResponse(
        { ok: true, stage, requestId, previewBucket: PREVIEW_BUCKET, previewPath, bytes: stlBytes.byteLength },
        200,
      );
    }

    previewPath = `${PREVIEW_PREFIX}/${quoteUploadFileId}.stl`;
    console.log("[step-to-stl] start", { requestId, mode, quoteUploadFileId, outBucket: PREVIEW_BUCKET, outPath: previewPath });

    stage = "storage_download";
    stageLog("start", { kind: "quote_upload_files_lookup" });
    const { data: uploadFile, error: uploadFileError } = await supabase
      .from("quote_upload_files")
      .select("id,upload_id,quote_id,path,filename,extension,is_from_archive")
      .eq("id", quoteUploadFileId)
      .maybeSingle<QuoteUploadFileRow>();

    if (uploadFileError || !uploadFile?.id) {
      stageLog("end", { ok: false, reason: "not_found" });
      return makeJsonResponse(
        { ok: false, error: "not_found", stage, requestId, message: "quote_upload_files row not found.", quoteUploadFileId, reason: "not_found" },
        200,
      );
    }
    stageLog("end", { ok: true });

    const ext =
      normalizeExtension(uploadFile.extension) ??
      normalizeExtension(uploadFile.filename) ??
      normalizeExtension(uploadFile.path) ??
      null;

    if (!isStepExtension(ext)) {
      stage = "parse_request";
      return makeJsonResponse(
        { ok: false, error: "not_step", stage, requestId, message: "File is not a STEP/STP.", quoteUploadFileId, reason: "not_step" },
        200,
      );
    }

    let stepBytes: Uint8Array | null = null;

    if (uploadFile.is_from_archive) {
      stage = "storage_download";
      stageLog("start", { kind: "archive_download" });
      const uploadId = normalizeId(uploadFile.upload_id);
      const { data: uploadRow } = await supabase
        .from("uploads")
        .select("id,file_path")
        .eq("id", uploadId)
        .maybeSingle<UploadRow>();

      const uploadFilePath = typeof uploadRow?.file_path === "string" ? uploadRow.file_path.trim() : "";
      const parsed = uploadFilePath ? parseStoragePath(uploadFilePath) : null;
      if (!parsed) {
        stageLog("end", { ok: false, reason: "archive_unavailable" });
        return makeJsonResponse(
          { ok: false, error: "archive_unavailable", stage, requestId, message: "Archive storage path unavailable.", quoteUploadFileId, reason: "archive_unavailable" },
          200,
        );
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        stageLog("end", { ok: false, reason: "archive_download_failed" });
        return makeJsonResponse(
          { ok: false, error: "archive_download_failed", stage, requestId, message: "Archive download failed.", quoteUploadFileId, reason: "archive_download_failed" },
          200,
        );
      }

      const zipBuffer = await downloaded.arrayBuffer();
      const { default: JSZip } = await import("npm:jszip@3.10.1");
      const zip = await JSZip.loadAsync(zipBuffer);
      const entryPath = (uploadFile.path ?? "").replace(/^\/+/, "").trim();
      const normalizedEntry = entryPath.replace(/\\/g, "/");
      const file = zip.file(entryPath) ?? zip.file(normalizedEntry) ?? null;
      if (!file) {
        stageLog("end", { ok: false, reason: "archive_entry_not_found" });
        return makeJsonResponse(
          { ok: false, error: "archive_entry_not_found", stage, requestId, message: "Archive entry not found.", quoteUploadFileId, reason: "archive_entry_not_found" },
          200,
        );
      }

      stepBytes = await file.async("uint8array");
      stageLog("end", { ok: true, bytes: stepBytes.byteLength });
    } else {
      stage = "storage_download";
      stageLog("start", { kind: "file_download" });
      const quoteId = normalizeId(uploadFile.quote_id);
      const keyName = typeof uploadFile.path === "string" ? uploadFile.path.trim() : "";

      const { data: fileMeta } = await supabase
        .from("files")
        .select("filename,storage_path,bucket_id,mime")
        .eq("quote_id", quoteId)
        .eq("filename", keyName)
        .maybeSingle<FilesRow>();

      const storagePath = typeof fileMeta?.storage_path === "string" ? fileMeta.storage_path.trim() : "";
      const bucketId =
        typeof fileMeta?.bucket_id === "string" && fileMeta.bucket_id.trim() ? fileMeta.bucket_id.trim() : null;
      const parsed = storagePath ? parseStoragePath(storagePath) : bucketId && keyName ? { bucket: bucketId, key: keyName } : null;
      if (!parsed) {
        stageLog("end", { ok: false, reason: "file_unavailable" });
        return makeJsonResponse(
          { ok: false, error: "file_unavailable", stage, requestId, message: "File storage path unavailable.", quoteUploadFileId, reason: "file_unavailable" },
          200,
        );
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        stageLog("end", { ok: false, reason: "download_failed" });
        return makeJsonResponse(
          { ok: false, error: "download_failed", stage, requestId, message: "Storage download failed.", quoteUploadFileId, reason: "download_failed" },
          200,
        );
      }

      stepBytes = new Uint8Array(await downloaded.arrayBuffer());
      stageLog("end", { ok: true, bytes: stepBytes.byteLength });
    }

    if (!stepBytes || stepBytes.byteLength === 0) {
      return makeJsonResponse(
        { ok: false, error: "empty", stage, requestId, message: "Downloaded file is empty.", quoteUploadFileId, reason: "empty" },
        200,
      );
    }
    if (stepBytes.byteLength > MAX_CONVERT_BYTES) {
      return makeJsonResponse(
        { ok: false, error: "file_too_large", stage, requestId, message: "File too large to convert.", quoteUploadFileId, reason: "file_too_large" },
        200,
      );
    }

    // Parse & tessellate STEP -> triangles
    stage = "conversion";
    stageLog("start", { kind: "occt_import_and_parse" });
    const { default: occtImportJs } = await import("npm:occt-import-js@0.0.23");
    const occt = await occtImportJs();
    const result = (occt as any)?.ReadStepFile?.(stepBytes, null);
    if (!result?.success) {
      stageLog("end", { ok: false, reason: "step_parse_failed" });
      return makeJsonResponse(
        { ok: false, error: "step_parse_failed", stage, requestId, message: "STEP parse failed.", quoteUploadFileId, reason: "step_parse_failed" },
        200,
      );
    }

    const stlBytes = encodeBinaryStlFromOcctMeshes(result.meshes);
    if (!stlBytes || stlBytes.byteLength === 0) {
      stageLog("end", { ok: false, reason: "no_triangles" });
      return makeJsonResponse(
        { ok: false, error: "no_triangles", stage, requestId, message: "No triangles produced.", quoteUploadFileId, reason: "no_triangles" },
        200,
      );
    }
    stageLog("end", { ok: true, stlBytes: stlBytes.byteLength });

    stage = "response";
    stageLog("start", { kind: "upload_preview", outBucket: PREVIEW_BUCKET, outPath: previewPath });
    await ensurePreviewBucketExists(supabase);

    const { error: uploadError } = await supabase.storage
      .from(PREVIEW_BUCKET)
      .upload(previewPath, stlBytes, { contentType: "model/stl", upsert: true });

    if (uploadError) {
      stageLog("end", { ok: false, reason: "preview_upload_failed" });
      return makeJsonResponse(
        { ok: false, error: "preview_upload_failed", stage, requestId, message: "Preview upload failed.", quoteUploadFileId, reason: "preview_upload_failed" },
        200,
      );
    }

    stageLog("end", { ok: true, bytes: stlBytes.byteLength });
    console.log("[step-to-stl] ok", { requestId, outBucket: PREVIEW_BUCKET, outPath: previewPath, bytes: stlBytes.byteLength });
    return makeJsonResponse(
      {
        ok: true,
        stage,
        requestId,
        quoteUploadFileId,
        // legacy response keys:
        bucket: PREVIEW_BUCKET,
        path: previewPath,
        // new response keys:
        previewBucket: PREVIEW_BUCKET,
        previewPath,
        bytes: stlBytes.byteLength,
      },
      200,
    );
  } catch (error) {
    const reason = compactErrorReason(error);
    console.log("[step-to-stl] fail", {
      requestId,
      stage,
      mode,
      quoteUploadFileId: quoteUploadFileId || null,
      intakeBucket: intakeBucket || null,
      intakePath: intakePath || null,
      outBucket: PREVIEW_BUCKET,
      outPath: previewPath || null,
      errorName: safeErrorName(error),
      reason,
    });

    return makeJsonResponse(
      {
        ok: false,
        error: safeErrorName(error),
        stage,
        requestId,
        message: safeErrorMessage(error).slice(0, 500),
        // back-compat
        quoteUploadFileId: quoteUploadFileId || undefined,
        reason,
      },
      200,
    );
  }
});

