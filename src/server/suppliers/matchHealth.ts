import { supabaseServer } from "@/lib/supabaseServer";
import { canUserBid } from "@/lib/permissions";
import {
  approvalsEnabled,
  isMissingQuoteAwardColumnsError,
} from "./flags";
import {
  isSupplierApproved,
  listSupplierCapabilities,
  loadSupplierById,
} from "./profile";
import {
  hasMatchingProcess,
  normalizeCapabilities,
  normalizeEmail,
  normalizeProcess,
  selectBidQuoteRefs,
  selectQuoteAssignmentsByEmail,
} from "./matching";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SupplierMatchHealth,
  type SupplierQuoteRow,
} from "./types";
import { QUOTE_OPEN_STATUSES } from "@/server/quotes/status";
import {
  isSupplierActivityQueryFailure,
  toSupplierActivityQueryError,
} from "./activityLogging";

const DEFAULT_LOOKBACK_DAYS = 30;
const MATCH_HEALTH_QUOTE_LIMIT = 200;

type MatchHealthEvent = {
  quoteId: string;
  status: string | null;
  processHint: string | null;
  createdAt: string | null;
  outcome: SupplierMatchHealth["recentExamples"][number]["outcome"];
};

type UploadProcessRow = {
  id: string;
  manufacturing_process: string | null;
};

export async function loadSupplierMatchHealth(
  supplierId: string,
  options?: { lookbackDays?: number },
): Promise<SupplierMatchHealth> {
  const normalizedSupplierId = typeof supplierId === "string" ? supplierId.trim() : "";
  const lookbackDays = coerceLookbackDays(options?.lookbackDays);
  const defaultHealth = createEmptyMatchHealth(normalizedSupplierId);

  if (!normalizedSupplierId) {
    return defaultHealth;
  }

  const lookbackStartIso = getLookbackWindowStartIso(lookbackDays);

  try {
    const supplier = await loadSupplierById(normalizedSupplierId);
    if (!supplier) {
      console.warn("[supplier match] health skipped", {
        supplierId: normalizedSupplierId,
        lookbackDays,
        reason: "Supplier profile missing",
      });
      return defaultHealth;
    }

    const supplierEmail = normalizeEmail(supplier.primary_email ?? null);
    const approvalsOn = approvalsEnabled();
    const supplierApproved = approvalsOn ? isSupplierApproved(supplier) : true;

    const [capabilities, assignmentRows, bidRows, quotes] = await Promise.all([
      listSupplierCapabilities(supplier.id),
      supplierEmail ? selectQuoteAssignmentsByEmail(supplierEmail) : [],
      selectBidQuoteRefs(supplier.id),
      selectOpenQuotesSince(lookbackStartIso),
    ]);

    const normalizedCapabilities = normalizeCapabilities(capabilities);

    if (normalizedCapabilities.processes.size === 0 || quotes.length === 0) {
      console.log("[supplier match] health loaded", {
        supplierId: supplier.id,
        evaluatedCount: 0,
        matchedCount: 0,
        skippedCapabilityCount: 0,
        lookbackDays,
      });
      return {
        ...defaultHealth,
        supplierId: supplier.id,
      };
    }

    const uploadProcesses = await selectUploadProcessHints(quotes);

    const authorizedQuoteIds = buildAuthorizedQuoteIdSet(assignmentRows, bidRows);
    const bidMetaByQuoteId = buildBidMetaMap(bidRows);
    const canViewGlobalMatches = supplier.verified || (approvalsOn && supplierApproved);

    let evaluatedCount = 0;
    let matchedCount = 0;
    let skippedCapabilityCount = 0;
    const events: MatchHealthEvent[] = [];

    for (const quote of quotes) {
      const quoteId = typeof quote.id === "string" ? quote.id : null;
      if (!quoteId) {
        continue;
      }

      const processHint =
        typeof quote.upload_id === "string" && quote.upload_id.length > 0
          ? uploadProcesses.get(quote.upload_id) ?? null
          : null;
      const normalizedProcess = normalizeProcess(processHint);
      if (!normalizedProcess) {
        continue;
      }

      const hasProcessMatch = hasMatchingProcess(
        normalizedProcess,
        normalizedCapabilities.processes,
      );

      const exampleBase: Omit<MatchHealthEvent, "outcome"> = {
        quoteId,
        status: quote.status ?? null,
        processHint,
        createdAt: quote.created_at ?? null,
      };

      if (!hasProcessMatch) {
        skippedCapabilityCount += 1;
        evaluatedCount += 1;
        events.push({
          ...exampleBase,
          outcome: "skipped_capability",
        });
        continue;
      }

      const canAccess =
        canViewGlobalMatches || (quoteId ? authorizedQuoteIds.has(quoteId) : false);

      if (!canAccess) {
        continue;
      }

      const bidMeta = bidMetaByQuoteId.get(quoteId);
      const canBid = canUserBid("supplier", {
        status: quote.status,
        existingBidStatus: bidMeta?.status ?? null,
        accessGranted: true,
      });

      if (!canBid) {
        continue;
      }

      matchedCount += 1;
      evaluatedCount += 1;
      events.push({
        ...exampleBase,
        outcome: "matched",
      });
    }

    const recentExamples = selectRecentMatchHealthExamples(events, 3);

    const result: SupplierMatchHealth = {
      supplierId: supplier.id,
      evaluatedCount,
      matchedCount,
      skippedCapabilityCount,
      recentExamples,
    };

    console.log("[supplier match] health loaded", {
      supplierId: supplier.id,
      evaluatedCount,
      matchedCount,
      skippedCapabilityCount,
      lookbackDays,
    });

    return result;
  } catch (error) {
    if (isQuoteAwardSchemaError(error)) {
      console.warn("[supplier match] health skipped: missing award columns", {
        supplierId: normalizedSupplierId,
        lookbackDays,
      });
      return defaultHealth;
    }
    console.error("[supplier match] health failed", {
      supplierId: normalizedSupplierId,
      lookbackDays,
      error,
    });
    return defaultHealth;
  }
}

