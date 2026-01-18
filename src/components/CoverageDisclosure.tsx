import clsx from "clsx";

import { DisclosureSection } from "@/components/DisclosureSection";
import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";

type CoverageDisclosureProps = {
  destinations?: RfqDestination[];
  defaultOpen?: boolean;
  className?: string;
};

type ProviderTypeKey = "network" | "marketplace" | "factory" | "broker";

type CoverageCounts = {
  byType: Record<ProviderTypeKey, number>;
  contacted: number;
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

const CONTACTED_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "queued",
  "sent",
  "viewed",
  "quoted",
  "declined",
  "error",
]);
const REPLIED_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set(["quoted", "declined"]);
const PENDING_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "queued",
  "sent",
  "viewed",
]);

export function CoverageDisclosure({
  destinations = [],
  defaultOpen = false,
  className,
}: CoverageDisclosureProps) {
  const counts = buildCoverageCounts(destinations);
  const summaryLabel = buildCoverageSummary(counts);

  return (
    <DisclosureSection
      id="coverage"
      title="Coverage"
      description="Verified, active providers only."
      defaultOpen={defaultOpen}
      summary={summaryLabel}
      className={clsx("border-slate-900/60 bg-slate-950/40", className)}
      contentClassName="py-4"
    >
      <div className="space-y-4 text-sm text-slate-200">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Provider mix
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-4">
            {PROVIDER_TYPE_LABELS.map((type) => (
              <CoverageStat key={type.key} label={type.label} value={counts.byType[type.key]} />
            ))}
          </dl>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Outreach status
          </p>
          <dl className="mt-2 grid gap-2 sm:grid-cols-3">
            <CoverageStat label="Contacted" value={counts.contacted} />
            <CoverageStat label="Replied" value={counts.replied} />
            <CoverageStat label="Pending" value={counts.pending} />
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
  let contacted = 0;
  let replied = 0;
  let pending = 0;

  for (const destination of destinations) {
    const typeKey = normalizeProviderType(destination.provider?.provider_type);
    if (typeKey) {
      byType[typeKey] += 1;
    }
    if (CONTACTED_STATUSES.has(destination.status)) {
      contacted += 1;
    }
    if (REPLIED_STATUSES.has(destination.status)) {
      replied += 1;
    }
    if (PENDING_STATUSES.has(destination.status)) {
      pending += 1;
    }
  }

  return { byType, contacted, replied, pending, total: destinations.length };
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

function buildCoverageSummary(counts: CoverageCounts): string {
  if (counts.total === 0) {
    return "Coverage pending";
  }
  const providerLabel = counts.total === 1 ? "provider" : "providers";
  return `${counts.total} ${providerLabel} • ${counts.replied} replied`;
}
