import { supabaseServer } from "@/lib/supabaseServer";
import type { UploadMeta } from "@/server/quotes/types";
import {
  getSupplierApprovalStatus,
  isSupplierApproved,
  listSupplierCapabilities,
  loadSupplierById,
} from "./profile";
import {
  logSupplierActivityQueryFailure,
  resolveSupplierActivityQuery,
  toSupplierActivityQueryError,
} from "./activityLogging";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SupplierActivityIdentity,
  type SupplierActivityResult,
  type SupplierApprovalStatus,
  type SupplierCapabilityRow,
  type SupplierQuoteMatch,
  type SupplierQuoteRow,
  type SupplierRow,
} from "./types";
import { canUserBid } from "@/lib/permissions";
import { computeFairnessBoost } from "@/lib/fairness";
import { approvalsEnabled } from "./flags";
import { QUOTE_OPEN_STATUSES, isOpenQuoteStatus } from "@/server/quotes/status";

const MATCH_LIMIT = 20;

export type QuoteAssignmentRow = {
  quote_id: string | null;
};

export type SupplierBidRef = {
  quote_id: string | null;
  status: string | null;
  updated_at: string | null;
};

type UploadMatchingRow = Pick<
  UploadMeta,
  "manufacturing_process" | "quantity" | "rfq_reason" | "notes"
> & {
  id: string;
};

