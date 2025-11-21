// src/app/admin/quotes/[id]/page.tsx

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import CadViewerClient from "@/components/CadViewerClient";
import { supabaseServer } from "@/lib/supabaseServer";
import { formatDateTime } from "@/lib/formatDate";
import {
  DEFAULT_UPLOAD_STATUS,
  normalizeUploadStatus,
  type UploadStatus,
  UPLOAD_STATUS_LABELS,
} from "../../constants";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { SuccessBanner } from "../../uploads/[id]/SuccessBanner";

export const dynamic = "force-dynamic";

type SearchParamsLike =
  | ReadonlyURLSearchParams
  | URLSearchParams
  | Record<string, string | string[] | undefined>;

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParamsLike>;
};

type QuoteWithUploadsRow = {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  company: string | null;
  file_name: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  status: UploadStatus | null;
  price: number | null;
  currency: string | null;
  target_date: string | null;
  internal_notes: string | null;
  dfm_notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  upload_id: string | null;
};

type FileStorageRow = {
  storage_path: string | null;
  bucket_id: string | null;
  filename: string | null;
  mime: string | null;
};

type UploadFileReference = {
  file_path: string | null;
  file_name: string | null;
};

type UploadMeta = {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  company: string | null;
  manufacturing_process: string | null;
  quantity: string | null;
  shipping_postal_code: string | null;
  export_restriction: string | null;
  rfq_reason: string | null;
  notes: string | null;
  itar_acknowledged: boolean | null;
  terms_accepted: boolean | null;
};

type CadFileCandidate = {
  storagePath: string;
  bucketId?: string | null;
  fileName?: string | null;
  mime?: string | null;
};

type CadPreviewResult = {
  signedUrl: string | null;
  fileName?: string | null;
  reason?: string;
};

const DEFAULT_CAD_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

const CAD_SIGNED_URL_TTL_SECONDS = 60 * 60;

function extractFileNames(row: QuoteWithUploadsRow): string[] {
  const names: string[] = [];

  const forward = (value: unknown) => {
    if (typeof value === "string" && value.trim().length > 0) {
      names.push(value.trim());
    }
  };

  const maybeArrays = [row.file_names, row.upload_file_names];
  maybeArrays.forEach((maybeList) => {
    if (Array.isArray(maybeList)) {
      maybeList.forEach(forward);
    }
  });

  if (names.length === 0) {
    forward(row.file_name);
  }

  return names;
}

