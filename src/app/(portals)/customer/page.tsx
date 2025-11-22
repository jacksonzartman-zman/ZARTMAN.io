import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import PortalCard from "../PortalCard";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  normalizeUploadStatus,
  UPLOAD_STATUS_LABELS,
  type UploadStatus,
} from "@/app/admin/constants";

export const dynamic = "force-dynamic";

const OPEN_STATUSES: UploadStatus[] = ["submitted", "in_review", "quoted"];
const OPEN_QUOTES_LIMIT = 5;
const ACTIVITY_LIMIT = 10;
const UPLOAD_LIMIT = 25;
const QUOTE_LIMIT = 25;

const DUE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const TIMELINE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
});

type SearchParamsRecord = Record<string, string | string[] | undefined>;
type SearchParamSource =
  | Promise<ReadonlyURLSearchParams | URLSearchParams | SearchParamsRecord>
  | undefined;

type CustomerPageProps = {
  searchParams?: SearchParamSource;
};

type RawUploadRecord = {
  id: string;
  created_at: string | null;
  file_name: string | null;
  manufacturing_process: string | null;
  company: string | null;
  status: string | null;
  quantity: number | null;
};

type RawQuoteRecord = {
  id: string;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  target_date: string | null;
  price: number | string | null;
  currency: string | null;
  file_name: string | null;
  customer_email: string | null;
  company: string | null;
};

type DerivedQuote = {
  id: string;
  status: UploadStatus;
  statusLabel: string;
  dueLabel: string | null;
  fallbackDateLabel: string | null;
  priceLabel: string | null;
};

type ActivityItem = {
  id: string;
  type: "upload" | "quote";
  label: string;
  body?: string;
  timestamp: string;
};

type CustomerPortalData = {
  openQuotes: DerivedQuote[];
  activity: ActivityItem[];
  rfqCount: number;
  totalQuotes: number;
  openQuoteCount: number;
  lastCompany?: string | null;
  hasRecords: boolean;
  error?: string;
};

type ResolvedSearchParams = {
  email?: string;
};

