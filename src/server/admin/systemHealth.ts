import { supabaseServer } from "@/lib/supabaseServer";
import { getServerAuthUser, requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  serializeSupabaseError,
} from "@/server/admin/logging";

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

function getErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || null;
  const candidate = error as { message?: unknown };
  if (typeof candidate?.message === "string" && candidate.message) {
    return candidate.message;
  }
  return formatErrorDetails(error);
}

async function checkAuthJwt(): Promise<HealthCheckResult> {
  const id: HealthCheckId = "auth_jwt";
  const label = "Auth JWT sanity";

  try {
    const { user, error } = await getServerAuthUser();

    if (error) {
      // Auth SDK could not validate a user; this usually means SSR auth config issues.
      const msg = getErrorMessage(error) ?? "unknown";
      return {
        id,
        label,
        status: "degraded",
        details: `Auth error: ${msg}`,
        suggestion:
          "Verify Supabase URL/keys and auth cookie configuration for SSR.",
      };
    }

    if (!user) {
      // No active session for this request. That’s fine from a system-health standpoint.
      return {
        id,
        label,
        status: "ok",
        details: "No active auth session on this request.",
      };
    }

    // User resolved successfully via Supabase auth SDK.
    return {
      id,
      label,
      status: "ok",
      details: "Supabase auth user resolved successfully on server.",
    };
  } catch (error) {
    // Only treat unexpected runtime failures as degraded.
    logOnce("warn", "[system-health] auth_jwt unexpected error", error);
    return {
      id,
      label,
      status: "degraded",
      details: "Unexpected error while checking auth.",
      suggestion:
        "Verify Supabase auth environment variables and SSR configuration.",
    };
  }
}

export async function loadSystemHealth(options?: {
  authenticatedAdminUserId?: string;
  includeAuthJwtCheck?: boolean;
}): Promise<SystemHealthSummary> {
  // Defense-in-depth: admin-only diagnostics uses service-role Supabase client.
  // For admin notification refresh we can skip the auth check, since the entrypoint already validated admin.
  const authenticatedAdminUserId =
    typeof options?.authenticatedAdminUserId === "string" ? options.authenticatedAdminUserId.trim() : "";
  if (!authenticatedAdminUserId) {
    await requireAdminUser();
  }

  const includeAuthJwtCheck = options?.includeAuthJwtCheck ?? true;

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

    ...(includeAuthJwtCheck ? [checkAuthJwt()] : []),

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

