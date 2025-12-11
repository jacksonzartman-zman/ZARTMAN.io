import { toTimestamp } from "@/lib/relativeTime";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import {
  buildCapabilityProfile,
  deriveSupplierMatchInsight,
  type SupplierMatchInsight,
} from "@/lib/supplier/matchHealth";
import type { SupplierQuoteMatch } from "@/server/suppliers";
import {
  summarizeSupplierBidState,
  type SupplierInboxBidAggregate,
} from "@/server/suppliers/inbox";
import type {
  SupplierCapabilityRow,
  SupplierQuoteRow,
} from "@/server/suppliers/types";
import type { SupplierInboxRow } from "./SupplierInboxTable";

type BuildSupplierInboxRowsArgs = {
  matches: SupplierQuoteMatch[];
  bidAggregates: Record<string, SupplierInboxBidAggregate | undefined>;
  capabilities?: SupplierCapabilityRow[];
};

export function buildSupplierInboxRows({
  matches,
  bidAggregates,
  capabilities = [],
}: BuildSupplierInboxRowsArgs): SupplierInboxRow[] {
  const capabilityProfile =
    capabilities.length > 0 ? buildCapabilityProfile(capabilities) : null;

  const rows = matches.reduce<SupplierInboxRow[]>((acc, match) => {
    const quote = match.quote;
    const quoteId =
      typeof match.quoteId === "string" && match.quoteId.length > 0
        ? match.quoteId
        : quote?.id ?? null;

    if (!quote || !quoteId) {
      return acc;
    }

    const aggregate = bidAggregates[quoteId];
    const rawFileNames =
      (Array.isArray(quote.file_names) ? quote.file_names : null) ??
      (Array.isArray(quote.upload_file_names)
        ? quote.upload_file_names
        : null) ??
      null;
    let fileNames: string[] =
      Array.isArray(rawFileNames) && rawFileNames.length > 0
        ? rawFileNames
            .map((value) => (typeof value === "string" ? value.trim() : ""))
            .filter((value) => value.length > 0)
        : [];
    if (
      fileNames.length === 0 &&
      typeof quote.file_name === "string" &&
      quote.file_name.trim().length > 0
    ) {
      // Legacy inbox rows only show the “primary” file name; when the files array
      // is unavailable we still fall back to index 0 so the UI reflects at least
      // one attached part instead of zero.
      fileNames = [quote.file_name.trim()];
    }
    const companyName =
      sanitizeDisplayName(quote.company) ??
      sanitizeDisplayName(quote.customer_name) ??
      "Customer";
    const primaryFileName =
      sanitizeDisplayName(quote.file_name) ??
      sanitizeDisplayName(fileNames[0]) ??
      null;
    const rfqLabel =
      primaryFileName ??
      companyName ??
      `Quote ${quoteId.slice(0, 8)}`;
    const createdAt = match.createdAt ?? quote.created_at ?? null;
    const targetDate = quote.target_date ?? null;
    const lastBidAt = aggregate?.lastBidAt ?? null;
    const lastActivity = resolveLastActivity({
      createdAt,
      lastBidAt,
      targetDate,
    });

    const matchInsight = capabilityProfile
      ? deriveSupplierMatchInsight({
          profile: capabilityProfile,
          quoteProcess: match.processHint,
          materialMatches: match.materialMatches,
          quantityHint: match.quantityHint ?? null,
        })
      : null;

    acc.push({
      id: quoteId,
      quoteId,
      companyName,
      rfqLabel,
      primaryFileName,
      processHint: match.processHint,
      materials: match.materialMatches,
      quantityHint: match.quantityHint ?? null,
      fileCount: resolveFileCount(quote, fileNames.length),
      priceLabel: formatCurrencyValue(quote.price, quote.currency),
      createdAt,
      status: normalizeQuoteStatus(quote.status),
      bidCount: aggregate?.bidCount ?? 0,
      lastBidAt,
      hasWinningBid: aggregate?.hasWinningBid ?? false,
      fairnessReason: match.fairness?.reasons?.[0] ?? null,
      targetDate,
      dueSoon: isDueSoon(targetDate),
      lastActivityAt: lastActivity.value,
      lastActivityTimestamp: lastActivity.timestamp,
      matchHealth: matchInsight?.health ?? null,
      matchHealthHint: formatMatchHealthHint(matchInsight, match),
      supplierBidState: summarizeSupplierBidState(aggregate),
    });

    return acc;
  }, []);

  return rows.sort(
    (a, b) =>
      (b.lastActivityTimestamp ?? 0) - (a.lastActivityTimestamp ?? 0),
  );
}

