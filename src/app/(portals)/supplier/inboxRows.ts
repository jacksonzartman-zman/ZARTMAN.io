import { toTimestamp } from "@/lib/relativeTime";
import { normalizeQuoteStatus } from "@/server/quotes/status";
import type { SupplierQuoteMatch } from "@/server/suppliers";
import type { SupplierInboxBidAggregate } from "@/server/suppliers/inbox";
import type { SupplierInboxRow } from "./SupplierInboxTable";

type BuildSupplierInboxRowsArgs = {
  matches: SupplierQuoteMatch[];
  bidAggregates: Record<string, SupplierInboxBidAggregate | undefined>;
};

export function buildSupplierInboxRows({
  matches,
  bidAggregates,
}: BuildSupplierInboxRowsArgs): SupplierInboxRow[] {
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
    const fileNames =
      (Array.isArray(quote.file_names) ? quote.file_names : null) ??
      (Array.isArray(quote.upload_file_names)
        ? quote.upload_file_names
        : null) ??
      [];
    const companyName =
      sanitizeDisplayName(quote.company) ??
      sanitizeDisplayName(quote.customer_name) ??
      "Customer";
    const createdAt = match.createdAt ?? quote.created_at ?? null;
    const targetDate = quote.target_date ?? null;
    const lastBidAt = aggregate?.lastBidAt ?? null;
    const lastActivity = resolveLastActivity({
      createdAt,
      lastBidAt,
      targetDate,
    });

    acc.push({
      id: quoteId,
      quoteId,
      companyName,
      processHint: match.processHint,
      materials: match.materialMatches,
      quantityHint: match.quantityHint ?? null,
      fileCount: fileNames.length,
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
