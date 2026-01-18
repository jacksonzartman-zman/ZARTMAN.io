import Link from "next/link";
import clsx from "clsx";
import PortalCard from "../PortalCard";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  type QuoteStatus,
  normalizeQuoteStatus,
  isOpenQuoteStatus,
} from "@/server/quotes/status";
import { primaryCtaClasses } from "@/lib/ctas";
import { SHOW_LEGACY_QUOTE_ENTRYPOINTS } from "@/lib/ui/deprecation";
import {
  getFirstParamValue,
  normalizeEmailInput,
} from "@/app/(portals)/quotes/pageUtils";
import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerById, getCustomerByUserId } from "@/server/customers";
import { CompleteCustomerProfileCard } from "./CompleteCustomerProfileCard";
import type { WorkspaceMetric } from "../WorkspaceMetrics";
import { EmptyStateNotice } from "../EmptyStateNotice";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { SystemStatusBar } from "../SystemStatusBar";
import { PortalShell } from "../components/PortalShell";
import { PortalStatPills } from "../components/PortalStatPills";
import { QuoteStatusBadge } from "../components/QuoteStatusBadge";
import { loadRecentCustomerActivity } from "@/server/customers/activity";
import { loadCustomerOnboardingState } from "@/server/customer/onboarding";
import { refreshNotificationsForUser } from "@/server/notifications";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
  type SupplierQuoteRow,
} from "@/server/suppliers/types";
import type { QuoteActivityEvent } from "@/types/activity";
import {
  getCustomerDecisions,
  type CustomerDecision,
} from "@/server/marketplace/decisions";
import { resolveUserRoles } from "@/server/users/roles";
import { DataFallbackNotice } from "../DataFallbackNotice";
import { DEBUG_PORTALS } from "../debug";

export const dynamic = "force-dynamic";

const QUOTE_LIMIT = 20;
const RECENT_ACTIVITY_LIMIT = 10;
const IN_PROGRESS_STATUSES: QuoteStatus[] = ["in_review", "quoted", "approved"];
const COMPLETED_STATUSES: QuoteStatus[] = ["won", "lost", "cancelled"];
const QUOTE_FIELDS = SAFE_QUOTE_WITH_UPLOADS_FIELDS;

const TARGET_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const ACTIVITY_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type CustomerPageSearchParams = {
  [key: string]: string | string[] | undefined;
};

type CustomerPageProps = {
  searchParams?: CustomerPageSearchParams;
};

type RawQuoteRecord = Pick<SupplierQuoteRow, SafeQuoteWithUploadsField>;

type PortalQuote = {
  id: string;
  status: QuoteStatus;
  createdAt: string | null;
  updatedAt: string | null;
  targetDate: string | null;
  price: number | string | null;
  currency: string | null;
  fileName: string | null;
  customerEmail: string | null;
  customerName: string | null;
  company: string | null;
  uploadId: string | null;
};

type CustomerPortalData = {
  quotes: PortalQuote[];
  error?: string;
  domainFallbackUsed: boolean;
};

type LoadCustomerPortalDataArgs =
  | {
      customerId: string;
    }
  | {
      email: string;
      domain?: string | null;
    };

