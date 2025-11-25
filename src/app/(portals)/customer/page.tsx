import Link from "next/link";
import PortalCard from "../PortalCard";
import { WorkspaceWelcomeBanner } from "../WorkspaceWelcomeBanner";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  normalizeUploadStatus,
  UPLOAD_STATUS_LABELS,
  type UploadStatus,
} from "@/app/admin/constants";
import { primaryCtaClasses } from "@/lib/ctas";
import {
  getFirstParamValue,
  normalizeEmailInput,
} from "@/app/(portals)/quotes/pageUtils";
import { requireSession } from "@/server/auth";
import { getCustomerByUserId } from "@/server/customers";
import { CompleteCustomerProfileCard } from "./CompleteCustomerProfileCard";
import { WorkspaceMetrics, type WorkspaceMetric } from "../WorkspaceMetrics";
import { EmptyStateNotice } from "../EmptyStateNotice";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { SystemStatusBar } from "../SystemStatusBar";
import { loadCustomerActivityFeed } from "@/server/activity";
import type { ActivityItem } from "@/types/activity";
import {
  getCustomerDecisions,
  type CustomerDecision,
} from "@/server/marketplace/decisions";

export const dynamic = "force-dynamic";

const QUOTE_LIMIT = 20;
const RECENT_ACTIVITY_LIMIT = 10;
const OPEN_STATUSES: UploadStatus[] = ["submitted", "in_review", "quoted"];
const IN_PROGRESS_STATUSES: UploadStatus[] = ["in_review", "quoted"];
const COMPLETED_STATUSES: UploadStatus[] = ["approved"];

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

type RawQuoteRecord = {
  id: string;
  status: string | null;
  created_at: string | null;
  target_date: string | null;
  price: number | string | null;
  currency: string | null;
  file_name: string | null;
  email: string | null;
  company: string | null;
  customer_id: string | null;
};

