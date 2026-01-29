import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";

const CONTACTED_STATUSES: ReadonlySet<RfqDestinationStatus> = new Set([
  "queued",
  "sent",
  "submitted",
  "viewed",
  "quoted",
  "declined",
  "error",
]);

const DESTINATION_SLA_URGENCY_ORDER: Record<RfqDestinationStatus, number> = {
  error: 0,
  draft: 1,
  pending: 2,
  queued: 3,
  sent: 4,
  submitted: 5,
  viewed: 6,
  quoted: 7,
  declined: 8,
};

export function countContactedSuppliers(destinations: RfqDestination[]): number {
  let count = 0;
  for (const destination of destinations) {
    if (destination.dispatch_started_at || CONTACTED_STATUSES.has(destination.status)) {
      count += 1;
    }
  }
  return count;
}

export function buildPendingProvidersNextStepsCopy(args: {
  contactedCount: number;
  responseTimeLabel?: string | null;
}): string {
  const supplierLabel = args.contactedCount === 1 ? "supplier" : "suppliers";
  const responseTime = normalizeLabel(args.responseTimeLabel) ?? "TBD";
  return `We contacted ${args.contactedCount} ${supplierLabel}. Typical response time: ${responseTime}.`;
}

export function resolveDestinationActivityTimestamp(destination: RfqDestination): string | null {
  return destination.submitted_at ?? destination.dispatch_started_at ?? null;
}

export function isDestinationReceived(status: RfqDestinationStatus): boolean {
  return status === "quoted" || status === "declined";
}

export function sortDestinationsBySlaUrgency(a: RfqDestination, b: RfqDestination): number {
  const aUrgency = DESTINATION_SLA_URGENCY_ORDER[a.status] ?? 99;
  const bUrgency = DESTINATION_SLA_URGENCY_ORDER[b.status] ?? 99;
  if (aUrgency !== bUrgency) {
    return aUrgency - bUrgency;
  }
  const providerCompare = resolveDestinationProviderSortKey(a).localeCompare(
    resolveDestinationProviderSortKey(b),
    undefined,
    { sensitivity: "base" },
  );
  if (providerCompare !== 0) return providerCompare;
  return a.id.localeCompare(b.id);
}

function resolveDestinationProviderSortKey(destination: RfqDestination): string {
  const name = destination.provider?.name;
  if (typeof name === "string" && name.trim().length > 0) {
    return name.trim();
  }
  return destination.provider_id;
}

function normalizeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
