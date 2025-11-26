import { supabaseServer } from "@/lib/supabaseServer";
import { loadSupplierById } from "@/server/suppliers/profile";
import type { SupplierRow } from "@/server/suppliers/types";
import { explainScore, MIN_MATCH_SCORE } from "./matching";
import { logMarketplaceEvent } from "./events";
import { isMissingRfqTableError, isRfqsFeatureEnabled } from "./flags";
import type {
  ListOpenRfqsResult,
  MarketplaceRfq,
  MarketplaceRfqStatus,
  MatchableRfq,
} from "./types";

const RFQ_SELECT_FIELDS = [
  "id",
  "customer_id",
  "status",
  "title",
  "description",
  "quantity",
  "process_requirements",
  "material_requirements",
  "certification_requirements",
  "target_date",
  "created_at",
  "updated_at",
  "priority",
  "files",
  "upload_id",
].join(",");

export const OPEN_RFQ_STATUSES: MarketplaceRfqStatus[] = [
  "open",
  "in_review",
  "pending_award",
];

export async function loadRfqById(rfqId: string): Promise<MarketplaceRfq | null> {
  if (!rfqId || !isRfqsFeatureEnabled()) {
    return null;
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select(RFQ_SELECT_FIELDS)
      .eq("id", rfqId)
      .maybeSingle<MarketplaceRfq>();

    if (error) {
      if (isMissingRfqTableError(error)) {
        return null;
      }
      console.error("marketplace: loadRfqById failed", { rfqId, error });
      return null;
    }

    return data ?? null;
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return null;
    }
    console.error("marketplace: loadRfqById unexpected error", { rfqId, error });
    return null;
  }
}

export async function listOpenRfqsForSupplier(
  supplierId: string,
): Promise<ListOpenRfqsResult> {
  if (!supplierId) {
    return { rfqs: [], error: "Supplier ID is required" };
  }

  if (!isRfqsFeatureEnabled()) {
    return { rfqs: [], error: null };
  }

  const supplier = await loadSupplierById(supplierId);
  if (!supplier) {
    return { rfqs: [], error: "Supplier not found" };
  }

  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .select(RFQ_SELECT_FIELDS)
      .in("status", OPEN_RFQ_STATUSES)
      .order("created_at", { ascending: false });

    if (error) {
      if (isMissingRfqTableError(error)) {
        return { rfqs: [], error: null };
      }
      console.error("marketplace: listOpenRfqsForSupplier query failed", {
        supplierId,
        error,
      });
      return { rfqs: [], error: "Unable to load RFQs" };
    }

    const rfqs = (Array.isArray(data) ? data : []) as unknown as MarketplaceRfq[];
    const evaluationCache = new Map<string, Promise<MatchableRfq | null>>();

    const visibleResults = await Promise.all(
      rfqs.map((rfq) =>
        getVisibleRfqForSupplier({
          rfq,
          supplier,
          evaluationCache,
        }),
      ),
    );

    const filtered = visibleResults.filter(
      (entry): entry is MatchableRfq => Boolean(entry),
    );

    return {
      rfqs: filtered,
      error: null,
    };
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return { rfqs: [], error: null };
    }
    console.error("marketplace: listOpenRfqsForSupplier unexpected error", {
      supplierId,
      error,
    });
    return { rfqs: [], error: "Unexpected error while loading RFQs" };
  }
}

export async function updateRfqStatus(
  rfqId: string,
  status: MarketplaceRfqStatus,
): Promise<MarketplaceRfq | null> {
  if (!rfqId || !isRfqsFeatureEnabled()) {
    return null;
  }

  const previous = await loadRfqById(rfqId);

  try {
    const { data, error } = await supabaseServer
      .from("rfqs")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rfqId)
      .select(RFQ_SELECT_FIELDS)
      .maybeSingle<MarketplaceRfq>();

    if (error) {
      if (isMissingRfqTableError(error)) {
        return null;
      }
      console.error("marketplace: updateRfqStatus failed", { rfqId, status, error });
      return null;
    }

    const updated = data ?? null;

    if (
      updated &&
      status === "open" &&
      (!previous || previous.status !== "open")
    ) {
      await logMarketplaceEvent({
        rfqId,
        type: "rfq_opened",
        actorId: null,
        supplierId: null,
        customerId: updated.customer_id ?? null,
        payload: {
          previous_status: previous?.status ?? null,
        },
      });
    }

    return updated;
  } catch (error) {
    if (isMissingRfqTableError(error)) {
      return null;
    }
    console.error("marketplace: updateRfqStatus unexpected error", {
      rfqId,
      status,
      error,
    });
    return null;
  }
}

async function getVisibleRfqForSupplier(args: {
  rfq: MarketplaceRfq;
  supplier: SupplierRow;
  evaluationCache: Map<string, Promise<MatchableRfq | null>>;
}): Promise<MatchableRfq | null> {
  const cacheKey = `${args.rfq.id}:${args.supplier.id}`;
  const cached = args.evaluationCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const evaluationPromise = (async () => {
    const breakdown = await explainScore(args.rfq, args.supplier);
    const score = Math.round(breakdown.total);

    if (score < MIN_MATCH_SCORE) {
      await logMarketplaceEvent({
        rfqId: args.rfq.id,
        type: "visibility_filtered",
        supplierId: args.supplier.id,
        actorId: args.supplier.id,
        payload: {
          score,
          threshold: MIN_MATCH_SCORE,
          factors: breakdown.factors,
        },
      });
      return null;
    }

    return {
      ...args.rfq,
      match_score: score,
      match_explanation: breakdown,
    };
  })().finally(() => {
    args.evaluationCache.delete(cacheKey);
  });

  args.evaluationCache.set(cacheKey, evaluationPromise);
  return evaluationPromise;
}
