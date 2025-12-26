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
import JSZip from "npm:jszip@3.10.1";
import occtImportJs from "npm:occt-import-js@0.0.23";

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

  let quoteUploadFileId = "";
  let intakeBucket = "";
  let intakePath = "";
  let previewPath = "";
  let didLogStart = false;

  const logStartOnce = (input: { bucket: string; path: string; outPath: string }) => {
    if (didLogStart) return;
    didLogStart = true;
    console.log("[step-to-stl] start", input);
  };

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl) throw new Error("missing_SUPABASE_URL");

    // If service role is configured, require it as bearer token.
    if (serviceRoleKey) {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${serviceRoleKey}`) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
    }

    const supabaseKey = serviceRoleKey || anonKey;
    if (!supabaseKey) throw new Error("missing_SUPABASE_KEY");

    const body = (await req.json().catch(() => null)) as
      | { quoteUploadFileId?: unknown; bucket?: unknown; path?: unknown; fileName?: unknown }
      | null;

    quoteUploadFileId = normalizeId(body?.quoteUploadFileId);
    intakeBucket = normalizeId(body?.bucket);
    intakePath = normalizePath(body?.path);

    const mode = intakeBucket && intakePath ? "intake" : quoteUploadFileId ? "fileId" : "missing";

    if (mode === "missing") {
      return new Response(
        JSON.stringify({ ok: false, reason: "missing_bucket_path_or_quoteUploadFileId" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // New intake mode: bucket/path -> deterministic preview path.
    if (mode === "intake") {
      const previewHash = await sha256Hex(`${intakeBucket}:${intakePath}`);
      previewPath = `${PREVIEW_PREFIX}/${previewHash}.stl`;
      logStartOnce({ bucket: intakeBucket, path: intakePath, outPath: previewPath });

      // Idempotency: if preview already exists, return immediately.
      const { data: existing, error: existingError } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .download(previewPath);
      if (!existingError && existing) {
        const size = (existing as any)?.size;
        console.log("[step-to-stl] ok", {
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
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } },
        );
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(intakeBucket)
        .download(intakePath);

      if (downloadError || !downloaded) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "download_failed" });
        return new Response(
          JSON.stringify({ ok: false, reason: "download_failed" }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } },
        );
      }

      const stepBytes = new Uint8Array(await downloaded.arrayBuffer());
      if (!stepBytes || stepBytes.byteLength === 0) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "empty" });
        return new Response(JSON.stringify({ ok: false, reason: "empty" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
      if (stepBytes.byteLength > MAX_CONVERT_BYTES) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "file_too_large" });
        return new Response(JSON.stringify({ ok: false, reason: "file_too_large" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const occt = await occtImportJs();
      const result = (occt as any)?.ReadStepFile?.(stepBytes, null);
      if (!result?.success) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "step_parse_failed" });
        return new Response(JSON.stringify({ ok: false, reason: "step_parse_failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const stlBytes = encodeBinaryStlFromOcctMeshes(result.meshes);
      if (!stlBytes || stlBytes.byteLength === 0) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "no_triangles" });
        return new Response(JSON.stringify({ ok: false, reason: "no_triangles" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      await ensurePreviewBucketExists(supabase);

      const { error: uploadError } = await supabase.storage
        .from(PREVIEW_BUCKET)
        .upload(previewPath, stlBytes, { contentType: "model/stl", upsert: true });

      if (uploadError) {
        console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath, reason: "preview_upload_failed" });
        return new Response(JSON.stringify({ ok: false, reason: "preview_upload_failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      console.log("[step-to-stl] ok", { outBucket: PREVIEW_BUCKET, outPath: previewPath, bytes: stlBytes.byteLength });
      return new Response(
        JSON.stringify({
          ok: true,
          previewBucket: PREVIEW_BUCKET,
          previewPath,
          bytes: stlBytes.byteLength,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } },
      );
    }

    previewPath = `${PREVIEW_PREFIX}/${quoteUploadFileId}.stl`;
    logStartOnce({ bucket: "quote_upload_files", path: quoteUploadFileId, outPath: previewPath });

    const { data: uploadFile, error: uploadFileError } = await supabase
      .from("quote_upload_files")
      .select("id,upload_id,quote_id,path,filename,extension,is_from_archive")
      .eq("id", quoteUploadFileId)
      .maybeSingle<QuoteUploadFileRow>();

    if (uploadFileError || !uploadFile?.id) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "not_found" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const ext =
      normalizeExtension(uploadFile.extension) ??
      normalizeExtension(uploadFile.filename) ??
      normalizeExtension(uploadFile.path) ??
      null;

    if (!isStepExtension(ext)) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "not_step" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    let stepBytes: Uint8Array | null = null;

    if (uploadFile.is_from_archive) {
      const uploadId = normalizeId(uploadFile.upload_id);
      const { data: uploadRow } = await supabase
        .from("uploads")
        .select("id,file_path")
        .eq("id", uploadId)
        .maybeSingle<UploadRow>();

      const uploadFilePath = typeof uploadRow?.file_path === "string" ? uploadRow.file_path.trim() : "";
      const parsed = uploadFilePath ? parseStoragePath(uploadFilePath) : null;
      if (!parsed) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "archive_unavailable" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "archive_download_failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const zipBuffer = await downloaded.arrayBuffer();
      const zip = await JSZip.loadAsync(zipBuffer);
      const entryPath = (uploadFile.path ?? "").replace(/^\/+/, "").trim();
      const normalizedEntry = entryPath.replace(/\\/g, "/");
      const file = zip.file(entryPath) ?? zip.file(normalizedEntry) ?? null;
      if (!file) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "archive_entry_not_found" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      stepBytes = await file.async("uint8array");
    } else {
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
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "file_unavailable" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "download_failed" }), {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      stepBytes = new Uint8Array(await downloaded.arrayBuffer());
    }

    if (!stepBytes || stepBytes.byteLength === 0) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "empty" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    if (stepBytes.byteLength > MAX_CONVERT_BYTES) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "file_too_large" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    // Parse & tessellate STEP -> triangles
    const occt = await occtImportJs();
    const result = (occt as any)?.ReadStepFile?.(stepBytes, null);
    if (!result?.success) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "step_parse_failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const stlBytes = encodeBinaryStlFromOcctMeshes(result.meshes);
    if (!stlBytes || stlBytes.byteLength === 0) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "no_triangles" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    await ensurePreviewBucketExists(supabase);

    const { error: uploadError } = await supabase.storage
      .from(PREVIEW_BUCKET)
      .upload(previewPath, stlBytes, { contentType: "model/stl", upsert: true });

    if (uploadError) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, reason: "preview_upload_failed" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    console.log("[step-to-stl] ok", { outBucket: PREVIEW_BUCKET, outPath: previewPath, bytes: stlBytes.byteLength });
    return new Response(
      JSON.stringify({
        ok: true,
        quoteUploadFileId,
        // legacy response keys:
        bucket: PREVIEW_BUCKET,
        path: previewPath,
        // new response keys:
        previewBucket: PREVIEW_BUCKET,
        previewPath,
        bytes: stlBytes.byteLength,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      },
    );
  } catch (error) {
    const reason = compactErrorReason(error);
    if (intakeBucket && intakePath && previewPath) {
      logStartOnce({ bucket: intakeBucket, path: intakePath, outPath: previewPath });
    } else if (quoteUploadFileId && previewPath) {
      logStartOnce({ bucket: "quote_upload_files", path: quoteUploadFileId, outPath: previewPath });
    }
    console.log("[step-to-stl] fail", { outBucket: PREVIEW_BUCKET, outPath: previewPath || null, reason });
    return new Response(
      JSON.stringify({ ok: false, quoteUploadFileId: quoteUploadFileId || undefined, reason }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } },
    );
  }
});

