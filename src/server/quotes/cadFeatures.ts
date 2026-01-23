import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import { classifyCadFileType } from "@/lib/cadRendering";
import { requireSchema, schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  isSupabaseSelectIncompatibleError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";

export type CadKind = "stl" | "obj" | "glb" | "step" | "unknown";

export type CadVec3 = {
  x: number;
  y: number;
  z: number;
};

export type CadFeatureSummary = {
  quoteUploadFileId: string;
  fileSizeBytes: number;
  cadKind: CadKind;
  triangleCount: number | null;
  bboxMin: CadVec3 | null;
  bboxMax: CadVec3 | null;
  approxVolumeMm3: number | null;
  approxSurfaceAreaMm2: number | null;
  complexityScore: number | null; // 0-100
  dfmFlags: string[];
  createdAt: string | null;
};

type QuoteUploadFileRow = {
  id: string;
  quote_id: string;
  path: string;
  filename: string;
  extension: string | null;
  size_bytes: number | null;
  is_from_archive: boolean;
};

type CadFeaturesRow = {
  quote_upload_file_id: string;
  file_size_bytes: number;
  cad_kind: string;
  triangle_count: number | null;
  bbox_min: any;
  bbox_max: any;
  approx_volume_mm3: any;
  approx_surface_area_mm2: any;
  complexity_score: number | null;
  dfm_flags: any;
  created_at: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function toCadKind(value: unknown): CadKind {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (v === "stl" || v === "obj" || v === "glb" || v === "step" || v === "unknown") return v;
  return "unknown";
}

function toCadVec3(value: unknown): CadVec3 | null {
  if (!value || typeof value !== "object") return null;
  const anyVal = value as any;
  const x = toFiniteNumber(anyVal.x);
  const y = toFiniteNumber(anyVal.y);
  const z = toFiniteNumber(anyVal.z);
  if (x === null || y === null || z === null) return null;
  return { x, y, z };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

async function fetchCadMetricsEdge(args: {
  quoteUploadFileId: string;
}): Promise<
  | {
      ok: true;
      quoteUploadFileId: string;
      cadKind: CadKind;
      fileSizeBytes: number;
      metrics: {
        triangleCount: number;
        bboxMin: CadVec3;
        bboxMax: CadVec3;
        approxVolumeMm3: number;
        approxSurfaceAreaMm2: number;
        complexityScore: number;
      };
      dfmFlags: string[];
    }
  | {
      ok: false;
      quoteUploadFileId: string;
      cadKind?: CadKind;
      fileSizeBytes?: number;
      error: string;
    }
> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
    return { ok: false, quoteUploadFileId: args.quoteUploadFileId, error: "missing_supabase_url" };
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/functions/v1/cad-metrics`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.SUPABASE_SERVICE_ROLE_KEY
          ? { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }
          : {}),
      },
      body: JSON.stringify({ quoteUploadFileId: args.quoteUploadFileId }),
    });

    const json = (await res.json().catch(() => null)) as any;
    if (!json || typeof json !== "object") {
      return { ok: false, quoteUploadFileId: args.quoteUploadFileId, error: "invalid_response" };
    }

    if (json.ok === true) {
      const cadKind = toCadKind(json.cadKind);
      const fileSizeBytes = toFiniteNumber(json.fileSizeBytes) ?? 0;
      const metrics = json.metrics ?? {};

      const triangleCount = toFiniteNumber(metrics.triangleCount) ?? 0;
      const bboxMin = toCadVec3(metrics.bboxMin) ?? { x: 0, y: 0, z: 0 };
      const bboxMax = toCadVec3(metrics.bboxMax) ?? { x: 0, y: 0, z: 0 };
      const approxVolumeMm3 = toFiniteNumber(metrics.approxVolumeMm3) ?? 0;
      const approxSurfaceAreaMm2 = toFiniteNumber(metrics.approxSurfaceAreaMm2) ?? 0;
      const complexityScore = Math.max(0, Math.min(100, Math.round(toFiniteNumber(metrics.complexityScore) ?? 0)));

      return {
        ok: true,
        quoteUploadFileId: normalizeId(json.quoteUploadFileId) || args.quoteUploadFileId,
        cadKind,
        fileSizeBytes,
        metrics: {
          triangleCount,
          bboxMin,
          bboxMax,
          approxVolumeMm3,
          approxSurfaceAreaMm2,
          complexityScore,
        },
        dfmFlags: toStringArray(json.dfmFlags),
      };
    }

    return {
      ok: false,
      quoteUploadFileId: normalizeId(json.quoteUploadFileId) || args.quoteUploadFileId,
      cadKind: json.cadKind ? toCadKind(json.cadKind) : undefined,
      fileSizeBytes: toFiniteNumber(json.fileSizeBytes) ?? undefined,
      error: typeof json.error === "string" ? json.error : res.ok ? "error" : `http_${res.status}`,
    };
  } catch (error) {
    console.error("[cad-features] edge request crashed", {
      quoteUploadFileId: args.quoteUploadFileId,
      error,
    });
    return { ok: false, quoteUploadFileId: args.quoteUploadFileId, error: "request_failed" };
  }
}

export async function loadCadFeaturesForQuote(
  quoteId: string,
): Promise<Record<string, CadFeatureSummary>> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return {};

  const uploadFilesSchema = await requireSchema({
    relation: "quote_upload_files",
    requiredColumns: ["quote_id", "id", "filename", "extension", "size_bytes", "created_at"],
    warnPrefix: "[quote_upload_files]",
    warnKey: "schema_contract:quote_upload_files:cad_features_load",
  });
  if (!uploadFilesSchema.ok && uploadFilesSchema.reason === "missing_relation") {
    return {};
  }
  if (isSupabaseRelationMarkedMissing("quote_upload_files")) return {};

  type UploadFileLite = {
    id: string;
    quote_id: string;
    filename: string | null;
    extension: string | null;
    size_bytes: number | null;
    created_at?: string | null;
  };

  let uploadFiles: Array<Record<string, unknown>> = [];
  let shouldFallback = !uploadFilesSchema.ok;

  // Strategy:
  // - Attempt 1: safe select (no nested joins, no path)
  // - Attempt 2: select("*") if schema variant rejects attempt 1
  try {
    if (uploadFilesSchema.ok) {
      const attempt1 = await supabaseServer()
        .from("quote_upload_files")
        .select("id,quote_id,filename,extension,size_bytes,created_at")
        .eq("quote_id", normalizedQuoteId)
        .returns<UploadFileLite[]>();

      if (!attempt1.error) {
        uploadFiles = Array.isArray(attempt1.data)
          ? (attempt1.data as unknown as Array<Record<string, unknown>>)
          : [];
      } else {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_upload_files",
            error: attempt1.error,
            warnPrefix: "[quote_upload_files]",
          })
        ) {
          return {};
        }

        if (isSupabaseSelectIncompatibleError(attempt1.error)) {
          const serialized = serializeSupabaseError(attempt1.error);
          warnOnce(
            "quote_upload_files:select_incompatible",
            "[quote_upload_files] select incompatible; falling back",
            { code: serialized.code, message: serialized.message },
          );
          shouldFallback = true;
        } else {
          console.warn("[cad-features] quote_upload_files load failed", {
            quoteId: normalizedQuoteId,
            error: serializeSupabaseError(attempt1.error) ?? attempt1.error,
          });
          return {};
        }
      }
    }

    if (shouldFallback) {
      const attempt2 = await supabaseServer()
        .from("quote_upload_files")
        .select("*")
        .eq("quote_id", normalizedQuoteId);

      if (attempt2.error) {
        if (
          handleMissingSupabaseRelation({
            relation: "quote_upload_files",
            error: attempt2.error,
            warnPrefix: "[quote_upload_files]",
          }) ||
          isMissingTableOrColumnError(attempt2.error)
        ) {
          return {};
        }

        console.warn("[cad-features] quote_upload_files fallback load failed", {
          quoteId: normalizedQuoteId,
          error: serializeSupabaseError(attempt2.error) ?? attempt2.error,
        });
        return {};
      }

      uploadFiles = Array.isArray(attempt2.data)
        ? (attempt2.data as Array<Record<string, unknown>>)
        : [];
    }
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_upload_files",
        error,
        warnPrefix: "[quote_upload_files]",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return {};
    }
    console.warn("[cad-features] quote_upload_files load crashed", { quoteId: normalizedQuoteId, error });
    return {};
  }

  const fileIds = Array.from(
    new Set(
      uploadFiles
        .map((row) => normalizeId((row as any)?.id))
        .filter(Boolean),
    ),
  );
  if (fileIds.length === 0) return {};
  const cadFeaturesSchema = await schemaGate({
    enabled: true,
    relation: "quote_cad_features",
    requiredColumns: [
      "quote_upload_file_id",
      "file_size_bytes",
      "cad_kind",
      "triangle_count",
      "bbox_min",
      "bbox_max",
      "approx_volume_mm3",
      "approx_surface_area_mm2",
      "complexity_score",
      "dfm_flags",
      "created_at",
    ],
    warnPrefix: "[cad-features]",
  });
  if (!cadFeaturesSchema) return {};
  if (isSupabaseRelationMarkedMissing("quote_cad_features")) return {};

  let featureRows: CadFeaturesRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_cad_features")
      .select(
        "quote_upload_file_id,file_size_bytes,cad_kind,triangle_count,bbox_min,bbox_max,approx_volume_mm3,approx_surface_area_mm2,complexity_score,dfm_flags,created_at",
      )
      .in("quote_upload_file_id", fileIds)
      .returns<CadFeaturesRow[]>();

    if (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "quote_cad_features",
          error,
          warnPrefix: "[cad-features]",
        }) ||
        isMissingTableOrColumnError(error)
      ) {
        return {};
      }

      console.warn("[cad-features] quote_cad_features load failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return {};
    }

    featureRows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (
      handleMissingSupabaseRelation({
        relation: "quote_cad_features",
        error,
        warnPrefix: "[cad-features]",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return {};
    }
    console.warn("[cad-features] quote_cad_features load crashed", { quoteId: normalizedQuoteId, error });
    return {};
  }

  const featureByFileId = new Map<string, CadFeaturesRow>();
  for (const row of featureRows) {
    const fileId = normalizeId(row?.quote_upload_file_id);
    if (!fileId) continue;
    // First row wins (we expect one per file due to unique constraint).
    if (!featureByFileId.has(fileId)) {
      featureByFileId.set(fileId, row);
    }
  }

  const out: Record<string, CadFeatureSummary> = {};
  for (const [fileId, feature] of featureByFileId.entries()) {
    const dfmFlags = toStringArray(feature.dfm_flags);
    out[fileId] = {
      quoteUploadFileId: fileId,
      fileSizeBytes: toFiniteNumber(feature.file_size_bytes) ?? 0,
      cadKind: toCadKind(feature.cad_kind),
      triangleCount: toFiniteNumber(feature.triangle_count),
      bboxMin: toCadVec3(feature.bbox_min),
      bboxMax: toCadVec3(feature.bbox_max),
      approxVolumeMm3: toFiniteNumber(feature.approx_volume_mm3),
      approxSurfaceAreaMm2: toFiniteNumber(feature.approx_surface_area_mm2),
      complexityScore: toFiniteNumber(feature.complexity_score),
      dfmFlags,
      createdAt: typeof feature.created_at === "string" ? feature.created_at : null,
    };
  }

  return out;
}

export async function ensureCadFeaturesForQuote(
  quoteId: string,
  opts?: { maxNew?: number },
): Promise<void> {
  const normalizedQuoteId = normalizeId(quoteId);
  if (!normalizedQuoteId) return;

  const canUseUploads = await schemaGate({
    enabled: true,
    relation: "quote_upload_files",
    requiredColumns: ["quote_id", "id", "filename", "extension", "size_bytes", "is_from_archive"],
    warnPrefix: "[quote_upload_files]",
  });
  if (!canUseUploads) return;

  const canUseCadFeatures = await schemaGate({
    enabled: true,
    relation: "quote_cad_features",
    requiredColumns: [
      "quote_upload_file_id",
      "file_size_bytes",
      "cad_kind",
      "triangle_count",
      "bbox_min",
      "bbox_max",
      "approx_volume_mm3",
      "approx_surface_area_mm2",
      "complexity_score",
      "dfm_flags",
      "created_at",
    ],
    warnPrefix: "[cad-features]",
  });
  if (!canUseCadFeatures) return;

  const cap =
    typeof opts?.maxNew === "number" && Number.isFinite(opts.maxNew)
      ? Math.max(0, Math.min(25, Math.floor(opts.maxNew)))
      : 10;

  let uploadFiles: QuoteUploadFileRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_upload_files")
      .select("id,quote_id,path,filename,extension,size_bytes,is_from_archive")
      .eq("quote_id", normalizedQuoteId)
      .order("id", { ascending: true })
      .returns<QuoteUploadFileRow[]>();

    if (error) {
      console.warn("[cad-features] failed to load quote_upload_files", { quoteId: normalizedQuoteId, error });
      return;
    }

    uploadFiles = Array.isArray(data) ? data : [];
  } catch (error) {
    console.warn("[cad-features] quote_upload_files load crashed", { quoteId: normalizedQuoteId, error });
    return;
  }

  const cadFileIds: string[] = [];
  for (const file of uploadFiles) {
    const id = normalizeId(file?.id);
    if (!id) continue;
    const kind = classifyCadFileType({ filename: file.filename, extension: file.extension ?? null });
    if (!kind.ok) continue;

    // Only handle the MVP CAD types.
    if (kind.type === "stl" || kind.type === "obj" || kind.type === "glb" || kind.type === "step") {
      cadFileIds.push(id);
    }
  }

  if (cadFileIds.length === 0) return;

  const { data: existingRows } = await supabaseServer()
    .from("quote_cad_features")
    .select("quote_upload_file_id")
    .in("quote_upload_file_id", cadFileIds)
    .returns<Array<{ quote_upload_file_id: string }>>();

  const existing = new Set((existingRows ?? []).map((r) => normalizeId(r.quote_upload_file_id)).filter(Boolean));
  const missing = cadFileIds.filter((id) => !existing.has(id)).slice(0, cap);

  if (missing.length === 0) return;

  for (const fileId of missing) {
    try {
      const edge = await fetchCadMetricsEdge({ quoteUploadFileId: fileId });

      if (edge.ok) {
        const { error } = await supabaseServer()
          .from("quote_cad_features")
          .upsert(
            {
              quote_upload_file_id: fileId,
              file_size_bytes: edge.fileSizeBytes,
              cad_kind: edge.cadKind,
              triangle_count: edge.metrics.triangleCount,
              bbox_min: edge.metrics.bboxMin,
              bbox_max: edge.metrics.bboxMax,
              approx_volume_mm3: edge.metrics.approxVolumeMm3,
              approx_surface_area_mm2: edge.metrics.approxSurfaceAreaMm2,
              complexity_score: edge.metrics.complexityScore,
              dfm_flags: edge.dfmFlags,
            },
            { onConflict: "quote_upload_file_id" },
          );

        if (error) {
          console.warn("[cad-features] upsert failed", { quoteId: normalizedQuoteId, fileId, error });
        }

        continue;
      }

      // Cacheable "expected" failure.
      if (edge.error === "step_unsupported") {
        const { error } = await supabaseServer()
          .from("quote_cad_features")
          .upsert(
            {
              quote_upload_file_id: fileId,
              file_size_bytes: edge.fileSizeBytes ?? 0,
              cad_kind: "step",
              dfm_flags: ["step_unsupported"],
            },
            { onConflict: "quote_upload_file_id" },
          );

        if (error) {
          console.warn("[cad-features] step_unsupported cache upsert failed", {
            quoteId: normalizedQuoteId,
            fileId,
            error,
          });
        }

        continue;
      }

      console.warn("[cad-features] edge metrics failed", {
        quoteId: normalizedQuoteId,
        fileId,
        error: edge.error,
      });
    } catch (error) {
      console.warn("[cad-features] ensure crashed", { quoteId: normalizedQuoteId, fileId, error });
    }
  }
}
