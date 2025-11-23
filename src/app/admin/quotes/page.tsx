// src/app/admin/quotes/page.tsx

import { supabaseServer } from "@/lib/supabaseServer";
import type { ReadonlyURLSearchParams } from "next/navigation";
import {
  UPLOAD_STATUS_OPTIONS,
  normalizeUploadStatus,
  type UploadStatus,
} from "../constants";
import QuotesTable, { type QuoteRow } from "../QuotesTable";
import StatusFilterChips from "../StatusFilterChips";
import AdminDashboardShell from "../AdminDashboardShell";
import AdminFiltersBar from "../AdminFiltersBar";
import AdminSearchInput from "../AdminSearchInput";

export const dynamic = "force-dynamic";

type QuotesPageSearchParams = {
  status?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  status?: string;
  search?: string;
};

type QuotesPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

const VALID_STATUS_VALUES: UploadStatus[] = [...UPLOAD_STATUS_OPTIONS];

const getFirstParamValue = (
  value?: string | string[] | null,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value ?? undefined;
};

type ResolvableSearchParams =
  | QuotesPageProps["searchParams"]
  | URLSearchParams
  | ReadonlyURLSearchParams
  | QuotesPageSearchParams
  | null
  | undefined;

const isURLSearchParamsLike = (
  value: unknown,
): value is Pick<URLSearchParams, "get"> => {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).get === "function"
  );
};

const resolveSearchParams = async (
  rawSearchParams?: ResolvableSearchParams,
): Promise<ResolvedSearchParams> => {
  const resolved = await rawSearchParams;

  if (!resolved) {
    return {};
  }

  if (isURLSearchParamsLike(resolved)) {
    return {
      status: resolved.get("status") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  const maybeObject = resolved as QuotesPageSearchParams;
  return {
    status: getFirstParamValue(maybeObject.status),
    search: getFirstParamValue(maybeObject.search),
  };
};

export default async function QuotesPage({ searchParams }: QuotesPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const normalizedStatus =
    typeof resolvedSearchParams.status === "string"
      ? resolvedSearchParams.status.trim().toLowerCase()
      : "";
  const statusFilter: UploadStatus | "all" = VALID_STATUS_VALUES.includes(
    normalizedStatus as UploadStatus,
  )
    ? (normalizedStatus as UploadStatus)
    : "all";

  const searchTerm =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Error loading quotes for admin:", error);
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-400">
          Failed to load quotes dashboard: {error.message}
        </p>
      </main>
    );
  }

    const rows: QuoteRow[] =
      data?.map((row: any) => ({
        id: row.id,
        customerName: row.customer_name ?? "Unknown",
        customerEmail: row.email ?? "",
        company: row.company ?? "",
        fileName: row.file_name ?? "",
        status: normalizeUploadStatus(row.status as UploadStatus | null),
        price: row.price,
        currency: row.currency,
        targetDate: row.target_date,
        createdAt: row.created_at,
      })) ?? [];

  const filteredQuotes = rows.filter((row) => {
    const normalizedRowStatus = normalizeUploadStatus(row.status);
    const matchesStatus =
      statusFilter === "all" ? true : normalizedRowStatus === statusFilter;

    if (!normalizedSearch) {
      return matchesStatus;
    }

    const haystack = `${row.customerName ?? ""} ${row.customerEmail ?? ""} ${
      row.company ?? ""
    } ${row.fileName ?? ""} ${row.status ?? ""}`
      .toLowerCase()
      .replace(/\s+/g, " ");

    return matchesStatus && haystack.includes(normalizedSearch);
  });

    return (
      <AdminDashboardShell
        title="Quotes"
        description="Recent quotes created from uploads."
      >
        <AdminFiltersBar
          filters={
            <StatusFilterChips
              currentStatus={statusFilter === "all" ? "" : statusFilter}
              basePath="/admin/quotes"
            />
          }
          search={
            <AdminSearchInput
              initialValue={searchTerm}
              basePath="/admin/quotes"
              placeholder="Search by customer, email, company, file, or status..."
            />
          }
        />
        <QuotesTable quotes={filteredQuotes} totalCount={rows.length} />
      </AdminDashboardShell>
    );
}
