import Link from "next/link";

import { requireCustomerSessionOrRedirect } from "@/app/(portals)/customer/requireCustomerSessionOrRedirect";
import { getCustomerByUserId } from "@/server/customers";
import { loadCustomerQuotesList } from "@/server/customer/quotesList";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import PortalCard from "../../PortalCard";
import { PortalShell, PORTAL_SURFACE_CARD } from "../../components/PortalShell";
import { formatRelativeTimeCompactFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { CustomerQuotesListClient } from "./CustomerQuotesListClient";
import { primaryCtaClasses } from "@/lib/ctas";

export const dynamic = "force-dynamic";

type RfqStatusTone = "slate" | "blue" | "emerald" | "amber" | "muted";

function clsx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: RfqStatusTone;
}) {
  const toneClasses =
    tone === "blue"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "emerald"
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        : tone === "amber"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
          : tone === "muted"
            ? "border-slate-900/70 bg-slate-950/20 text-slate-400"
            : "border-slate-800 bg-slate-950/40 text-slate-200";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        toneClasses,
      )}
    >
      {children}
    </span>
  );
}

function getStatusTone(status: string): RfqStatusTone {
  if (status === "Delivered") return "emerald";
  if (status === "In production") return "amber";
  if (status === "Awarded") return "emerald";
  if (status === "Offers ready") return "blue";
  if (status === "Waiting on offers") return "slate";
  return "muted";
}

function formatFileNames(fileNames: string[]): {
  primary: string;
  secondary?: string;
} {
  const names = Array.isArray(fileNames) ? fileNames.filter(Boolean) : [];
  if (names.length === 0) {
    return { primary: "No files yet" };
  }
  if (names.length === 1) {
    return { primary: names[0]! };
  }
  const rest = names.slice(1, 4);
  const suffix = names.length > 4 ? ` +${names.length - 4} more` : "";
  return {
    primary: names[0]!,
    secondary: `${rest.join(", ")}${suffix}`,
  };
}

function formatUpdatedAt(value: string | null): string {
  const label = formatRelativeTimeCompactFromTimestamp(toTimestamp(value));
  return label ?? "—";
}

function getProjectStageLabel(status: string): string | null {
  if (status === "Awarded") return "Converted to project";
  if (status === "In production") return "Now in production";
  if (status === "Delivered") return "Project delivered";
  return null;
}

type CustomerQuoteRow = {
  id: string;
  href: string;
  primaryFileName: string;
  secondaryFileName?: string;
  fallbackLabel: string;
  status: string;
  stageLabel?: string;
  statusTone: RfqStatusTone;
  updatedLabel: string;
  updatedTitle: string;
};

type CustomerQuotesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CustomerQuotesPage({
  searchParams,
}: CustomerQuotesPageProps) {
  const user = await requireCustomerSessionOrRedirect("/customer/quotes");
  const customer = await getCustomerByUserId(user.id);

  if (!customer) {
    return (
      <PortalShell
        workspace="customer"
        title="RFQs"
        subtitle="Your command center for intake: track status, review offers, and jump back into context."
      >
        <PortalCard title="Customer workspace required" className={PORTAL_SURFACE_CARD}>
          <EmptyStateCard
            title="Complete your customer profile"
            description={`We couldn’t find a customer workspace linked to ${user.email ?? "your account"}.`}
            tone="warning"
            action={{ label: "Back to dashboard", href: "/customer" }}
          />
        </PortalCard>
      </PortalShell>
    );
  }

  // No filters yet — just a newest-first history list.
  const quotes = await loadCustomerQuotesList({ userId: user.id, email: user.email ?? null }, {});
  const sortedQuotes = [...quotes].sort((a, b) => {
    const aKey = Date.parse(a.updatedAt ?? a.createdAt);
    const bKey = Date.parse(b.updatedAt ?? b.createdAt);
    if (Number.isFinite(aKey) && Number.isFinite(bKey) && aKey !== bKey) return bKey - aKey;
    return (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt);
  });

  const rows: CustomerQuoteRow[] = sortedQuotes.map((quote) => {
    const files = formatFileNames(quote.fileNames);
    const status = quote.rfqHistoryStatus;
    const updatedAt = quote.updatedAt ?? quote.createdAt;
    return {
      id: quote.id,
      href: `/customer/quotes/${quote.id}`,
      primaryFileName: files.primary,
      secondaryFileName: files.secondary,
      fallbackLabel: quote.rfqLabel,
      status,
      stageLabel: getProjectStageLabel(status) ?? undefined,
      statusTone: getStatusTone(status),
      updatedLabel: formatUpdatedAt(updatedAt),
      updatedTitle: updatedAt,
    };
  });

  return (
    <PortalShell
      workspace="customer"
      title="RFQs"
      subtitle="Your command center for intake: track status, review offers, and jump back into context."
      actions={
        <div className="flex flex-wrap items-center gap-3 lg:justify-end">
          <Link
            href="/quote"
            className={`${primaryCtaClasses} text-xs font-semibold uppercase tracking-wide`}
          >
            Start an RFQ
          </Link>
          <Link
            href="/customer/projects"
            className="text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline motion-reduce:transition-none"
          >
            Projects
          </Link>
          <Link
            href="/customer/messages"
            className="text-xs font-semibold text-slate-300 underline-offset-4 transition hover:text-white hover:underline motion-reduce:transition-none"
          >
            Messages
          </Link>
        </div>
      }
    >
      <PortalCard
        title="RFQs"
        header={false}
        className={clsx(PORTAL_SURFACE_CARD, "p-0")}
      >
        {sortedQuotes.length === 0 ? (
          <div className="p-6">
            <EmptyStateCard
              title="No RFQs yet"
              description="Upload a part to start a search. We’ll keep status, offers, and updates here."
              action={{ label: "Start an RFQ", href: "/quote" }}
            />
          </div>
        ) : (
          <CustomerQuotesListClient rows={rows} />
        )}
      </PortalCard>
    </PortalShell>
  );
}
