import {
  DEFAULT_UPLOAD_STATUS,
  normalizeUploadStatus,
  type UploadStatus,
  UPLOAD_STATUS_LABELS,
} from "@/app/admin/constants";
import type { QuoteWithUploadsRow, UploadMeta } from "@/server/quotes/types";

export type QuotePresentation = {
  status: UploadStatus;
  statusLabel: string;
  customerName: string;
  customerEmail: string | null;
  companyName: string | null;
  intakeNotes: string | null;
  priceValue: number | null;
  currencyValue: string | null;
  targetDateValue: string | null;
  dfmNotes: string | null;
};

export function deriveQuotePresentation(
  quote: QuoteWithUploadsRow,
  uploadMeta: UploadMeta | null,
): QuotePresentation {
  const status = normalizeUploadStatus(
    quote.status as UploadStatus,
    DEFAULT_UPLOAD_STATUS,
  );
  const statusLabel = UPLOAD_STATUS_LABELS[status] ?? "Unknown";
  const customerName =
    [uploadMeta?.first_name, uploadMeta?.last_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => (value ?? "").trim())
      .join(" ")
      .trim() ||
    (typeof quote.customer_name === "string" && quote.customer_name.trim().length > 0
      ? quote.customer_name.trim()
      : "Customer");
  const customerEmail =
    typeof quote.email === "string" && quote.email.includes("@")
      ? quote.email
      : null;
  const companyName =
    (typeof uploadMeta?.company === "string" &&
    (uploadMeta?.company ?? "").trim().length > 0
      ? uploadMeta?.company
      : null) ||
    (typeof quote.company === "string" && quote.company.trim().length > 0
      ? quote.company
      : null);
  const intakeNotes =
    typeof uploadMeta?.notes === "string" && uploadMeta.notes.trim().length > 0
      ? uploadMeta.notes
      : null;
  const normalizedPrice =
    typeof quote.price === "number"
      ? quote.price
      : typeof quote.price === "string"
        ? Number(quote.price)
        : null;
  const priceValue =
    typeof normalizedPrice === "number" && Number.isFinite(normalizedPrice)
      ? normalizedPrice
      : null;
  const currencyValue =
    typeof quote.currency === "string" && quote.currency.trim().length > 0
      ? quote.currency.trim().toUpperCase()
      : null;
  const targetDateValue =
    typeof quote.target_date === "string" && quote.target_date.trim().length > 0
      ? quote.target_date
      : null;
  const dfmNotes =
    typeof quote.dfm_notes === "string" && quote.dfm_notes.trim().length > 0
      ? quote.dfm_notes
      : null;

  return {
    status,
    statusLabel,
    customerName,
    customerEmail,
    companyName,
    intakeNotes,
    priceValue,
    currencyValue,
    targetDateValue,
    dfmNotes,
  };
}
