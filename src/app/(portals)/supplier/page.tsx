import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { primaryCtaClasses } from "@/lib/ctas";
import PortalCard from "../PortalCard";
import SupplierInboxTable, { type SupplierInboxRow } from "./SupplierInboxTable";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { WorkspaceMetrics, type WorkspaceMetric } from "../WorkspaceMetrics";
import { EmptyStateNotice } from "../EmptyStateNotice";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import {
  getSupplierApprovalStatus,
  loadSupplierInboxBidAggregates,
  listSupplierBidsForSupplier,
  loadSupplierProfile,
  matchQuotesToSupplier,
  type SupplierActivityResult,
  type SupplierApprovalGate,
  type SupplierApprovalStatus,
  type SupplierBidWithContext,
  type SupplierQuoteMatch,
  type SupplierProfile,
} from "@/server/suppliers";
import { getServerAuthUser } from "@/server/auth";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { SystemStatusBar } from "../SystemStatusBar";
import { loadRecentSupplierActivity } from "@/server/suppliers/activity";
import type { QuoteActivityEvent } from "@/types/activity";
import { resolveUserRoles } from "@/server/users/roles";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { DEBUG_PORTALS } from "../debug";
import { approvalsEnabled } from "@/server/suppliers/flags";
import { normalizeQuoteStatus } from "@/server/quotes/status";

export const dynamic = "force-dynamic";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

