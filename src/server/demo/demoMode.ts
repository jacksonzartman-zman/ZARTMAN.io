export function isDemoModeEnabled(): boolean {
  const raw = typeof process.env.DEMO_MODE === "string" ? process.env.DEMO_MODE.trim() : "";
  const enabled =
    raw === "1" ||
    raw.toLowerCase() === "true" ||
    raw.toLowerCase() === "yes" ||
    raw.toLowerCase() === "on";

  if (!enabled) return false;

  const nodeEnv = (process.env.NODE_ENV ?? "").trim().toLowerCase();
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim().toLowerCase();
  const isProd = nodeEnv === "production" || vercelEnv === "production";
  return !isProd;
}

export function assertDemoModeEnabled(): void {
  if (isDemoModeEnabled()) return;
  throw new Error("Demo mode is disabled.");
}

