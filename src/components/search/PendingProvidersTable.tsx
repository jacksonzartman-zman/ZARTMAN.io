import { TagPill, type TagPillTone } from "@/components/shared/primitives/TagPill";
import { decorateProviderForCustomerDisplay } from "@/lib/providers/customerDisplay";
import {
  isDestinationReceived,
  resolveDestinationActivityTimestamp,
} from "@/lib/search/pendingProviders";
import { formatDateTime } from "@/lib/formatDate";
import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";

type PendingProvidersTableProps = {
  destinations: RfqDestination[];
  remainingCount?: number;
  matchContext?: {
    matchedOnProcess?: boolean;
    locationFilter?: string | null;
  };
};

export function PendingProvidersTable({
  destinations,
  remainingCount = 0,
  matchContext,
}: PendingProvidersTableProps) {
  if (destinations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-4 py-3 text-sm text-slate-400">
        Providers will appear here once dispatch begins.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-900/60 bg-slate-950/60">
            <tr className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <th className="px-4 py-2">Provider</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900/60">
            {destinations.map((destination, index) => {
              const providerLabel = getDestinationProviderLabel(destination, index);
              const providerTypeLabel = formatEnumLabel(destination.provider?.provider_type);
              const statusMeta = resolvePendingProviderStatus(destination);
              const lastActivityLabel = formatDateTime(
                resolveDestinationActivityTimestamp(destination),
                {
                  includeTime: true,
                  fallback: "-",
                },
              );
              const providerDisplay = decorateProviderForCustomerDisplay(destination.provider, {
                matchedOnProcess: matchContext?.matchedOnProcess,
                locationFilter: matchContext?.locationFilter ?? null,
                previousActivity: isDestinationReceived(destination.status),
              });
              const whyShownLabel =
                providerDisplay.whyShownTags.length > 0
                  ? `Matched on: ${providerDisplay.whyShownTags.join(", ")}`
                  : null;

              return (
                <tr key={destination.id}>
                  <td className="px-4 py-3 text-slate-100">
                    <div className="flex flex-col gap-1">
                      <span>{providerLabel}</span>
                      {providerTypeLabel ? (
                        <TagPill size="sm" tone="muted" className="w-fit normal-case tracking-normal">
                          {providerTypeLabel}
                        </TagPill>
                      ) : null}
                      <p className="text-[11px] text-slate-400">
                        Source: {providerDisplay.sourceLabel}
                      </p>
                      {whyShownLabel ? (
                        <p className="text-[11px] text-slate-500">{whyShownLabel}</p>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <TagPill size="sm" tone={statusMeta.tone} className="normal-case">
                      {statusMeta.label}
                    </TagPill>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{lastActivityLabel}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {remainingCount > 0 ? (
        <p className="text-xs text-slate-400">
          + {remainingCount} more provider{remainingCount === 1 ? "" : "s"} in progress
        </p>
      ) : null}
    </div>
  );
}

function resolvePendingProviderStatus(
  destination: RfqDestination,
): { label: string; tone: TagPillTone } {
  const hasDispatchStarted = Boolean(destination.dispatch_started_at);
  switch (destination.status) {
    case "draft":
      return { label: "Not started", tone: "slate" };
    case "queued":
      return { label: "Outreach started", tone: "blue" };
    case "sent":
    case "viewed":
      return { label: "Awaiting response", tone: "amber" };
    case "submitted":
      return { label: "Submitted", tone: "emerald" };
    case "error":
      return {
        label: hasDispatchStarted ? "Outreach started" : "Not started",
        tone: "red",
      };
    case "quoted":
    case "declined":
      return { label: "Submitted", tone: "emerald" };
    default:
      return { label: "Awaiting response", tone: "amber" };
  }
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return "";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function getDestinationProviderLabel(destination: RfqDestination, fallbackIndex: number): string {
  const name = destination.provider?.name;
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  return `Provider ${fallbackIndex + 1}`;
}
