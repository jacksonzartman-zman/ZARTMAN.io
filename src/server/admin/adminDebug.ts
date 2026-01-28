import "server-only";

function isProdEnv(): boolean {
  const nodeEnvRaw = process.env.NODE_ENV ?? "";
  const vercelEnvRaw = process.env.VERCEL_ENV ?? "";

  const nodeEnv = nodeEnvRaw.trim().toLowerCase();
  const vercelEnv = vercelEnvRaw.trim().toLowerCase();

  // On Vercel, NODE_ENV is "production" even for Preview; prefer VERCEL_ENV when present.
  return vercelEnv ? vercelEnv === "production" : nodeEnv === "production";
}

/**
 * DEMO-safe admin debug logging gate.
 *
 * - Enabled in non-prod envs (local/dev/preview).
 */
export function shouldLogAdminDebug(): boolean {
  return !isProdEnv();
}

