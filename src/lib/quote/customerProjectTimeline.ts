export type CustomerProjectTimelineStepId =
  | "search_started"
  | "offers_received"
  | "intro_requested"
  | "supplier_awarded"
  | "kickoff_started"
  | "in_production";

export type CustomerProjectTimelineStepStatus = "complete" | "current" | "upcoming";

export type CustomerProjectTimelineStep = {
  id: CustomerProjectTimelineStepId;
  label: string;
  status: CustomerProjectTimelineStepStatus;
};

export const CUSTOMER_PROJECT_TIMELINE_STEPS: Array<{
  id: CustomerProjectTimelineStepId;
  label: string;
}> = [
  { id: "search_started", label: "Search started" },
  { id: "offers_received", label: "Offers received" },
  { id: "intro_requested", label: "Introduction requested" },
  { id: "supplier_awarded", label: "Supplier awarded" },
  { id: "kickoff_started", label: "Kickoff started" },
  { id: "in_production", label: "In production" },
];

export type CustomerProjectTimelineSignals = {
  offersCount: number;
  introRequested: boolean;
  supplierAwarded: boolean;
  kickoffStarted: boolean;
  inProduction: boolean;
};

export function computeCustomerProjectTimelineStage(
  signals: CustomerProjectTimelineSignals,
): CustomerProjectTimelineStepId {
  if (signals.inProduction) return "in_production";
  if (signals.kickoffStarted) return "kickoff_started";
  if (signals.supplierAwarded) return "supplier_awarded";
  if (signals.introRequested) return "intro_requested";
  if (signals.offersCount > 0) return "offers_received";
  return "search_started";
}

export function buildCustomerProjectTimeline(
  signals: CustomerProjectTimelineSignals,
): { stage: CustomerProjectTimelineStepId; steps: CustomerProjectTimelineStep[] } {
  const stage = computeCustomerProjectTimelineStage(signals);
  const stageIndex = CUSTOMER_PROJECT_TIMELINE_STEPS.findIndex((step) => step.id === stage);
  const safeStageIndex = stageIndex >= 0 ? stageIndex : 0;

  return {
    stage,
    steps: CUSTOMER_PROJECT_TIMELINE_STEPS.map((step, idx) => {
      const status: CustomerProjectTimelineStepStatus =
        idx < safeStageIndex ? "complete" : idx === safeStageIndex ? "current" : "upcoming";
      return { id: step.id, label: step.label, status };
    }),
  };
}