function resolveLastActivity({
  createdAt,
  lastBidAt,
  targetDate,
}: {
  createdAt: string | null;
  lastBidAt: string | null;
  targetDate: string | null;
}): { value: string | null; timestamp: number | null } {
  const candidates = [createdAt, lastBidAt, targetDate]
    .filter((value): value is string => typeof value === "string")
    .map((value) => {
      const timestamp = toTimestamp(value);
      return { value, timestamp };
    })
    .filter(
      (
        candidate,
      ): candidate is { value: string; timestamp: number } =>
        typeof candidate.timestamp === "number",
    );

  if (candidates.length === 0) {
    const fallback = createdAt ?? lastBidAt ?? targetDate ?? null;
    return { value: fallback, timestamp: toTimestamp(fallback) };
  }

  return candidates.reduce(
    (latest, candidate) =>
      candidate.timestamp > latest.timestamp ? candidate : latest,
    candidates[0],
  );
}

function isDueSoon(targetDate: string | null, thresholdDays = 7): boolean {
  if (!targetDate) {
    return false;
  }
  const timestamp = toTimestamp(targetDate);
  if (timestamp === null) {
    return false;
  }
  const now = Date.now();
  if (timestamp < now) {
    return false;
  }
  const diffDays = (timestamp - now) / (1000 * 60 * 60 * 24);
  return diffDays <= thresholdDays;
}

function sanitizeDisplayName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveFileCount(
  quote: SupplierQuoteRow,
  derivedCount: number,
): number {
  const declaredCount =
    typeof quote.file_count === "number" && Number.isFinite(quote.file_count)
      ? quote.file_count
      : typeof quote.upload_file_count === "number" &&
          Number.isFinite(quote.upload_file_count)
        ? quote.upload_file_count
        : null;
  if (declaredCount && declaredCount > 0) {
    return declaredCount;
  }
  return derivedCount;
}

function formatCurrencyValue(
  value: number | string | null | undefined,
  currency?: string | null,
): string {
  const numericValue =
    typeof value === "string" ? Number(value) : value;
  if (typeof numericValue !== "number" || !Number.isFinite(numericValue)) {
    return "Value pending";
  }
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency ?? "USD").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(numericValue);
  } catch {
    return `$${numericValue.toFixed(0)}`;
  }
}

function formatMatchHealthHint(
  insight: SupplierMatchInsight | null,
  match: SupplierQuoteMatch,
): string | null {
  if (!insight) {
    return null;
  }

  const processLabel = match.processHint ?? "Process TBD";
  const primaryMaterial = match.materialMatches[0]
    ? match.materialMatches[0].toUpperCase()
    : null;

  switch (insight.health) {
    case "excellent":
      return primaryMaterial
        ? `Great fit: ${processLabel} + ${primaryMaterial}`
        : `Great fit: ${processLabel}`;
    case "good":
      if (primaryMaterial) {
        return `Good fit: ${processLabel} + ${primaryMaterial}`;
      }
      return `Process match: ${processLabel}`;
    case "limited":
      return "Limited: process match, material mismatch";
    case "poor":
      return "Poor fit: process mismatch";
    default:
      return insight.reasons[0] ?? null;
  }
}
