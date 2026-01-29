import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type CustomerExclusion = {
  id: string;
  customer_id: string;
  excluded_provider_id: string | null;
  excluded_source_name: string | null;
  reason: string | null;
  created_at: string;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSourceNameForMatch(value: unknown): string | null {
  const text = normalizeOptionalText(value);
  return text ? text.toLowerCase() : null;
}

export async function loadCustomerExclusions(
  customerId: string,
  options?: { client?: ReturnType<typeof supabaseServer> },
): Promise<CustomerExclusion[]> {
  const normalizedCustomerId = normalizeId(customerId);
  if (!normalizedCustomerId) return [];

  const client = options?.client ?? supabaseServer();
  try {
    const { data, error } = await client
      .from("customer_exclusions")
      .select("id,customer_id,excluded_provider_id,excluded_source_name,reason,created_at")
      .eq("customer_id", normalizedCustomerId)
      .order("created_at", { ascending: false })
      .returns<CustomerExclusion[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.warn("[customer exclusions] load failed", {
        customerId: normalizedCustomerId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.warn("[customer exclusions] load crashed", {
      customerId: normalizedCustomerId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export type CustomerExclusionMatch =
  | { kind: "provider"; exclusionId: string; providerId: string }
  | { kind: "source"; exclusionId: string; sourceName: string };

export function findCustomerExclusionMatch(args: {
  exclusions: readonly CustomerExclusion[];
  providerId?: string | null;
  sourceName?: string | null;
}): CustomerExclusionMatch | null {
  const providerId = normalizeId(args.providerId);
  const sourceNameNormalized = normalizeSourceNameForMatch(args.sourceName);

  for (const exclusion of args.exclusions ?? []) {
    const exclusionId = normalizeId(exclusion?.id);
    if (!exclusionId) continue;

    const excludedProviderId = normalizeId(exclusion?.excluded_provider_id);
    if (providerId && excludedProviderId && providerId === excludedProviderId) {
      return { kind: "provider", exclusionId, providerId };
    }

    const excludedSourceNameNormalized = normalizeSourceNameForMatch(
      exclusion?.excluded_source_name,
    );
    if (
      sourceNameNormalized &&
      excludedSourceNameNormalized &&
      sourceNameNormalized === excludedSourceNameNormalized
    ) {
      return {
        kind: "source",
        exclusionId,
        sourceName: normalizeOptionalText(args.sourceName) ?? sourceNameNormalized,
      };
    }
  }

  return null;
}

export function filterOffersByCustomerExclusions<TOffer extends { provider_id?: unknown; source_name?: unknown }>(
  offers: readonly TOffer[],
  exclusions: readonly CustomerExclusion[],
): TOffer[] {
  return (offers ?? []).filter((offer) => {
    const providerId = normalizeId((offer as any)?.provider_id);
    const sourceName = normalizeOptionalText((offer as any)?.source_name);
    return !findCustomerExclusionMatch({
      exclusions,
      providerId: providerId || null,
      sourceName,
    });
  });
}

