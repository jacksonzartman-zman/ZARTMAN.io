// src/app/admin/quotes/[id]/page.tsx

import clsx from "clsx";
import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { formatDateTime } from "@/lib/formatDate";
import {
  loadQuoteMessages,
  type QuoteMessage,
  type QuoteMessageAuthorType,
} from "@/server/quotes/messages";
import {
  DEFAULT_UPLOAD_STATUS,
  normalizeUploadStatus,
  type UploadStatus,
  UPLOAD_STATUS_LABELS,
} from "../../constants";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { SuccessBanner } from "../../uploads/[id]/SuccessBanner";
import { QuoteMessageComposer } from "./QuoteMessageComposer";
import { QuoteFilesCard, type QuoteFileItem } from "./QuoteFilesCard";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

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

const AUTHOR_BADGE_BASE_CLASSES =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide";

const AUTHOR_BADGE_VARIANTS: Record<QuoteMessageAuthorType, string> = {
  admin: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  customer: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  supplier: "border-amber-500/40 bg-amber-500/10 text-amber-200",
};

const AUTHOR_LABELS: Record<QuoteMessageAuthorType, string> = {
  admin: "Admin",
  customer: "Customer",
  supplier: "Supplier",
};

const MESSAGE_BUBBLE_VARIANTS: Record<QuoteMessageAuthorType, string> = {
  admin:
    "bg-emerald-400 text-slate-950 border border-emerald-300/70 shadow-lift-sm",
  customer: "bg-slate-900 text-slate-100 border border-slate-800/80",
  supplier: "bg-slate-900 text-slate-100 border border-slate-800/80",
};

function getAuthorBadgeClasses(type: QuoteMessageAuthorType): string {
  return `${AUTHOR_BADGE_BASE_CLASSES} ${
    AUTHOR_BADGE_VARIANTS[type] ?? AUTHOR_BADGE_VARIANTS.admin
  }`;
}

function getMessageBubbleClasses(type: QuoteMessageAuthorType): string {
  return MESSAGE_BUBBLE_VARIANTS[type] ?? MESSAGE_BUBBLE_VARIANTS.customer;
}

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

async function getQuoteFilePreviews(
  quote: QuoteWithUploadsRow,
): Promise<QuoteFileItem[]> {
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
    const previewCache = new Map<string, CadPreviewResult>();
    const declaredNames = extractFileNames(quote);
    const fallbackNames = candidates
      .map((candidate) => {
        return (
          candidate.fileName ??
          extractFileNameFromPath(candidate.storagePath) ??
          null
        );
      })
      .filter((value): value is string => Boolean(value?.trim()));
    const orderedNames =
      declaredNames.length > 0
        ? declaredNames
        : fallbackNames.length > 0
          ? fallbackNames
          : [];

    const entries: QuoteFileItem[] = [];
    const matchedCandidates = new Set<string>();

    for (let index = 0; index < orderedNames.length; index += 1) {
      const label = orderedNames[index] || `File ${index + 1}`;
      const candidate = matchCandidateByName(label, candidates);
      if (candidate) {
        matchedCandidates.add(candidate.storagePath);
      }

      const preview = candidate
        ? await getPreviewForCandidate(candidate, previewCache)
        : {
            signedUrl: null,
            fileName: label,
            reason: "Preview not available for this file yet.",
          };

      entries.push({
        id: candidate?.storagePath ?? `${index}-${label}`,
        label,
        fileName: preview.fileName ?? label,
        signedUrl: preview.signedUrl,
        fallbackMessage: preview.reason,
      });
    }

    const unmatchedCandidates = candidates.filter(
      (candidate) => !matchedCandidates.has(candidate.storagePath),
    );

    for (const [index, candidate] of unmatchedCandidates.entries()) {
      const fallbackLabel =
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        `File ${entries.length + 1}`;
      const preview = await getPreviewForCandidate(candidate, previewCache);
      entries.push({
        id: `${candidate.storagePath}-${index}`,
        label: fallbackLabel,
        fileName: preview.fileName ?? fallbackLabel,
        signedUrl: preview.signedUrl,
        fallbackMessage: preview.reason,
      });
    }

    return entries;
  } catch (error) {
    console.error("Unexpected CAD preview error", error);
    return [];
  }
}