type PortalQuote = {
  id: string;
  status: UploadStatus;
  createdAt: string | null;
  targetDate: string | null;
  price: number | string | null;
  currency: string | null;
  fileName: string | null;
  customerEmail: string | null;
  company: string | null;
  customerId: string | null;
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
  const session = await requireSession({ redirectTo: "/customer" });
  const sessionCompanyName =
    sanitizeDisplayName(session.user.user_metadata?.company) ??
    sanitizeDisplayName(session.user.user_metadata?.full_name) ??
    sanitizeDisplayName(session.user.email) ??
    "your team";
  const overrideParam = getFirstParamValue(searchParams?.email);
  const overrideEmail = normalizeEmailInput(overrideParam);
  const customer = await getCustomerByUserId(session.user.id);
  let decisions: CustomerDecision[] = [];
  let hasDecisions = false;

  if (customer) {
    decisions = await getCustomerDecisions(customer.id);
    hasDecisions = decisions.length > 0;
  }

  if (!customer) {
    return (
      <div className="space-y-6">
        <WorkspaceWelcomeBanner
          role="customer"
          companyName={sessionCompanyName}
        />
        <CompleteCustomerProfileCard
          sessionEmail={session.user.email ?? null}
          defaultCompanyName={
            session.user.user_metadata?.company ??
            session.user.user_metadata?.full_name ??
            null
          }
        />
        <CustomerPortalDemoCard />
      </div>
    );
  }

  const customerEmail = normalizeEmailInput(customer.email);
  const sessionEmail = normalizeEmailInput(session.user.email ?? null);
  const usingOverride =
    Boolean(overrideEmail) && overrideEmail !== customerEmail;
  const viewerEmail = usingOverride ? overrideEmail : customerEmail ?? sessionEmail;

  if (usingOverride && !viewerEmail) {
    return (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/60 p-6">
        <h2 className="text-xl font-semibold text-white">Invalid override</h2>
        <p className="mt-2 text-sm text-slate-400">
          Add ?email=you@company.com with a valid address to preview another account.
        </p>
      </section>
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

  const openQuotes = portalData.quotes.filter((quote) =>
    OPEN_STATUSES.includes(quote.status),
  );
  const hasAnyQuotes = portalData.quotes.length > 0;
  const viewerDisplayEmail = viewerEmail ?? "customer";
  const quoteLinkQuery =
    usingOverride && viewerEmail
      ? `?email=${encodeURIComponent(viewerEmail)}`
      : "";
  const viewerDomain = getEmailDomain(viewerDisplayEmail);
  const activityFeed = await loadCustomerActivityFeed({
    customerId: usingOverride ? null : customer.id,
    email: viewerEmail ?? sessionEmail,
    domain: viewerDomain,
    limit: RECENT_ACTIVITY_LIMIT,
  });
  const recentActivity: ActivityItem[] = activityFeed.map((item) => ({
    ...item,
    href:
      item.href && quoteLinkQuery
        ? `${item.href}${quoteLinkQuery}`
        : item.href,
  }));
  const customerMetrics = deriveCustomerMetrics(portalData.quotes);
  const lastUpdatedTimestamp = getLatestCustomerActivityTimestamp(portalData.quotes);
  const lastUpdatedLabel = formatRelativeTimeFromTimestamp(lastUpdatedTimestamp);
  const systemStatusMessage = portalData.error
    ? "Sync delayed"
    : hasAnyQuotes
      ? "All systems operational"
      : "Standing by for your first upload";

  return (
    <div className="space-y-6">
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
      <WorkspaceMetrics
        role="customer"
        metrics={customerMetrics}
        lastUpdatedLabel={lastUpdatedLabel}
      />
      <PortalCard
        title="Decisions Needed"
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
            Nothing needs a decision right now. We’ll surface supplier-ready moves
            here the moment they exist.
          </div>
        )}
      </PortalCard>
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-sm text-slate-300">
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
            </>
          )}
          {portalData.domainFallbackUsed && viewerDomain ? (
            <p className="mt-2 text-xs text-slate-500">
              No direct matches found, so we’re showing other contacts at @{viewerDomain}.
            </p>
          ) : null}
      </section>

      {portalData.error ? (
        <PortalCard
          title="Live RFQ data"
          description="We ran into a temporary issue while loading Supabase data."
        >
          <p className="text-sm text-red-200">{portalData.error}</p>
        </PortalCard>
      ) : null}

      <PortalCard
        title="Open quotes"
        description={
          hasAnyQuotes
            ? "Quotes that are actively moving forward for your team."
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
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 transition hover:bg-slate-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400"
                  >
                    <div>
                      <p className="font-medium text-white">{getQuoteTitle(quote)}</p>
                      <p className="text-xs text-slate-400">{getQuoteSummary(quote)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-right">
                      <StatusBadge status={quote.status} />
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
            title="No open quotes yet"
            description={`Waiting for the first upload from ${viewerDisplayEmail}. Fresh RFQs drop here as soon as they sync.`}
            action={
              <Link
                href="/quote"
                className="text-sm font-semibold text-emerald-300 underline-offset-4 hover:underline"
              >
                Submit a new RFQ
              </Link>
            }
          />
        )}
      </PortalCard>

      <PortalCard title="Recent activity" description="Latest RFQ, bid, and status updates.">
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
        title="Next steps"
        description="Keep momentum with a lightweight checklist."
        action={
          <Link href="/quote" className={primaryCtaClasses}>
            Submit a new RFQ
          </Link>
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
    </div>
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
    console.error("Failed to load customer quotes by email", emailResponse.error);
    errors.push("email");
  }

  let quotes = mapQuoteRecords(emailResponse.data ?? []);
  let domainFallbackUsed = false;

  if (quotes.length === 0 && domain) {
    const domainResponse = await selectQuotesByPattern(`%@${domain}`);
    if (domainResponse.error) {
      console.error(
        "Failed to load customer quotes by domain",
        domainResponse.error,
      );
      errors.push("domain");
    }

    const domainQuotes = mapQuoteRecords(domainResponse.data ?? []);
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

async function selectQuotesByCustomerId(
  customerId: string,
): Promise<CustomerPortalData> {
  const { data, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select(
      `
        id,
        status,
        created_at,
        target_date,
        price,
        currency,
        file_name,
        email,
        company,
        customer_id
      `,
    )
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(QUOTE_LIMIT);

  if (error) {
    console.error("selectQuotesByCustomerId: query failed", {
      customerId,
      error,
    });
    return { quotes: [], domainFallbackUsed: false, error: "Unable to load quotes." };
  }

  return {
    quotes: mapQuoteRecords((data as RawQuoteRecord[]) ?? []),
    domainFallbackUsed: false,
  };
}

function selectQuotesByPattern(pattern: string) {
  return supabaseServer
    .from("quotes_with_uploads")
    .select(
      `
        id,
        status,
        created_at,
        target_date,
        price,
        currency,
        file_name,
        email,
        company,
        customer_id
      `,
    )
    .ilike("email", pattern)
    .order("created_at", { ascending: false })
    .limit(QUOTE_LIMIT);
}

function mapQuoteRecords(records: RawQuoteRecord[]): PortalQuote[] {
  return records.map((record) => ({
    id: record.id,
    status: normalizeUploadStatus(record.status),
    createdAt: record.created_at ?? null,
    targetDate: record.target_date ?? null,
    price: record.price ?? null,
    currency: record.currency ?? null,
    fileName: record.file_name ?? null,
    customerEmail: record.email ?? null,
    company: record.company ?? null,
    customerId: record.customer_id ?? null,
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

function StatusBadge({
  status,
  size = "md",
}: {
  status: UploadStatus;
  size?: "md" | "sm";
}) {
  const sizeClasses =
    size === "sm"
      ? "px-2 py-0.5 text-[11px]"
      : "px-3 py-1 text-xs";

  return (
    <span className={`inline-flex items-center rounded-full bg-emerald-500/10 font-semibold text-emerald-200 ${sizeClasses}`}>
      {UPLOAD_STATUS_LABELS[status]}
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
    quote: "bg-emerald-500/10 text-emerald-200 border-emerald-500/30",
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

function UrgencyBadge({
  level,
}: {
  level: CustomerDecision["urgencyLevel"];
}) {
  const palette: Record<CustomerDecision["urgencyLevel"], string> = {
    high: "border-red-500/40 bg-red-500/10 text-red-200",
    medium: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    low: "border-slate-500/40 bg-slate-500/10 text-slate-200",
  };
  const labelMap: Record<CustomerDecision["urgencyLevel"], string> = {
    high: "High urgency",
    medium: "Needs attention",
    low: "Low pressure",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${palette[level]}`}
    >
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
        <Link
          href="/quote"
          className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400 hover:text-emerald-200"
        >
          Go to /quote
        </Link>
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
