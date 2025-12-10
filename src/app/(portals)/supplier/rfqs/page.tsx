import clsx from "clsx";
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
  getSearchParamValue,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import { resolveUserRoles } from "@/server/users/roles";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { buildSupplierInboxRows } from "../inboxRows";
import { isOpenQuoteStatus } from "@/server/quotes/status";
import { formatRelativeTimeFromTimestamp } from "@/lib/relativeTime";

export const dynamic = "force-dynamic";

type SupplierRfqsPageProps = {
  searchParams?: SearchParamsLike;
};

type FilterValue = "all" | "open" | "closed";

export default async function SupplierRfqsPage({
  searchParams,
}: SupplierRfqsPageProps) {
  const { user } = await getServerAuthUser();

  if (!user) {
    return (
      <PortalLoginPanel role="supplier" fallbackRedirect="/supplier/rfqs" />
    );
  }

  const roles = await resolveUserRoles(user.id);
  if (!roles?.isSupplier) {
    return (
      <PortalShell
        workspace="supplier"
        title="RFQs"
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
        title="RFQs"
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
        title="RFQs"
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

  const matchesResult = await loadMatchesForSupplier({
    supplierId: supplier.id,
    supplierEmail: supplier.primary_email ?? supplierEmail,
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
  });

  const filterValue = resolveFilterValue(searchParams);
  const filteredRows = filterRows(supplierInboxRows, filterValue);
  const filterOptions = deriveFilterOptions(supplierInboxRows);
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
      title="RFQs"
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
              Actionable RFQs
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Sorted by the latest bid, assignment, or target date so you can
              prioritize the hottest leads.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Synced {syncedLabel ?? "moments ago"}
          </p>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {filterOptions.map((option) => (
            <FilterChip
              key={option.value}
              option={option}
              selected={option.value === filterValue}
            />
          ))}
        </div>

        <div className="mt-6">
          {approvalGateActive ? (
            <EmptyStateNotice
              title="RFQs unlock after approval"
              description="We’ll populate this list as soon as your supplier profile is approved."
            />
          ) : filteredRows.length > 0 ? (
            <SupplierInboxTable rows={filteredRows} />
          ) : (
            <EmptyStateNotice
              title={
                filterValue === "open"
                  ? "No open RFQs"
                  : filterValue === "closed"
                    ? "No closed RFQs yet"
                    : "No RFQs matched yet"
              }
              description={
                filterValue === "open"
                  ? "You’re caught up on every active invitation. We’ll notify you the moment a new RFQ routes in."
                  : filterValue === "closed"
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
}): Promise<SupplierActivityResult<SupplierQuoteMatch[]>> {
  const { supplierId, supplierEmail } = args;
  try {
    return await matchQuotesToSupplier({
      supplierId,
      supplierEmail: supplierEmail ?? undefined,
    });
  } catch (error) {
    console.error("[supplier rfqs] failed to load matches", {
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

function resolveFilterValue(params?: SearchParamsLike): FilterValue {
  const raw = (getSearchParamValue(params, "status") ?? "").toLowerCase();
  if (raw === "open" || raw === "closed") {
    return raw;
  }
  return "all";
}

function filterRows(rows: SupplierInboxRow[], filter: FilterValue) {
  if (filter === "open") {
    return rows.filter((row) => isOpenQuoteStatus(row.status));
  }
  if (filter === "closed") {
    return rows.filter((row) => !isOpenQuoteStatus(row.status));
  }
  return rows;
}

function deriveFilterOptions(rows: SupplierInboxRow[]) {
  const openCount = rows.filter((row) => isOpenQuoteStatus(row.status)).length;
  const total = rows.length;
  const closedCount = total - openCount;
  return [
    { label: "All", value: "all", count: total },
    { label: "Open", value: "open", count: openCount },
    { label: "Closed", value: "closed", count: closedCount },
  ] satisfies { label: string; value: FilterValue; count: number }[];
}

function FilterChip({
  option,
  selected,
}: {
  option: { label: string; value: FilterValue; count: number };
  selected: boolean;
}) {
  const href =
    option.value === "all"
      ? "/supplier/rfqs"
      : `/supplier/rfqs?status=${option.value}`;
  return (
    <Link
      href={href}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] transition",
        selected
          ? "border-white bg-white/10 text-white"
          : "border-slate-800 text-slate-400 hover:text-white",
      )}
    >
      {option.label}
      <span
        className={clsx(
          "rounded-full px-2 py-0.5 text-[10px]",
          selected
            ? "bg-white/20 text-white"
            : "bg-slate-800 text-slate-400",
        )}
      >
        {option.count}
      </span>
    </Link>
  );
}
