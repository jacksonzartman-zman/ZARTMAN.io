import { supabaseServer } from "@/lib/supabaseServer";
import { OfferSubmissionForm } from "./OfferSubmissionForm";
import { getDestinationByOfferToken } from "@/server/rfqs/destinations";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import {
  deriveQuotePrimaryLabel,
  formatQuoteFileCountLabel,
} from "@/server/quotes/fileSummary";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export const dynamic = "force-dynamic";

type ProviderOfferPageProps = {
  params?: Promise<{ token?: string | string[] }>;
};

type QuoteRow = {
  id: string;
  upload_id: string | null;
  file_name: string | null;
  file_names: string[] | null;
  upload_file_names: string[] | null;
  upload_name: string | null;
  company: string | null;
  customer_name: string | null;
};

type UploadSummaryRow = {
  manufacturing_process: string | null;
  quantity: string | null;
};

type QuoteSummary = {
  title: string;
  fileNames: string[];
  fileCountLabel: string;
  process: string | null;
  quantity: string | null;
};

type ExistingOfferRow = {
  id: string | null;
  received_at: string | null;
  total_price: number | string | null;
  lead_time_days_min: number | null;
  lead_time_days_max: number | null;
  confidence_score: number | null;
  assumptions: string | null;
  notes: string | null;
  destination_id: string | null;
};

export default async function ProviderOfferPage({ params }: ProviderOfferPageProps) {
  const resolvedParams = params ? await params : undefined;
  const token =
    typeof resolvedParams?.token === "string"
      ? resolvedParams.token
      : Array.isArray(resolvedParams?.token)
        ? resolvedParams.token[0]
        : "";

  const tokenContext = await getDestinationByOfferToken(token);

  if (!tokenContext) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-12 text-center">
        <p className="text-lg font-semibold text-white">Offer link unavailable</p>
        <p className="text-sm text-slate-300">
          This offer link is invalid or expired. Ask the Zartman team for a fresh link.
        </p>
      </main>
    );
  }

  const quoteSummary = await loadQuoteSummary({
    quoteId: tokenContext.quote.id,
    uploadId: tokenContext.quote.upload_id,
    fallbackFileName: tokenContext.quote.file_name,
    fallbackCompany: tokenContext.quote.company,
    fallbackCustomerName: tokenContext.quote.customer_name,
  });
  const existingOffer = await loadExistingOffer({
    rfqId: tokenContext.quote.id,
    providerId: tokenContext.provider.id,
    destinationId: tokenContext.destination.id,
  });
  const initialValues = existingOffer
    ? {
        price: formatOfferInputValue(existingOffer.total_price),
        leadTimeDays: formatOfferInputValue(
          existingOffer.lead_time_days_min ?? existingOffer.lead_time_days_max,
        ),
        confidenceScore: formatOfferInputValue(existingOffer.confidence_score),
        assumptions: formatOfferTextValue(existingOffer.assumptions),
        notes: formatOfferTextValue(existingOffer.notes),
      }
    : undefined;

  const providerName = tokenContext.provider.name ?? "Provider";
  const displayedFiles = quoteSummary.fileNames.slice(0, 3);
  const remainingFiles = Math.max(quoteSummary.fileNames.length - displayedFiles.length, 0);

  return (
    <main className="main-shell">
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-12 sm:px-6 lg:px-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-300">
            Provider offer
          </p>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">Submit your offer</h1>
            <p className="text-sm text-slate-300">
              You&apos;re submitting an offer for{" "}
              <span className="font-semibold text-white">{quoteSummary.title}</span> search request.
            </p>
          </div>
        </header>

        <section className="space-y-4 rounded-3xl border border-slate-900 bg-slate-950/70 p-6 shadow-lift-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Search request summary
              </p>
              <p className="mt-1 text-sm text-slate-300">
                Quick snapshot of the request you&apos;re quoting.
              </p>
            </div>
            <span className="pill pill-info px-3 py-1 text-[11px]">
              {quoteSummary.fileCountLabel}
            </span>
          </div>

          <dl className="grid gap-4 text-sm text-slate-100 sm:grid-cols-2">
            <SummaryItem label="Provider" value={providerName} />
            <SummaryItem label="Quote" value={quoteSummary.title} />
            <SummaryItem label="Process" value={quoteSummary.process ?? "Not specified"} />
            <SummaryItem label="Quantity" value={quoteSummary.quantity ?? "Not specified"} />
          </dl>

          <div className="rounded-2xl border border-slate-900/70 bg-black/30 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Files
            </p>
            {displayedFiles.length > 0 ? (
              <ul className="mt-2 space-y-1 text-sm text-slate-100">
                {displayedFiles.map((filename) => (
                  <li key={filename} className="truncate">
                    {filename}
                  </li>
                ))}
                {remainingFiles > 0 ? (
                  <li className="text-xs text-slate-400">+{remainingFiles} more</li>
                ) : null}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-400">No files listed yet.</p>
            )}
          </div>
        </section>

        <OfferSubmissionForm
          token={token}
          lastSubmittedAt={existingOffer?.received_at ?? null}
          initialValues={initialValues}
        />
      </div>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium text-slate-100">{value}</dd>
    </div>
  );
}

