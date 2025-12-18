import { supabaseServer } from "@/lib/supabaseServer";
import { requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { cookies } from "next/headers";

export type SystemHealthStatus = "ok" | "degraded" | "error";

export type HealthCheckId =
  | "db_connection"
  | "quotes_views"
  | "message_sla_rpc"
  | "bench_health_views"
  | "storage_uploads_bucket"
  | "auth_jwt"
  | "events_stream";

export type HealthCheckResult = {
  id: HealthCheckId;
  label: string;
  status: SystemHealthStatus;
  details?: string;
  suggestion?: string;
};

export type SystemHealthSummary = {
  status: SystemHealthStatus;
  checks: HealthCheckResult[];
};

const UPLOADS_BUCKET =
  process.env.SUPABASE_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_CAD_BUCKET ||
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  "cad";

const didLogOnce = new Set<string>();

function logOnce(level: "info" | "warn", message: string, payload?: unknown) {
  const key = `${level}:${message}`;
  if (didLogOnce.has(key)) return;
  didLogOnce.add(key);
  if (level === "warn") {
    console.warn(message, payload);
    return;
  }
  console.info(message, payload);
}

function getSerializedError(
  error: unknown,
): { code: string | null; message: string | null; details: string | null; hint: string | null } | null {
  const serialized = serializeSupabaseError(error);
  if (!serialized || typeof serialized !== "object") {
    return null;
  }
  const candidate = serialized as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
    hint?: unknown;
  };
  return {
    code: typeof candidate.code === "string" ? candidate.code : null,
    message: typeof candidate.message === "string" ? candidate.message : null,
    details: typeof candidate.details === "string" ? candidate.details : null,
    hint: typeof candidate.hint === "string" ? candidate.hint : null,
  };
}

function formatErrorDetails(error: unknown): string | null {
  const serialized = getSerializedError(error);
  const code = serialized?.code ?? null;
  const message = serialized?.message ?? null;
  const details = serialized?.details ?? null;
  const hint = serialized?.hint ?? null;

  const parts = [
    code ? `code=${code}` : null,
    message ? `message=${message}` : null,
    details ? `details=${details}` : null,
    hint ? `hint=${hint}` : null,
  ].filter(Boolean) as string[];

  return parts.length > 0 ? parts.join(" · ") : null;
}

async function safeProbe(
  _probeName: string,
  run: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<
  | { ok: true }
  | { ok: false; missingSchema: true; error: unknown }
  | { ok: false; missingSchema: false; error: unknown }
> {
  try {
    const result = await run();
    if (result?.error) {
      if (isMissingTableOrColumnError(result.error)) {
        return { ok: false, missingSchema: true, error: result.error };
      }
      return { ok: false, missingSchema: false, error: result.error };
    }
    return { ok: true };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return { ok: false, missingSchema: true, error };
    }
    return { ok: false, missingSchema: false, error };
  }
}

