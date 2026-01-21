import type { SupplierActivityResultReason } from "@/server/suppliers";

export type SupplierActivityEmptyStateCopy = {
  title: string;
  description: string;
};

type ResolveActivityEmptyStateArgs = {
  supplierExists: boolean;
  hasEvents: boolean;
  reason?: SupplierActivityResultReason | null;
};

export function resolveSupplierActivityEmptyState({
  supplierExists,
  hasEvents,
  reason,
}: ResolveActivityEmptyStateArgs): SupplierActivityEmptyStateCopy | null {
  if (hasEvents) {
    return null;
  }

  if (reason === "assignments-disabled") {
    return {
      title: "Workspace activity will appear here",
      description:
        "We’ll show search request and bid activity once we start assigning workspaces through the marketplace.",
    };
  }

  if (supplierExists) {
    return {
      title: "No activity yet",
      description: "We’ll stream search request assignments and bid updates here as they happen.",
    };
  }

  return {
    title: "Activity unlocks after onboarding",
    description: "Finish onboarding to start tracking search requests and bids in this feed.",
  };
}
