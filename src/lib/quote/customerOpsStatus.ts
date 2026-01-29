export type CustomerOpsStatusStep = "placed" | "in_production" | "shipped" | "delivered";

export const CUSTOMER_OPS_STATUS_STEPS: readonly CustomerOpsStatusStep[] = [
  "placed",
  "in_production",
  "shipped",
  "delivered",
] as const;

export function normalizeCustomerOpsStatusStep(value: unknown): CustomerOpsStatusStep | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;

  if (normalized === "placed") return "placed";
  if (normalized === "in_production") return "in_production";
  if (normalized === "shipped") return "shipped";
  if (normalized === "delivered") return "delivered";
  return null;
}

export function formatCustomerOpsStatusLabel(value: unknown): string | null {
  const step = normalizeCustomerOpsStatusStep(value);
  if (!step) return null;
  switch (step) {
    case "placed":
      return "Order placed";
    case "in_production":
      return "In production";
    case "shipped":
      return "Shipped";
    case "delivered":
      return "Delivered";
  }
}

export function getCustomerOpsStatusStepIndex(step: CustomerOpsStatusStep): number {
  return CUSTOMER_OPS_STATUS_STEPS.indexOf(step);
}