async function CustomerDashboardPage({
  searchParams,
}: CustomerPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer");
  const roles = await resolveUserRoles(user.id);
  void refreshNotificationsForUser(user.id, "customer").catch((error) => {
    console.error("[notifications] refresh failed (customer)", { userId: user.id, error });
  });
  console.log("[portal] user id", user.id);
  console.log("[portal] email", user.email);
  console.log("[portal] isSupplier", roles?.isSupplier);
  console.log("[portal] isCustomer", roles?.isCustomer);
  const sessionCompanyName =
    sanitizeDisplayName(user.user_metadata?.company) ??
    sanitizeDisplayName(user.user_metadata?.full_name) ??
    sanitizeDisplayName(user.email) ??
    "your team";
  const overrideParam = getFirstParamValue(searchParams?.email);
  const overrideEmail = normalizeEmailInput(overrideParam);
  const customer = await getCustomerByUserId(user.id);
  let decisions: CustomerDecision[] = [];
  let hasDecisions = false;

  if (customer) {
    decisions = await getCustomerDecisions(customer.id);
    hasDecisions = decisions.length > 0;
  }

  if (!customer) {
    const heroContent = (
      <WorkspaceWelcomeBanner
        role="customer"
        companyName={sessionCompanyName}
      />
    );

    return (
      <PortalShell
        workspace="customer"
        title="Dashboard"
        subtitle="Upload RFQs, track bids, and keep supplier moves organized."
        headerContent={heroContent}
        actions={
          SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
            <Link
              href="/quote"
              className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
            >
              Start a new RFQ
            </Link>
          ) : null
        }
      >
        <CompleteCustomerProfileCard
          sessionEmail={user.email ?? null}
          defaultCompanyName={
            user.user_metadata?.company ??
            user.user_metadata?.full_name ??
            null
          }
        />
        <CustomerPortalDemoCard />
        <DataFallbackNotice className="mt-2" />
        {DEBUG_PORTALS ? (
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-900 bg-black/40 p-4 text-xs text-slate-500">
            {JSON.stringify({ user, roles }, null, 2)}
          </pre>
        ) : null}
      </PortalShell>
    );
  }

  const customerEmail = normalizeEmailInput(customer.email);
  const sessionEmail = normalizeEmailInput(user.email ?? null);
  const usingOverride =
    Boolean(overrideEmail) && overrideEmail !== customerEmail;
  const viewerEmail = usingOverride ? overrideEmail : customerEmail ?? sessionEmail;

  if (usingOverride && !viewerEmail) {
    return (
      <PortalShell
        workspace="customer"
        title="Dashboard"
        subtitle="Upload RFQs, track bids, and keep supplier moves organized."
        headerContent={
          <WorkspaceWelcomeBanner
            role="customer"
            companyName={sessionCompanyName}
          />
        }
        actions={
          SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
            <Link
              href="/quote"
              className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
            >
              Start a new RFQ
            </Link>
          ) : null
        }
      >
        <section className="rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
          <h2 className="text-xl font-semibold text-white">Invalid override</h2>
          <p className="mt-2 text-sm text-slate-400">
            Add ?email=you@company.com with a valid address to preview another account.
          </p>
        </section>
      </PortalShell>
    );
  }

  const portalData = usingOverride
    ? await loadCustomerPortalData({
        email: viewerEmail!,
        domain: getEmailDomain(viewerEmail) ?? getEmailDomain(overrideParam),
      })
    : await loadCustomerPortalData({
        customerId: customer.id,
      });
  const customerWebsite =
    typeof customer.website === "string" && customer.website.trim().length > 0
      ? customer.website.trim()
      : "";
  console.log("[customer workspace] quotes loaded", {
    userId: user.id,
    customerId: usingOverride ? null : customer.id,
    viewerEmail: viewerEmail ?? user.email ?? null,
    quoteCount: portalData.quotes.length,
    domainFallbackUsed: portalData.domainFallbackUsed,
    error: portalData.error ?? null,
  });

  const openQuotes = portalData.quotes.filter((quote) =>
    isOpenQuoteStatus(quote.status),
  );
  const hasAnyQuotes = portalData.quotes.length > 0;
  const viewerDisplayEmail = viewerEmail ?? "customer";
  const quoteLinkQuery =
    usingOverride && viewerEmail
      ? `?email=${encodeURIComponent(viewerEmail)}`
      : "";
  const viewerDomain = getEmailDomain(viewerDisplayEmail);
  const rawActivity = await loadRecentCustomerActivity(customer.id, {
    emailOverride: usingOverride ? viewerEmail ?? null : null,
  });
  const recentActivity: QuoteActivityEvent[] = rawActivity.map((item) => ({
    ...item,
    href:
      item.href && quoteLinkQuery
        ? `${item.href}${quoteLinkQuery}`
        : item.href,
  }));
  console.log("[customer dashboard] activity loaded", {
    customerId: customer.id,
    eventCount: recentActivity.length,
    override: usingOverride,
  });
  const customerMetrics = deriveCustomerMetrics(portalData.quotes);
  const lastUpdatedTimestamp = getLatestCustomerActivityTimestamp(portalData.quotes);
  const lastUpdatedLabel = formatRelativeTimeFromTimestamp(lastUpdatedTimestamp);
  const systemStatusMessage = portalData.error
    ? "Sync delayed"
    : hasAnyQuotes
      ? "All systems operational"
      : "Standing by for your first upload";

  const onboardingState = await loadCustomerOnboardingState({
    userId: usingOverride ? null : user.id,
    email: viewerEmail ?? user.email ?? null,
  });
  const showFirstRfqCard =
    !onboardingState.hasAnyQuotes && !onboardingState.hasAnyProjects;

  console.info("[customer dashboard] loaded (post-website-fix)", {
    userEmail: user.email ?? null,
    customerId: customer?.id ?? null,
    customerEmail: customer?.email ?? null,
    companyName: customer?.company_name ?? null,
    customerWebsite: customerWebsite || null,
    hasProfile: Boolean(customer),
    activityEventCount: Array.isArray(recentActivity) ? recentActivity.length : null,
    quoteCount: Array.isArray(portalData.quotes) ? portalData.quotes.length : null,
  });

  const headerContent = (
    <div className="space-y-4">
      <WorkspaceWelcomeBanner
        role="customer"
        companyName={
          sanitizeDisplayName(customer.company_name) ??
          viewerDisplayEmail ??
          sessionCompanyName
        }
      />
      <SystemStatusBar
        role="customer"
        statusMessage={systemStatusMessage}
        syncedLabel={lastUpdatedLabel}
      />
    </div>
  );

  const headerActions = SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
    <Link
      href="/quote"
      className="inline-flex items-center rounded-full border border-emerald-400/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
    >
      Start a new RFQ
    </Link>
  ) : null;

  return (
    <PortalShell
      workspace="customer"
      title="Dashboard"
      subtitle="Upload RFQs, track bids, and keep supplier moves organized."
      headerContent={headerContent}
      actions={headerActions}
    >
      {showFirstRfqCard ? (
        <PortalCard
          title="Start your first RFQ"
          description="Upload your CAD or a ZIP, tell us what you need, and we’ll route it to the right suppliers."
          action={
            SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
              <Link href="/quote" className={primaryCtaClasses}>
                Create an RFQ
              </Link>
            ) : null
          }
        >
          <ul className="list-disc space-y-2 pl-5 text-sm text-slate-300">
            <li>Bundle multiple parts into a single ZIP so we can keep them organized.</li>
            <li>Include technical drawings (PDF/DWG/DXF) for manufacturing clarity.</li>
          </ul>
        </PortalCard>
      ) : null}
      <PortalStatPills
        role="customer"
        metrics={customerMetrics}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <PortalCard
        title="Open RFQs"
        description={
          hasAnyQuotes
            ? "Active RFQs routed through Zartman for your team."
            : "We’ll surface live RFQs here as soon as they exist."
        }
      >
        {openQuotes.length > 0 ? (
          <ul className="space-y-3">
            {openQuotes.map((quote) => (
              <li
                key={quote.id}
                className="rounded-xl border border-slate-900/70 bg-slate-900/30 px-0 py-0"
              >
                <Link
                  href={
                    quoteLinkQuery
                      ? `/customer/quotes/${quote.id}${quoteLinkQuery}`
                      : `/customer/quotes/${quote.id}`
                  }
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-6 py-4 transition hover:bg-slate-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                >
                  <div>
                    <p className="font-medium text-white">{getQuoteTitle(quote)}</p>
                    <p className="text-xs text-slate-400">{getQuoteSummary(quote)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    <QuoteStatusBadge status={quote.status} />
                    <p className="text-xs text-slate-400">
                      {formatTargetDate(quote.targetDate) ?? "Target TBD"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyStateNotice
            title="No open RFQs yet"
            description={`Waiting for the first upload from ${viewerDisplayEmail}. Fresh RFQs drop here as soon as they sync.`}
            action={
              SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
                <Link
                  href="/quote"
                  className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
                >
                  Submit a new RFQ
                </Link>
              ) : null
            }
          />
        )}
        {portalData.error ? <DataFallbackNotice className="mt-4" /> : null}
      </PortalCard>

      <PortalCard
        title="Recent activity"
        description="Latest RFQ, bid, and status updates routed through this workspace."
      >
        {recentActivity.length > 0 ? (
          <ul className="space-y-3">
            {recentActivity.map((item) => {
              const inner = (
                <div className="flex flex-col gap-2 rounded-xl border border-slate-900/60 bg-slate-900/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <ActivityTypeBadge type={item.type} />
                    <p className="font-medium text-white">{item.title}</p>
                    <p className="text-xs text-slate-400">{item.description}</p>
                  </div>
                  <div className="flex flex-col items-start gap-1 text-left sm:items-end sm:text-right">
                    <p className="text-xs text-slate-500">
                      {formatActivityDate(item.timestamp) ?? "Date pending"}
                    </p>
                  </div>
                </div>
              );
              return (
                <li key={item.id}>
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
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
            title="No activity to show"
            description="No activity yet. We’ll stream quote updates here the moment anything moves."
          />
        )}
      </PortalCard>

      <PortalCard
        title="Decisions needed"
        description="Quick calls that keep bids and builds moving."
      >
        {hasDecisions ? (
          <ul className="space-y-3">
            {decisions.map((decision) => (
              <li
                key={decision.id}
                className="rounded-xl border border-slate-900/70 bg-slate-900/30 p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="font-medium text-white">{decision.title}</p>
                    <p className="text-xs text-slate-400">{decision.description}</p>
                  </div>
                  <UrgencyBadge level={decision.urgencyLevel} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
            Nothing needs a decision right now. We’ll surface supplier-ready moves here the moment they exist.
          </div>
        )}
      </PortalCard>

      {!showFirstRfqCard ? (
        <PortalCard
          title="Next steps"
          description="Keep momentum with a lightweight checklist."
          action={
            SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
              <Link href="/quote" className={primaryCtaClasses}>
                Submit a new RFQ
              </Link>
            ) : null
          }
        >
          <ul className="list-disc space-y-2 pl-5 text-slate-300">
            <li>Share this link with teammates — the portal is read-only today.</li>
            <li>
              {openQuotes.length > 0
                ? `Track ${openQuotes.length} open quote${openQuotes.length === 1 ? "" : "s"} to keep reviews moving.`
                : "Watch for new quotes here as soon as uploads are processed."}
            </li>
            <li>Uploads from /quote will sync back into this workspace automatically.</li>
          </ul>
        </PortalCard>
      ) : null}

      <PortalCard
        title="Workspace scope"
        description={
          usingOverride
            ? "You’re previewing another teammate’s workspace in read-only mode."
            : "Identity and sync details for this account."
        }
      >
        {usingOverride ? (
          <>
            <p>
              Showing read-only activity for{" "}
              <span className="font-semibold text-white">{viewerDisplayEmail}</span>.
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Remove ?email from the URL to switch back to your own workspace.
            </p>
          </>
        ) : (
          <>
            <p>
              Signed in as{" "}
              <span className="font-semibold text-white">
                {customer.company_name ?? viewerDisplayEmail}
              </span>
              .
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Uploads from your account automatically sync back into this dashboard.
            </p>
            {customerWebsite ? (
              <p className="mt-2 text-xs text-slate-500">
                Website: <span className="font-mono text-slate-300">{customerWebsite}</span>
              </p>
            ) : null}
          </>
        )}
        {portalData.domainFallbackUsed && viewerDomain ? (
          <p className="mt-2 text-xs text-slate-500">
            No direct matches found, so we’re showing other contacts at @{viewerDomain}.
          </p>
        ) : null}
      </PortalCard>

      {portalData.error ? (
        <PortalCard
          title="Live RFQ data"
          description="We ran into a temporary issue while loading Supabase data."
        >
          <p className="text-sm text-red-200">{portalData.error}</p>
        </PortalCard>
      ) : null}

      {DEBUG_PORTALS ? (
        <pre className="mt-4 overflow-x-auto rounded-2xl border border-slate-900 bg-black/40 p-4 text-xs text-slate-500">
          {JSON.stringify({ user, roles }, null, 2)}
        </pre>
      ) : null}
    </PortalShell>
  );
}

function getEmailDomain(value?: string | null): string | null {
  if (!value || !value.includes("@")) {
    return null;
  }
  const [, domain] = value.split("@");
  return domain?.length ? domain : null;
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loadCustomerPortalData(
  args: LoadCustomerPortalDataArgs,
): Promise<CustomerPortalData> {
  if ("customerId" in args) {
    return selectQuotesByCustomerId(args.customerId);
  }

  return loadCustomerPortalDataByEmail(args.email, args.domain ?? null);
}

async function loadCustomerPortalDataByEmail(
  email: string,
  domain: string | null,
): Promise<CustomerPortalData> {
  const errors: string[] = [];

  const emailResponse = await selectQuotesByPattern(email);
  if (emailResponse.error) {
    logCustomerPortalQueryFailure("quotes-by-email", emailResponse.error, {
      pattern: email,
    });
    errors.push("email");
  }

  const emailRecords = isRawQuoteRecordArray(emailResponse.data)
    ? emailResponse.data
    : [];
  let quotes = mapQuoteRecords(emailRecords);
  let domainFallbackUsed = false;

  if (quotes.length === 0 && domain) {
    const domainResponse = await selectQuotesByPattern(`%@${domain}`);
    if (domainResponse.error) {
      logCustomerPortalQueryFailure("quotes-by-domain", domainResponse.error, {
        pattern: `%@${domain}`,
      });
      errors.push("domain");
    }

    const domainRecords = isRawQuoteRecordArray(domainResponse.data)
      ? domainResponse.data
      : [];
    const domainQuotes = mapQuoteRecords(domainRecords);
    if (domainQuotes.length > 0) {
      quotes = domainQuotes;
      domainFallbackUsed = true;
    }
  }

  return {
    quotes,
    domainFallbackUsed,
    error:
      errors.length > 0
        ? "We had trouble loading every data point. Refresh to try again."
        : undefined,
  };
}

function logCustomerPortalQueryFailure(
  scope: string,
  error: unknown,
  context: Record<string, unknown>,
) {
  console.error("[customer portal] query failed", {
    scope,
    ...context,
    error:
      error instanceof Error
        ? {
            message: error.message,
            stack: error.stack,
          }
        : error,
  });
}

async function selectQuotesByCustomerId(
  customerId: string,
): Promise<CustomerPortalData> {
  if (!customerId) {
    return { quotes: [], domainFallbackUsed: false };
  }

  const customer = await getCustomerById(customerId);
  if (!customer) {
    console.warn("selectQuotesByCustomerId: customer not found", { customerId });
    return { quotes: [], domainFallbackUsed: false, error: "Unable to load quotes." };
  }

  const normalizedEmail = normalizeEmailInput(customer.email);
  if (!normalizedEmail) {
    console.warn("selectQuotesByCustomerId: customer missing email", {
      customerId,
    });
    return { quotes: [], domainFallbackUsed: false, error: "Unable to load quotes." };
  }

  console.log("selectQuotesByCustomerId: resolving via email", {
    customerId,
    email: normalizedEmail,
  });

  try {
    return await loadCustomerPortalDataByEmail(
      normalizedEmail,
      getEmailDomain(normalizedEmail),
    );
  } catch (error) {
    console.error("selectQuotesByCustomerId: query failed", {
      customerId,
      email: normalizedEmail,
      error,
    });
    return { quotes: [], domainFallbackUsed: false, error: "Unable to load quotes." };
  }
}

function selectQuotesByPattern(pattern: string) {
  return supabaseServer
    .from("quotes_with_uploads")
    .select(QUOTE_FIELDS.join(","))
    .ilike("customer_email", pattern)
    .order("created_at", { ascending: false })
    .limit(QUOTE_LIMIT);
}

function isRawQuoteRecordArray(value: unknown): value is RawQuoteRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    return false;
  }

  const [first] = value;
  return typeof first === "object" && first !== null && "status" in first;
}

function mapQuoteRecords(records: RawQuoteRecord[]): PortalQuote[] {
  return records.map((record) => ({
    id: record.id,
    status: normalizeQuoteStatus(record.status),
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
    targetDate: record.target_date ?? null,
    price: record.price ?? null,
    currency: record.currency ?? null,
    fileName: record.file_name ?? null,
    customerEmail: record.customer_email ?? null,
    customerName: record.customer_name ?? null,
    company: record.company ?? null,
    uploadId: record.upload_id ?? null,
  }));
}

function formatTargetDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return TARGET_DATE_FORMATTER.format(new Date(timestamp));
}

function formatActivityDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return ACTIVITY_DATE_FORMATTER.format(new Date(timestamp));
}

function getQuoteTitle(quote: PortalQuote): string {
  if (quote.fileName) {
    return quote.fileName;
  }
  return `Quote ${formatQuoteId(quote.id)}`;
}

function getQuoteSummary(quote: PortalQuote): string {
  if (quote.company) {
    return quote.company;
  }

  if (quote.customerEmail) {
    return quote.customerEmail;
  }

  return "Awaiting company details";
}

function formatQuoteId(id: string): string {
  if (!id) {
    return "—";
  }

  return id.startsWith("Q-") ? id : `#${id.slice(0, 6)}`;
}

function deriveCustomerMetrics(quotes: PortalQuote[]): WorkspaceMetric[] {
  const submitted = quotes.length;
  const inProgress = quotes.filter((quote) =>
    IN_PROGRESS_STATUSES.includes(quote.status),
  ).length;
  const completed = quotes.filter((quote) =>
    COMPLETED_STATUSES.includes(quote.status),
  ).length;

  return [
    {
      label: "Quotes submitted",
      value: submitted,
      helper:
        submitted > 0
          ? `${submitted} file${submitted === 1 ? "" : "s"} synced from /quote`
          : "Upload parts from /quote to populate this workspace.",
    },
    {
      label: "Quotes in progress",
      value: inProgress,
      helper:
        inProgress > 0
          ? "In review or quoted by Zartman"
          : "We’ll highlight live reviews here.",
    },
    {
      label: "Quotes completed",
      value: completed,
      helper:
        completed > 0
          ? "Approved and ready to move forward"
          : "Completed quotes will land once approvals happen.",
    },
  ];
}

function getLatestCustomerActivityTimestamp(quotes: PortalQuote[]): number | null {
  return quotes.reduce<number | null>((latest, quote) => {
    const created = toTimestamp(quote.createdAt);
    if (created && (!latest || created > latest)) {
      return created;
    }
    return latest;
  }, null);
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
    rfq_submitted: "pill-success",
    status_changed: "pill-muted",
    message_posted: "pill-info",
    bid_received: "pill-info",
    winner_selected: "pill-warning",
  };
  return (
    <span className={clsx("pill mb-1 px-2 py-0.5 text-[10px]", colorMap[type])}>
      {labelMap[type]}
    </span>
  );
}

function UrgencyBadge({
  level,
}: {
  level: CustomerDecision["urgencyLevel"];
}) {
  const palette: Record<CustomerDecision["urgencyLevel"], string> = {
    high: "pill-warning",
    medium: "pill-info",
    low: "pill-muted",
  };
  const labelMap: Record<CustomerDecision["urgencyLevel"], string> = {
    high: "High urgency",
    medium: "Needs attention",
    low: "Low pressure",
  };
  return (
    <span className={clsx("pill px-3 py-1 text-[11px]", palette[level])}>
      {labelMap[level]}
    </span>
  );
}

function CustomerPortalDemoCard() {
  return (
    <PortalCard
      title="Customer portal demo"
        description="Signed-in teammates can append ?email=you@company.com to preview other accounts for demos."
      action={
        SHOW_LEGACY_QUOTE_ENTRYPOINTS ? (
          <Link
            href="/quote"
            className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
          >
            Go to /quote
          </Link>
        ) : null
      }
    >
      <p className="text-sm text-slate-300">
          Example:{" "}
          <code className="text-white">/customer?email=you@company.com</code>
          {" — "}remove the query string to go back to your own workspace.
      </p>
    </PortalCard>
  );
}


type NextAppPage = (props: {
  params?: Promise<Record<string, unknown>>;
  searchParams?: Promise<any>;
}) => ReturnType<typeof CustomerDashboardPage>;

export default CustomerDashboardPage as unknown as NextAppPage;
