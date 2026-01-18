import type { ProviderSource, ProviderVerificationStatus } from "@/server/providers";

export type CustomerDisplayProvider = {
  source?: ProviderSource | string | null;
  verification_status?: ProviderVerificationStatus | string | null;
  is_active?: boolean | null;
  country?: string | null;
};

export type CustomerDisplayContext = {
  matchedOnProcess?: boolean;
  matchedOnLocation?: boolean;
  locationFilter?: string | null;
  invitedSupplier?: boolean;
  previousActivity?: boolean;
  verifiedNetwork?: boolean;
};

export type CustomerDisplayDecoration = {
  sourceLabel: string;
  whyShownTags: string[];
  confidenceHint: "high" | "medium" | "low";
};

const SOURCE_LABELS: Record<string, string> = {
  customer_invite: "Your invited supplier",
  manual: "Admin outreach",
  csv_import: "Admin outreach",
  discovered: "Verified directory",
};

const DEFAULT_SOURCE_LABEL = "Verified directory";

export function decorateProviderForCustomerDisplay(
  provider?: CustomerDisplayProvider | null,
  context: CustomerDisplayContext = {},
): CustomerDisplayDecoration {
  const normalizedSource = normalizeToken(provider?.source);
  const verificationStatus = normalizeToken(provider?.verification_status);
  const isActive = provider?.is_active === true;
  const invitedSupplier =
    typeof context.invitedSupplier === "boolean"
      ? context.invitedSupplier
      : normalizedSource === "customer_invite";
  const verifiedNetwork =
    typeof context.verifiedNetwork === "boolean"
      ? context.verifiedNetwork
      : verificationStatus === "verified";
  const matchedOnProcess = context.matchedOnProcess === true;
  const matchedOnLocation = resolveLocationMatch(provider, context);
  const previousActivity = context.previousActivity === true;

  const whyShownTags: string[] = [];
  if (matchedOnProcess) whyShownTags.push("process");
  if (matchedOnLocation) whyShownTags.push("location");
  if (invitedSupplier) whyShownTags.push("supplier invited");
  if (previousActivity) whyShownTags.push("previous activity");
  if (verifiedNetwork) whyShownTags.push("verified network");

  const sourceLabel = resolveSourceLabel(normalizedSource, invitedSupplier, verifiedNetwork);
  const isVerifiedActive = verificationStatus === "verified" && isActive;
  const isInvitedStub = invitedSupplier && (!isActive || verificationStatus === "unverified");
  const confidenceHint = isVerifiedActive ? "high" : isInvitedStub ? "low" : "medium";

  return {
    sourceLabel,
    whyShownTags,
    confidenceHint,
  };
}

function resolveSourceLabel(
  source: string | null,
  invitedSupplier: boolean,
  verifiedNetwork: boolean,
): string {
  if (source && SOURCE_LABELS[source]) {
    return SOURCE_LABELS[source];
  }
  if (invitedSupplier) {
    return SOURCE_LABELS.customer_invite;
  }
  if (verifiedNetwork) {
    return DEFAULT_SOURCE_LABEL;
  }
  return SOURCE_LABELS.manual;
}

function resolveLocationMatch(
  provider: CustomerDisplayProvider | null | undefined,
  context: CustomerDisplayContext,
): boolean {
  if (typeof context.matchedOnLocation === "boolean") {
    return context.matchedOnLocation;
  }
  const locationFilter = normalizeText(context.locationFilter);
  const providerLocation = normalizeText(provider?.country);
  if (!providerLocation) {
    return false;
  }
  if (!locationFilter) {
    return true;
  }
  return providerLocation.includes(locationFilter);
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}
