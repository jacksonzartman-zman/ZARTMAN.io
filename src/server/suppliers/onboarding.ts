import { supabaseServer } from "@/lib/supabaseServer";
import { isMissingTableOrColumnError, serializeSupabaseError } from "@/server/admin/logging";
import { loadSupplierByUserId } from "@/server/suppliers/profile";

export type SupplierOnboardingState = {
  hasAnyBids: boolean;
  hasAnyAwards: boolean;
  hasRecentCapacitySnapshot: boolean; // within last 30 days
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function loadSupplierOnboardingState(
  supplierUserId: string,
): Promise<SupplierOnboardingState> {
  const userId = normalizeId(supplierUserId);
  if (!userId) {
    return { hasAnyBids: false, hasAnyAwards: false, hasRecentCapacitySnapshot: false };
  }

  const supplier = await loadSupplierByUserId(userId);
  const supplierId = normalizeId(supplier?.id);
  if (!supplierId) {
    return { hasAnyBids: false, hasAnyAwards: false, hasRecentCapacitySnapshot: false };
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const safeHasRow = async (queryName: string, run: () => Promise<any>): Promise<boolean> => {
    try {
      const result = await run();
      if (result?.error) {
        if (isMissingTableOrColumnError(result.error)) {
          return false;
        }
        console.error("[supplier onboarding] query failed", {
          queryName,
          supplierId,
          error: serializeSupabaseError(result.error) ?? result.error,
        });
        return false;
      }
      return Array.isArray(result?.data) && result.data.length > 0;
    } catch (error) {
      if (isMissingTableOrColumnError(error)) {
        return false;
      }
      console.error("[supplier onboarding] query crashed", {
        queryName,
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
      return false;
    }
  };

  const [hasAnyBids, hasAnyAwards, hasRecentCapacitySnapshot] = await Promise.all([
    safeHasRow("supplier_bids", async () =>
      await supabaseServer()
        .from("supplier_bids")
        .select("id")
        .eq("supplier_id", supplierId)
        .limit(1),
    ),
    safeHasRow("quotes_awards", async () =>
      await supabaseServer()
        .from("quotes")
        .select("id")
        .eq("awarded_supplier_id", supplierId)
        .limit(1),
    ),
    safeHasRow("supplier_capacity_snapshots_recent", async () =>
      await supabaseServer()
        .from("supplier_capacity_snapshots")
        .select("created_at")
        .eq("supplier_id", supplierId)
        .gte("created_at", cutoff)
        .limit(1),
    ),
  ]);

  return { hasAnyBids, hasAnyAwards, hasRecentCapacitySnapshot };
}
