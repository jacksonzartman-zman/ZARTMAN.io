import { supabaseServer } from "@/lib/supabaseServer";
import {
  computePartsCoverage,
  summarizePartsCoverageHealth,
  type PartsCoverageHealth,
} from "@/lib/quote/partsCoverage";
import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { schemaGate } from "@/server/db/schemaContract";

type QuotePartRow = {
  id: string;
  quote_id: string;
  part_label: string;
  part_number: string | null;
  notes: string | null;
  sort_order: number | null;
  created_at: string;
};

type QuotePartFileRow = {
  id: string;
  quote_part_id: string;
  quote_upload_file_id: string;
  role: string;
  created_at: string;
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

type QuotePartFileRole = QuotePartWithFiles["files"][number]["role"];

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeQuotePartRole(value: unknown): QuotePartFileRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "cad") return "cad";
  if (normalized === "drawing") return "drawing";
  return "other";
}

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  const aIsNumber = typeof a === "number" && Number.isFinite(a);
  const bIsNumber = typeof b === "number" && Number.isFinite(b);
  if (aIsNumber && bIsNumber) return (a as number) - (b as number);
  if (aIsNumber) return -1;
  if (bIsNumber) return 1;
  return 0;
}

export type QuotePartsCoverageSignal = {
  partsCoverageHealth: PartsCoverageHealth;
  partsCount: number;
};

export async function loadPartsCoverageSignalsForQuotes(
  quoteIds: readonly string[],
): Promise<Map<string, QuotePartsCoverageSignal>> {
  const normalizedQuoteIds = Array.from(
    new Set((quoteIds ?? []).map(normalizeId).filter(Boolean)),
  );

  const result = new Map<string, QuotePartsCoverageSignal>();
  for (const quoteId of normalizedQuoteIds) {
    result.set(quoteId, { partsCoverageHealth: "none", partsCount: 0 });
  }
  if (normalizedQuoteIds.length === 0) return result;

  let partRows: QuotePartRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_parts")
      .select("id,quote_id,part_label,part_number,notes,sort_order,created_at")
      .in("quote_id", normalizedQuoteIds)
      .returns<QuotePartRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return result;
      console.error("[parts coverage] failed to load quote_parts", {
        quoteIdsCount: normalizedQuoteIds.length,
        error: serializeSupabaseError(error),
      });
      return result;
    }

    partRows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return result;
    console.error("[parts coverage] quote_parts load crashed", {
      quoteIdsCount: normalizedQuoteIds.length,
      error: serializeSupabaseError(error),
    });
    return result;
  }

  if (partRows.length === 0) return result;

  const partIds = Array.from(
    new Set(partRows.map((row) => normalizeId(row?.id)).filter(Boolean)),
  );

  let partFileRows: QuotePartFileRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_part_files")
      .select("id,quote_part_id,quote_upload_file_id,role,created_at")
      .in("quote_part_id", partIds)
      .returns<QuotePartFileRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        // Parts exist, but file links aren't available.
        partFileRows = [];
      } else {
        console.error("[parts coverage] failed to load quote_part_files", {
          partIdsCount: partIds.length,
          error: serializeSupabaseError(error),
        });
        partFileRows = [];
      }
    } else {
      partFileRows = Array.isArray(data) ? data : [];
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[parts coverage] quote_part_files load crashed", {
        partIdsCount: partIds.length,
        error: serializeSupabaseError(error),
      });
    }
    partFileRows = [];
  }

  const uploadFileIds = Array.from(
    new Set(
      partFileRows
        .map((row) => normalizeId(row?.quote_upload_file_id))
        .filter(Boolean),
    ),
  );

  const uploadFilesById = new Map<string, QuoteUploadFileRow>();
  if (uploadFileIds.length > 0) {
    const hasUploadsSchema = await schemaGate({
      enabled: true,
      relation: "quote_upload_files",
      requiredColumns: ["id", "quote_id", "path", "filename", "extension", "size_bytes", "is_from_archive"],
      warnPrefix: "[quote_upload_files]",
    });
    if (hasUploadsSchema) {
      try {
        const { data, error } = await supabaseServer()
          .from("quote_upload_files")
          .select("id,quote_id,path,filename,extension,size_bytes,is_from_archive")
          .in("id", uploadFileIds)
          .returns<QuoteUploadFileRow[]>();

        if (error) {
          if (!isMissingTableOrColumnError(error)) {
            console.error("[parts coverage] failed to load quote_upload_files", {
              uploadFileIdsCount: uploadFileIds.length,
              error: serializeSupabaseError(error),
            });
          }
        } else if (Array.isArray(data)) {
          for (const row of data) {
            const id = normalizeId(row?.id);
            if (id) uploadFilesById.set(id, row);
          }
        }
      } catch (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.error("[parts coverage] quote_upload_files load crashed", {
            uploadFileIdsCount: uploadFileIds.length,
            error: serializeSupabaseError(error),
          });
        }
      }
    }
  }

  const filesByPartId = new Map<string, QuotePartWithFiles["files"]>();
  for (const row of partFileRows) {
    const partId = normalizeId(row?.quote_part_id);
    const uploadFileId = normalizeId(row?.quote_upload_file_id);
    if (!partId || !uploadFileId) continue;
    const uploadFile = uploadFilesById.get(uploadFileId);
    if (!uploadFile) continue;

    if (!filesByPartId.has(partId)) filesByPartId.set(partId, []);
    filesByPartId.get(partId)!.push({
      quoteUploadFileId: uploadFileId,
      path: uploadFile.path,
      filename: uploadFile.filename,
      extension: uploadFile.extension,
      sizeBytes: uploadFile.size_bytes,
      isFromArchive: uploadFile.is_from_archive,
      role: normalizeQuotePartRole(row.role),
    });
  }

  for (const [partId, files] of filesByPartId.entries()) {
    files.sort((a, b) => a.filename.localeCompare(b.filename) || a.path.localeCompare(b.path));
    filesByPartId.set(partId, files);
  }

  // Group parts by quote id and keep stable ordering inside each quote.
  const partsByQuoteId = new Map<string, QuotePartRow[]>();
  for (const row of partRows) {
    const quoteId = normalizeId(row?.quote_id);
    const id = normalizeId(row?.id);
    if (!quoteId || !id) continue;
    if (!partsByQuoteId.has(quoteId)) partsByQuoteId.set(quoteId, []);
    partsByQuoteId.get(quoteId)!.push(row);
  }

  for (const [quoteId, rows] of partsByQuoteId.entries()) {
    rows.sort((a, b) => {
      const byOrder = compareNullableNumberAsc(a.sort_order ?? null, b.sort_order ?? null);
      if (byOrder !== 0) return byOrder;
      const aCreated = Date.parse(a.created_at);
      const bCreated = Date.parse(b.created_at);
      if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
        return aCreated - bCreated;
      }
      return a.id.localeCompare(b.id);
    });

    const parts: QuotePartWithFiles[] = rows.map((part) => ({
      id: part.id,
      partLabel: part.part_label,
      partNumber: part.part_number,
      notes: part.notes,
      sortOrder: part.sort_order,
      files: filesByPartId.get(part.id) ?? [],
    }));

    const { summary } = computePartsCoverage(parts);
    result.set(quoteId, {
      partsCoverageHealth: summarizePartsCoverageHealth(summary),
      partsCount: summary.totalParts,
    });
  }

  return result;
}

