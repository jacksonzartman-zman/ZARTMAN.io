// src/app/admin/page.tsx
import type { ReadonlyURLSearchParams } from "next/navigation";
import AdminTable, { type InboxRow } from "./AdminTable";
import StatusFilterChips from "./StatusFilterChips";
import AdminSearchInput from "./AdminSearchInput";
import {
  normalizeUploadStatus,
  isUploadStatus,
  type UploadStatus,
} from "./constants";
import AdminDashboardShell from "./AdminDashboardShell";
import AdminFiltersBar from "./AdminFiltersBar";
import { loadAdminUploadsInbox } from "@/server/admin/uploads";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams?: Promise<ReadonlyURLSearchParams>;
};

type SearchParamRecord = {
  status?: string | string[] | null;
  search?: string | string[] | null;
};

type ResolvedSearchParams = {
  status?: string;
  search?: string;
};

type ResolvableSearchParams =
  | AdminPageProps["searchParams"]
  | URLSearchParams
  | ReadonlyURLSearchParams
  | SearchParamRecord
  | null
  | undefined;

const getFirstParamValue = (
  value?: string | string[] | null,
): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value ?? undefined;
};

const isSearchParamsLike = (
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

  if (isSearchParamsLike(resolved)) {
    return {
      status: resolved.get("status") ?? undefined,
      search: resolved.get("search") ?? undefined,
    };
  }

  return {
    status: getFirstParamValue(resolved.status),
    search: getFirstParamValue(resolved.search),
  };
};

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const resolvedSearchParams = await resolveSearchParams(searchParams);

  const rawStatus = resolvedSearchParams.status?.trim().toLowerCase();
  const statusFilter: UploadStatus | undefined = rawStatus
    ? (isUploadStatus(rawStatus) ? rawStatus : undefined)
    : undefined;

  const searchInputValue =
    typeof resolvedSearchParams.search === "string"
      ? resolvedSearchParams.search
      : "";
  const normalizedSearch = searchInputValue.trim().toLowerCase();

  const inboxResult = await loadAdminUploadsInbox({
    status: statusFilter ?? null,
    search: normalizedSearch || null,
  });

  const rows: InboxRow[] =
    inboxResult.data?.map((row) => {
      const contactPieces = [row.first_name, row.last_name]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
      const fallbackName =
        typeof row.name === "string" && row.name.trim().length > 0
          ? row.name.trim()
          : undefined;
      const fallbackEmail =
        typeof row.email === "string" && row.email.trim().length > 0
          ? row.email.trim()
          : undefined;
      const contactName =
        contactPieces.join(" ").trim() ||
        fallbackName ||
        fallbackEmail ||
        "Unknown contact";

      return {
        id: row.id,
        quoteId: row.quote_id ?? null,
        createdAt: row.created_at ?? null,
        company: row.company ?? null,
        contactName,
        contactEmail: fallbackEmail ?? null,
        manufacturingProcess: row.manufacturing_process ?? null,
        quantity: row.quantity ?? null,
        status: normalizeUploadStatus(row.status),
      };
    }) ?? [];

  const hasActiveFilters = Boolean(statusFilter || normalizedSearch);

  return (
    <AdminDashboardShell
      title="RFQ inbox"
      description="Filter, search, and jump into the latest submissions from customers."
    >
      {!inboxResult.ok ? (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-100">
          We had trouble loading the inbox. Check logs and try again.
        </div>
      ) : null}
      <AdminFiltersBar
        filters={
          <StatusFilterChips
            currentStatus={statusFilter ?? ""}
            basePath="/admin"
          />
        }
        search={
          <AdminSearchInput
            initialValue={searchInputValue}
            basePath="/admin"
            placeholder="Search company, contact, email, or file name..."
          />
        }
      />
      <AdminTable rows={rows} hasActiveFilters={hasActiveFilters} />
    </AdminDashboardShell>
  );
}
