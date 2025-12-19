import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadSupplierProfileByUserId } from "@/server/suppliers/profile";
import { loadSupplierSelfBenchHealth } from "@/server/suppliers/benchHealth";
import {
  matchQuotesToSupplier,
  normalizeCapabilities,
  normalizeEmail,
  normalizeProcess,
} from "@/server/suppliers/matching";
import { deriveQuotePrimaryLabel } from "@/server/quotes/fileSummary";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { isOpenQuoteStatus, normalizeQuoteStatus } from "@/server/quotes/status";

/**
 * INVENTORY (existing supplier RFQ list as of Dec 2025)
 *
 * - **Where the supplier RFQ list is loaded today**
 *   - `loadSupplierQuotesList` in `src/server/suppliers/quotesList.ts`
 *     - Visibility is the union of: awarded-to-supplier, supplier bids, quote invites,
 *       legacy `quotes.assigned_supplier_email`, and `quote_suppliers` (by supplier email).
 *     - Base quote data comes from `quotes_with_uploads` (selected columns include:
 *       `id`, `file_name`, `company`, `customer_name`, `customer_email`, `status`,
 *       timestamps, award columns, and upload file arrays/counts).
 *     - Enrichment includes: unread message summary, kickoff tasks completion, parts coverage
 *       signals, plus supplier-level `matchHealth` + `benchStatus` from
 *       `loadSupplierSelfBenchHealth(supplierId)`.
 *     - Sort is by `lastActivityAt` (derived from messages/bids/quote timestamps), descending.
 *
 * - **How `/supplier/rfqs` currently renders**
 *   - `src/app/(portals)/supplier/rfqs/page.tsx` is currently a re-export of
 *     `src/app/(portals)/supplier/quotes/page.tsx` (so `/supplier/rfqs` and `/supplier/quotes`
 *     are identical today).
 *   - The current UI is a “Quotes / RFQs you’re invited to, have bid on, or have been awarded.”
 *     It provides filters for: status (open/closed/awarded), kickoff status, messages, and
 *     parts coverage; and shows columns for RFQ label, status, parts, kickoff, messages,
 *     supplier-level match/bench chips, and last activity time.
 *
 * - **Existing “match / routing” hints we can reuse**
 *   - `matchQuotesToSupplier` in `src/server/suppliers/matching.ts` scans open quotes from
 *     `quotes_with_uploads`, uses `uploads.manufacturing_process` as a process hint, and
 *     applies access rules:
 *       - Global feed allowed for verified (or approved when approvals are enabled), otherwise
 *         only authorized quote IDs via assignments/invites/bids.
 *       - Uses `canUserBid(...)` to enforce “open for bidding” and bid-locked rules.
 *     - It also derives coarse material matches by searching upload text (`uploads.notes`,
 *       `uploads.rfq_reason`) for supplier material keywords.
 *
 * This file adds a *read-only*, supplier-specific discovery loader for `/supplier/rfqs` that
 * ranks open RFQs by a simple “Recommended” score using existing signals + bench health.
 */

export type SupplierRfqsDiscoveryFilters = {
  status?: string | null; // e.g. "open", "closed", etc.
  process?: string | null;
  material?: string | null;
  region?: string | null;
  matchHealth?: "good" | "caution" | "poor" | "unknown" | null;
  benchStatus?: "underused" | "balanced" | "overused" | "unknown" | null;
  search?: string | null; // RFQ / customer search
};

export type SupplierRfqsDiscoveryRow = {
  quoteId: string;
  rfqLabel: string;
  customerName: string | null;
  region: string | null;
  status: string;
  dueAt: string | null;
  processes: string[];
  materials: string[];
  matchHealth: "good" | "caution" | "poor" | "unknown";
  benchStatus: "underused" | "balanced" | "overused" | "unknown";
  recommendedScore: number;
  isAlreadyInvited: boolean;
  hasAlreadyBid: boolean;
};

