import "server-only";

import { cookies } from "next/headers";
import { isDemoModeEnabled } from "@/server/demo/demoMode";

export const DEMO_SUPPLIER_PROVIDER_COOKIE_NAME = "zartman_demo_provider_id" as const;

function normalizeProviderId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Demo-only supplier provider context (no SQL migrations).
 *
 * - Enabled only when `DEMO_MODE` is on and this is not a production environment.
 * - Stored in an httpOnly cookie so it never reaches client bundles.
 */
export async function getDemoSupplierProviderIdFromCookie(): Promise<string | null> {
  if (!isDemoModeEnabled()) return null;
  const store = await cookies();
  return normalizeProviderId(store.get(DEMO_SUPPLIER_PROVIDER_COOKIE_NAME)?.value);
}

