const WORKFLOW_ALIASES = new Map<string, WorkflowState>([
  ["in_review", "reviewing"],
  ["in review", "reviewing"],
  ["review", "reviewing"],
  ["matching", "supplier_matching"],
  ["supplier match", "supplier_matching"],
  ["quoted", "quoted"],
  ["pricing", "quoted"],
  ["approved", "approved"],
  ["greenlit", "approved"],
  ["in_production", "in_production"],
  ["in production", "in_production"],
  ["production", "in_production"],
  ["shipped", "shipped"],
  ["delivered", "delivered"],
  ["submitted", "submitted"],
]);

export const QUOTE_WORKFLOW = [
  "submitted",
  "reviewing",
  "supplier_matching",
  "quoted",
  "approved",
  "in_production",
  "shipped",
  "delivered",
] as const;

type WorkflowState = (typeof QUOTE_WORKFLOW)[number];

const WORKFLOW_SET = new Set<string>(QUOTE_WORKFLOW);

export function normalizeWorkflowState(
  value: string | null | undefined,
): WorkflowState | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (WORKFLOW_SET.has(normalized)) {
    return normalized as WorkflowState;
  }
  const alias = WORKFLOW_ALIASES.get(normalized);
  return alias ?? null;
}

export function getNextWorkflowState(current: string): string | null {
  const normalized = normalizeWorkflowState(current);
  if (!normalized) {
    return null;
  }
  const index = QUOTE_WORKFLOW.indexOf(normalized);
  if (index === -1 || index >= QUOTE_WORKFLOW.length - 1) {
    return null;
  }
  return QUOTE_WORKFLOW[index + 1];
}

export function formatWorkflowStateLabel(state: string | null): string {
  if (!state) {
    return "—";
  }
  return state
    .split("_")
    .map((segment) =>
      segment.length > 0
        ? segment.charAt(0).toUpperCase() + segment.slice(1)
        : segment,
    )
    .join(" ");
}
