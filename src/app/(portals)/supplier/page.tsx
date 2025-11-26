import type { ReactNode } from "react";
import Link from "next/link";
import { formatDateTime } from "@/lib/formatDate";
import { primaryCtaClasses } from "@/lib/ctas";
import PortalCard from "../PortalCard";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { WorkspaceMetrics, type WorkspaceMetric } from "../WorkspaceMetrics";
import { EmptyStateNotice } from "../EmptyStateNotice";
import {
  getSearchParamValue,
  normalizeEmailInput,
  type SearchParamsLike,
} from "@/app/(portals)/quotes/pageUtils";
import {
  listSupplierBidsForSupplier,
  loadSupplierProfile,
  matchQuotesToSupplier,
  type SupplierActivityResult,
  type SupplierBidWithContext,
  type SupplierQuoteMatch,
  type SupplierProfile,
} from "@/server/suppliers";
import { getCurrentSession } from "@/server/auth";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { SystemStatusBar } from "../SystemStatusBar";
import { loadSupplierActivityFeed } from "@/server/activity";
import type { ActivityItem } from "@/types/activity";
import { resolveUserRoles } from "@/server/users/roles";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { DEBUG_PORTALS } from "../debug";

export const dynamic = "force-dynamic";

type SupplierDashboardPageProps = {
  searchParams?: SearchParamsLike;
};

async function SupplierDashboardPage({
  searchParams,
}: SupplierDashboardPageProps) {
  const session = await getCurrentSession();
  const roles = session ? await resolveUserRoles(session.user.id) : null;
  if (!session) {
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
  console.log("[portal] user id", session.user.id);
  console.log("[portal] email", session.user.email);
  console.log("[portal] isSupplier", roles?.isSupplier);
  console.log("[portal] isCustomer", roles?.isCustomer);
  const sessionCompanyName =
    sanitizeDisplayName(session.user.user_metadata?.company) ??
    sanitizeDisplayName(session.user.user_metadata?.full_name) ??
    sanitizeDisplayName(session.user.email) ??
    "your team";
  const supplierEmail = normalizeEmailInput(session.user.email ?? null);
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
  const matchesUnavailable = supplierExists && !matchesResult.ok;
  const bidsUnavailable = supplierExists && !bidsResult.ok;
  const recentActivityResult: SupplierActivityResult<ActivityItem[]> = supplier
    ? await loadSupplierActivityFeed({
        supplierId: supplier.id,
        supplierEmail: supplier.primary_email ?? supplierEmail,
        limit: 10,
      })
    : { ok: true, data: [] };
  const recentActivity = recentActivityResult.data ?? [];

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
  const systemStatusMessage = supplier
    ? hasActivity
      ? "All systems operational"
      : "Waiting for your first match"
    : "Finish onboarding to unlock matches";

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
      />
      {supplierProfileUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}

      <PortalCard
        title="Recent activity"
        description="Quick pulse on RFQs, bids, and status changes routed to your shop."
      >
        {recentActivityResult.ok ? (
          recentActivity.length > 0 ? (
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
          )
        ) : (
          <DataFallbackNotice className="mt-2" />
        )}
      </PortalCard>

      <MatchesCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        supplierExists={supplierExists}
        result={matchesResult}
      />
      {matchesUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}

      <BidsCard
        supplierEmail={supplier?.primary_email ?? supplierEmail}
        result={bidsResult}
      />
      {bidsUnavailable ? (
        <DataFallbackNotice className="mt-2" />
      ) : null}
      {DEBUG_PORTALS ? (
        <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-900 bg-black/40 p-4 text-xs text-slate-500">
          {JSON.stringify({ session, roles }, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function ProfileCard({
  supplier,
  capabilities,
  documents,
}: {
  supplier: SupplierProfile["supplier"] | null;
  capabilities: SupplierProfile["capabilities"];
  documents: SupplierProfile["documents"];
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
                supplier?.verified ? (
                  <span className="text-emerald-200">Verified marketplace supplier</span>
                ) : (
                  "Pending review"
                )
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
  supplierEmail,
  supplierExists,
  result,
}: {
  supplierEmail: string;
  supplierExists: boolean;
  result: SupplierActivityResult<SupplierQuoteMatch[]>;
}) {
  const matches = result.data ?? [];
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
        <ul className="space-y-3">
          {matches.map((match) => {
            const quote = match.quote;
            const fileCount = (quote.file_names ?? quote.upload_file_names ?? []).length;
            const createdLabel = formatDateTime(match.createdAt, {
              includeTime: false,
            });
            const materialsText =
              match.materialMatches.length > 0
                ? `Materials: ${match.materialMatches.join(", ")}`
                : "Materials: —";
            const priceText =
              typeof quote.price === "number" || typeof quote.price === "string"
                ? formatCurrency(Number(quote.price), quote.currency)
                : "Value pending";
            const filesLabel =
              fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : "No files";
            const fairnessReason = match.fairness?.reasons?.[0] ?? null;
            return (
              <li key={quote.id}>
                <Link
                  href={`/supplier/quotes/${quote.id}`}
                  className="block rounded-2xl border border-slate-900/80 bg-slate-950/40 px-4 py-3 transition hover:border-blue-400/40 hover:bg-slate-900/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {quote.company ?? quote.customer_name ?? "Customer"}
                      </p>
                      <p className="text-xs text-slate-400">
                        {match.processHint ?? "Process TBD"} • {filesLabel} • {priceText}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-blue-200">
                      View quote &rarr;
                    </span>
                  </div>
                  <div className="mt-2 text-xs text-slate-500">
                    <p>{materialsText}</p>
                    <p>Created {createdLabel ?? "recently"}</p>
                    {fairnessReason ? (
                      <p className="text-[11px] text-blue-200/80">
                        Fairness boost: {fairnessReason}
                      </p>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
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
  supplierEmail,
  result,
}: {
  supplierEmail: string;
  result: SupplierActivityResult<SupplierBidWithContext[]>;
}) {
  const bids = result.data ?? [];
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

function ActivityTypeBadge({ type }: { type: ActivityItem["type"] }) {
  const labelMap: Record<ActivityItem["type"], string> = {
    quote: "Quote",
    bid: "Bid",
    status: "Status",
  };
  const colorMap: Record<ActivityItem["type"], string> = {
    quote: "bg-blue-500/10 text-blue-200 border-blue-500/30",
    bid: "bg-sky-500/10 text-sky-200 border-sky-500/30",
    status: "bg-slate-500/10 text-slate-200 border-slate-500/30",
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