function formatMoney(amount: number | null, currency: string | null) {
  if (amount == null) return "Not set";

  const parsed = Number(amount);
  if (Number.isNaN(parsed)) {
    return "Not set";
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return formatter.format(parsed);
}

function hasGetMethod(
  params: SearchParamsLike,
): params is URLSearchParams | ReadonlyURLSearchParams {
  return typeof (params as URLSearchParams).get === "function";
}

async function resolveMaybePromise<T>(
  value?: Promise<T> | T,
): Promise<T | undefined> {
  if (typeof value === "undefined") {
    return undefined;
  }

  return await value;
}

function getSearchParamValue(
  params: SearchParamsLike | undefined,
  key: string,
): string | undefined {
  if (!params) {
    return undefined;
  }

  if (hasGetMethod(params)) {
    return params.get(key) ?? undefined;
  }

  const recordValue = (params as Record<string, string | string[] | undefined>)[
    key
  ];

  if (Array.isArray(recordValue)) {
    return recordValue[0];
  }

  return recordValue;
}

async function getCadPreviewForQuote(
  quote: QuoteWithUploadsRow,
): Promise<CadPreviewResult> {
  try {
    const { data: files, error: filesError } = await supabaseServer
      .from("files")
      .select("storage_path,bucket_id,filename,mime")
      .eq("quote_id", quote.id)
      .order("created_at", { ascending: true });

    if (filesError) {
      console.error("Failed to load files for quote", quote.id, filesError);
    }

    let uploadFile: UploadFileReference | null = null;
    if (quote.upload_id) {
      const { data: uploadData, error: uploadError } = await supabaseServer
        .from("uploads")
        .select("file_path,file_name")
        .eq("id", quote.upload_id)
        .maybeSingle<UploadFileReference>();

      if (uploadError) {
        console.error(
          "Failed to load upload for quote",
          quote.upload_id,
          uploadError,
        );
      } else {
        uploadFile = uploadData;
      }
    }

    const candidates = gatherCadCandidates(files ?? [], uploadFile);
    const stlCandidate = candidates.find(isStlCandidate);

    if (!stlCandidate) {
      return {
        signedUrl: null,
        fileName: uploadFile?.file_name ?? files?.[0]?.filename ?? undefined,
        reason:
          candidates.length > 0
            ? "No STL file available for preview yet."
            : "3D preview not available for this quote yet.",
      };
    }

    const normalized = normalizeStorageReference(
      stlCandidate.storagePath,
      stlCandidate.bucketId,
    );

    if (!normalized) {
      return {
        signedUrl: null,
        fileName: stlCandidate.fileName ?? undefined,
        reason: "Missing storage path for CAD file.",
      };
    }

    const { data: signedData, error: signedError } =
      await supabaseServer.storage
        .from(normalized.bucket)
        .createSignedUrl(normalized.path, CAD_SIGNED_URL_TTL_SECONDS);

    if (signedError || !signedData?.signedUrl) {
      console.error("Failed to create CAD signed URL", signedError);
      return {
        signedUrl: null,
        fileName:
          stlCandidate.fileName ??
          extractFileNameFromPath(stlCandidate.storagePath),
        reason: "Unable to generate CAD preview link right now.",
      };
    }

    return {
      signedUrl: signedData.signedUrl,
      fileName:
        stlCandidate.fileName ??
        extractFileNameFromPath(stlCandidate.storagePath),
    };
  } catch (error) {
    console.error("Unexpected CAD preview error", error);
    return {
      signedUrl: null,
      reason: "Unable to load the 3D preview right now.",
    };
  }
}

function gatherCadCandidates(
  files: FileStorageRow[],
  upload: UploadFileReference | null,
): CadFileCandidate[] {
  const candidates: CadFileCandidate[] = [];

  files?.forEach((file) => {
    if (!file?.storage_path) return;
    candidates.push({
      storagePath: file.storage_path,
      bucketId: file.bucket_id,
      fileName: file.filename,
      mime: file.mime,
    });
  });

  if (upload?.file_path) {
    candidates.push({
      storagePath: upload.file_path,
      bucketId: null,
      fileName: upload.file_name,
    });
  }

  return candidates;
}

function isStlCandidate(candidate: CadFileCandidate): boolean {
  const fileName = candidate.fileName?.toLowerCase() ?? "";
  const path = candidate.storagePath.toLowerCase();
  const mime = candidate.mime?.toLowerCase() ?? "";

  return (
    fileName.endsWith(".stl") || path.endsWith(".stl") || mime.includes("stl")
  );
}

function normalizeStorageReference(
  storagePath: string,
  bucketId?: string | null,
): { bucket: string; path: string } | null {
  if (!storagePath) {
    return null;
  }

  let path = storagePath.trim().replace(/^\/+/, "");
  if (!path) {
    return null;
  }

  let bucket = bucketId?.trim() || null;

  if (!bucket && path.startsWith(`${DEFAULT_CAD_BUCKET}/`)) {
    bucket = DEFAULT_CAD_BUCKET;
    path = path.slice(DEFAULT_CAD_BUCKET.length + 1);
  }

  if (!bucket) {
    bucket = DEFAULT_CAD_BUCKET;
  }

  if (path.startsWith(`${bucket}/`)) {
    path = path.slice(bucket.length + 1);
  }

  if (!path) {
    return null;
  }

  return { bucket, path };
}

function extractFileNameFromPath(path: string): string | undefined {
  if (!path) return undefined;
  const segments = path.split("/");
  return segments[segments.length - 1] || undefined;
}

export default async function QuoteDetailPage({
  params,
  searchParams,
}: QuoteDetailPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = await resolveMaybePromise(searchParams);
  const wasUpdated =
    getSearchParamValue(resolvedSearchParams, "updated") === "1";

  const { data: quote, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select("*")
    .eq("id", resolvedParams.id)
    .maybeSingle<QuoteWithUploadsRow>();

  if (error) {
    console.error("Quote load error", error);
  }

  if (!quote) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-center">
          <h1 className="text-xl font-semibold text-slate-50">
            Quote not found
          </h1>
          <p className="mt-2 text-sm text-slate-400">
            We couldn’t find a quote with ID{" "}
            <span className="font-mono text-slate-200">
              {resolvedParams.id}
            </span>
            .
          </p>
          <div className="mt-4">
            <Link
              href="/admin/quotes"
              className="text-sm font-medium text-emerald-400 hover:text-emerald-300"
            >
              Back to quotes
            </Link>
          </div>
        </section>
      </main>
    );
  }

  let uploadMeta: UploadMeta | null = null;
  if (quote.upload_id) {
    const { data: meta, error: metaError } = await supabaseServer
      .from("uploads")
      .select(
        "first_name,last_name,phone,company,manufacturing_process,quantity,shipping_postal_code,export_restriction,rfq_reason,notes,itar_acknowledged,terms_accepted",
      )
      .eq("id", quote.upload_id)
      .maybeSingle<UploadMeta>();

    if (metaError) {
      console.error(
        "Failed to load upload metadata for quote",
        quote.upload_id,
        metaError,
      );
    } else {
      uploadMeta = meta;
    }
  }

  const status = normalizeUploadStatus(quote.status, DEFAULT_UPLOAD_STATUS);
  const customerName =
    [uploadMeta?.first_name, uploadMeta?.last_name]
      .filter((value) => typeof value === "string" && value.trim().length > 0)
      .map((value) => (value ?? "").trim())
      .join(" ")
      .trim() ||
    (typeof quote.customer_name === "string" &&
    quote.customer_name.trim().length > 0
      ? quote.customer_name
      : "Unknown customer");
  const customerEmail =
    typeof quote.customer_email === "string" &&
    quote.customer_email.includes("@")
      ? quote.customer_email
      : null;
  const companyName =
    (typeof uploadMeta?.company === "string" &&
    (uploadMeta?.company ?? "").trim().length > 0
      ? uploadMeta?.company
      : null) ||
    (typeof quote.company === "string" && quote.company.trim().length > 0
      ? quote.company
      : null);
  const contactPhone =
    typeof uploadMeta?.phone === "string" && uploadMeta.phone.trim().length > 0
      ? uploadMeta.phone.trim()
      : null;
  const intakeSummaryItems = uploadMeta
    ? [
        {
          label: "Company",
          value: uploadMeta.company || companyName || "—",
        },
        {
          label: "Manufacturing process",
          value: uploadMeta.manufacturing_process || "—",
        },
        {
          label: "Quantity / volumes",
          value: uploadMeta.quantity || "—",
        },
        {
          label: "Export restriction",
          value: uploadMeta.export_restriction || "—",
        },
        {
          label: "Shipping ZIP / Postal code",
          value: uploadMeta.shipping_postal_code || "—",
        },
        {
          label: "RFQ reason",
          value: uploadMeta.rfq_reason || "—",
        },
        {
          label: "ITAR acknowledgement",
          value: uploadMeta.itar_acknowledged ? "Acknowledged" : "Not confirmed",
        },
        {
          label: "Terms acceptance",
          value: uploadMeta.terms_accepted ? "Accepted" : "Not accepted",
        },
      ]
    : null;
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
  const fileNames = extractFileNames(quote);
  const statusLabel = UPLOAD_STATUS_LABELS[status] ?? "Unknown";
  const cadPreview = await getCadPreviewForQuote(quote);
  const cadPreviewUrl =
    typeof cadPreview.signedUrl === "string" &&
    cadPreview.signedUrl.trim().length > 0
      ? cadPreview.signedUrl
      : null;
  const cadPreviewFallback =
    typeof cadPreview.reason === "string" && cadPreview.reason.trim().length > 0
      ? cadPreview.reason
      : undefined;
  const dfmNotes =
    typeof quote.dfm_notes === "string" && quote.dfm_notes.trim().length > 0
      ? quote.dfm_notes
      : null;
  const internalNotes =
    typeof quote.internal_notes === "string" &&
    quote.internal_notes.trim().length > 0
      ? quote.internal_notes
      : null;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-8">
      {wasUpdated && <SuccessBanner message="Quote updated." />}

      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quote workspace
        </p>
        <h1 className="text-3xl font-semibold text-slate-50">
          Quote · {customerName}
        </h1>
        <p className="text-sm text-slate-400">
          Customer context synced from Supabase view
          <span className="ml-1 font-mono text-xs text-slate-500">
            quotes_with_uploads
          </span>
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Customer
              </p>
              <p className="mt-1 text-lg font-medium text-slate-50">
                {customerName}
              </p>
              {customerEmail && (
                <a
                  href={`mailto:${customerEmail}`}
                  className="text-sm text-emerald-400 hover:underline"
                >
                  {customerEmail}
                </a>
              )}
                {contactPhone && (
                  <p>
                    <a
                      href={`tel:${contactPhone}`}
                      className="text-sm text-slate-300 hover:text-emerald-300"
                    >
                      {contactPhone}
                    </a>
                  </p>
                )}
              {companyName && (
                <p className="text-sm text-slate-300">{companyName}</p>
              )}
            </div>
            <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {statusLabel}
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Files
              </p>
              <div className="mt-2 space-y-1 text-sm text-slate-200">
                {fileNames.length === 0 ? (
                  <p className="text-slate-500">No files listed.</p>
                ) : (
                  fileNames.map((name) => (
                    <p key={name} className="break-words">
                      {name}
                    </p>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Quote details
              </p>
              <dl className="mt-2 space-y-2 text-sm text-slate-200">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Price</dt>
                  <dd>{formatMoney(priceValue, currencyValue)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Target date</dt>
                  <dd>{formatDateTime(targetDateValue)}</dd>
                </div>
              </dl>
            </div>
          </div>

            {intakeSummaryItems && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    RFQ summary
                  </p>
                  <dl className="mt-3 grid gap-3 text-sm text-slate-200">
                    {intakeSummaryItems.map((item) => (
                      <div key={item.label} className="flex flex-col gap-0.5">
                        <dt className="text-slate-500">{item.label}</dt>
                        <dd className="font-medium text-slate-100">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
                <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Project details / notes
                  </p>
                  <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
                    {intakeNotes ?? "—"}
                  </p>
                </div>
              </div>
            )}

          <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                3D preview
              </p>
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-600">
                {cadPreviewUrl ? "Interactive STL" : "Unavailable"}
              </span>
            </div>
            <div className="mt-4">
              <CadViewerClient
                src={cadPreviewUrl}
                fileName={cadPreview.fileName}
                fallbackMessage={cadPreviewFallback}
                height={320}
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                DFM notes
              </p>
              <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
                {dfmNotes ?? "No customer-facing notes yet."}
              </p>
              <p className="mt-2 text-xs text-slate-500">
                Shared with the customer once the quote is ready.
              </p>
            </div>

            <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Timeline
              </p>
              <dl className="mt-3 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Created</dt>
                  <dd>
                    {formatDateTime(quote.created_at, { includeTime: true })}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Updated</dt>
                  <dd>
                    {formatDateTime(quote.updated_at, { includeTime: true })}
                  </dd>
                </div>
              </dl>
              <p className="mt-4 text-xs text-slate-500">
                Quote ID:{" "}
                <span className="font-mono text-slate-300">{quote.id}</span>
                {quote.upload_id && (
                  <>
                    <br />
                    Upload ID:{" "}
                    <span className="font-mono text-slate-300">
                      {quote.upload_id}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
          <h2 className="text-base font-semibold text-slate-50">
            Update quote
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Adjust status, pricing, currency, target date, DFM notes, and
            internal notes. Changes are saved back to Supabase and show up
            instantly on the dashboard.
          </p>

          <QuoteUpdateForm
            quote={{
              id: quote.id,
              status,
              price: priceValue,
              currency: currencyValue,
              targetDate: targetDateValue,
              internalNotes,
              dfmNotes,
            }}
          />
        </section>
      </div>
    </main>
  );
}