export async function matchQuotesToSupplier(
  args: SupplierActivityIdentity,
): Promise<SupplierActivityResult<SupplierQuoteMatch[]>> {
  const supplierId = args.supplierId ?? null;
  const supplierEmail = normalizeEmail(args.supplierEmail);
  const logContext = {
    supplierId,
    supplierEmail,
    loader: "matches" as const,
  };

  if (!supplierId) {
    console.warn("[supplier activity] loading skipped", {
      ...logContext,
      error: "Missing supplier identity",
    });
    return {
      ok: false,
      data: [],
      error: "Missing supplier identity",
    };
  }

  console.log("[supplier activity] loading", logContext);

  try {
    const supplier = await loadSupplierById(supplierId);
    if (!supplier) {
      console.warn("[supplier activity] loading skipped", {
        ...logContext,
        error: "Supplier profile missing",
      });
      return {
        ok: false,
        data: [],
        error: "Supplier profile missing",
      };
    }

    const decisionContext = {
      supplierId: supplier.id,
      supplierEmail: supplier.primary_email ?? supplierEmail,
    };
    const approvalStatus = getSupplierApprovalStatus(supplier);
    const approvalsOn = approvalsEnabled();
    const approved = approvalsOn ? isSupplierApproved(supplier) : true;

    if (approvalsOn && !approved) {
      logMatchDecision("supplier skipped - not approved", {
        ...decisionContext,
        approvalStatus,
        approvalsEnabled: approvalsOn,
        supplierApproved: approved,
      });
      console.log("[supplier activity] approvals gate active", {
        ...logContext,
        approvalStatus,
      });
      return {
        ok: true,
        data: [],
        approvalGate: {
          enabled: true,
          status: approvalStatus,
        },
      };
    }

    const [capabilities, assignmentRows, bidRows] = await Promise.all([
      listSupplierCapabilities(supplier.id),
      selectQuoteAssignmentsByEmail(supplier.primary_email),
      selectBidQuoteRefs(supplier.id),
    ]);

    const normalizedCapabilities = normalizeCapabilities(capabilities);
    if (normalizedCapabilities.processes.size === 0) {
      logMatchDecision("supplier skipped - capability mismatch", {
        ...decisionContext,
        reason: "No manufacturing processes recorded",
      });
      console.log("[supplier activity] quote query result", {
        ...logContext,
        count: 0,
      });
      return {
        ok: true,
        data: [],
      };
    }

    const authorizedQuoteIds = new Set<string>();
    assignmentRows.forEach((row) => {
      if (row?.quote_id) {
        authorizedQuoteIds.add(row.quote_id);
      }
    });
    bidRows.forEach((row) => {
      if (row?.quote_id) {
        authorizedQuoteIds.add(row.quote_id);
      }
    });

    const canViewGlobalMatches = supplier.verified || (approvalsOn && approved);

    const quotes = await selectOpenQuotes();
    if (quotes.length === 0) {
      console.log("[supplier activity] quote query result", {
        ...logContext,
        count: 0,
      });
      return {
        ok: true,
        data: [],
      };
    }

    const uploadMetaMap = await selectUploadMeta(quotes);

    const fairness = computeFairnessBoost({
      assignmentCount: assignmentRows.length,
      recentBidOutcomes: bidRows,
      supplierCreatedAt: supplier.created_at,
    });

    const matches: SupplierQuoteMatch[] = [];

    for (const quote of quotes) {
      const quoteId = quote.id;
      const quoteStatus = quote.status ?? null;
      const decisionPayload = {
        ...decisionContext,
        quoteId,
        quoteStatus,
      };

      if (!isOpenQuoteStatus(quoteStatus)) {
        logMatchDecision("supplier skipped - RFQ not open", decisionPayload);
        continue;
      }

      const uploadMeta = quote.upload_id
        ? uploadMetaMap.get(quote.upload_id)
        : null;

      const processHint = uploadMeta?.manufacturing_process ?? null;
      const normalizedProcess = normalizeProcess(processHint);
      const hasProcessMatch = normalizedProcess
        ? hasMatchingProcess(normalizedProcess, normalizedCapabilities.processes)
        : false;

      if (!hasProcessMatch) {
        logMatchDecision("supplier skipped - capability mismatch", {
          ...decisionPayload,
          processHint,
        });
        continue;
      }

      const canAccess =
        canViewGlobalMatches || (quoteId ? authorizedQuoteIds.has(quoteId) : false);

      if (!canAccess) {
        logMatchDecision("supplier skipped - supplier inactive", {
          ...decisionPayload,
          approvalsEnabled: approvalsOn,
          supplierApproved: approved,
          supplierVerified: supplier.verified,
          reason: supplier.verified
            ? "supplier not assigned to RFQ"
            : "supplier not verified for global feed",
        });
        continue;
      }

      const supplierBidMeta = bidRows.find((bid) => bid.quote_id === quoteId);
      const canBid = canUserBid("supplier", {
        status: quote.status,
        existingBidStatus: supplierBidMeta?.status ?? null,
        accessGranted: canAccess,
      });

      if (!canBid) {
        logMatchDecision("supplier skipped - bidding blocked", {
          ...decisionPayload,
          existingBidStatus: supplierBidMeta?.status ?? null,
          reason: "permission matrix denied bidding",
        });
        continue;
      }

      const materialMatches = findMaterialMatches(
        uploadMeta,
        normalizedCapabilities.materials,
      );

      const baseScore = computeMatchScore({
        createdAt: quote.created_at,
        materialMatches,
      });
      const score = baseScore + fairness.modifier;

      matches.push({
        quoteId,
        quote,
        processHint,
        materialMatches,
        score,
        createdAt: quote.created_at ?? null,
        quantityHint: uploadMeta?.quantity ?? null,
        fairness: fairness.reasons.length > 0 ? fairness : undefined,
      });

      logMatchDecision("supplier matched", {
        ...decisionPayload,
        processHint,
        score,
      });

      if (matches.length >= MATCH_LIMIT) {
        break;
      }
    }

    const sortedMatches = matches.sort((a, b) => b.score - a.score);

    console.log("[supplier activity] quote query result", {
      ...logContext,
      count: sortedMatches.length,
    });

    return {
      ok: true,
      data: sortedMatches,
    };
  } catch (error) {
    logSupplierActivityQueryFailure({
      ...logContext,
      query: resolveSupplierActivityQuery(error, "matchQuotesToSupplier"),
      error,
    });
    return {
      ok: false,
      data: [],
      error: "Unable to load matches right now",
    };
  }
}

type MatchDecisionEvent =
  | "supplier skipped - not approved"
  | "supplier skipped - capability mismatch"
  | "supplier skipped - RFQ not open"
  | "supplier skipped - supplier inactive"
  | "supplier skipped - bidding blocked"
  | "supplier matched";

type MatchDecisionPayload = {
  supplierId: string | null;
  supplierEmail: string | null;
  quoteId?: string | null;
  quoteStatus?: string | null;
  processHint?: string | null;
  reason?: string;
  approvalsEnabled?: boolean;
  supplierApproved?: boolean;
  supplierVerified?: boolean;
  approvalStatus?: SupplierApprovalStatus;
  score?: number;
  existingBidStatus?: string | null;
};

