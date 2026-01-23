import { requireAdminUser } from "@/server/auth";
import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { dispatchEmailNotification } from "@/server/notifications/dispatcher";

export type CapacityUpdateRequestReason = "stale" | "missing" | "manual";

let didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = false;
let didWarnMissingCapacitySnapshotsSchemaForAdminCapacityRequests = false;

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeWeekStartDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return "";
  return trimmed;
}

function resolveSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  );
}

function buildPortalLink(path: string): string {
  return `${resolveSiteUrl()}${path}`;
}

function formatWeekStartForSubject(weekStartDate: string): string | null {
  const normalized = normalizeWeekStartDate(weekStartDate);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function buildCapacityUpdateRequestedEmail(args: {
  supplierCompanyName: string | null;
  weekStartDate: string;
  reason: CapacityUpdateRequestReason;
}): {
  subject: string;
  previewText: string;
  html: string;
  link: string;
} {
  const weekLabel = formatWeekStartForSubject(args.weekStartDate) ?? args.weekStartDate;
  const link = buildPortalLink("/supplier/settings/capacity");
  const greeting = args.supplierCompanyName?.trim()
    ? `<p>${escapeHtml(args.supplierCompanyName.trim())} team,</p>`
    : "<p>Hello,</p>";
  const reasonSentence =
    args.reason === "stale"
      ? "Your saved capacity looks stale."
      : args.reason === "missing"
        ? "Your saved capacity looks incomplete."
        : null;

  return {
    subject: `Action requested: update your capacity for the week of ${weekLabel}`,
    previewText: `Please update your capacity for the week of ${weekLabel}.`,
    link,
    html: `
      ${greeting}
      <p>An admin requested an updated capacity snapshot for the week of <strong>${escapeHtml(
        weekLabel,
      )}</strong>.</p>
      ${
        reasonSentence
          ? `<p>${escapeHtml(reasonSentence)} Keeping this updated helps us plan timelines and route work appropriately.</p>`
          : "<p>Keeping this updated helps us plan timelines and route work appropriately.</p>"
      }
      <p><a href="${link}">Update your capacity settings</a></p>
    `,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadSupplierCapacityLastUpdatedAtForWeek(args: {
  supplierId: string;
  weekStartDate: string;
}): Promise<string | null> {
  const supplierId = normalizeId(args?.supplierId);
  const weekStartDate = normalizeWeekStartDate(args?.weekStartDate);
  if (!supplierId || !weekStartDate) return null;

  try {
    const { data, error } = await supabaseServer()
      .from("supplier_capacity_snapshots")
      .select("created_at")
      .eq("supplier_id", supplierId)
      .eq("week_start_date", weekStartDate)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Array<{ created_at: string }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        if (!didWarnMissingCapacitySnapshotsSchemaForAdminCapacityRequests) {
          didWarnMissingCapacitySnapshotsSchemaForAdminCapacityRequests = true;
          console.warn("[admin capacity request] capacity snapshot lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            pgCode: (error as { code?: string | null })?.code ?? null,
            message: (error as { message?: string | null })?.message ?? null,
          });
        }
        return null;
      }

      console.error("[admin capacity request] capacity snapshot lookup failed", {
        supplierId,
        weekStartDate,
        error: serializeSupabaseError(error),
      });
      return null;
    }

    const createdAt =
      Array.isArray(data) && typeof data[0]?.created_at === "string"
        ? data[0].created_at
        : null;
    return createdAt;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      if (!didWarnMissingCapacitySnapshotsSchemaForAdminCapacityRequests) {
        didWarnMissingCapacitySnapshotsSchemaForAdminCapacityRequests = true;
        console.warn("[admin capacity request] capacity snapshot lookup crashed (missing schema)", {
          supplierId,
          weekStartDate,
          error: serializeSupabaseError(error),
        });
      }
      return null;
    }

    console.error("[admin capacity request] capacity snapshot lookup crashed", {
      supplierId,
      weekStartDate,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

/**
 * Load the most recent capacity_update_requested event for a supplier + week,
 * limited to a lookback window (default: 7 days).
 *
 * Failure-only logging:
 * - warn once on missing schema
 * - error on real failures
 */
export async function loadRecentCapacityUpdateRequest(args: {
  supplierId: string;
  weekStartDate: string;
  lookbackDays?: number;
}): Promise<{ createdAt: string | null }> {
  // Defense-in-depth: uses service role; keep admin-only.
  await requireAdminUser();

  const supplierId = normalizeId(args?.supplierId);
  const weekStartDate = normalizeWeekStartDate(args?.weekStartDate);
  const lookbackDaysRaw = args?.lookbackDays;
  const lookbackDays =
    typeof lookbackDaysRaw === "number" && Number.isFinite(lookbackDaysRaw)
      ? Math.max(1, Math.min(90, Math.floor(lookbackDaysRaw)))
      : 7;

  if (!supplierId || !weekStartDate) {
    return { createdAt: null };
  }

  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  type Row = { created_at: string };

  const selectLatest = async (supplierKey: "supplierId" | "supplier_id") => {
    return await supabaseServer()
      .from("quote_events")
      .select("created_at")
      .eq("event_type", "capacity_update_requested")
      .eq(`metadata->>${supplierKey}`, supplierId)
      .eq("metadata->>weekStartDate", weekStartDate)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Row[]>();
  };

  try {
    const preferred = await selectLatest("supplierId");
    if (preferred.error) {
      if (isMissingTableOrColumnError(preferred.error)) {
        if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
          didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
          console.warn("[admin capacity request] lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            lookbackDays,
            pgCode: (preferred.error as { code?: string | null })?.code ?? null,
            message: (preferred.error as { message?: string | null })?.message ?? null,
          });
        }
        return { createdAt: null };
      }

      console.error("[admin capacity request] lookup failed", {
        supplierId,
        weekStartDate,
        lookbackDays,
        error: serializeSupabaseError(preferred.error),
      });
      return { createdAt: null };
    }

    const preferredCreatedAt =
      Array.isArray(preferred.data) && typeof preferred.data[0]?.created_at === "string"
        ? preferred.data[0].created_at
        : null;
    if (preferredCreatedAt) {
      return { createdAt: preferredCreatedAt };
    }

    const legacy = await selectLatest("supplier_id");
    if (legacy.error) {
      if (isMissingTableOrColumnError(legacy.error)) {
        if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
          didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
          console.warn("[admin capacity request] lookup skipped (missing schema)", {
            supplierId,
            weekStartDate,
            lookbackDays,
            pgCode: (legacy.error as { code?: string | null })?.code ?? null,
            message: (legacy.error as { message?: string | null })?.message ?? null,
          });
        }
        return { createdAt: null };
      }

      console.error("[admin capacity request] lookup failed", {
        supplierId,
        weekStartDate,
        lookbackDays,
        error: serializeSupabaseError(legacy.error),
      });
      return { createdAt: null };
    }

    const legacyCreatedAt =
      Array.isArray(legacy.data) && typeof legacy.data[0]?.created_at === "string"
        ? legacy.data[0].created_at
        : null;
    return { createdAt: legacyCreatedAt };
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      if (!didWarnMissingQuoteEventsSchemaForAdminCapacityRequests) {
        didWarnMissingQuoteEventsSchemaForAdminCapacityRequests = true;
        console.warn("[admin capacity request] lookup crashed (missing schema)", {
          supplierId,
          weekStartDate,
          lookbackDays,
          error: serializeSupabaseError(error),
        });
      }
      return { createdAt: null };
    }

    console.error("[admin capacity request] lookup crashed", {
      supplierId,
      weekStartDate,
      lookbackDays,
      error: serializeSupabaseError(error) ?? error,
    });
    return { createdAt: null };
  }
}