function getSupabaseProjectRefFromUrl(url: string): string | null {
  // Typical: https://<ref>.supabase.co
  try {
    const parsed = new URL(url);
    const host = parsed.host ?? "";
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function base64UrlDecode(input: string): string | null {
  try {
    const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function tryDecodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payloadRaw = base64UrlDecode(parts[1] ?? "");
  if (!payloadRaw) return null;
  try {
    const parsed = JSON.parse(payloadRaw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function loadSystemHealth(): Promise<SystemHealthSummary> {
  // Defense-in-depth: admin-only diagnostics uses service-role Supabase client.
  await requireAdminUser();

  const checks = await Promise.all<HealthCheckResult>([
    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "db_connection";
      const label = "DB connection";

      const probe = await safeProbe("quotes", async () =>
        supabaseServer.from("quotes").select("id").limit(1),
      );

      if (probe.ok) {
        return { id, label, status: "ok" };
      }

      if (probe.missingSchema) {
        logOnce(
          "warn",
          "[system-health] db_connection missing schema",
          serializeSupabaseError(probe.error),
        );
        return {
          id,
          label,
          status: "degraded",
          details: formatErrorDetails(probe.error) ?? "Missing schema for core quote tables/views.",
          suggestion: "Run latest SQL migrations and reload the PostgREST schema cache.",
        };
      }

      return {
        id,
        label,
        status: "error",
        details: formatErrorDetails(probe.error) ?? "Database query failed.",
        suggestion: "Verify Supabase connectivity and service role credentials.",
      };
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "quotes_views";
      const label = "Quotes views";

      const required = [
        {
          name: "quotes_with_uploads",
          run: () => supabaseServer.from("quotes_with_uploads").select("id").limit(1),
        },
        {
          name: "admin_quotes_inbox",
          run: () => supabaseServer.from("admin_quotes_inbox").select("id").limit(1),
        },
      ] as const;

      const results = await Promise.all(required.map((t) => safeProbe(t.name, t.run)));
      const missing = results
        .map((r, idx) => (!r.ok && r.missingSchema ? required[idx]?.name : null))
        .filter(Boolean) as string[];
      const failed = results
        .map((r, idx) => (!r.ok && !r.missingSchema ? required[idx]?.name : null))
        .filter(Boolean) as string[];

      if (missing.length > 0) {
        const firstMissing = results.find((r) => !r.ok && r.missingSchema) as
          | { ok: false; missingSchema: true; error: unknown }
          | undefined;
        logOnce("warn", "[system-health] quotes_views missing", {
          missing,
          supabaseError: serializeSupabaseError(firstMissing?.error),
        });
        return {
          id,
          label,
          status: "degraded",
          details: `Missing view(s): ${missing.join(", ")}`,
          suggestion: "Run latest SQL migrations and reload PostgREST schema.",
        };
      }

      if (failed.length > 0) {
        const firstErr = results.find((r) => !r.ok && !r.missingSchema) as
          | { ok: false; missingSchema: false; error: unknown }
          | undefined;
        return {
          id,
          label,
          status: "error",
          details:
            formatErrorDetails(firstErr?.error) ??
            `Quotes views query failed: ${failed.join(", ")}`,
          suggestion: "Verify Supabase connectivity and service role credentials.",
        };
      }

      return { id, label, status: "ok" };
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "message_sla_rpc";
      const label = "Message SLA RPC";

      try {
        const { error } = await supabaseServer
          .rpc("admin_message_sla_for_quotes", { p_quote_ids: [] })
          .returns<unknown[]>();

        if (!error) {
          return { id, label, status: "ok" };
        }

        const code = getSerializedError(error)?.code ?? null;

        // Missing function / RPC in PostgREST.
        if (code === "PGRST202" || isMissingTableOrColumnError(error)) {
          logOnce(
            "warn",
            "[system-health] message_sla_rpc missing",
            serializeSupabaseError(error),
          );
          return {
            id,
            label,
            status: "degraded",
            details: formatErrorDetails(error) ?? "SLA RPC unavailable.",
            suggestion: "SLA signal unavailable; quotes will fall back to basic staleness.",
          };
        }

        return {
          id,
          label,
          status: "error",
          details: formatErrorDetails(error) ?? "SLA RPC failed.",
          suggestion: "Verify Supabase database function and PostgREST configuration.",
        };
      } catch (error) {
        const code = getSerializedError(error)?.code ?? null;
        if (code === "PGRST202" || isMissingTableOrColumnError(error)) {
          logOnce(
            "warn",
            "[system-health] message_sla_rpc missing (crash)",
            serializeSupabaseError(error) ?? error,
          );
          return {
            id,
            label,
            status: "degraded",
            details: formatErrorDetails(error) ?? "SLA RPC unavailable.",
            suggestion: "SLA signal unavailable; quotes will fall back to basic staleness.",
          };
        }
        return {
          id,
          label,
          status: "error",
          details: formatErrorDetails(error) ?? "SLA RPC crashed.",
          suggestion: "Verify Supabase database function and PostgREST configuration.",
        };
      }
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "bench_health_views";
      const label = "Bench health views";

      const views = [
        "supplier_match_health_summary",
        "supplier_bench_utilization_summary",
      ] as const;

      const results = await Promise.all(
        views.map((name) =>
          safeProbe(name, async () => supabaseServer.from(name).select("supplier_id").limit(1)),
        ),
      );

      const missing = results
        .map((r, idx) => (!r.ok && r.missingSchema ? views[idx] : null))
        .filter(Boolean) as string[];
      const failed = results
        .map((r, idx) => (!r.ok && !r.missingSchema ? views[idx] : null))
        .filter(Boolean) as string[];

      if (missing.length > 0) {
        logOnce(
          "warn",
          "[system-health] bench_health_views missing",
          { missing, error: serializeSupabaseError((results.find((r) => !r.ok) as any)?.error) },
        );
        return {
          id,
          label,
          status: "degraded",
          details: `Missing view(s): ${missing.join(", ")}`,
          suggestion:
            "Bench health views missing; match health cards will show “unknown”.",
        };
      }

      if (failed.length > 0) {
        const firstErr = results.find((r) => !r.ok && !r.missingSchema) as
          | { ok: false; missingSchema: false; error: unknown }
          | undefined;
        return {
          id,
          label,
          status: "error",
          details:
            formatErrorDetails(firstErr?.error) ??
            `Bench health query failed: ${failed.join(", ")}`,
          suggestion: "Verify Supabase connectivity and service role credentials.",
        };
      }

      return { id, label, status: "ok" };
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "storage_uploads_bucket";
      const label = "Storage uploads bucket";

      try {
        const { error } = await supabaseServer.storage.from(UPLOADS_BUCKET).list("", {
          limit: 1,
          offset: 0,
          sortBy: { column: "name", order: "asc" },
        });

        if (!error) {
          return { id, label, status: "ok" };
        }

        const details =
          formatErrorDetails(error) ??
          (typeof (error as any)?.message === "string" ? (error as any).message : null) ??
          "Storage bucket check failed.";

        // Bucket issues typically break uploads; treat as error.
        return {
          id,
          label,
          status: "error",
          details,
          suggestion: "Check Supabase storage bucket config / service role credentials.",
        };
      } catch (error) {
        return {
          id,
          label,
          status: "error",
          details: formatErrorDetails(error) ?? "Storage bucket check crashed.",
          suggestion: "Check Supabase storage bucket config / service role credentials.",
        };
      }
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "auth_jwt";
      const label = "Auth JWT sanity";

      const supabaseUrl =
        process.env.NEXT_PUBLIC_SUPABASE_URL ??
        process.env.SUPABASE_URL ??
        null;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;

      if (!supabaseUrl || !anonKey) {
        return {
          id,
          label,
          status: "degraded",
          details: "Missing Supabase auth environment variables.",
          suggestion: "Verify NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        };
      }

      try {
        const cookieStore = await cookies();
        const projectRef = getSupabaseProjectRefFromUrl(supabaseUrl) ?? null;
        const cookieName = projectRef ? `sb-${projectRef}-auth-token` : null;
        const cookieValue = cookieName ? cookieStore.get(cookieName)?.value ?? null : null;

        if (!cookieName || !cookieValue) {
          // If the session cookie is missing we can’t validate JWT parsing, but this
          // doesn’t necessarily mean auth is broken (e.g. no session yet).
          return {
            id,
            label,
            status: "degraded",
            details: "Auth session cookie not found.",
            suggestion: "Verify Supabase auth cookies are present for signed-in admins.",
          };
        }

        const parsed = (() => {
          try {
            return JSON.parse(cookieValue) as unknown;
          } catch {
            return null;
          }
        })();

        const accessToken =
          parsed &&
          typeof parsed === "object" &&
          !Array.isArray(parsed) &&
          typeof (parsed as any).access_token === "string"
            ? ((parsed as any).access_token as string)
            : null;

        if (!accessToken) {
          return {
            id,
            label,
            status: "degraded",
            details: "Unable to read access_token from auth cookie payload.",
            suggestion: "Verify Supabase auth cookie format and SSR configuration.",
          };
        }

        const claims = tryDecodeJwtPayload(accessToken);
        const sub = typeof claims?.sub === "string" ? claims.sub : null;
        const email = typeof claims?.email === "string" ? claims.email : null;

        if (!sub && !email) {
          return {
            id,
            label,
            status: "degraded",
            details: "JWT parsed but missing expected claims (sub/email).",
            suggestion: "Verify Supabase auth JWT configuration.",
          };
        }

        return { id, label, status: "ok" };
      } catch (error) {
        logOnce(
          "warn",
          "[system-health] auth_jwt check failed",
          serializeSupabaseError(error) ?? error,
        );
        return {
          id,
          label,
          status: "degraded",
          details: formatErrorDetails(error) ?? "Unable to access cookies/auth in this environment.",
          suggestion: "Verify NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY.",
        };
      }
    })(),

    (async (): Promise<HealthCheckResult> => {
      const id: HealthCheckId = "events_stream";
      const label = "Events stream";

      const probe = await safeProbe("quote_events", async () =>
        supabaseServer.from("quote_events").select("id").limit(1),
      );

      if (probe.ok) {
        return { id, label, status: "ok" };
      }

      // Per spec: treat missing/inaccessible as degraded (timeline partial/unavailable).
      const degradedDetails =
        formatErrorDetails(probe.error) ??
        "Timeline activity will be unavailable / partial.";

      if (probe.missingSchema || isRowLevelSecurityDeniedError(probe.error)) {
        logOnce(
          "warn",
          "[system-health] events_stream degraded",
          serializeSupabaseError(probe.error),
        );
      }

      return {
        id,
        label,
        status: "degraded",
        details: degradedDetails,
        suggestion: "Timeline activity will be unavailable / partial.",
      };
    })(),
  ]);

  const overall: SystemHealthStatus = checks.some((c) => c.status === "error")
    ? "error"
    : checks.some((c) => c.status === "degraded")
      ? "degraded"
      : "ok";

  return { status: overall, checks };
}

