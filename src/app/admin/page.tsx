// src/app/admin/page.tsx
import type { ReadonlyURLSearchParams } from "next/navigation";
import type { ReactNode } from "react";
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
import {
  loadAdminDashboardMetrics,
  type AdminDashboardMetrics,
} from "@/server/admin/dashboard";

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

const DEFAULT_METRICS: AdminDashboardMetrics = {
  totalOpen: 0,
  totalWon: 0,
  totalLost: 0,
  openQuotedValue: 0,
  wonQuotedValue: 0,
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

  const [metricsResult, inboxResult] = await Promise.all([
    loadAdminDashboardMetrics(),
    loadAdminUploadsInbox({
      status: statusFilter ?? null,
      search: normalizedSearch || null,
    }),
  ]);

  const metrics = metricsResult.data ?? DEFAULT_METRICS;

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
      {!metricsResult.ok ? (
        <p className="mb-2 text-sm text-slate-400">
          Some metrics are temporarily unavailable.
        </p>
      ) : null}
      <section className="mb-6 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <MetricCard
          label="Open RFQs"
          value={metrics.totalOpen}
          hint="Submitted, in review, or quoted"
        />
        <MetricCard label="Won quotes" value={metrics.totalWon} hint="Closed as won" />
        <MetricCard label="Lost quotes" value={metrics.totalLost} hint="Closed as lost" />
        <MetricCard
          label="Open quoted value"
          value={formatCurrency(metrics.openQuotedValue)}
          hint="Sum of quoted open RFQs"
        />
        <MetricCard
          label="Won quoted value"
          value={formatCurrency(metrics.wonQuotedValue)}
          hint="Sum of closed-won quotes"
        />
      </section>
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

type MetricCardProps = {
  label: string;
  value: ReactNode;
  hint?: string;
};

function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