export function isCapacityRequestSuppressed(args: {
  requestCreatedAt: string | null;
  supplierLastUpdatedAt: string | null;
}): boolean {
  const requestCreatedAt =
    typeof args?.requestCreatedAt === "string" && args.requestCreatedAt.trim()
      ? args.requestCreatedAt.trim()
      : null;
  if (!requestCreatedAt) return false;

  const supplierLastUpdatedAt =
    typeof args?.supplierLastUpdatedAt === "string" && args.supplierLastUpdatedAt.trim()
      ? args.supplierLastUpdatedAt.trim()
      : null;
  if (!supplierLastUpdatedAt) return true;

  const requestTs = Date.parse(requestCreatedAt);
  const updatedTs = Date.parse(supplierLastUpdatedAt);
  if (!Number.isFinite(requestTs) || !Number.isFinite(updatedTs)) {
    // Be conservative: treat unknown timestamps as suppressed if a request exists.
    return true;
  }

  // Suppressed if supplier has NOT updated capacity after the request.
  return updatedTs <= requestTs;
}

export async function requestSupplierCapacityUpdate(args: {
  quoteId: string;
  supplierId: string;
  weekStartDate: string; // YYYY-MM-DD
  reason: CapacityUpdateRequestReason;
  actorUserId: string;
}): Promise<void> {
  const quoteId = typeof args?.quoteId === "string" ? args.quoteId.trim() : "";
  const supplierId =
    typeof args?.supplierId === "string" ? args.supplierId.trim() : "";
  const weekStartDate =
    typeof args?.weekStartDate === "string" ? args.weekStartDate.trim() : "";
  const reason =
    args?.reason === "stale" || args?.reason === "missing" || args?.reason === "manual"
      ? args.reason
      : "manual";

  if (!quoteId || !supplierId || !weekStartDate) {
    // Failure-only logging, per spec.
    console.warn("[admin capacity request] skipped (invalid input)", {
      quoteId: quoteId || null,
      supplierId: supplierId || null,
      weekStartDate: weekStartDate || null,
      reason,
      actorUserId: normalizeId(args?.actorUserId) || null,
      skipReason: "invalid_input",
    });
    return;
  }

  // Guard with requireAdminUser (do not trust caller-provided actor id).
  const adminUser = await requireAdminUser();

  try {
    // Defense-in-depth: do not emit/notify if the request is currently suppressed.
    const [recentRequest, supplierCapacityLastUpdatedAt, recentRequestForEmail] =
      await Promise.all([
        loadRecentCapacityUpdateRequest({
          supplierId,
          weekStartDate,
          lookbackDays: 7,
        }),
        loadSupplierCapacityLastUpdatedAtForWeek({
          supplierId,
          weekStartDate,
        }),
        // Idempotency: if a request exists in the last 24h, skip email send.
        loadRecentCapacityUpdateRequest({
          supplierId,
          weekStartDate,
          lookbackDays: 1,
        }),
      ]);

    const suppressed = isCapacityRequestSuppressed({
      requestCreatedAt: recentRequest.createdAt,
      supplierLastUpdatedAt: supplierCapacityLastUpdatedAt,
    });

    if (suppressed) {
      console.warn("[admin capacity request] email skipped due to suppression", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        skipReason: "suppressed",
      });
      return;
    }

    // Emit quote_events row (observable timeline) before any email.
    const row = {
      quote_id: quoteId,
      event_type: "capacity_update_requested",
      actor_role: "admin" as const,
      actor_user_id: adminUser.id,
      actor_supplier_id: null,
      metadata: {
        supplierId,
        weekStartDate,
        reason,
      },
    };

    const insert = await supabaseServer()
      .from("quote_events")
      .insert(row)
      .select("id,created_at")
      .returns<Array<{ id: string; created_at: string }>>();

    const inserted =
      !insert.error && Array.isArray(insert.data) && insert.data[0]?.id
        ? insert.data[0]
        : null;

    if (insert.error || !inserted?.id) {
      // Failure-only logging (schema missing / insert failure), per spec.
      console.warn("[admin capacity request] emit failed", {
        quoteId,
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        error: serializeSupabaseError(insert.error) ?? insert.error,
      });
      return;
    }

    // If a request exists in the last 24h, do not send email (anti-spam).
    if (recentRequestForEmail.createdAt) {
      console.warn("[admin capacity request] email skipped due to recent request", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        skipReason: "recent_request_24h",
      });
      return;
    }

    // Resolve supplier contact for email dispatch.
    const { data: supplier, error: supplierError } = await supabaseServer()
      .from("suppliers")
      .select("id,company_name,primary_email,user_id")
      .eq("id", supplierId)
      .maybeSingle<{
        id: string;
        company_name: string | null;
        primary_email: string | null;
        user_id: string | null;
      }>();

    if (supplierError) {
      console.error("[admin capacity request] supplier lookup failed", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        error: serializeSupabaseError(supplierError),
      });
      return;
    }

    const recipientEmail =
      typeof supplier?.primary_email === "string" && supplier.primary_email.trim()
        ? supplier.primary_email.trim().toLowerCase()
        : null;
    const recipientUserId =
      typeof supplier?.user_id === "string" && supplier.user_id.trim()
        ? supplier.user_id.trim()
        : null;

    if (!recipientEmail) {
      console.warn("[admin capacity request] email skipped (missing supplier email)", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        skipReason: "missing_email",
      });
      return;
    }

    if (recipientUserId && recipientUserId === adminUser.id) {
      console.warn("[admin capacity request] email skipped (self recipient)", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        skipReason: "self_recipient",
      });
      return;
    }

    const email = buildCapacityUpdateRequestedEmail({
      supplierCompanyName: supplier?.company_name ?? null,
      weekStartDate,
      reason,
    });

    const sent = await dispatchEmailNotification({
      eventType: "capacity_update_requested",
      quoteId,
      recipientEmail,
      recipientUserId,
      recipientRole: "supplier",
      actorRole: "admin",
      actorUserId: adminUser.id,
      audience: "supplier",
      payload: {
        supplierCompanyName: supplier?.company_name ?? null,
        weekStartDate,
        reason,
        link: email.link,
        supplierId,
      },
      subject: email.subject,
      previewText: email.previewText,
      html: email.html,
    });

    if (!sent) {
      // Failure-only logging: include context for observability.
      console.warn("[admin capacity request] email dispatch failed or skipped", {
        supplierId,
        weekStartDate,
        actorUserId: adminUser.id,
        reason,
        skipReason: "dispatch_failed_or_gated",
      });
    }
  } catch (error) {
    console.warn("[admin capacity request] emit crashed", {
      quoteId,
      supplierId,
      weekStartDate,
      reason,
      actorUserId: adminUser.id,
      message: (error as { message?: string | null })?.message ?? null,
      code: (error as { code?: string | null })?.code ?? null,
    });
  }
}