async function loadQuoteSummary(args: {
  quoteId: string;
  uploadId: string | null;
  fallbackFileName: string | null;
  fallbackCompany: string | null;
  fallbackCustomerName: string | null;
}): Promise<QuoteSummary> {
  const quoteRow = await loadQuoteRow(args.quoteId);
  const fileSource = {
    id: args.quoteId,
    file_name: quoteRow?.file_name ?? args.fallbackFileName,
    file_names: quoteRow?.file_names ?? null,
    upload_file_names: quoteRow?.upload_file_names ?? null,
  };
  const files = buildQuoteFilesFromRow(fileSource);
  const derivedTitle = deriveQuotePrimaryLabel(
    {
      id: args.quoteId,
      file_name: fileSource.file_name,
      file_names: fileSource.file_names ?? null,
      upload_file_names: fileSource.upload_file_names ?? null,
      upload_name: quoteRow?.upload_name ?? null,
      company: quoteRow?.company ?? args.fallbackCompany ?? null,
      customer_name: quoteRow?.customer_name ?? args.fallbackCustomerName ?? null,
    },
    { files },
  );
  const explicitTitle = await loadQuoteTitle(args.quoteId);
  const uploadSummary = await loadUploadSummary(quoteRow?.upload_id ?? args.uploadId);

  return {
    title: explicitTitle ?? derivedTitle,
    fileNames: files.map((file) => file.filename),
    fileCountLabel: formatQuoteFileCountLabel(files.length),
    process: uploadSummary?.process ?? null,
    quantity: uploadSummary?.quantity ?? null,
  };
}

async function loadQuoteRow(quoteId: string): Promise<QuoteRow | null> {
  const normalizedId = normalizeText(quoteId);
  if (!normalizedId) return null;

  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(
        "id,upload_id,file_name,file_names,upload_file_names,upload_name,company,customer_name",
      )
      .eq("id", normalizedId)
      .maybeSingle<QuoteRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[provider offer] quote lookup failed", {
        quoteId: normalizedId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return data ?? null;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[provider offer] quote lookup crashed", {
      quoteId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function loadQuoteTitle(quoteId: string): Promise<string | null> {
  const normalizedId = normalizeText(quoteId);
  if (!normalizedId) return null;

  try {
    const { data, error } = await supabaseServer
      .from("quotes")
      .select("title")
      .eq("id", normalizedId)
      .maybeSingle<{ title?: string | null }>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[provider offer] quote title lookup failed", {
        quoteId: normalizedId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    return normalizeText(data?.title);
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[provider offer] quote title lookup crashed", {
      quoteId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function loadUploadSummary(
  uploadId: string | null,
): Promise<{ process: string | null; quantity: string | null } | null> {
  const normalizedId = normalizeText(uploadId);
  if (!normalizedId) return null;

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select("manufacturing_process,quantity")
      .eq("id", normalizedId)
      .maybeSingle<UploadSummaryRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      console.warn("[provider offer] upload metadata lookup failed", {
        uploadId: normalizedId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    if (!data) return null;

    return {
      process: normalizeText(data.manufacturing_process),
      quantity: normalizeText(data.quantity),
    };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[provider offer] upload metadata lookup crashed", {
      uploadId: normalizedId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

async function loadExistingOffer(args: {
  rfqId: string;
  providerId: string;
  destinationId?: string | null;
}): Promise<ExistingOfferRow | null> {
  const rfqId = normalizeText(args.rfqId);
  const providerId = normalizeText(args.providerId);
  const destinationId = normalizeText(args.destinationId);
  if (!rfqId || !providerId) return null;

  const selectFields = [
    "id",
    "received_at",
    "total_price",
    "lead_time_days_min",
    "lead_time_days_max",
    "confidence_score",
    "assumptions",
    "notes",
    "destination_id",
  ].join(",");

  try {
    if (destinationId) {
      const { data, error } = await supabaseServer
        .from("rfq_offers")
        .select(selectFields)
        .eq("destination_id", destinationId)
        .maybeSingle<ExistingOfferRow>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[provider offer] existing offer lookup failed", {
            rfqId,
            providerId,
            destinationId,
            error: serializeSupabaseError(error),
          });
        }
      } else if (data?.id) {
        return data;
      }
    }

    let compositeQuery = supabaseServer
      .from("rfq_offers")
      .select(selectFields)
      .eq("rfq_id", rfqId)
      .eq("provider_id", providerId);

    if (destinationId) {
      compositeQuery = compositeQuery.eq("destination_id", destinationId);
    }

    const { data, error } = await compositeQuery.maybeSingle<ExistingOfferRow>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        if (destinationId) {
          const { data: fallbackData } = await supabaseServer
            .from("rfq_offers")
            .select(selectFields)
            .eq("rfq_id", rfqId)
            .eq("provider_id", providerId)
            .maybeSingle<ExistingOfferRow>();
          if (fallbackData?.id) return fallbackData;
        }
        return null;
      }
      console.warn("[provider offer] existing offer lookup failed", {
        rfqId,
        providerId,
        destinationId,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    if (!data?.id && destinationId) {
      const { data: fallbackData } = await supabaseServer
        .from("rfq_offers")
        .select(selectFields)
        .eq("rfq_id", rfqId)
        .eq("provider_id", providerId)
        .maybeSingle<ExistingOfferRow>();
      if (fallbackData?.id) return fallbackData;
    }

    if (!data?.id) return null;
    return data;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return null;
    }
    console.warn("[provider offer] existing offer lookup crashed", {
      rfqId,
      providerId,
      destinationId,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatOfferInputValue(value: unknown): string | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toString() : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function formatOfferTextValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
