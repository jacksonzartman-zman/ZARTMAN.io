// Supabase Edge Function: cad-metrics
//
// Best-effort CAD mesh extraction + basic geometry metrics.
//
// Env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY (preferred) or SUPABASE_ANON_KEY
//
// Request:
//   { "quoteUploadFileId": string }
//
// Response (200):
//   { ok: true, quoteUploadFileId, cadKind, fileSizeBytes, metrics: {...}, dfmFlags: string[] }
//   { ok: false, quoteUploadFileId, cadKind, fileSizeBytes, error: string }
//
// Response (500):
//   { ok: false, quoteUploadFileId, error: string }

import { createClient } from "jsr:@supabase/supabase-js@2";
import JSZip from "npm:jszip@3.10.1";

import * as THREE from "npm:three@0.160.1";
import { STLLoader } from "npm:three@0.160.1/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "npm:three@0.160.1/examples/jsm/loaders/OBJLoader.js";
import { GLTFLoader } from "npm:three@0.160.1/examples/jsm/loaders/GLTFLoader.js";

type QuoteUploadFileRow = {
  id: string;
  upload_id: string;
  quote_id: string;
  path: string;
  filename: string;
  extension: string | null;
  is_from_archive: boolean;
  size_bytes: number | null;
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
  size_bytes: number | null;
};

type CadKind = "stl" | "obj" | "glb" | "step" | "unknown";

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

function normalizeExtension(value?: string | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.slice(1) : trimmed;
}

function extractExtensionFromName(fileName?: string | null): string | null {
  if (typeof fileName !== "string") return null;
  const trimmed = fileName.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length < 2) return null;
  return parts[parts.length - 1] ?? null;
}

function classifyCadKind(input: { filename?: string | null; extension?: string | null }): CadKind {
  const ext =
    normalizeExtension(input.extension) ?? normalizeExtension(extractExtensionFromName(input.filename));

  if (!ext) return "unknown";
  if (ext === "stl") return "stl";
  if (ext === "obj") return "obj";
  if (ext === "glb" || ext === "gltf") return "glb";
  if (ext === "stp" || ext === "step") return "step";
  return "unknown";
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

function toText(bytes: Uint8Array): string {
  // OBJ is text-based.
  return new TextDecoder("utf-8").decode(bytes);
}

function mergeNonIndexedGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  const valid = geometries.filter((g) => g && g.getAttribute("position"));
  if (valid.length === 0) return null;

  let totalFloats = 0;
  for (const g of valid) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    totalFloats += pos.array.length;
  }

  const merged = new Float32Array(totalFloats);
  let offset = 0;
  for (const g of valid) {
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    merged.set(pos.array as Float32Array, offset);
    offset += pos.array.length;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(merged, 3));
  return out;
}

function extractMergedGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  const geometries: THREE.BufferGeometry[] = [];

  root.updateMatrixWorld(true);
  root.traverse((child) => {
    const anyChild = child as any;
    if (!anyChild?.isMesh) return;
    const mesh = child as THREE.Mesh;
    const geom = (mesh.geometry as THREE.BufferGeometry | undefined) ?? null;
    if (!geom) return;

    try {
      const cloned = geom.clone();
      const applied = cloned.applyMatrix4(mesh.matrixWorld);
      const nonIndexed = applied.index ? applied.toNonIndexed() : applied;
      if (nonIndexed.getAttribute("position")) {
        geometries.push(nonIndexed);
      }
    } catch {
      // best-effort
    }
  });

  return mergeNonIndexedGeometries(geometries);
}

function extractFirstMeshGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null;
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (found) return;
    const anyChild = child as any;
    if (!anyChild?.isMesh) return;
    const mesh = child as THREE.Mesh;
    const geom = (mesh.geometry as THREE.BufferGeometry | undefined) ?? null;
    if (!geom) return;
    try {
      const cloned = geom.clone();
      const applied = cloned.applyMatrix4(mesh.matrixWorld);
      found = applied.index ? applied.toNonIndexed() : applied;
    } catch {
      found = null;
    }
  });
  return found;
}

function computeTriangleCount(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return 0;
  const vertexCount = Math.floor(pos.count);
  return Math.floor(vertexCount / 3);
}

function computeSurfaceArea(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return 0;

  const arr = pos.array as Float32Array;
  let area = 0;

  for (let i = 0; i + 8 < arr.length; i += 9) {
    const ax = arr[i + 0]!, ay = arr[i + 1]!, az = arr[i + 2]!;
    const bx = arr[i + 3]!, by = arr[i + 4]!, bz = arr[i + 5]!;
    const cx = arr[i + 6]!, cy = arr[i + 7]!, cz = arr[i + 8]!;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;

    const cxp = aby * acz - abz * acy;
    const cyp = abz * acx - abx * acz;
    const czp = abx * acy - aby * acx;

    const triArea = 0.5 * Math.sqrt(cxp * cxp + cyp * cyp + czp * czp);
    area += triArea;
  }

  return area;
}

