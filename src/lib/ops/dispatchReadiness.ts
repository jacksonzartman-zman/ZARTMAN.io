import { resolveDispatchModeValue } from "@/lib/adapters/providerDispatchMode";

export type DispatchReadinessFix = {
  label: string;
  href?: string;
  action?: string;
};

export type DispatchReadinessResult = {
  isReady: boolean;
  blockingReasons: string[];
  recommendedFix: DispatchReadinessFix | null;
};

export type DispatchReadinessDestination = {
  id?: string | null;
  dispatch_mode?: string | null;
  quoting_mode?: string | null;
  provider_email?: string | null;
  provider_rfq_url?: string | null;
  provider?: {
    primary_email?: string | null;
    email?: string | null;
    contact_email?: string | null;
    rfq_url?: string | null;
  } | null;
};

type EffectiveDispatchMode = "email" | "mailto" | "web_form" | "api" | "unknown";

const loggedNotReady = new Set<string>();

function normalizeString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeLower(value: unknown): string {
  return normalizeString(value).toLowerCase();
}

function resolveEffectiveDispatchMode(
  destination: DispatchReadinessDestination,
): EffectiveDispatchMode {
  const rawDispatchMode = normalizeLower(destination.dispatch_mode);
  const rawQuotingMode = normalizeLower(destination.quoting_mode);
  if (rawDispatchMode === "mailto" || rawQuotingMode === "mailto") {
    return "mailto";
  }
  const normalized = resolveDispatchModeValue(destination.dispatch_mode, destination.quoting_mode);
  if (normalized === "email") return "email";
  if (normalized === "web_form") return "web_form";
  if (normalized === "api") return "api";
  return "unknown";
}

function resolveProviderEmail(destination: DispatchReadinessDestination): string {
  return (
    normalizeString(destination.provider_email) ||
    normalizeString(destination.provider?.primary_email) ||
    normalizeString(destination.provider?.email) ||
    normalizeString(destination.provider?.contact_email)
  );
}

function resolveProviderRfqUrl(destination: DispatchReadinessDestination): string {
  return (
    normalizeString(destination.provider_rfq_url) ||
    normalizeString(destination.provider?.rfq_url)
  );
}

function buildRecommendedFix(blockingReasons: string[]): DispatchReadinessFix | null {
  if (blockingReasons.includes("Missing provider email")) {
    return { label: "Add provider email" };
  }
  if (blockingReasons.includes("Missing RFQ URL")) {
    return { label: "Add RFQ URL" };
  }
  if (blockingReasons.includes("Unsupported dispatch mode")) {
    return { label: "Review dispatch mode" };
  }
  return null;
}

export function getDestinationDispatchReadiness(
  destination: DispatchReadinessDestination,
): DispatchReadinessResult {
  const effectiveDispatchMode = resolveEffectiveDispatchMode(destination);
  const providerEmail = resolveProviderEmail(destination);
  const providerRfqUrl = resolveProviderRfqUrl(destination);
  const blockingReasons: string[] = [];

  if (effectiveDispatchMode === "email" || effectiveDispatchMode === "mailto") {
    if (!providerEmail) {
      blockingReasons.push("Missing provider email");
    }
  } else if (effectiveDispatchMode === "web_form") {
    if (!providerRfqUrl) {
      blockingReasons.push("Missing RFQ URL");
    }
  } else if (effectiveDispatchMode === "unknown") {
    blockingReasons.push("Unsupported dispatch mode");
  }

  const isReady = blockingReasons.length === 0;
  const recommendedFix = isReady ? null : buildRecommendedFix(blockingReasons);

  if (!isReady) {
    const destinationId = normalizeString(destination.id) || "unknown";
    const logKey = `${destinationId}:${effectiveDispatchMode}:${blockingReasons.join("|")}`;
    if (!loggedNotReady.has(logKey)) {
      loggedNotReady.add(logKey);
      console.debug("[dispatch readiness] destination not dispatchable", {
        destinationId,
        dispatchMode: effectiveDispatchMode,
        blockingReasons,
      });
    }
  }

  return {
    isReady,
    blockingReasons,
    recommendedFix,
  };
}
