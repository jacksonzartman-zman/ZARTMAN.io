import Link from "next/link";
import { PortalShell } from "../../components/PortalShell";
import { PortalLoginPanel } from "../../PortalLoginPanel";
import { EmptyStateNotice } from "../../EmptyStateNotice";
import SupplierInboxTable, {
  type SupplierInboxRow,
} from "../SupplierInboxTable";
import { DataFallbackNotice } from "../../DataFallbackNotice";
import {
  getSupplierApprovalStatus,
  loadSupplierInboxBidAggregates,
  loadSupplierProfile,
  matchQuotesToSupplier,
  type SupplierQuoteMatch,
  type SupplierActivityResult,
} from "@/server/suppliers";
import { getServerAuthUser } from "@/server/auth";
import {
  normalizeEmailInput,
  resolveMaybePromise,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import { resolveUserRoles } from "@/server/users/roles";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { buildSupplierInboxRows } from "../inboxRows";
import { isOpenQuoteStatus } from "@/server/quotes/status";
import { formatRelativeTimeFromTimestamp } from "@/lib/relativeTime";
import AdminSearchInput from "@/app/admin/AdminSearchInput";
import TablePaginationControls from "@/app/admin/components/TablePaginationControls";
import { parseListState } from "@/app/(portals)/lib/listState";
import {
  SUPPLIER_RFQS_LIST_STATE_CONFIG,
  type SupplierRfqsSortKey,
  type SupplierRfqsStatusFilter,
} from "./listState";
import SupplierRfqsListControls from "./SupplierRfqsListControls";

export const dynamic = "force-dynamic";

type SupplierQuotesPageProps = {
  searchParams?: Promise<SearchParamsLike>;
};

export default async function SupplierQuotesPage({
  searchParams,
}: SupplierQuotesPageProps) {
  const { user } = await getServerAuthUser();

  if (!user) {
    return (
      <PortalLoginPanel role="supplier" fallbackRedirect="/supplier/quotes" />
    );
  }

  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Quotes"
        subtitle="This workspace is reserved for supplier accounts."
      >
        <EmptyStateNotice
          title="Supplier access required"
          description="Switch to the customer portal or contact support if you need supplier access."
          action={
            <Link
              href="/customer"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Go to customer portal
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const supplierEmail = normalizeEmailInput(user.email ?? null);
  if (!supplierEmail) {
    return (
      <PortalShell
        workspace="supplier"
        title="Quotes"
        subtitle="We need a verified supplier email to load your matches."
      >
        <EmptyStateNotice
          title="Sign in with your supplier email"
          description="Log out and sign back in with the verified email tied to your supplier workspace."
        />
      </PortalShell>
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  const supplier = profile?.supplier ?? null;
  if (!supplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="Quotes"
        subtitle="Finish onboarding to start routing matched RFQs here."
      >
        <EmptyStateNotice
          title="Complete supplier onboarding"
          description="Share capabilities, certifications, and documents so we can route the right RFQs."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-300 underline-offset-4 hover:underline"
            >
              Finish onboarding
            </Link>
          }
        />
      </PortalShell>
    );
  }

  const approvalsOn = approvalsEnabled();
  const supplierStatus = supplier?.status ?? "pending";
  const approvalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus({ status: supplierStatus });
  const approvalGateActive = approvalsOn && approvalStatus !== "approved";

  const resolvedSearchParams = await resolveMaybePromise(searchParams);
  const listState = parseListState(resolvedSearchParams, SUPPLIER_RFQS_LIST_STATE_CONFIG);
  const page = listState.page;
  const pageSize = listState.pageSize;
  const sort = (listState.sort ??
    SUPPLIER_RFQS_LIST_STATE_CONFIG.defaultSort ??
    "recently_updated") as SupplierRfqsSortKey;
  const status = (listState.status ?? undefined) as SupplierRfqsStatusFilter | undefined;

  const desiredMatchLimit = Math.min(1000, Math.max(100, page * pageSize + 50));
  const desiredQuoteScanLimit = Math.min(
    2000,
    Math.max(200, desiredMatchLimit * 3),
  );

  const matchesResult = await loadMatchesForSupplier({
    supplierId: supplier.id,
    supplierEmail: supplier.primary_email ?? supplierEmail,
    options: {
      maxMatches: desiredMatchLimit,
      quoteFetchLimit: desiredQuoteScanLimit,
    },
  });
  const matchesData = matchesResult.data ?? [];
  const bidAggregates =
    matchesData.length > 0
      ? await loadSupplierInboxBidAggregates(
          supplier.id,
          collectQuoteIds(matchesData),
        )
      : {};
  const supplierInboxRows = buildSupplierInboxRows({
    matches: matchesData,
    bidAggregates,
    capabilities: profile?.capabilities ?? [],
  });

  const searchTerm = listState.q;
  const normalizedSearch = searchTerm.trim().toLowerCase().replace(/\s+/g, " ");

  const searchedRows = normalizedSearch
    ? supplierInboxRows.filter((row) => matchesSupplierRfqSearch(row, normalizedSearch))
    : supplierInboxRows;

  const openCount = searchedRows.filter((row) => isOpenQuoteStatus(row.status)).length;
  const totalCount = searchedRows.length;
  const closedCount = totalCount - openCount;
  const filterOptions: Array<{
    label: string;
    value: "all" | SupplierRfqsStatusFilter;
    count: number;
  }> = [
    { label: "All", value: "all", count: totalCount },
    { label: "Open", value: "open", count: openCount },
    { label: "Closed", value: "closed", count: closedCount },
  ];

  const statusFilteredRows =
    status === "open"
      ? searchedRows.filter((row) => isOpenQuoteStatus(row.status))
      : status === "closed"
        ? searchedRows.filter((row) => !isOpenQuoteStatus(row.status))
        : searchedRows;

  const sortedRows = sortSupplierRfqs(statusFilteredRows, sort);
  const pageStart = (page - 1) * pageSize;
  const pageRows = sortedRows.slice(pageStart, pageStart + pageSize);
  const hasMore = pageStart + pageSize < sortedRows.length;
  const latestActivityTimestamp =
    supplierInboxRows[0]?.lastActivityTimestamp ?? null;
  const syncedLabel =
    formatRelativeTimeFromTimestamp(latestActivityTimestamp) ??
    (supplierInboxRows.length > 0 ? "Recently updated" : "Waiting for activity");

  const headerActions = (
    <div className="flex flex-wrap gap-3">
      <Link
        href="/supplier"
        className="inline-flex items-center rounded-full border border-blue-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-blue-100 transition hover:border-blue-300 hover:text-white"
      >
        Back to dashboard
      </Link>
      <Link
        href="/supplier/decisions"
        className="inline-flex items-center rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-600 hover:text-white"
      >
        Decisions queue
      </Link>
    </div>
  );

  return (
    <PortalShell
      workspace="supplier"
      title="Quotes"
      subtitle="Every matched RFQ sorted by latest activity."
      actions={headerActions}
    >
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
              Supplier inbox
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-white">
              Matched quotes
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Sorted by the latest bid, assignment, or target date so you can prioritize the hottest leads.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Synced {syncedLabel ?? "moments ago"}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <SupplierRfqsListControls
            basePath="/supplier/quotes"
            filterOptions={filterOptions}
            listStateConfig={SUPPLIER_RFQS_LIST_STATE_CONFIG}
          />
          <AdminSearchInput
            initialValue={searchTerm}
            basePath="/supplier/quotes"
            placeholder="Search RFQs by customer, file, process, or material..."
            listStateConfig={SUPPLIER_RFQS_LIST_STATE_CONFIG}
          />
        </div>

        <div className="mt-6">
          {approvalGateActive ? (
            <EmptyStateNotice
              title="RFQs unlock after approval"
              description="We’ll populate this list as soon as your supplier profile is approved."
            />
          ) : pageRows.length > 0 ? (
            <>
              <SupplierInboxTable rows={pageRows} />
              <TablePaginationControls
                basePath="/supplier/quotes"
                page={page}
                pageSize={pageSize}
                hasMore={hasMore}
                totalCount={sortedRows.length}
                rowsOnPage={pageRows.length}
                listStateConfig={SUPPLIER_RFQS_LIST_STATE_CONFIG}
              />
            </>
          ) : (
            <EmptyStateNotice
              title={
                status === "open"
                  ? "No open RFQs"
                  : status === "closed"
                    ? "No closed RFQs yet"
                    : "No RFQs matched yet"
              }
              description={
                status === "open"
                  ? "You’re caught up on every active invitation. We’ll notify you the moment a new RFQ routes in."
                  : status === "closed"
                    ? "Close out a bid or mark an RFQ complete to see it here."
                    : "We’re constantly matching your capabilities. The first compatible RFQ drops here automatically."
              }
            />
          )}
        </div>
        {!matchesResult.ok ? (
          <DataFallbackNotice className="mt-4" />
        ) : null}
      </section>
    </PortalShell>
  );
}

async function loadMatchesForSupplier(args: {
  supplierId: string;
  supplierEmail: string | null;
  options?: {
    maxMatches?: number;
    quoteFetchLimit?: number;
  };
}): Promise<SupplierActivityResult<SupplierQuoteMatch[]>> {
  const { supplierId, supplierEmail, options } = args;
  try {
    return await matchQuotesToSupplier({
      supplierId,
      supplierEmail: supplierEmail ?? undefined,
    }, options);
  } catch (error) {
    console.error("[supplier quotes] failed to load matches", {
      supplierId,
      error,
    });
    return { ok: false, data: [] };
  }
}

function collectQuoteIds(matches: SupplierQuoteMatch[]): string[] {
  return matches
    .map((match) => match.quoteId ?? match.quote?.id ?? null)
    .filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
}

function sortSupplierRfqs(
  rows: SupplierInboxRow[],
  sort: SupplierRfqsSortKey,
): SupplierInboxRow[] {
  const copy = rows.slice();

  if (sort === "newest") {
    copy.sort(
      (a, b) =>
        (toSortableTimestamp(b.createdAt) ?? 0) -
        (toSortableTimestamp(a.createdAt) ?? 0),
    );
    return copy;
  }

  // recently_updated (default)
  copy.sort((a, b) => (b.lastActivityTimestamp ?? 0) - (a.lastActivityTimestamp ?? 0));
  return copy;
}

function toSortableTimestamp(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function matchesSupplierRfqSearch(row: SupplierInboxRow, normalizedNeedle: string): boolean {
  const haystack = [
    row.rfqLabel,
    row.companyName,
    row.primaryFileName ?? "",
    row.processHint ?? "",
    row.materials.join(" "),
  ]
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  return haystack.includes(normalizedNeedle);
}
