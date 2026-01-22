import Link from "next/link";
import clsx from "clsx";

import { DisclosureSection } from "@/components/DisclosureSection";
import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";

type CoverageDisclosureProps = {
  destinations?: RfqDestination[];
  defaultOpen?: boolean;
  className?: string;
  showSummary?: boolean;
};

type ProviderTypeKey = "network" | "marketplace" | "factory" | "broker";
type QuotingModeKey = "manual" | "email" | "api";

type CoverageCounts = {
  byType: Record<ProviderTypeKey, number>;
  byQuotingMode: Record<QuotingModeKey, number>;
  replied: number;
  pending: number;
  total: number;
};

const PROVIDER_TYPE_LABELS: Array<{ key: ProviderTypeKey; label: string }> = [
  { key: "network", label: "Network" },
  { key: "marketplace", label: "Marketplace" },
  { key: "factory", label: "Factory" },
  { key: "broker", label: "Broker" },
];
const QUOTING_MODE_LABELS: Array<{ key: QuotingModeKey; label: string }> = [
  { key: "manual", label: "Manual" },
  { key: "email", label: "Email" },
  { key: "api", label: "API-ready" },
];

const CONTACTED_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
]);
const REPLIED_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set(["quoted", "declined"]);
const PENDING_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "queued",
  "sent",
  "submitted",
  "viewed",
]);

export function CoverageDisclosure({
  destinations = [],
  defaultOpen = false,
  className,
  showSummary = true,
}: CoverageDisclosureProps) {
  const counts = buildCoverageCounts(destinations);
  const summaryLabel = showSummary ? buildCoverageSummary(counts) : undefined;

  return (
    <DisclosureSection
      id="coverage"
      title="Coverage"
      description="Verified, active providers in the Zartman network."
      defaultOpen={defaultOpen}
      summary={summaryLabel}
      className={clsx("border-slate-900/60 bg-slate-950/40", className)}
      contentClassName="py-4"
    >
      <div className="space-y-4 text-sm text-slate-200">
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            What happens when you click Search?
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-300">
            <li>
              We package your search request details and match them to suppliers by process and
              volume fit.
            </li>
            <li>We contact a mix of network, marketplace, factory, and broker partners and track outreach.</li>
            <li>Responses arrive as suppliers quote, and we notify you as they land.</li>
          </ul>
          <p className="text-xs text-slate-300">
            We route search requests to verified, active suppliers. Want to include a supplier not
            listed?{" "}
            <Link href="/customer/invite-supplier" className="font-semibold text-slate-100 hover:text-white">
              Invite them.
            </Link>
          </p>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Which suppliers will be contacted?
          </p>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Provider type
            </p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-4">
              {PROVIDER_TYPE_LABELS.map((type) => (
                <CoverageStat key={type.key} label={type.label} value={counts.byType[type.key]} />
              ))}
            </dl>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Quoting mode
            </p>
            <dl className="mt-2 grid gap-2 sm:grid-cols-3">
              {QUOTING_MODE_LABELS.map((mode) => (
                <CoverageStat
                  key={mode.key}
                  label={mode.label}
                  value={counts.byQuotingMode[mode.key]}
                />
              ))}
            </dl>
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Response status
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
            <CoverageStat label="Replied" value={counts.replied} />
            <CoverageStat label="Awaiting reply" value={counts.pending} />
            <CoverageStat label="Matched" value={counts.total} />
          </dl>
        </div>
        <p className="text-xs text-slate-400">We don&apos;t play favorites.</p>
      </div>
    </DisclosureSection>
  );
}

function CoverageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-semibold text-white tabular-nums">{value}</dd>
    </div>
  );
}

function buildCoverageCounts(destinations: RfqDestination[]): CoverageCounts {
  const byType: CoverageCounts["byType"] = {
    network: 0,
    marketplace: 0,
    factory: 0,
    broker: 0,
  };
  const byQuotingMode: CoverageCounts["byQuotingMode"] = {
    manual: 0,
    email: 0,
    api: 0,
  };
  let replied = 0;
  let pending = 0;

  for (const destination of destinations) {
    const typeKey = normalizeProviderType(destination.provider?.provider_type);
    const quotingModeKey = normalizeQuotingMode(destination.provider?.quoting_mode);
    if (typeKey) {
      byType[typeKey] += 1;
    }
    if (quotingModeKey) {
      byQuotingMode[quotingModeKey] += 1;
    }
    if (REPLIED_STATUSES.has(destination.status)) {
      replied += 1;
    }
    if (PENDING_STATUSES.has(destination.status)) {
      pending += 1;
    }
  }

  return { byType, byQuotingMode, replied, pending, total: destinations.length };
}

function normalizeProviderType(value: string | null | undefined): ProviderTypeKey | null {
  if (!value) return null;
  const normalized = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (normalized === "direct supplier" || normalized === "network") return "network";
  if (normalized === "marketplace") return "marketplace";
  if (normalized === "factory") return "factory";
  if (normalized === "broker") return "broker";
  return null;
}

function normalizeQuotingMode(value: string | null | undefined): QuotingModeKey | null {
  if (!value) return null;
  const normalized = value.replace(/[_-]+/g, " ").trim().toLowerCase();
  if (normalized === "manual") return "manual";
  if (normalized === "email") return "email";
  if (normalized === "api") return "api";
  return null;
}

function buildCoverageSummary(counts: CoverageCounts): string {
  if (counts.total === 0) {
    return "Coverage pending";
  }
  const providerLabel = counts.total === 1 ? "provider" : "providers";
  return `${counts.total} ${providerLabel} • ${counts.replied} replied`;
}
