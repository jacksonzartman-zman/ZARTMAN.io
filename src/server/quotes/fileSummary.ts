import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import type { QuoteFileMeta, QuoteFileSource } from "@/server/quotes/types";

type QuoteLabelSource = Pick<
  QuoteFileSource,
  "id" | "file_name" | "file_names" | "upload_file_names" | "file_count" | "upload_file_count"
> &
  Partial<Pick<QuoteFileSource, "upload_id">> & {
  project_label?: string | null;
  upload_name?: string | null;
  upload_label?: string | null;
  rfq_label?: string | null;
  company?: string | null;
  customer_name?: string | null;
};

type PrimaryLabelOptions = {
  files?: QuoteFileMeta[];
};

export function deriveQuotePrimaryLabel(
  row: QuoteLabelSource,
  options?: PrimaryLabelOptions,
): string {
  const files = options?.files ?? buildQuoteFilesFromRow(row);
  const candidates: Array<string | null | undefined> = [
    row.project_label,
    row.upload_name,
    row.upload_label,
    row.rfq_label,
    files[0]?.filename,
    row.file_name,
    row.company,
    row.customer_name,
  ];

  for (const candidate of candidates) {
    const label = typeof candidate === "string" ? candidate.trim() : "";
    if (label.length > 0) {
      return label;
    }
  }

  if (typeof row.id === "string" && row.id.trim().length > 0) {
    return `Quote ${row.id.slice(0, 6)}`;
  }

  return "Untitled RFQ";
}

export function resolveQuoteFileCount(
  row: Pick<QuoteFileSource, "file_count" | "upload_file_count">,
  derivedCount?: number,
): number {
  const declaredFileCount =
    typeof row.file_count === "number" && Number.isFinite(row.file_count)
      ? row.file_count
      : null;
  if (declaredFileCount && declaredFileCount > 0) {
    return declaredFileCount;
  }

  const declaredUploadCount =
    typeof row.upload_file_count === "number" &&
    Number.isFinite(row.upload_file_count)
      ? row.upload_file_count
      : null;
  if (declaredUploadCount && declaredUploadCount > 0) {
    return declaredUploadCount;
  }

  if (typeof derivedCount === "number" && derivedCount > 0) {
    return derivedCount;
  }

  return 0;
}

export function formatQuoteFileCountLabel(count: number): string {
  if (!count || count <= 0) {
    return "No files";
  }
  if (count === 1) {
    return "1 file";
  }
  return `${count} files`;
}
