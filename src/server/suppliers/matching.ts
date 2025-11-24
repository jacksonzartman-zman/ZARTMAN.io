import { supabaseServer } from "@/lib/supabaseServer";
import type { QuoteWithUploadsRow, UploadMeta } from "@/server/quotes/types";
import { listSupplierCapabilities, loadSupplierById } from "./profile";
import type {
  SupplierCapabilityRow,
  SupplierQuoteMatch,
  SupplierRow,
} from "./types";
import { canUserBid } from "@/lib/permissions";
import { computeFairnessBoost } from "@/lib/fairness";

const OPEN_QUOTE_STATUSES = ["submitted", "in_review", "quoted"];
const MATCH_LIMIT = 20;

type QuoteAssignmentRow = {
  quote_id: string | null;
};

type SupplierBidRef = {
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
  supplierId: string,
): Promise<SupplierQuoteMatch[]> {
  const supplier = await loadSupplierById(supplierId);
  if (!supplier) {
    return [];
  }

  const [capabilities, assignmentRows, bidRows] = await Promise.all([
    listSupplierCapabilities(supplier.id),
    selectQuoteAssignmentsByEmail(supplier.primary_email),
    selectBidQuoteRefs(supplier.id),
  ]);

  const normalizedCapabilities = normalizeCapabilities(capabilities);
  if (normalizedCapabilities.processes.size === 0) {
    return [];
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

  const canViewGlobalMatches = supplier.verified;

  const quotes = await selectOpenQuotes();
  if (quotes.length === 0) {
    return [];
  }

  const uploadMetaMap = await selectUploadMeta(quotes);

  const fairness = computeFairnessBoost({
    assignmentCount: assignmentRows.length,
    recentBidOutcomes: bidRows,
    supplierCreatedAt: supplier.created_at,
  });

  const matches: SupplierQuoteMatch[] = [];

  for (const quote of quotes) {
    const uploadMeta = quote.upload_id
      ? uploadMetaMap.get(quote.upload_id)
      : null;

    const processHint = uploadMeta?.manufacturing_process ?? null;
    const normalizedProcess = normalizeProcess(processHint);
    const hasProcessMatch = normalizedProcess
      ? hasMatchingProcess(normalizedProcess, normalizedCapabilities.processes)
      : false;

    if (!hasProcessMatch) {
      continue;
    }

    const quoteId = quote.id;
    const canAccess =
      canViewGlobalMatches || (quoteId ? authorizedQuoteIds.has(quoteId) : false);

    if (!canAccess) {
      continue;
    }

    const supplierBidMeta = bidRows.find((bid) => bid.quote_id === quoteId);
    const canBid = canUserBid("supplier", {
      status: quote.status,
      existingBidStatus: supplierBidMeta?.status ?? null,
      accessGranted: canAccess,
    });

    if (!canBid) {
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

    if (matches.length >= MATCH_LIMIT) {
      break;
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function normalizeCapabilities(capabilities: SupplierCapabilityRow[]) {
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

function normalizeProcess(value?: string | null): string | null {
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

function hasMatchingProcess(
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

async function selectOpenQuotes(): Promise<QuoteWithUploadsRow[]> {
  try {
    const { data, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(
        [
          "id",
          "upload_id",
          "customer_name",
          "email",
          "company",
          "status",
          "price",
          "currency",
          "created_at",
          "updated_at",
          "target_date",
          "file_name",
          "assigned_supplier_email",
          "assigned_supplier_name",
          "internal_notes",
          "dfm_notes",
        ].join(","),
      )
      .in("status", OPEN_QUOTE_STATUSES)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("matchQuotesToSupplier: quote query failed", { error });
      return [];
    }

    return ((data ?? []) as unknown) as QuoteWithUploadsRow[];
  } catch (error) {
    console.error("matchQuotesToSupplier: unexpected quote error", { error });
    return [];
  }
}

async function selectUploadMeta(quotes: QuoteWithUploadsRow[]) {
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
      console.error("matchQuotesToSupplier: upload query failed", { error });
      return new Map();
    }

    const map = new Map<string, UploadMatchingRow>();
    (data ?? []).forEach((row) => {
      if (row?.id) {
        map.set(row.id, row as UploadMatchingRow);
      }
    });
    return map;
  } catch (error) {
    console.error("matchQuotesToSupplier: unexpected upload error", { error });
    return new Map();
  }
}

async function selectQuoteAssignmentsByEmail(email: string) {
  if (!email) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_suppliers")
      .select("quote_id")
      .eq("supplier_email", email);

    if (error) {
      console.error("matchQuotesToSupplier: assignment query failed", {
        email,
        error,
      });
      return [];
    }

    return (data as QuoteAssignmentRow[]) ?? [];
  } catch (error) {
    console.error("matchQuotesToSupplier: assignment unexpected error", {
      email,
      error,
    });
    return [];
  }
}

async function selectBidQuoteRefs(supplierId: string) {
  if (!supplierId) {
    return [];
  }

  try {
    const { data, error } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,status,updated_at")
      .eq("supplier_id", supplierId);

    if (error) {
      console.error("matchQuotesToSupplier: bid query failed", {
        supplierId,
        error,
      });
      return [];
    }

    return (data as SupplierBidRef[]) ?? [];
  } catch (error) {
    console.error("matchQuotesToSupplier: bid unexpected error", {
      supplierId,
      error,
    });
    return [];
  }
}
