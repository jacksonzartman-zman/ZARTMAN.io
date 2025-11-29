import type { User } from "@supabase/supabase-js";

export type OrgPlan = "basic" | "pro" | "enterprise";

export type Org = {
  id: string;
  name: string;
  domain?: string;
  plan: OrgPlan;
};

export type OrgSeatSummary = {
  total: number;
  used: number;
  available: number;
};

type SessionSource = User;
const DEFAULT_PLAN: OrgPlan = "basic";
const PLAN_CAPACITY: Record<OrgPlan, number> = {
  basic: 3,
  pro: 10,
  enterprise: 50,
};

export function deriveOrgFromSession(
  user: SessionSource,
  fallbackName: string,
): Org {
  const email = user.email ?? "";
  const domain = extractDomain(email);
  const planCandidates = [
    user.app_metadata?.plan,
    user.user_metadata?.plan,
  ];
  const derivedPlan =
    planCandidates
      .map((value) => normalizePlan(value))
      .find((value): value is OrgPlan => Boolean(value)) ??
    (domain && domain.endsWith("zartman.com") ? "enterprise" : DEFAULT_PLAN);
  const orgId =
    (user.app_metadata?.org_id as string | undefined) ??
    `org-${domain ?? user.id}`;
  const orgNameCandidate =
    (user.user_metadata?.org_name as string | undefined) ??
    fallbackName;
  const orgName =
    typeof orgNameCandidate === "string" && orgNameCandidate.trim().length > 0
      ? orgNameCandidate.trim()
      : fallbackName;

  return {
    id: orgId,
    name: orgName,
    domain: domain ?? undefined,
    plan: derivedPlan,
  };
}

export function deriveOrgSeatSummary(org: Org, user: SessionSource): OrgSeatSummary {
  const seatUsageRaw =
    user.app_metadata?.org_seat_usage ??
    user.user_metadata?.org_seat_usage ??
    user.app_metadata?.seat_count ??
    user.user_metadata?.seat_count;
  const usedValue =
    typeof seatUsageRaw === "number"
      ? seatUsageRaw
      : Number.parseInt(
          typeof seatUsageRaw === "string" ? seatUsageRaw : "",
          10,
        );
  const normalizedUsed =
    Number.isFinite(usedValue) && usedValue > 0 ? usedValue : 1;
  const total = PLAN_CAPACITY[org.plan];
  const used = Math.min(normalizedUsed, total);
  return {
    total,
    used,
    available: Math.max(total - used, 0),
  };
}

function normalizePlan(value: unknown): OrgPlan | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "basic" || normalized === "pro" || normalized === "enterprise") {
    return normalized;
  }
  return null;
}

function extractDomain(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const atIndex = value.indexOf("@");
  if (atIndex === -1) {
    return null;
  }
  const domain = value.slice(atIndex + 1).trim().toLowerCase();
  return domain.length > 0 ? domain : null;
}