async function getPreviewForCandidate(
  candidate: CadFileCandidate,
  cache: Map<string, CadPreviewResult>,
): Promise<CadPreviewResult> {
  const cacheKey = `${candidate.bucketId ?? "default"}:${candidate.storagePath}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }

  let result: CadPreviewResult;

  if (!isStlCandidate(candidate)) {
    result = {
      signedUrl: null,
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Only STL files are supported for preview today.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const normalized = normalizeStorageReference(
    candidate.storagePath,
    candidate.bucketId,
  );

  if (!normalized) {
    result = {
      signedUrl: null,
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Missing storage path for CAD file.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  const { data: signedData, error: signedError } = await supabaseServer.storage
    .from(normalized.bucket)
    .createSignedUrl(normalized.path, CAD_SIGNED_URL_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    console.error("Failed to create CAD signed URL", signedError);
    result = {
      signedUrl: null,
      fileName:
        candidate.fileName ??
        extractFileNameFromPath(candidate.storagePath) ??
        undefined,
      reason: "Unable to generate CAD preview link right now.",
    };
    cache.set(cacheKey, result);
    return result;
  }

  result = {
    signedUrl: signedData.signedUrl,
    fileName:
      candidate.fileName ??
      extractFileNameFromPath(candidate.storagePath) ??
      undefined,
  };

  cache.set(cacheKey, result);
  return result;
}

function matchCandidateByName(
  name: string,
  candidates: CadFileCandidate[],
): CadFileCandidate | undefined {
  const normalizedName = name?.toLowerCase().trim();
  if (!normalizedName) {
    return undefined;
  }

  return candidates.find((candidate) => {
    const candidateName = candidate.fileName?.toLowerCase().trim();
    if (candidateName && candidateName === normalizedName) {
      return true;
    }
    const pathName =
      extractFileNameFromPath(candidate.storagePath)?.toLowerCase().trim() ??
      "";
    return pathName === normalizedName;
  });
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
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex",
                )}
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
    const statusLabel = UPLOAD_STATUS_LABELS[status] ?? "Unknown";
    const filePreviews = await getQuoteFilePreviews(quote);
    const dfmNotes =
      typeof quote.dfm_notes === "string" && quote.dfm_notes.trim().length > 0
        ? quote.dfm_notes
        : null;
    const internalNotes =
      typeof quote.internal_notes === "string" &&
      quote.internal_notes.trim().length > 0
        ? quote.internal_notes
        : null;
    const {
      messages: quoteMessages,
      error: quoteMessagesError,
    } = await loadQuoteMessages(quote.id);

    if (quoteMessagesError) {
      console.error("Failed to load quote messages", {
        quoteId: quote.id,
        error: quoteMessagesError,
      });
    }
    const messages: QuoteMessage[] = quoteMessages ?? [];

    return (
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 lg:py-10">
        {wasUpdated && <SuccessBanner message="Quote updated." />}

        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Quote workspace
              </p>
              <div>
                <h1 className="text-2xl font-semibold text-slate-50">
                  Quote · {customerName}
                </h1>
                {companyName && (
                  <p className="text-sm text-slate-300">{companyName}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 text-sm text-slate-300">
                {customerEmail && (
                  <a
                    href={`mailto:${customerEmail}`}
                    className="text-emerald-300 hover:underline"
                  >
                    {customerEmail}
                  </a>
                )}
                {contactPhone && (
                  <a
                    href={`tel:${contactPhone}`}
                    className="text-slate-300 hover:text-emerald-300"
                  >
                    {contactPhone}
                  </a>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Synced from{" "}
                <span className="font-mono text-xs text-slate-400">
                  quotes_with_uploads
                </span>
              </p>
            </div>
            <div className="flex flex-col items-end gap-3 text-right">
              <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
                {statusLabel}
              </span>
              {quote.upload_id && (
                <Link
                  href={`/admin/uploads/${quote.upload_id}`}
                  className={clsx(
                    secondaryCtaClasses,
                    ctaSizeClasses.sm,
                    "whitespace-nowrap",
                  )}
                >
                  View upload
                </Link>
              )}
            </div>
          </div>

          <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Price
              </dt>
              <dd className="mt-1 text-base font-medium text-slate-50">
                {formatMoney(priceValue, currencyValue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Target date
              </dt>
              <dd className="mt-1 text-base text-slate-100">
                {formatDateTime(targetDateValue) ?? "Not set"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Created
              </dt>
              <dd className="mt-1 text-base text-slate-100">
                {formatDateTime(quote.created_at, { includeTime: true })}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Updated
              </dt>
              <dd className="mt-1 text-base text-slate-100">
                {formatDateTime(quote.updated_at, { includeTime: true })}
              </dd>
            </div>
          </dl>

          <p className="mt-4 text-xs text-slate-500">
            Quote ID: <span className="font-mono text-slate-300">{quote.id}</span>
            {quote.upload_id && (
              <>
                {" "}
                • Upload ID:{" "}
                <span className="font-mono text-slate-300">{quote.upload_id}</span>
              </>
            )}
          </p>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-6">
            <QuoteFilesCard files={filePreviews} />

            {intakeSummaryItems && (
              <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  RFQ summary
                </p>
                <dl className="mt-4 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
                  {intakeSummaryItems.map((item) => (
                    <div key={item.label} className="space-y-1">
                      <dt className="text-[12px] uppercase tracking-wide text-slate-500">
                        {item.label}
                      </dt>
                      <dd className="font-medium text-slate-100">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Project details / notes
              </p>
              <p className="mt-3 whitespace-pre-line text-sm text-slate-200">
                {intakeNotes ?? "No additional notes captured during intake."}
              </p>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Quote actions
              </p>
              <h2 className="mt-1 text-lg font-semibold text-slate-50">
                Update quote
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Adjust status, pricing, currency, target date, and internal/DFM notes.
              </p>
              <div className="mt-4">
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
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Messages
                  </p>
                  <h2 className="text-lg font-semibold text-slate-50">Admin chat</h2>
                  <p className="text-sm text-slate-400">
                    Chat-style thread visible only to the admin workspace.
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  {messages.length} {messages.length === 1 ? "message" : "messages"}
                </span>
              </div>

              {quoteMessagesError && (
                <p
                  className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200"
                  role="status"
                >
                  Unable to load every message right now. Refresh to retry.
                </p>
              )}

              <div className="mt-4">
                {messages.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-5 text-sm text-slate-400">
                    No messages yet. Use the composer below to start the thread for this quote.
                  </p>
                ) : (
                  <div className="md:max-h-[380px] md:overflow-y-auto md:pr-3">
                    <ol className="flex flex-col gap-4">
                      {messages.map((message) => {
                        const isAdmin = message.author_type === "admin";
                        return (
                          <li
                            key={message.id}
                            className={clsx(
                              "flex w-full",
                              isAdmin ? "justify-end" : "justify-start",
                            )}
                          >
                            <div className="flex max-w-[92%] flex-col gap-2 sm:max-w-[70%]">
                              <div
                                className={clsx(
                                  "flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                                  isAdmin ? "justify-end text-right" : "text-left",
                                )}
                              >
                                <span className={getAuthorBadgeClasses(message.author_type)}>
                                  {AUTHOR_LABELS[message.author_type] ?? AUTHOR_LABELS.admin}
                                </span>
                                <span className="text-slate-400">
                                  {formatDateTime(message.created_at, { includeTime: true })}
                                </span>
                                {message.author_name && (
                                  <span className="text-slate-500">{message.author_name}</span>
                                )}
                              </div>
                              <div
                                className={clsx(
                                  "rounded-2xl border px-4 py-3 text-sm leading-relaxed whitespace-pre-line",
                                  getMessageBubbleClasses(message.author_type),
                                  isAdmin ? "rounded-tr-sm" : "rounded-tl-sm",
                                )}
                              >
                                {message.body}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>
                )}
              </div>

              <div className="mt-6 border-t border-slate-900/60 pt-4">
                <p className="text-sm font-semibold text-slate-100">Post a message</p>
                <p className="mt-1 text-xs text-slate-500">
                  Shared only with admins working on this quote.
                </p>
                <div className="mt-3">
                  <QuoteMessageComposer quoteId={quote.id} />
                </div>
              </div>
            </section>
          </div>
        </div>
      </main>
    );
}