async function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const { user } = await getServerAuthUser();
  const roles = user ? await resolveUserRoles(user.id) : null;
  if (!user) {
    return (
      <section className="mx-auto max-w-3xl rounded-3xl border border-slate-900 bg-slate-950/70 p-8 text-center shadow-[0_18px_40px_rgba(2,6,23,0.85)]">
        <p className="text-xs font-semibold uppercase tracking-[0.35em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-4 text-3xl font-semibold text-white">You&apos;re not logged in</h1>
        <p className="mt-3 text-sm text-slate-300">
          Use the email you onboarded with to request a magic link. We&apos;ll redirect you back to
          your supplier dashboard once you&apos;re in.
        </p>
        <Link
          href="/login?next=/supplier"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-white"
        >
          Go to login
        </Link>
      </section>
    );
  }
  console.log("[portal] user id", user.id);
  console.log("[portal] email", user.email);
  console.log("[portal] isSupplier", roles?.isSupplier);
  console.log("[portal] isCustomer", roles?.isCustomer);
  const sessionCompanyName =
    sanitizeDisplayName(user.user_metadata?.company) ??
    sanitizeDisplayName(user.user_metadata?.full_name) ??
    sanitizeDisplayName(user.email) ??
    "your team";
  const supplierEmail = normalizeEmailInput(user.email ?? null);
  const onboardingJustCompleted =
    getSearchParamValue(searchParams, "onboard") === "1";

  if (!supplierEmail) {
    return (
      <div className="space-y-6">
        <WorkspaceWelcomeBanner
          role="supplier"
          companyName={sessionCompanyName}
        />
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6 text-center">
          <p className="text-sm text-slate-300">
            Sign in with a verified supplier email address to load your workspace.
          </p>
        </section>
      </div>
    );
  }

  const profile = await loadSupplierProfile(supplierEmail);
  const supplier = profile?.supplier ?? null;
  const capabilities = profile?.capabilities ?? [];
  const documents = profile?.documents ?? [];
  const supplierExists = Boolean(supplier);
  const supplierProfileUnavailable = Boolean(supplierEmail) && !profile;
  const approvalsOn = approvalsEnabled();
  const approvalStatus: SupplierApprovalStatus =
    profile?.approvalStatus ??
    getSupplierApprovalStatus(supplier ?? undefined);
  const supplierApproved = approvalsOn ? approvalStatus === "approved" : true;
  const approvalGate: SupplierApprovalGate | undefined =
    approvalsOn && !supplierApproved
      ? {
          enabled: true,
          status: approvalStatus,
        }
      : undefined;
  const activityHoldCopy = getApprovalHoldCopy(approvalGate?.status);

  const [matchesResult, bidsResult] = supplier
    ? await Promise.all([
        matchQuotesToSupplier({
          supplierId: supplier.id,
          supplierEmail: supplier.primary_email ?? supplierEmail,
        }),
        listSupplierBidsForSupplier({
          supplierId: supplier.id,
          supplierEmail: supplier.primary_email ?? supplierEmail,
        }),
      ])
    : [
        { ok: true, data: [] } satisfies SupplierActivityResult<SupplierQuoteMatch[]>,
        { ok: true, data: [] } satisfies SupplierActivityResult<
          SupplierBidWithContext[]
        >,
      ];
  const matchesData = matchesResult.data ?? [];
  const bidsData = bidsResult.data ?? [];
  const matchQuoteIds = matchesData
    .map((match) => match.quoteId ?? match.quote?.id ?? null)
    .filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
  const bidAggregates =
    supplier && matchQuoteIds.length > 0
      ? await loadSupplierInboxBidAggregates(supplier.id, matchQuoteIds)
      : {};
  const supplierInboxRows = matchesData.reduce<SupplierInboxRow[]>(
    (acc, match) => {
      const quote = match.quote;
      const quoteId =
        typeof match.quoteId === "string" && match.quoteId.length > 0
          ? match.quoteId
          : quote?.id ?? null;
      if (!quote || !quoteId) {
        return acc;
      }
      const aggregate = bidAggregates[quoteId];
      const fileNames =
        (Array.isArray(quote.file_names) ? quote.file_names : null) ??
        (Array.isArray(quote.upload_file_names)
          ? quote.upload_file_names
          : null) ??
        [];
      const companyName =
        sanitizeDisplayName(quote.company) ??
        sanitizeDisplayName(quote.customer_name) ??
        "Customer";
      const fairnessReason = match.fairness?.reasons?.[0] ?? null;

      acc.push({
        id: quoteId,
        quoteId,
        companyName,
        processHint: match.processHint,
        materials: match.materialMatches,
        quantityHint: match.quantityHint ?? null,
        fileCount: fileNames.length,
        priceLabel: formatCurrency(quote.price, quote.currency),
        createdAt: match.createdAt ?? quote.created_at ?? null,
        status: normalizeQuoteStatus(quote.status),
        bidCount: aggregate?.bidCount ?? 0,
        lastBidAt: aggregate?.lastBidAt ?? null,
        hasWinningBid: aggregate?.hasWinningBid ?? false,
        fairnessReason: fairnessReason ?? null,
      });
      return acc;
    },
    [],
  );
  console.info("[supplier inbox] loaded", {
    supplierId: supplier?.id ?? null,
    totalQuotes: supplierInboxRows.length,
    withBids: supplierInboxRows.filter((row) => row.bidCount > 0).length,
  });
  const matchesUnavailable = supplierExists && !matchesResult.ok;
  const bidsUnavailable = supplierExists && !bidsResult.ok;
  const canLoadActivity =
    supplierExists && !isApprovalGateActive(approvalGate);
  const recentActivity: QuoteActivityEvent[] =
    canLoadActivity && supplier
      ? await loadRecentSupplierActivity(supplier.id)
      : [];
  console.log("[supplier dashboard] activity loaded", {
    supplierId: supplier?.id ?? null,
    eventCount: recentActivity.length,
    gateActive: isApprovalGateActive(approvalGate),
  });

  const signedInEmail = supplier?.primary_email ?? supplierEmail;
  const companyLabel =
    supplier?.company_name ?? supplier?.primary_email ?? supplierEmail;
  const workspaceCompanyName =
    sanitizeDisplayName(supplier?.company_name) ??
    sanitizeDisplayName(companyLabel) ??
    sessionCompanyName;
  const supplierMetrics = deriveSupplierMetrics(matchesData, bidsData);
  const lastUpdatedTimestamp = getLatestSupplierActivityTimestamp(
    matchesData,
    bidsData,
  );
  const lastUpdatedLabel = formatRelativeTimeFromTimestamp(lastUpdatedTimestamp);
  const hasActivity = matchesData.length > 0 || bidsData.length > 0;
  const systemStatusMessage = !supplier
    ? "Finish onboarding to unlock matches"
    : approvalsOn && !supplierApproved
      ? "Pending supplier review"
      : hasActivity
        ? "All systems operational"
        : "Waiting for your first match";

  console.info("[supplier dashboard] loaded", {
    userEmail: user.email ?? null,
    supplierId: supplier?.id ?? null,
    supplierEmail: supplier?.primary_email ?? supplierEmail ?? null,
    companyName: supplier?.company_name ?? null,
    hasProfile: Boolean(supplier),
    inboxRowCount: Array.isArray(supplierInboxRows) ? supplierInboxRows.length : null,
    activityEventCount: Array.isArray(recentActivity) ? recentActivity.length : null,
  });

  return (
    <div className="space-y-6">
      <WorkspaceWelcomeBanner
        role="supplier"
        companyName={workspaceCompanyName}
      />
      <SystemStatusBar
        role="supplier"
        statusMessage={systemStatusMessage}
        syncedLabel={lastUpdatedLabel}
      />
      <WorkspaceMetrics
        role="supplier"
        metrics={supplierMetrics}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-blue-300">
          Supplier workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-white">
          RFQs, bids, and compliance docs in one place
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          Review matched RFQs, submit bids, and keep your onboarding profile current without leaving
          this dashboard.
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
          <span>
            Signed in as{" "}
            <span className="font-semibold text-white">{companyLabel}</span>{" "}
            (<span className="font-mono text-slate-200">{signedInEmail}</span>)
          </span>
          <span>
            Every “View quote” link below carries your identity so we can confirm assignments
            automatically.
          </span>
        </div>
        {approvalsOn && supplierExists ? (
          supplierApproved ? (
            <span className="mt-4 inline-flex w-fit rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
              Status: Approved
            </span>
          ) : (
            <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">
              Your supplier profile is pending review. You can keep editing your profile; RFQs will
              start flowing in once you’re approved.
            </p>
          )
        ) : null}
        {onboardingJustCompleted ? (
          <p className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            Profile updated! We’ll start routing matched RFQs to you automatically.
          </p>
        ) : null}
      </section>

      <ProfileCard
        supplier={supplier}
        capabilities={capabilities}
        documents={documents}
        approvalsEnabled={approvalsOn}
        approvalStatus={approvalStatus}
      />
      {supplierProfileUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}

      <PortalCard
        title="Recent activity"
        description="Quick pulse on RFQs, bids, and status changes routed to your shop."
      >
        {isApprovalGateActive(approvalGate) ? (
          <EmptyStateNotice
            title={activityHoldCopy.title}
            description={activityHoldCopy.description}
          />
        ) : recentActivity.length > 0 ? (
          <ul className="space-y-3">
            {recentActivity.map((item) => {
              const inner = (
                <div className="flex flex-col gap-2 rounded-2xl border border-slate-900/70 bg-slate-950/50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <ActivityTypeBadge type={item.type} />
                    <p className="text-sm font-semibold text-white">{item.title}</p>
                    <p className="text-xs text-slate-400">{item.description}</p>
                  </div>
                  <p className="text-xs text-slate-500">
                    {formatActivityTimestamp(item.timestamp) ?? "Date pending"}
                  </p>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyStateNotice
            title={supplierExists ? "No activity yet" : "Activity unlocks after onboarding"}
            description={
              supplierExists
                ? "We’ll stream RFQ assignments and bid updates here as they happen."
                : "Finish onboarding to start tracking RFQs and bids in this feed."
            }
          />
        )}
      </PortalCard>

      <MatchesCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        supplierExists={supplierExists}
        rows={supplierInboxRows}
        approvalGate={matchesResult.approvalGate ?? approvalGate}
      />
      {matchesUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}

      <BidsCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        result={bidsResult}
        approvalGate={bidsResult.approvalGate ?? approvalGate}
      />
      {bidsUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}
      {DEBUG_PORTALS ? (
        <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-900 bg-black/40 p-4 text-xs text-slate-500">
          {JSON.stringify({ user, roles }, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function isApprovalGateActive(gate?: SupplierApprovalGate | null): boolean {
  return Boolean(gate?.enabled && gate.status !== "approved");
}

function getApprovalHoldCopy(status?: SupplierApprovalStatus) {
  if (status === "rejected") {
    return {
      title: "Account needs review",
      description: "Reach out to our team so we can revisit your approval status.",
    };
  }
  return {
    title: "RFQs unlock after approval",
    description: "RFQs and bids will appear here once your account is approved.",
  };
}

function ProfileCard({
  supplier,
  capabilities,
  documents,
  approvalsEnabled,
  approvalStatus,
}: {
  supplier: SupplierProfile["supplier"] | null;
  capabilities: SupplierProfile["capabilities"];
  documents: SupplierProfile["documents"];
  approvalsEnabled: boolean;
  approvalStatus: SupplierApprovalStatus;
}) {
  const hasProfile = Boolean(supplier);
  return (
    <PortalCard
      title="Supplier profile"
      description={
        hasProfile
          ? "Keep company details, capabilities, and compliance docs current so RFQ matches stay accurate."
          : "Complete onboarding so customers see verified company info."
      }
      action={
        <Link
          href="/supplier/onboarding"
          className={primaryCtaClasses}
        >
          {hasProfile ? "Edit profile" : "Start onboarding"}
        </Link>
      }
    >
      {hasProfile ? (
        <div className="space-y-4 text-sm text-slate-200">
          <div className="grid gap-3 md:grid-cols-2">
            <Detail label="Company" value={supplier?.company_name ?? "—"} />
            <Detail label="Primary email" value={supplier?.primary_email ?? "—"} />
            <Detail label="Phone" value={supplier?.phone ?? "—"} />
            <Detail label="Website" value={supplier?.website ?? "—"} />
            <Detail label="Country" value={supplier?.country ?? "—"} />
            <Detail
              label="Status"
              value={
                approvalsEnabled
                  ? approvalStatus === "approved"
                    ? (
                      <span className="text-emerald-200">Approved marketplace supplier</span>
                      )
                    : approvalStatus === "rejected"
                      ? (
                        <span className="text-red-200">Review required</span>
                        )
                      : (
                        <span className="text-amber-200">Pending review</span>
                        )
                  : supplier?.verified
                      ? (
                        <span className="text-emerald-200">Verified marketplace supplier</span>
                        )
                      : "Pending review"
              }
            />
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Capabilities
            </p>
            {capabilities.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {capabilities.map((capability) => (
                  <li
                    key={capability.id}
                    className="rounded-xl border border-slate-900/70 bg-black/20 px-3 py-2"
                  >
                    <p className="text-sm font-semibold text-white">
                      {capability.process}
                    </p>
                    <p className="text-xs text-slate-400">
                      Materials:{" "}
                      {(capability.materials ?? []).join(", ") || "Not provided"}
                    </p>
                    <p className="text-xs text-slate-400">
                      Certs:{" "}
                      {(capability.certifications ?? []).join(", ") || "Not provided"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                Add at least one capability so we know which processes to match.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Documents
            </p>
            {documents.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {documents.slice(0, 4).map((doc) => (
                  <li key={doc.id}>
                    <a
                      href={doc.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-blue-300 underline-offset-4 hover:underline"
                    >
                      {doc.doc_type ?? "Document"}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                No compliance documents uploaded yet.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-400">
          Complete the onboarding form so we can capture company info, capabilities, and compliance docs.
        </p>
      )}
    </PortalCard>
  );
}

function MatchesCard({
  supplierEmail: _supplierEmail,
  supplierExists,
  rows,
  approvalGate,
}: {
  supplierEmail: string;
  supplierExists: boolean;
  rows: SupplierInboxRow[];
  approvalGate?: SupplierApprovalGate | null;
}) {
  const matches = rows;
  if (isApprovalGateActive(approvalGate)) {
    const copy = getApprovalHoldCopy(approvalGate?.status);
    return (
      <PortalCard
        title="Inbound RFQs"
        description="RFQs that match your verified processes, certifications, and compliance documents."
      >
        <EmptyStateNotice title={copy.title} description={copy.description} />
      </PortalCard>
    );
  }
  return (
    <PortalCard
      title="Inbound RFQs"
      description={
        supplierExists
          ? "RFQs that match your verified processes, certifications, and compliance documents."
          : "Complete onboarding to start receiving filtered RFQs."
      }
    >
      {supplierExists && matches.length > 0 ? (
        <SupplierInboxTable rows={matches} />
      ) : supplierExists ? (
        <EmptyStateNotice
          title="No RFQs matched yet"
          description="We’re scanning your capabilities constantly. The first compatible RFQ drops here immediately."
        />
      ) : (
        <EmptyStateNotice
          title="Unlock RFQ matching"
          description="Share capabilities and certs to start routing RFQs straight into this list."
          action={
            <Link
              href="/supplier/onboarding"
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              Finish onboarding
            </Link>
          }
        />
      )}
    </PortalCard>
  );
}

function BidsCard({
  supplierEmail: _supplierEmail,
  result,
  approvalGate,
}: {
  supplierEmail: string;
  result: SupplierActivityResult<SupplierBidWithContext[]>;
  approvalGate?: SupplierApprovalGate | null;
}) {
  const bids = result.data ?? [];
  if (isApprovalGateActive(approvalGate)) {
    const copy = getApprovalHoldCopy(approvalGate?.status);
    return (
      <PortalCard
        title="Submitted bids"
        description="Track the quotes you’ve priced and see where each bid stands."
      >
        <EmptyStateNotice title={copy.title} description={copy.description} />
      </PortalCard>
    );
  }
  return (
    <PortalCard
      title="Submitted bids"
      description="Track the quotes you’ve priced and see where each bid stands."
    >
      {bids.length > 0 ? (
        <ul className="space-y-3">
          {bids.slice(0, 8).map((bid) => (
            <li
              key={bid.id}
              className="rounded-2xl border border-slate-900/70 bg-black/20 px-4 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">
                    Quote {bid.quote_id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatCurrency(bid.unit_price, bid.currency)} · Lead time{" "}
                    {bid.lead_time_days ?? "—"} days
                  </p>
                </div>
                <StatusBadge status={bid.status} />
              </div>
              <Link
                href={`/supplier/quotes/${bid.quote_id}`}
                className="mt-2 inline-flex text-xs font-semibold text-blue-300 underline-offset-4 hover:underline"
              >
                View workspace
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyStateNotice
          title="No bids submitted"
          description="No bids yet. Open a matched RFQ to send pricing—every submission lands here."
        />
      )}
    </PortalCard>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-900/70 bg-slate-950/40 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="text-sm text-slate-100">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    accepted: "bg-emerald-500/20 text-emerald-200 border-emerald-500/30",
    declined: "bg-red-500/10 text-red-200 border-red-500/30",
    withdrawn: "bg-slate-500/10 text-slate-200 border-slate-500/30",
    pending: "bg-blue-500/10 text-blue-200 border-blue-500/30",
  };
  const classes =
    colorMap[status] ?? "bg-slate-500/10 text-slate-200 border-slate-500/30";
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${classes}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ActivityTypeBadge({ type }: { type: QuoteActivityEvent["type"] }) {
  const labelMap: Record<QuoteActivityEvent["type"], string> = {
    rfq_submitted: "RFQ",
    status_changed: "Status",
    message_posted: "Message",
    bid_received: "Bid",
    winner_selected: "Winner",
  };
  const colorMap: Record<QuoteActivityEvent["type"], string> = {
    rfq_submitted: "bg-blue-500/10 text-blue-200 border-blue-500/30",
    status_changed: "bg-slate-500/10 text-slate-200 border-slate-500/30",
    message_posted: "bg-indigo-500/10 text-indigo-200 border-indigo-500/30",
    bid_received: "bg-sky-500/10 text-sky-200 border-sky-500/30",
    winner_selected: "bg-amber-500/10 text-amber-200 border-amber-500/30",
  };
  return (
    <span
      className={`mb-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${colorMap[type]}`}
    >
      {labelMap[type]}
    </span>
  );
}

function formatActivityTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return (
    formatDateTime(value, {
      includeTime: true,
    }) ?? null
  );
}

function formatCurrency(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const numericValue =
    typeof value === "string" ? Number(value) : value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
    return "Value pending";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `$${numericValue.toFixed(0)}`;
  }
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveSupplierMetrics(
  matches: SupplierQuoteMatch[],
  bids: SupplierBidWithContext[],
): WorkspaceMetric[] {
  const rfqsMatched = matches.length;
  const bidsSubmitted = bids.length;
  const bidsAccepted = bids.filter((bid) => bid.status === "accepted").length;

  return [
    {
      label: "RFQs matched",
      value: rfqsMatched,
      helper:
        rfqsMatched > 0
          ? "Capability-aligned RFQs waiting for review"
          : "We’ll auto-populate this once your profile attracts matches.",
    },
    {
      label: "Bids submitted",
      value: bidsSubmitted,
      helper:
        bidsSubmitted > 0
          ? "Tracked across every quote you’ve priced"
          : "Send your first bid from an RFQ match above.",
    },
    {
      label: "Bids accepted",
      value: bidsAccepted,
      helper:
        bidsAccepted > 0
          ? "Customers accepted these proposals"
          : "We’ll highlight wins to celebrate momentum.",
    },
  ];
}

function getLatestSupplierActivityTimestamp(
  matches: SupplierQuoteMatch[],
  bids: SupplierBidWithContext[],
): number | null {
  const timestamps: number[] = [];

  for (const match of matches) {
    const ts = toTimestamp(match.createdAt);
    if (typeof ts === "number") {
      timestamps.push(ts);
    }
  }

  for (const bid of bids) {
    const ts = toTimestamp(bid.updated_at ?? bid.created_at);
    if (typeof ts === "number") {
      timestamps.push(ts);
    }
  }

  if (timestamps.length === 0) {
    return null;
  }

  return Math.max(...timestamps);
}

type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof SupplierDashboardPage>;

export default SupplierDashboardPage as unknown as NextAppPage;