export function selectRecentMatchHealthExamples(
  events: MatchHealthEvent[],
  limit: number,
): SupplierMatchHealth["recentExamples"] {
  if (!Array.isArray(events) || events.length === 0) {
    return [];
  }

  const maxExamples = Math.max(1, limit);

  const sorted = [...events].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime;
  });

  return sorted.slice(0, maxExamples).map((event) => ({
    quoteId: event.quoteId,
    status: event.status ?? null,
    processHint: event.processHint ?? null,
    outcome: event.outcome,
  }));
}

function createEmptyMatchHealth(supplierId: string): SupplierMatchHealth {
  return {
    supplierId,
    evaluatedCount: 0,
    matchedCount: 0,
    skippedCapabilityCount: 0,
    recentExamples: [],
  };
}

function coerceLookbackDays(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LOOKBACK_DAYS;
  }
  if (value <= 0) {
    return DEFAULT_LOOKBACK_DAYS;
  }
  return Math.min(90, Math.round(value));
}

function getLookbackWindowStartIso(days: number): string {
  const now = Date.now();
  const ms = Math.max(1, days) * 24 * 60 * 60 * 1000;
  return new Date(now - ms).toISOString();
}

async function selectOpenQuotesSince(sinceIso: string): Promise<SupplierQuoteRow[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(","))
      .in("status", Array.from(QUOTE_OPEN_STATUSES))
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(MATCH_HEALTH_QUOTE_LIMIT);

    if (error) {
      throw toSupplierActivityQueryError("quotes_with_uploads", error);
    }

    return ((data ?? []) as unknown) as SupplierQuoteRow[];
  } catch (error) {
    throw toSupplierActivityQueryError("quotes_with_uploads", error);
  }
}

async function selectUploadProcessHints(
  quotes: SupplierQuoteRow[],
): Promise<Map<string, string | null>> {
  const uploadIds = Array.from(
    new Set(
      quotes
        .map((quote) => quote.upload_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  if (uploadIds.length === 0) {
    return new Map();
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select("id,manufacturing_process")
      .in("id", uploadIds)
      .returns<UploadProcessRow[]>();

    if (error) {
      throw toSupplierActivityQueryError("uploads", error);
    }

    const map = new Map<string, string | null>();
    (data ?? []).forEach((row) => {
      if (row?.id) {
        map.set(row.id, row.manufacturing_process ?? null);
      }
    });
    return map;
  } catch (error) {
    throw toSupplierActivityQueryError("uploads", error);
  }
}

function buildAuthorizedQuoteIdSet(
  assignments: Awaited<ReturnType<typeof selectQuoteAssignmentsByEmail>>,
  bids: Awaited<ReturnType<typeof selectBidQuoteRefs>>,
): Set<string> {
  const ids = new Set<string>();
  assignments.forEach((row) => {
    const quoteId =
      typeof row?.quote_id === "string" && row.quote_id.length > 0 ? row.quote_id : null;
    if (quoteId) {
      ids.add(quoteId);
    }
  });
  bids.forEach((row) => {
    const quoteId =
      typeof row?.quote_id === "string" && row.quote_id.length > 0 ? row.quote_id : null;
    if (quoteId) {
      ids.add(quoteId);
    }
  });
  return ids;
}

function buildBidMetaMap(
  bids: Awaited<ReturnType<typeof selectBidQuoteRefs>>,
): Map<string, { status: string | null }> {
  const map = new Map<string, { status: string | null }>();
  bids.forEach((bid) => {
    const quoteId =
      typeof bid?.quote_id === "string" && bid.quote_id.length > 0 ? bid.quote_id : null;
    if (!quoteId) {
      return;
    }
    map.set(quoteId, {
      status: bid?.status ?? null,
    });
  });
  return map;
}

function isQuoteAwardSchemaError(error: unknown): boolean {
  if (isSupplierActivityQueryFailure(error) && error.supabaseError) {
    return isMissingQuoteAwardColumnsError(error.supabaseError);
  }
  return isMissingQuoteAwardColumnsError(error);
}