type UploadRegionRow = {
  id: string;
  shipping_postal_code: string | null;
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLower(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function uniq(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function parseCountryCode(value: string | null | undefined): string | null {
  const v = normalizeLower(value);
  if (!v) return null;
  if (v === "us" || v === "usa" || v === "united states" || v === "united states of america") {
    return "US";
  }
  if (v === "ca" || v === "canada") return "CA";
  if (v.length === 2) return v.toUpperCase();
  return null;
}

function deriveCountryFromPostalCode(postal: string | null): string | null {
  const value = normalizeText(postal);
  if (!value) return null;
  // Very rough: enough to make the “region” column/filter useful without schema changes.
  if (/^\d{5}(-\d{4})?$/.test(value)) return "US";
  if (/^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(value)) return "CA";
  return null;
}

function includesLoose(haystack: string, needle: string): boolean {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  return h.includes(n);
}

function intersectsNormalized(values: string[], normalizedSet: Set<string>): boolean {
  for (const value of values) {
    const n = value.trim().toLowerCase();
    if (n && normalizedSet.has(n)) return true;
  }
  return false;
}

function isDueWithinHours(iso: string | null, hours: number): boolean {
  if (!iso) return false;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  const diff = ts - now;
  if (diff <= 0) return false;
  return diff <= hours * 60 * 60 * 1000;
}

function toSortKey(value: string | null): string {
  return normalizeText(value).toLowerCase();
}

function normalizeNullableFilter(value: unknown): string | null {
  const t = normalizeText(value);
  return t.length > 0 ? t : null;
}

export async function loadSupplierRfqsDiscovery(
  supplierUserId: string,
  filters: SupplierRfqsDiscoveryFilters,
): Promise<SupplierRfqsDiscoveryRow[]> {
  const userId = normalizeText(supplierUserId);
  if (!userId) return [];

  const resolvedFilters: SupplierRfqsDiscoveryFilters = {
    status: normalizeNullableFilter(filters?.status),
    process: normalizeNullableFilter(filters?.process),
    material: normalizeNullableFilter(filters?.material),
    region: normalizeNullableFilter(filters?.region),
    matchHealth: (filters?.matchHealth ?? null) as any,
    benchStatus: (filters?.benchStatus ?? null) as any,
    search: normalizeNullableFilter(filters?.search),
  };

  try {
    const profile = await loadSupplierProfileByUserId(userId);
    const supplier = profile?.supplier ?? null;
    if (!supplier?.id) return [];

    const supplierId = supplier.id;
    const supplierEmail = normalizeEmail(supplier.primary_email ?? null);
    const supplierCountryCode = parseCountryCode(supplier.country);

    const [bench, matchResult] = await Promise.all([
      loadSupplierSelfBenchHealth(supplierId).catch((error) => {
        console.error("[supplier rfqs discovery] bench health load failed", {
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
        return null;
      }),
      matchQuotesToSupplier(
        { supplierId, supplierEmail },
        // Small-ish scan: this is a portal page load.
        { maxMatches: 200, quoteFetchLimit: 400 },
      ).catch((error) => {
        console.error("[supplier rfqs discovery] matchQuotesToSupplier crashed", {
          supplierId,
          error: serializeSupabaseError(error) ?? error,
        });
        return { ok: false, data: [] as any[] } as const;
      }),
    ]);

    const matchHealth: SupplierRfqsDiscoveryRow["matchHealth"] =
      bench?.matchHealth ?? "unknown";
    const benchStatus: SupplierRfqsDiscoveryRow["benchStatus"] =
      bench?.benchStatus ?? "unknown";

    // Filter by supplier-level match/bench first (cheap).
    if (resolvedFilters.matchHealth && resolvedFilters.matchHealth !== matchHealth) return [];
    if (resolvedFilters.benchStatus && resolvedFilters.benchStatus !== benchStatus) return [];

    const matches = Array.isArray(matchResult?.data) ? matchResult.data : [];
    if (matches.length === 0) return [];

    const capabilities = profile?.capabilities ?? [];
    const capabilityProfile = normalizeCapabilities(capabilities);

    const quoteIds = uniq(
      matches
        .map((m) => normalizeText((m as any)?.quoteId ?? (m as any)?.quote?.id))
        .filter(Boolean),
    );

    const uploadIds = uniq(
      matches
        .map((m) => normalizeText((m as any)?.quote?.upload_id))
        .filter(Boolean),
    );

    const [invitesResult, bidsResult, assignmentsResult, uploadRegionsResult] =
      await Promise.all([
        supabaseServer
          .from("quote_invites")
          .select("quote_id")
          .eq("supplier_id", supplierId)
          .in("quote_id", quoteIds)
          .returns<Array<{ quote_id: string | null }>>(),
        supabaseServer
          .from("supplier_bids")
          .select("quote_id")
          .eq("supplier_id", supplierId)
          .in("quote_id", quoteIds)
          .returns<Array<{ quote_id: string | null }>>(),
        supplierEmail
          ? supabaseServer
              .from("quote_suppliers")
              .select("quote_id")
              .eq("supplier_email", supplierEmail)
              .in("quote_id", quoteIds)
              .returns<Array<{ quote_id: string | null }>>()
          : (Promise.resolve({ data: [], error: null }) as any),
        uploadIds.length > 0
          ? supabaseServer
              .from("uploads")
              .select("id,shipping_postal_code")
              .in("id", uploadIds)
              .returns<UploadRegionRow[]>()
          : (Promise.resolve({ data: [], error: null }) as any),
      ]);

    // Best-effort: ignore optional/missing tables.
    if (invitesResult.error && !isMissingTableOrColumnError(invitesResult.error)) {
      console.error("[supplier rfqs discovery] quote_invites query failed", {
        supplierId,
        error: serializeSupabaseError(invitesResult.error) ?? invitesResult.error,
      });
    }
    if (bidsResult.error && !isMissingTableOrColumnError(bidsResult.error)) {
      console.error("[supplier rfqs discovery] supplier_bids query failed", {
        supplierId,
        error: serializeSupabaseError(bidsResult.error) ?? bidsResult.error,
      });
    }
    if (assignmentsResult.error && !isMissingTableOrColumnError(assignmentsResult.error)) {
      console.error("[supplier rfqs discovery] quote_suppliers query failed", {
        supplierId,
        error: serializeSupabaseError(assignmentsResult.error) ?? assignmentsResult.error,
      });
    }
    if (uploadRegionsResult.error && !isMissingTableOrColumnError(uploadRegionsResult.error)) {
      console.error("[supplier rfqs discovery] uploads region query failed", {
        supplierId,
        error: serializeSupabaseError(uploadRegionsResult.error) ?? uploadRegionsResult.error,
      });
    }

    const invitedQuoteIds = new Set<string>();
    for (const row of invitesResult.data ?? []) {
      const id = normalizeText((row as any)?.quote_id);
      if (id) invitedQuoteIds.add(id);
    }
    for (const row of assignmentsResult.data ?? []) {
      const id = normalizeText((row as any)?.quote_id);
      if (id) invitedQuoteIds.add(id);
    }

    const bidQuoteIds = new Set<string>();
    for (const row of bidsResult.data ?? []) {
      const id = normalizeText((row as any)?.quote_id);
      if (id) bidQuoteIds.add(id);
    }

    const uploadPostalById = new Map<string, string | null>();
    for (const row of uploadRegionsResult.data ?? []) {
      const id = normalizeText((row as any)?.id);
      if (!id) continue;
      uploadPostalById.set(id, normalizeNullableFilter((row as any)?.shipping_postal_code));
    }

    const rows: SupplierRfqsDiscoveryRow[] = matches
      .map((match: any): SupplierRfqsDiscoveryRow | null => {
        const quote = match?.quote ?? null;
        const quoteId = normalizeText(match?.quoteId ?? quote?.id);
        if (!quote || !quoteId) return null;

        const files = buildQuoteFilesFromRow(quote as any);
        const rfqLabel = deriveQuotePrimaryLabel(quote as any, { files });

        const customerName =
          normalizeNullableFilter(quote.company) ?? normalizeNullableFilter(quote.customer_name);

        const normalizedStatus = normalizeQuoteStatus(quote.status);
        // Defensive: discovery is meant to be “open for bidding” (matchQuotesToSupplier already
        // applies this via canUserBid), but keep the guard here too.
        if (!isOpenQuoteStatus(normalizedStatus)) return null;

        const dueAt = normalizeNullableFilter(quote.target_date);
        const processHintRaw = normalizeNullableFilter(match?.processHint);
        const processHintNormalized = normalizeProcess(processHintRaw);

        const processes = uniq(processHintRaw ? [processHintRaw] : []);
        const materials = uniq(
          Array.isArray(match?.materialMatches)
            ? match.materialMatches
                .map((m: any) => (typeof m === "string" ? m.trim() : ""))
                .filter(Boolean)
            : [],
        );

        const uploadId = normalizeText(quote.upload_id);
        const postal = uploadId ? uploadPostalById.get(uploadId) ?? null : null;
        const inferredCountry = deriveCountryFromPostalCode(postal);
        const region = inferredCountry ?? postal ?? null;

        const isAlreadyInvited =
          invitedQuoteIds.has(quoteId) ||
          (supplierEmail &&
            normalizeEmail(quote.assigned_supplier_email ?? null) === supplierEmail) ||
          false;
        const hasAlreadyBid = bidQuoteIds.has(quoteId);

        let recommendedScore = 0;
        if (processHintNormalized && capabilityProfile.processes.has(processHintNormalized)) {
          recommendedScore += 30;
        } else if (processHintNormalized) {
          // Fuzzy process match (similar to the supplier matching logic).
          for (const candidate of capabilityProfile.processes) {
            if (
              processHintNormalized.includes(candidate) ||
              candidate.includes(processHintNormalized)
            ) {
              recommendedScore += 30;
              break;
            }
          }
        }

        if (materials.length > 0 && intersectsNormalized(materials, capabilityProfile.materials)) {
          recommendedScore += 30;
        }

        const rfqCountryCode = inferredCountry;
        if (rfqCountryCode && supplierCountryCode && rfqCountryCode === supplierCountryCode) {
          recommendedScore += 10;
        }

        if (benchStatus === "underused") recommendedScore += 20;
        if (benchStatus === "overused") recommendedScore -= 15;

        if (hasAlreadyBid) recommendedScore -= 50;

        if (isDueWithinHours(dueAt, 72)) recommendedScore += 10;

        return {
          quoteId,
          rfqLabel: rfqLabel || `RFQ-${quoteId.slice(0, 8)}`,
          customerName,
          region,
          status: normalizedStatus,
          dueAt,
          processes,
          materials,
          matchHealth,
          benchStatus,
          recommendedScore,
          isAlreadyInvited,
          hasAlreadyBid,
        };
      })
      .filter((row): row is SupplierRfqsDiscoveryRow => Boolean(row));

    const filtered = rows
      .filter((row) => {
        const f = normalizeLower(resolvedFilters.status);
        if (!f) return true;
        if (f === "open") return isOpenQuoteStatus(row.status);
        if (f === "closed") return !isOpenQuoteStatus(row.status);
        if (f === "awarded") return false; // discovery feed is "open for bidding" only
        return row.status === f;
      })
      .filter((row) => {
        const f = normalizeLower(resolvedFilters.process);
        if (!f) return true;
        return row.processes.some((p) => includesLoose(p, f));
      })
      .filter((row) => {
        const f = normalizeLower(resolvedFilters.material);
        if (!f) return true;
        return row.materials.some((m) => includesLoose(m, f));
      })
      .filter((row) => {
        const f = normalizeLower(resolvedFilters.region);
        if (!f) return true;
        return includesLoose(row.region ?? "", f);
      })
      .filter((row) => {
        const f = normalizeLower(resolvedFilters.search);
        if (!f) return true;
        return (
          includesLoose(row.rfqLabel, f) ||
          includesLoose(row.customerName ?? "", f) ||
          includesLoose(row.quoteId, f)
        );
      });

    filtered.sort((a, b) => {
      if (a.recommendedScore !== b.recommendedScore) {
        return b.recommendedScore - a.recommendedScore;
      }
      const aDue = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
      if (aDue !== bDue) return aDue - bDue;
      const aCustomer = toSortKey(a.customerName);
      const bCustomer = toSortKey(b.customerName);
      if (aCustomer !== bCustomer) return aCustomer.localeCompare(bCustomer);
      return toSortKey(a.rfqLabel).localeCompare(toSortKey(b.rfqLabel));
    });

    return filtered;
  } catch (error) {
    console.error("[supplier rfqs discovery] load failed", {
      supplierUserId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

