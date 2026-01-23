import "server-only";

import { debugOnce } from "@/server/db/schemaErrors";

export function isDemoModeEnabled(): boolean {
  const raw = typeof process.env.DEMO_MODE === "string" ? process.env.DEMO_MODE.trim() : "";
  const demoFlag =
    raw === "1" ||
    raw.toLowerCase() === "true" ||
    raw.toLowerCase() === "yes" ||
    raw.toLowerCase() === "on";

  const nodeEnvRaw = process.env.NODE_ENV ?? "";
  const vercelEnvRaw = process.env.VERCEL_ENV ?? "";

  const nodeEnv = nodeEnvRaw.trim().toLowerCase();
  const vercelEnv = vercelEnvRaw.trim().toLowerCase();

  /**
   * Production safety:
   * - On Vercel, `NODE_ENV` is "production" even for Preview deployments, so we
   *   must primarily rely on `VERCEL_ENV` when present.
   * - Off-Vercel, fall back to `NODE_ENV`.
   */
  const isProd = vercelEnv ? vercelEnv === "production" : nodeEnv === "production";
  const enabled = demoFlag && !isProd;

  debugOnce("demo-mode-env", "[demo] demo mode gating", {
    enabled,
    demoFlag,
    isProd,
    DEMO_MODE: raw || null,
    VERCEL_ENV: vercelEnvRaw || null,
    NODE_ENV: nodeEnvRaw || null,
  });

  return enabled;
}

export function assertDemoModeEnabled(): void {
  if (isDemoModeEnabled()) return;
  throw new Error("Demo mode is disabled.");
}

