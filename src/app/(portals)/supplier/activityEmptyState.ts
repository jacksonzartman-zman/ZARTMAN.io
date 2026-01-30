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
      title: "Activity will appear here",
      description:
        "We’ll start streaming marketplace assignments and bid updates once workspaces are enabled.",
    };
  }

  if (supplierExists) {
    return {
      title: "No activity yet",
      description: "New assignments, bids, and updates will show up here as they happen.",
    };
  }

  return {
    title: "Finish onboarding to unlock activity",
    description: "Complete onboarding to start receiving assignments and tracking bid activity here.",
  };
}