function computeSignedVolume(geom: THREE.BufferGeometry): number {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) return 0;

  const arr = pos.array as Float32Array;
  let volume = 0;

  // Signed tetrahedra with origin.
  for (let i = 0; i + 8 < arr.length; i += 9) {
    const ax = arr[i + 0]!, ay = arr[i + 1]!, az = arr[i + 2]!;
    const bx = arr[i + 3]!, by = arr[i + 4]!, bz = arr[i + 5]!;
    const cx = arr[i + 6]!, cy = arr[i + 7]!, cz = arr[i + 8]!;

    const crossX = by * cz - bz * cy;
    const crossY = bz * cx - bx * cz;
    const crossZ = bx * cy - by * cx;

    volume += (ax * crossX + ay * crossY + az * crossZ) / 6;
  }

  return volume;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function computeComplexityScore(args: { triangleCount: number; largestDim: number }): number {
  const tri = Math.max(0, args.triangleCount);
  const size = Math.max(0, args.largestDim);

  if (tri === 0 || !Number.isFinite(tri)) return 0;

  // Triangle score: log-scaled from 1k..1M -> 0..100
  const triScore = clamp((Math.log10(tri + 1) - 3) / (6 - 3), 0, 1) * 100;

  // Size score: gentle bump for very large models.
  const sizeScore = clamp((size - 100) / 400, 0, 1) * 20;

  return Math.round(clamp(triScore * 0.85 + sizeScore * 0.15, 0, 100));
}

