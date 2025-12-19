import { requireAdminUser } from "@/server/auth";
import { loadAdminSupplierBenchHealth, type SupplierBenchHealthRow } from "@/server/suppliers/benchHealth";
import {
  loadSupplierReputationForSuppliers,
  type SupplierReputationLabel,
} from "@/server/suppliers/reputation";

export type AdminSupplierDiscoveryRow = SupplierBenchHealthRow & {
  reputationScore: number | null;
  reputationLabel: SupplierReputationLabel;
};

export async function loadAdminSupplierDiscovery(): Promise<AdminSupplierDiscoveryRow[]> {
  await requireAdminUser();
  const rows = await loadAdminSupplierBenchHealth();
  const reputationBySupplierId = await loadSupplierReputationForSuppliers(
    rows.map((row) => row.supplierId),
  );

  return rows.map((row) => {
    const rep = reputationBySupplierId[row.supplierId] ?? null;
    return {
      ...row,
      reputationScore: rep?.score ?? null,
      reputationLabel: rep?.label ?? "unknown",
    };
  });
}