export default async function CustomerDashboardPage({
  searchParams,
}: CustomerPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);
  const normalizedEmail = normalizeEmailInput(resolvedSearchParams.email);

  if (!normalizedEmail) {
    return (
      <div className="space-y-6">
        <PortalCard
          title="Customer portal demo"
          description="Paste your business email into the URL to preview how RFQs and quotes will show up for your team."
          action={
            <Link
              href="/quote"
              className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
            >
              Go to /quote
            </Link>
          }
        >
          <p className="text-sm text-slate-300">
            Example: <code className="text-white">/customer?email=you@company.com</code>
          </p>
        </PortalCard>
      </div>
    );
  }

  const customerData = await loadCustomerPortalData(normalizedEmail);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-sm text-slate-300">
        <p>
          Showing activity for{" "}
          <span className="font-semibold text-white">{normalizedEmail}</span>
          {customerData.lastCompany ? (
            <>
              {" "}
              · <span className="text-slate-400">{customerData.lastCompany}</span>
            </>
          ) : null}
        </p>
        {!customerData.hasRecords ? (
          <p className="mt-2 text-xs text-slate-500">
            We don’t see any RFQs for this contact yet — start a new upload on the
            quote page.
          </p>
        ) : null}
      </section>

      {customerData.error ? (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          {customerData.error}
        </div>
      ) : null}

      <PortalCard
        title="Open quotes"
        description={
          customerData.openQuoteCount > 0
            ? `These quotes are still in motion for ${normalizedEmail}.`
            : "We’ll surface active quotes here as soon as they’re ready."
        }
        action={
          <Link
            href="/quote"
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
          >
            Start new RFQ
          </Link>
        }
      >
        {customerData.openQuotes.length > 0 ? (
          <ul className="space-y-3">
            {customerData.openQuotes.map((quote) => (
              <li
                key={quote.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-900/70 bg-slate-900/30 px-4 py-3"
              >
                <div>
                  <p className="font-medium text-white">
                    Quote {formatQuoteId(quote.id)}
                  </p>
                  <p className="text-xs text-slate-400">{quote.statusLabel}</p>
                </div>
                <div className="text-right text-xs text-slate-400">
                  {quote.priceLabel ? (
                    <p className="text-sm font-semibold text-white">
                      {quote.priceLabel}
                    </p>
                  ) : null}
                  {quote.dueLabel ? (
                    <p>Target {quote.dueLabel}</p>
                  ) : quote.fallbackDateLabel ? (
                    <p>Updated {quote.fallbackDateLabel}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            {customerData.hasRecords
              ? "All caught up! No open quotes at the moment."
              : `We don’t see any RFQs for ${normalizedEmail} yet.`}{" "}
            <Link
              href="/quote"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Upload files to request a quote.
            </Link>
          </p>
        )}
      </PortalCard>

      <PortalCard
        title="Next steps"
        description="Lightweight onboarding checklist so future automation has a home."
      >
        <ol className="list-decimal space-y-2 pl-4 text-slate-300">
          <li>
            You’ve submitted {customerData.rfqCount} RFQs with this email. Drop in
            more drawings anytime.
          </li>
          <li>
            {customerData.openQuoteCount > 0
              ? `Review ${customerData.openQuoteCount} open quote${customerData.openQuoteCount === 1 ? "" : "s"} for final tweaks.`
              : "Expect a response shortly — we’ll notify you as soon as quotes update."}
          </li>
          <li>Loop in teammates or share target pricing from the quote page.</li>
        </ol>
      </PortalCard>

      <PortalCard
        title="Activity feed"
        description="Recent RFQ submissions and quote updates."
      >
        {customerData.activity.length > 0 ? (
          <ul className="space-y-4">
            {customerData.activity.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-1 rounded-xl border border-slate-900/60 bg-slate-900/20 p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-white">{item.label}</p>
                  {item.body ? (
                    <p className="text-sm text-slate-400">{item.body}</p>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  {formatTimelineTimestamp(item.timestamp) ?? "Date pending"}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-400">
            {customerData.hasRecords
              ? "No recent changes yet — we’ll drop updates here automatically."
              : `We don’t see any RFQs for ${normalizedEmail} yet.`}{" "}
            <Link
              href="/quote"
              className="text-emerald-300 underline-offset-4 hover:underline"
            >
              Share files to kick off your first RFQ.
            </Link>
          </p>
        )}
      </PortalCard>
    </div>
  );
}

async function resolveSearchParams(
  rawSearchParams?: SearchParamSource,
): Promise<ResolvedSearchParams> {
  const resolved = await rawSearchParams;

  if (!resolved) {
    return {};
  }

  if (isSearchParamsLike(resolved)) {
    return {
      email: resolved.get("email") ?? undefined,
    };
  }

  const record = resolved as SearchParamsRecord;
  return {
    email: getFirstParamValue(record.email),
  };
}

function normalizeEmailInput(value?: string): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 3 ? normalized : null;
}

function getFirstParamValue(
  value?: string | string[] | null,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
}

function isSearchParamsLike(
  value: unknown,
): value is Pick<URLSearchParams, "get"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).get === "function"
  );
}

async function loadCustomerPortalData(
  email: string,
): Promise<CustomerPortalData> {
  const supabase = supabaseServer;

  const [uploadsResponse, quotesResponse] = await Promise.all([
    supabase
      .from("uploads")
      .select(
        `
        id,
        created_at,
        file_name,
        manufacturing_process,
        company,
        status,
        quantity
      `,
      )
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(UPLOAD_LIMIT),
    supabase
      .from("quotes_with_uploads")
      .select(
        `
        id,
        status,
        created_at,
        updated_at,
        target_date,
        price,
        currency,
        file_name,
        customer_email,
        company
      `,
      )
      .ilike("customer_email", email)
      .order("created_at", { ascending: false })
      .limit(QUOTE_LIMIT),
  ]);

  const errors: string[] = [];
  if (uploadsResponse.error) {
    console.error("Failed to load uploads for customer portal", uploadsResponse.error);
    errors.push("uploads");
  }

  if (quotesResponse.error) {
    console.error("Failed to load quotes for customer portal", quotesResponse.error);
    errors.push("quotes");
  }

  const uploads = (uploadsResponse.data ?? []) as RawUploadRecord[];
  const quotes = (quotesResponse.data ?? []) as RawQuoteRecord[];

  const openQuoteRecords = quotes.filter((quote) =>
    OPEN_STATUSES.includes(normalizeUploadStatus(quote.status)),
  );

  const openQuotes: DerivedQuote[] = openQuoteRecords
    .slice(0, OPEN_QUOTES_LIMIT)
    .map((quote) => {
      const status = normalizeUploadStatus(quote.status);
      return {
        id: quote.id,
        status,
        statusLabel: UPLOAD_STATUS_LABELS[status],
        dueLabel: formatDueDate(quote.target_date),
        fallbackDateLabel: formatDueDate(quote.created_at),
        priceLabel: formatPriceLabel(quote.price, quote.currency),
      };
    });

  const activity = buildActivityItems(uploads, quotes).slice(0, ACTIVITY_LIMIT);

  const rfqCount = uploads.length;
  const totalQuotes = quotes.length;
  const openQuoteCount = openQuoteRecords.length;

  return {
    openQuotes,
    activity,
    rfqCount,
    totalQuotes,
    openQuoteCount,
    lastCompany: uploads[0]?.company ?? quotes[0]?.company ?? null,
    hasRecords: rfqCount > 0 || totalQuotes > 0,
    error:
      errors.length > 0
        ? "We couldn’t load every data point just now. Refresh to try again."
        : undefined,
  };
}

function buildActivityItems(
  uploads: RawUploadRecord[],
  quotes: RawQuoteRecord[],
): ActivityItem[] {
  const uploadItems: ActivityItem[] = uploads
    .filter((upload) => Boolean(upload.created_at))
    .map((upload) => ({
      id: `upload-${upload.id}`,
      type: "upload" as const,
      label: "RFQ submitted",
      body: buildUploadActivityBody(upload),
      timestamp: upload.created_at as string,
    }));

  const quoteItems = quotes.flatMap((quote) => {
    const timestamp = quote.updated_at ?? quote.created_at;
    if (!timestamp) {
      return [];
    }

    const normalizedStatus = normalizeUploadStatus(quote.status);
    return [
      {
        id: `quote-${quote.id}`,
        type: "quote" as const,
        label: getQuoteActivityLabel(normalizedStatus),
        body: buildQuoteActivityBody(quote),
        timestamp,
      },
    ];
  });

  return [...uploadItems, ...quoteItems].sort((a, b) => {
    const left = Date.parse(b.timestamp);
    const right = Date.parse(a.timestamp);
    return (Number.isNaN(left) ? 0 : left) - (Number.isNaN(right) ? 0 : right);
  });
}

function buildUploadActivityBody(upload: RawUploadRecord): string {
  const quantityLabel =
    typeof upload.quantity === "number" && upload.quantity > 0
      ? `Qty ${upload.quantity}`
      : null;
  const parts = [
    upload.file_name,
    upload.manufacturing_process,
    quantityLabel,
    upload.company,
  ].filter((part): part is string => Boolean(part));

  return parts.join(" • ") || "Files received for review.";
}

function buildQuoteActivityBody(quote: RawQuoteRecord): string | undefined {
  const price = formatPriceLabel(quote.price, quote.currency);
  const due = formatDueDate(quote.target_date);
  const parts = [
    quote.file_name,
    price ? `Est. ${price}` : null,
    due ? `Target ${due}` : null,
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

function getQuoteActivityLabel(status: UploadStatus): string {
  switch (status) {
    case "approved":
      return "Order approved";
    case "rejected":
      return "Quote closed";
    case "quoted":
      return "Quote shared";
    case "in_review":
      return "Quote in review";
    default:
      return "Quote updated";
  }
}

function formatDueDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return DUE_DATE_FORMATTER.format(new Date(timestamp));
}

function formatQuoteId(id: string): string {
  if (!id) {
    return "—";
  }

  return id.startsWith("Q-") ? id : `#${id.slice(0, 6)}`;
}

function formatPriceLabel(
  amount: unknown,
  currency: string | null,
): string | null {
  const numericAmount =
    typeof amount === "number"
      ? amount
      : typeof amount === "string"
        ? Number(amount)
        : null;

  if (numericAmount === null || Number.isNaN(numericAmount)) {
    return null;
  }

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: numericAmount >= 1000 ? 0 : 2,
    }).format(numericAmount);
  } catch {
    return numericAmount.toLocaleString("en-US");
  }
}

function formatTimelineTimestamp(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return TIMELINE_FORMATTER.format(new Date(timestamp));
}
