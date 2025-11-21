// src/app/admin/quotes/[id]/page.tsx

import Link from "next/link";
import type { ReadonlyURLSearchParams } from "next/navigation";
import { supabaseServer } from "@/lib/supabaseServer";
import { formatDateTime } from "@/lib/formatDate";
import type { UploadStatus } from "../../constants";
import { UPLOAD_STATUS_LABELS } from "../../constants";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { SuccessBanner } from "../../uploads/[id]/SuccessBanner";

export const dynamic = "force-dynamic";

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<ReadonlyURLSearchParams>;
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
  created_at: string | null;
  updated_at: string | null;
  upload_id: string | null;
};

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

export default async function QuoteDetailPage({
  params,
  searchParams,
}: QuoteDetailPageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const wasUpdated = resolvedSearchParams?.get("updated") === "1";

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
            <span className="font-mono text-slate-200">{resolvedParams.id}</span>.
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

  const status = (quote.status ?? "new") as UploadStatus;
  const customerName = quote.customer_name ?? "Unknown customer";
  const fileNames = extractFileNames(quote);

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
              {quote.customer_email && (
                <a
                  href={`mailto:${quote.customer_email}`}
                  className="text-sm text-emerald-400 hover:underline"
                >
                  {quote.customer_email}
                </a>
              )}
              {quote.company && (
                <p className="text-sm text-slate-300">{quote.company}</p>
              )}
            </div>
            <span className="inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
              {UPLOAD_STATUS_LABELS[status]}
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
                  <dd>{formatMoney(quote.price, quote.currency)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Target date</dt>
                  <dd>{formatDateTime(quote.target_date)}</dd>
                </div>
              </dl>
            </div>
          </div>

          <div className="rounded-lg border border-slate-900/80 bg-slate-950/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timeline
            </p>
            <dl className="mt-3 grid gap-3 text-sm text-slate-200 md:grid-cols-2">
              <div>
                <dt className="text-slate-500">Created</dt>
                <dd>{formatDateTime(quote.created_at, { includeTime: true })}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Updated</dt>
                <dd>{formatDateTime(quote.updated_at, { includeTime: true })}</dd>
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
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6">
          <h2 className="text-base font-semibold text-slate-50">
            Update quote
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Adjust status, pricing, currency, target date, and notes. Changes are
            saved back to Supabase and show up instantly on the dashboard.
          </p>

          <QuoteUpdateForm
            quote={{
              id: quote.id,
              status,
              price: quote.price,
              currency: quote.currency,
              targetDate: quote.target_date,
              internalNotes: quote.internal_notes,
            }}
          />
        </section>
      </div>
    </main>
  );
}