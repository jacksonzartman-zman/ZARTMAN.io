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
        "We’ll show RFQ and bid activity once we start assigning workspaces through the marketplace.",
    };
  }

  if (supplierExists) {
    return {
      title: "No activity yet",
      description: "We’ll stream RFQ assignments and bid updates here as they happen.",
    };
  }

  return {
    title: "Activity unlocks after onboarding",
    description: "Finish onboarding to start tracking RFQs and bids in this feed.",
  };
}