function logMatchDecision(event: MatchDecisionEvent, payload: MatchDecisionPayload) {
  console.log(`[matching] ${event}`, payload);
}

export function normalizeCapabilities(capabilities: SupplierCapabilityRow[]) {
  const processes = new Set<string>();
  const materials = new Set<string>();

  capabilities.forEach((capability) => {
    const normalizedProcess = normalizeProcess(capability.process);
    if (normalizedProcess) {
      processes.add(normalizedProcess);
    }

    (capability.materials ?? []).forEach((material) => {
      const normalizedMaterial = normalizeMaterial(material);
      if (normalizedMaterial) {
        materials.add(normalizedMaterial);
      }
    });
  });

  return { processes, materials };
}

export function normalizeProcess(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeMaterial(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export function hasMatchingProcess(
  quoteProcess: string,
  supplierProcesses: Set<string>,
): boolean {
  if (supplierProcesses.has(quoteProcess)) {
    return true;
  }
  for (const candidate of supplierProcesses) {
    if (quoteProcess.includes(candidate) || candidate.includes(quoteProcess)) {
      return true;
    }
  }
  return false;
}

function findMaterialMatches(
  uploadMeta: UploadMatchingRow | null | undefined,
  supplierMaterials: Set<string>,
): string[] {
  if (!uploadMeta || supplierMaterials.size === 0) {
    return [];
  }

  const searchableText = [
    uploadMeta.notes ?? "",
    uploadMeta.rfq_reason ?? "",
  ]
    .join(" ")
    .toLowerCase();

  const matches: string[] = [];
  supplierMaterials.forEach((material) => {
    if (material.length === 0) {
      return;
    }
    if (searchableText.includes(material)) {
      matches.push(material);
    }
  });

  return matches;
}

function computeMatchScore({
  createdAt,
  materialMatches,
}: {
  createdAt?: string | null;
  materialMatches: string[];
}): number {
  let score = 1;
  score += materialMatches.length * 0.5;

  if (createdAt) {
    const createdMs = Date.parse(createdAt);
    if (!Number.isNaN(createdMs)) {
      const days = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
      const recencyBoost = Math.max(0, 30 - days);
      score += recencyBoost / 10;
    }
  }

  return score;
}

export function normalizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

async function selectOpenQuotes(): Promise<SupplierQuoteRow[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(","))
      .in("status", Array.from(QUOTE_OPEN_STATUSES))
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw toSupplierActivityQueryError("quotes_with_uploads", error);
    }

    return ((data ?? []) as unknown) as SupplierQuoteRow[];
  } catch (error) {
    throw toSupplierActivityQueryError("quotes_with_uploads", error);
  }
}

async function selectUploadMeta(quotes: SupplierQuoteRow[]) {
  const uploadIds = Array.from(
    new Set(
      quotes
        .map((quote) => quote.upload_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );

  if (uploadIds.length === 0) {
    return new Map<string, UploadMatchingRow>();
  }

  try {
    const { data, error } = await supabaseServer
      .from("uploads")
      .select(
        "id,manufacturing_process,quantity,rfq_reason,notes",
      )
      .in("id", uploadIds);

    if (error) {
      throw toSupplierActivityQueryError("uploads", error);
    }

    const map = new Map<string, UploadMatchingRow>();
    (data ?? []).forEach((row) => {
      if (row?.id) {
        map.set(row.id, row as UploadMatchingRow);
      }
    });
    return map;
  } catch (error) {
    throw toSupplierActivityQueryError("uploads", error);
  }
}

export async function selectQuoteAssignmentsByEmail(email: string) {
  if (!email) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_suppliers")
      .select("quote_id")
      .eq("supplier_email", email);

    if (error) {
      throw toSupplierActivityQueryError("quote_suppliers", error);
    }

    return (data as QuoteAssignmentRow[]) ?? [];
  } catch (error) {
    throw toSupplierActivityQueryError("quote_suppliers", error);
  }
}

export async function selectBidQuoteRefs(supplierId: string) {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,status,updated_at")
      .eq("supplier_id", supplierId);

    if (error) {
      throw toSupplierActivityQueryError("supplier_bids", error);
    }

    return (data as SupplierBidRef[]) ?? [];
  } catch (error) {
    throw toSupplierActivityQueryError("supplier_bids", error);
  }
}