function computeDfmFlags(args: {
  triangleCount: number;
  largestDim: number;
  smallestDim: number;
  dims: { x: number; y: number; z: number };
}): string[] {
  const flags: string[] = [];

  if (args.largestDim > 500) flags.push("very_large");
  if (args.largestDim > 0 && args.largestDim < 5) flags.push("very_small");
  if (args.triangleCount > 500_000) flags.push("very_complex");

  const minDim = args.smallestDim;
  const maxDim = args.largestDim;
  if (minDim > 0) {
    const aspect = maxDim / minDim;
    if (aspect > 80 || minDim < 1) {
      flags.push("maybe_thin");
    }
  }

  return flags;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders() });
  }

  let quoteUploadFileId = "";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    if (!supabaseUrl) throw new Error("missing_SUPABASE_URL");

    // If service role is configured, require it as bearer token.
    if (serviceRoleKey) {
      const auth = req.headers.get("authorization") ?? "";
      if (auth !== `Bearer ${serviceRoleKey}`) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
    }

    const supabaseKey = serviceRoleKey || anonKey;
    if (!supabaseKey) throw new Error("missing_SUPABASE_KEY");

    const body = (await req.json().catch(() => null)) as
      | { quoteUploadFileId?: unknown }
      | null;

    quoteUploadFileId = normalizeId(body?.quoteUploadFileId);
    if (!quoteUploadFileId) {
      return new Response(JSON.stringify({ ok: false, error: "missing_quoteUploadFileId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: uploadFile, error: uploadFileError } = await supabase
      .from("quote_upload_files")
      .select("id,upload_id,quote_id,path,filename,extension,is_from_archive,size_bytes")
      .eq("id", quoteUploadFileId)
      .maybeSingle<QuoteUploadFileRow>();

    if (uploadFileError || !uploadFile?.id) {
      return new Response(JSON.stringify({ ok: false, error: "not_found", quoteUploadFileId }), {
        status: 404,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const cadKind = classifyCadKind({ filename: uploadFile.filename, extension: uploadFile.extension });

    // STEP: best-effort only; explicitly unsupported for now.
    if (cadKind === "step") {
      const fileSizeBytes =
        typeof uploadFile.size_bytes === "number" && Number.isFinite(uploadFile.size_bytes)
          ? uploadFile.size_bytes
          : 0;
      return new Response(
        JSON.stringify({
          ok: false,
          quoteUploadFileId,
          cadKind,
          fileSizeBytes,
          error: "step_unsupported",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
      );
    }

    let bytes: Uint8Array | null = null;

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
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "archive_unavailable" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "archive_download_failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const zipBuffer = await downloaded.arrayBuffer();
      const zip = await JSZip.loadAsync(zipBuffer);
      const entryPath = (uploadFile.path ?? "").replace(/^\/+/, "").trim();
      const normalizedEntry = entryPath.replace(/\\/g, "/");
      const file = zip.file(entryPath) ?? zip.file(normalizedEntry) ?? null;
      if (!file) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "archive_entry_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      bytes = await file.async("uint8array");
    } else {
      const quoteId = normalizeId(uploadFile.quote_id);
      const keyName = typeof uploadFile.path === "string" ? uploadFile.path.trim() : "";

      const { data: fileMeta } = await supabase
        .from("files")
        .select("filename,storage_path,bucket_id,mime,size_bytes")
        .eq("quote_id", quoteId)
        .eq("filename", keyName)
        .maybeSingle<FilesRow>();

      const storagePath = typeof fileMeta?.storage_path === "string" ? fileMeta.storage_path.trim() : "";
      const bucketId =
        typeof fileMeta?.bucket_id === "string" && fileMeta.bucket_id.trim() ? fileMeta.bucket_id.trim() : null;

      const parsed = storagePath ? parseStoragePath(storagePath) : bucketId && keyName ? { bucket: bucketId, key: keyName } : null;
      if (!parsed) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "file_unavailable" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      const { data: downloaded, error: downloadError } = await supabase.storage
        .from(parsed.bucket)
        .download(parsed.key);

      if (downloadError || !downloaded) {
        return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "download_failed" }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }

      bytes = new Uint8Array(await downloaded.arrayBuffer());
    }

    if (!bytes || bytes.byteLength === 0) {
      return new Response(JSON.stringify({ ok: false, quoteUploadFileId, error: "empty" }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }

    const fileSizeBytes = bytes.byteLength;

    if (cadKind === "unknown") {
      return new Response(
        JSON.stringify({
          ok: false,
          quoteUploadFileId,
          cadKind,
          fileSizeBytes,
          error: "unsupported_cad_kind",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
      );
    }

    // Parse -> BufferGeometry
    let geometry: THREE.BufferGeometry | null = null;

    if (cadKind === "stl") {
      const loader = new STLLoader();
      const parsed = loader.parse(bytes.buffer);
      geometry = parsed.index ? parsed.toNonIndexed() : parsed;
    } else if (cadKind === "obj") {
      const loader = new OBJLoader();
      const obj = loader.parse(toText(bytes));
      geometry = extractMergedGeometry(obj);
    } else if (cadKind === "glb") {
      const loader = new GLTFLoader();
      const gltf = await new Promise<any>((resolve, reject) => {
        loader.parse(
          bytes.buffer,
          "",
          (out) => resolve(out),
          (err) => reject(err),
        );
      });
      const scene: THREE.Object3D | null = gltf?.scene ?? gltf?.scenes?.[0] ?? null;
      if (scene) {
        const firstGeom = extractFirstMeshGeometry(scene);
        geometry = firstGeom ? (firstGeom.index ? firstGeom.toNonIndexed() : firstGeom) : null;
      }
    }

    if (!geometry) {
      return new Response(
        JSON.stringify({
          ok: false,
          quoteUploadFileId,
          cadKind,
          fileSizeBytes,
          error: "parse_failed",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
      );
    }

    geometry.computeBoundingBox();
    const bbox = geometry.boundingBox;
    if (!bbox) {
      return new Response(
        JSON.stringify({
          ok: false,
          quoteUploadFileId,
          cadKind,
          fileSizeBytes,
          error: "bbox_failed",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        },
      );
    }

    const bboxMin = bbox.min;
    const bboxMax = bbox.max;

    const dims = {
      x: bboxMax.x - bboxMin.x,
      y: bboxMax.y - bboxMin.y,
      z: bboxMax.z - bboxMin.z,
    };

    const largestDim = Math.max(dims.x, dims.y, dims.z);
    const smallestDim = Math.min(dims.x, dims.y, dims.z);

    const triangleCount = computeTriangleCount(geometry);
    const approxSurfaceAreaMm2 = computeSurfaceArea(geometry);
    const signedVolume = computeSignedVolume(geometry);
    const approxVolumeMm3 = Math.abs(signedVolume);

    const complexityScore = computeComplexityScore({ triangleCount, largestDim });
    const dfmFlags = computeDfmFlags({ triangleCount, largestDim, smallestDim, dims });

    return new Response(
      JSON.stringify({
        ok: true,
        quoteUploadFileId,
        cadKind,
        fileSizeBytes,
        metrics: {
          triangleCount,
          bboxMin: { x: bboxMin.x, y: bboxMin.y, z: bboxMin.z },
          bboxMax: { x: bboxMax.x, y: bboxMax.y, z: bboxMax.z },
          approxVolumeMm3,
          approxSurfaceAreaMm2,
          complexityScore,
        },
        dfmFlags,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      },
    );
  } catch (error) {
    console.error("[cad-metrics] failed", { quoteUploadFileId, error });
    return new Response(
      JSON.stringify({ ok: false, quoteUploadFileId, error: "error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      },
    );
  }
});
