import { supabaseServer } from "@/lib/supabaseServer";
import { createAuthClient, createReadOnlyAuthClient, requireAdminUser } from "@/server/auth";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { loadCustomerInbox, loadSupplierInbox, loadAdminInbox } from "@/server/messages/inbox";
import { getCustomerByUserId } from "@/server/customers";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { computeRfqQualitySummary } from "@/server/quotes/rfqQualitySignals";
import {
  isOpenQuoteStatus,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import { getAdminQuotesInbox } from "@/server/admin/quotesInbox";
import { loadAdminSupplierBenchHealth } from "@/server/suppliers/benchHealth";
import { loadSystemHealth } from "@/server/admin/systemHealth";

export type NotificationType =
  | "message_needs_reply"
  | "new_message"
  | "change_request_submitted"
  | "new_bid_on_rfq"
  | "rfq_ready_to_award"
  | "kickoff_overdue"
  | "kickoff_ready"
  | "capacity_stale"
  | "rfq_low_quality"
  | "bench_overused"
  | "system_health_degraded";

export type NotificationAudienceRole = "customer" | "supplier" | "admin";

export type UserNotification = {
  id: string;
  userId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  href: string;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
};

const NOTIFICATIONS_TABLE = "user_notifications" as const;

type NotificationRow = {
  id: string;
  user_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string;
  href: string;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
};

type NotificationDescriptor = {
  userId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  href: string;
  createdAt?: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function daysAgoIso(days: number): string {
  const ms = Math.max(0, Math.floor(days)) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function toUserNotification(row: NotificationRow): UserNotification {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type as NotificationType,
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body,
    href: row.href,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
    readAt: row.read_at ?? null,
  };
}

export async function loadUserNotifications(
  userId: string,
  options?: { onlyUnread?: boolean; limit?: number },
): Promise<UserNotification[]> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return [];

  const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 100)));

  try {
    const supabase = await createReadOnlyAuthClient();

    let query = supabase
      .from(NOTIFICATIONS_TABLE)
      .select(
        "id,user_id,type,entity_type,entity_id,title,body,href,is_read,created_at,read_at",
      )
      .eq("user_id", normalizedUserId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (options?.onlyUnread) {
      query = query.eq("is_read", false);
    }

    const { data, error } = await query.returns<NotificationRow[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[notifications] loadUserNotifications failed", {
        userId: normalizedUserId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    return (Array.isArray(data) ? data : []).map(toUserNotification);
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] loadUserNotifications crashed", {
      userId: normalizedUserId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

export async function markNotificationsRead(
  userId: string,
  notificationIds: string[],
): Promise<void> {
  const normalizedUserId = normalizeId(userId);
  const ids = Array.from(
    new Set(
      (Array.isArray(notificationIds) ? notificationIds : [])
        .map((value) => normalizeId(value))
        .filter(Boolean),
    ),
  );

  if (!normalizedUserId || ids.length === 0) return;

  try {
    const supabase = createAuthClient();
    const { error } = await supabase
      .from(NOTIFICATIONS_TABLE)
      .update({ is_read: true, read_at: nowIso() })
      .eq("user_id", normalizedUserId)
      .in("id", ids);

    if (error) {
      if (isMissingTableOrColumnError(error)) return;
      console.error("[notifications] markNotificationsRead failed", {
        userId: normalizedUserId,
        count: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return;
    console.error("[notifications] markNotificationsRead crashed", {
      userId: normalizedUserId,
      count: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

export async function refreshNotificationsForUser(
  userId: string,
  role: NotificationAudienceRole,
): Promise<void> {
  const normalizedUserId = normalizeId(userId);
  if (!normalizedUserId) return;

  console.log("[notifications] refresh start", { userId: normalizedUserId, role });

  try {
    const managedTypes = getManagedTypesForRole(role);

    const computeResults = await Promise.allSettled([
      role === "customer" ? computeCustomerNotifications(normalizedUserId) : Promise.resolve([]),
      role === "supplier" ? computeSupplierNotifications(normalizedUserId) : Promise.resolve([]),
      role === "admin" ? computeAdminNotifications(normalizedUserId) : Promise.resolve([]),
    ]);

    for (const result of computeResults) {
      if (result.status === "rejected") {
        console.error("[notifications] compute failed", {
          type: "refreshNotificationsForUser",
          error: serializeSupabaseError(result.reason) ?? result.reason,
        });
      }
    }

    const descriptors = computeResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((d): d is NotificationDescriptor => Boolean(d));

    await upsertNotificationsForUser({ userId: normalizedUserId, managedTypes, descriptors });
  } catch (error) {
    console.error("[notifications] refresh failed", {
      userId: normalizedUserId,
      role,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

function getManagedTypesForRole(role: NotificationAudienceRole): NotificationType[] {
  if (role === "customer") {
    return [
      "message_needs_reply",
      "new_bid_on_rfq",
      "rfq_ready_to_award",
      "rfq_low_quality",
    ];
  }
  if (role === "supplier") {
    return ["message_needs_reply", "kickoff_overdue", "capacity_stale"];
  }
  return [
    "message_needs_reply",
    "change_request_submitted",
    "new_bid_on_rfq",
    "rfq_ready_to_award",
    "kickoff_overdue",
    "capacity_stale",
    "bench_overused",
    "system_health_degraded",
  ];
}

async function upsertNotificationsForUser(args: {
  userId: string;
  managedTypes: NotificationType[];
  descriptors: NotificationDescriptor[];
}): Promise<void> {
  const managedTypes = Array.from(new Set(args.managedTypes));
  const userId = normalizeId(args.userId);
  if (!userId || managedTypes.length === 0) return;

  const should = new Map<string, NotificationDescriptor>();
  for (const d of args.descriptors) {
    if (!d) continue;
    if (normalizeId(d.userId) !== userId) continue;
    if (!managedTypes.includes(d.type)) continue;
    const key = `${d.type}::${d.entityType}::${normalizeId(d.entityId)}`;
    if (!should.has(key)) {
      should.set(key, {
        ...d,
        entityId: normalizeId(d.entityId),
      });
    }
  }

  const now = nowIso();

  let existingUnread: NotificationRow[] = [];
  try {
    const { data, error } = await supabaseServer
      .from(NOTIFICATIONS_TABLE)
      .select(
        "id,user_id,type,entity_type,entity_id,title,body,href,is_read,created_at,read_at",
      )
      .eq("user_id", userId)
      .eq("is_read", false)
      .in("type", managedTypes)
      .limit(1000)
      .returns<NotificationRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return;
      console.error("[notifications] upsert: existing unread load failed", {
        userId,
        error: serializeSupabaseError(error) ?? error,
      });
      return;
    }

    existingUnread = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return;
    console.error("[notifications] upsert: existing unread load crashed", {
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return;
  }

  const existingByKey = new Map<string, NotificationRow>();
  for (const row of existingUnread) {
    const key = `${row.type}::${row.entity_type}::${row.entity_id}`;
    if (!existingByKey.has(key)) {
      existingByKey.set(key, row);
    }
  }

  const inserts: Array<{
    user_id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    title: string;
    body: string;
    href: string;
    is_read: boolean;
    created_at: string;
  }> = [];

  const updates: Array<{ id: string; patch: Partial<NotificationRow> }> = [];

  for (const [key, descriptor] of should.entries()) {
    const existing = existingByKey.get(key) ?? null;
    const createdAt = safeIso(descriptor.createdAt) ?? now;

    if (!existing) {
      inserts.push({
        user_id: userId,
        type: descriptor.type,
        entity_type: descriptor.entityType,
        entity_id: descriptor.entityId,
        title: descriptor.title,
        body: descriptor.body,
        href: descriptor.href,
        is_read: false,
        created_at: createdAt,
      });
      continue;
    }

    const needsUpdate =
      existing.title !== descriptor.title ||
      existing.body !== descriptor.body ||
      existing.href !== descriptor.href;

    if (needsUpdate) {
      updates.push({
        id: existing.id,
        patch: {
          title: descriptor.title,
          body: descriptor.body,
          href: descriptor.href,
        },
      });
    }
  }

  const obsoleteIds: string[] = [];
  for (const row of existingUnread) {
    const key = `${row.type}::${row.entity_type}::${row.entity_id}`;
    if (!should.has(key)) {
      obsoleteIds.push(row.id);
    }
  }

  console.log("[notifications] upsert start", { userId, count: inserts.length });

  try {
    if (inserts.length > 0) {
      const { error } = await supabaseServer.from(NOTIFICATIONS_TABLE).insert(inserts);
      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.error("[notifications] upsert: insert failed", {
            userId,
            count: inserts.length,
            error: serializeSupabaseError(error) ?? error,
          });
        }
        // Best-effort: surface change-request notification insert failures without failing refresh.
        logChangeRequestInAppNotificationInsertFailure(inserts);
      } else {
        console.log("[notifications] upsert success", { userId, inserted: inserts.length });
        // Best-effort: emit a specific log line when change-request notifications are inserted.
        logChangeRequestInAppNotificationInsertSuccess(inserts);
      }
    } else {
      console.log("[notifications] upsert success", { userId, inserted: 0 });
    }

    for (const update of updates) {
      const { error } = await supabaseServer
        .from(NOTIFICATIONS_TABLE)
        .update(update.patch)
        .eq("id", update.id)
        .eq("user_id", userId);

      if (error && !isMissingTableOrColumnError(error)) {
        console.error("[notifications] upsert: update failed", {
          userId,
          notificationId: update.id,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }

    if (obsoleteIds.length > 0) {
      const { error } = await supabaseServer
        .from(NOTIFICATIONS_TABLE)
        .update({ is_read: true, read_at: now })
        .eq("user_id", userId)
        .in("id", obsoleteIds);

      if (error && !isMissingTableOrColumnError(error)) {
        console.error("[notifications] upsert: obsolete mark-read failed", {
          userId,
          count: obsoleteIds.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return;
    console.error("[notifications] upsert crashed", {
      userId,
      error: serializeSupabaseError(error) ?? error,
    });
  }
}

function extractQuoteIdFromAdminHref(href: string): string | null {
  const normalized = typeof href === "string" ? href.trim() : "";
  if (!normalized) return null;
  const match = normalized.match(/\/admin\/quotes\/([^/?#]+)/);
  return match?.[1] ? match[1] : null;
}

function logChangeRequestInAppNotificationInsertSuccess(
  inserts: Array<{
    user_id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    title: string;
    body: string;
    href: string;
    is_read: boolean;
    created_at: string;
  }>,
) {
  for (const insert of inserts) {
    if (insert.type !== "change_request_submitted") continue;
    const quoteId = extractQuoteIdFromAdminHref(insert.href);
    const changeRequestId = normalizeId(insert.entity_id) || null;
    console.log("[change-requests] admin in-app notification created", {
      quoteId,
      changeRequestId,
    });
  }
}

function logChangeRequestInAppNotificationInsertFailure(
  inserts: Array<{
    user_id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    title: string;
    body: string;
    href: string;
    is_read: boolean;
    created_at: string;
  }>,
) {
  const failures = inserts
    .filter((insert) => insert.type === "change_request_submitted")
    .map((insert) => ({
      quoteId: extractQuoteIdFromAdminHref(insert.href),
      changeRequestId: normalizeId(insert.entity_id) || null,
    }));

  if (failures.length === 0) return;

  console.error("[change-requests] admin in-app notification failed", {
    count: failures.length,
    failures,
  });
}

async function computeCustomerNotifications(userId: string): Promise<NotificationDescriptor[]> {
  const customer = await getCustomerByUserId(userId);
  const customerEmail = (customer?.email ?? "").trim();
  if (!customer || !customerEmail) return [];

  const [messageNeedsReply, bidSignals, rfqQuality] = await Promise.all([
    computeMessageNeedsReplyNotifications({ userId, role: "customer" }),
    computeCustomerBidAndAwardNotifications({ userId, customerEmail }),
    computeCustomerLowQualityNotifications({ userId, customerEmail }),
  ]);

  return [...messageNeedsReply, ...bidSignals, ...rfqQuality];
}

async function computeSupplierNotifications(userId: string): Promise<NotificationDescriptor[]> {
  const profile = await loadSupplierProfileByUserId(userId);
  const supplier = profile?.supplier ?? null;
  if (!supplier?.id) return [];

  const [messageNeedsReply, kickoffOverdue, capacityStale] = await Promise.all([
    computeMessageNeedsReplyNotifications({ userId, role: "supplier" }),
    computeKickoffOverdueNotifications({ userId, role: "supplier", supplierId: supplier.id }),
    computeSupplierCapacityStaleNotifications({ userId, supplierId: supplier.id }),
  ]);

  return [...messageNeedsReply, ...kickoffOverdue, ...capacityStale];
}

async function computeAdminNotifications(userId: string): Promise<NotificationDescriptor[]> {
  // Defense-in-depth: admin notifications are derived from admin-only signals.
  await requireAdminUser();

  const computes: Array<{
    type: string;
    run: () => Promise<NotificationDescriptor[]>;
  }> = [
    {
      type: "computeMessageNeedsReplyNotifications(admin)",
      run: () => computeMessageNeedsReplyNotifications({ userId, role: "admin" }),
    },
    {
      type: "computeAdminChangeRequestSubmittedNotifications",
      run: () => computeAdminChangeRequestSubmittedNotifications({ userId }),
    },
    { type: "computeAdminNewBidNotifications", run: () => computeAdminNewBidNotifications({ userId }) },
    {
      type: "computeAdminRfqReadyToAwardNotifications",
      run: () => computeAdminRfqReadyToAwardNotifications({ userId }),
    },
    {
      type: "computeKickoffOverdueNotifications(admin)",
      run: () => computeKickoffOverdueNotifications({ userId, role: "admin" }),
    },
    { type: "computeAdminCapacityStaleNotifications", run: () => computeAdminCapacityStaleNotifications({ userId }) },
    { type: "computeAdminBenchOverusedNotifications", run: () => computeAdminBenchOverusedNotifications({ userId }) },
    { type: "computeAdminSystemHealthNotifications", run: () => computeAdminSystemHealthNotifications({ userId }) },
  ];

  const results = await Promise.allSettled(computes.map((c) => c.run()));
  const out: NotificationDescriptor[] = [];

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const type = computes[i]?.type ?? "unknown";
    if (result?.status === "fulfilled") {
      out.push(...(Array.isArray(result.value) ? result.value : []));
      continue;
    }
    console.error("[notifications] compute failed", {
      type,
      error: serializeSupabaseError(result.reason) ?? result.reason,
    });
  }

  return out;
}

async function computeMessageNeedsReplyNotifications(args: {
  userId: string;
  role: "customer" | "supplier" | "admin";
}): Promise<NotificationDescriptor[]> {
  try {
    const rows =
      args.role === "customer"
        ? await loadCustomerInbox({ userId: args.userId, email: null })
        : args.role === "supplier"
          ? await loadSupplierInbox(args.userId)
          : await loadAdminInbox();

    const needs = args.role;
    return (rows ?? [])
      .filter((row) => row.needsReplyFrom === needs)
      .slice(0, 50)
      .map((row) => {
        const quoteId = row.quoteId;
        const title = "Message needs your reply";
        const body = `${row.rfqLabel}: ${row.lastMessagePreview}`;

        const href =
          args.role === "customer"
            ? `/customer/quotes/${quoteId}?tab=messages#messages`
            : args.role === "supplier"
              ? `/supplier/quotes/${quoteId}?tab=messages#messages`
              : `/admin/quotes/${quoteId}#messages`;

        return {
          userId: args.userId,
          type: "message_needs_reply" as const,
          entityType: "quote",
          entityId: quoteId,
          title,
          body,
          href,
          createdAt: row.lastMessageAt,
        };
      });
  } catch (error) {
    console.error("[notifications] computeMessageNeedsReply failed", {
      role: args.role,
      userId: args.userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

type CustomerQuoteLite = {
  id: string;
  status: string | null;
  file_name: string | null;
  company: string | null;
  created_at: string | null;
  awarded_at?: string | null;
  awarded_supplier_id?: string | null;
  awarded_bid_id?: string | null;
};

type BidLite = { quote_id: string; updated_at: string | null; created_at: string | null };

type NotificationSeenRow = Pick<NotificationRow, "entity_id" | "created_at" | "read_at" | "is_read" | "type" | "entity_type">;

type ChangeRequestLite = {
  id: string;
  quote_id: string;
  change_type: string;
  notes: string;
  status: string | null;
  created_at: string | null;
};

type QuoteLabelRow = {
  id: string;
  file_name: string | null;
  company: string | null;
};

function formatChangeRequestTypeLabel(value: string | null | undefined): string {
  switch ((value ?? "").trim().toLowerCase()) {
    case "tolerance":
      return "Tolerance";
    case "material_finish":
      return "Material / finish";
    case "lead_time":
      return "Lead time";
    case "shipping":
      return "Shipping";
    case "revision":
      return "Revision";
    default:
      return "Change request";
  }
}

function truncateOneLine(value: string | null | undefined, maxLen: number): string | null {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!normalized) return null;
  if (normalized.length <= maxLen) return normalized;
  if (maxLen <= 1) return normalized.slice(0, Math.max(0, maxLen));
  return `${normalized.slice(0, Math.max(0, maxLen - 1))}…`;
}

function quoteLabelFromRow(row: QuoteLabelRow | null, quoteId: string): string {
  return row?.file_name ?? row?.company ?? `Quote ${quoteId.slice(0, 6)}`;
}

async function computeAdminChangeRequestSubmittedNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  const LOOKBACK_DAYS = 30;
  const LIMIT = 25;

  try {
    // Defense-in-depth: keep this admin-only.
    await requireAdminUser();

    const { data, error } = await supabaseServer
      .from("quote_change_requests")
      .select("id,quote_id,change_type,notes,status,created_at")
      .gte("created_at", daysAgoIso(LOOKBACK_DAYS))
      .order("created_at", { ascending: false })
      .limit(150)
      .returns<ChangeRequestLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[notifications] admin change-requests query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const changeRequestIds = rows.map((r) => normalizeId(r.id)).filter(Boolean);
    const quoteIds = Array.from(
      new Set(rows.map((r) => normalizeId(r.quote_id)).filter(Boolean)),
    );

    if (rows.length === 0 || changeRequestIds.length === 0 || quoteIds.length === 0) {
      return [];
    }

    const [{ data: quoteRows, error: quoteError }, { data: seenRows, error: seenError }] =
      await Promise.all([
        supabaseServer
          .from("quotes")
          .select("id,file_name,company")
          .in("id", quoteIds)
          .limit(500)
          .returns<QuoteLabelRow[]>(),
        supabaseServer
          .from(NOTIFICATIONS_TABLE)
          .select("entity_id")
          .eq("user_id", args.userId)
          .eq("type", "change_request_submitted")
          .eq("entity_type", "change_request")
          .in("entity_id", changeRequestIds)
          .limit(5000)
          .returns<Array<{ entity_id: string }>>(),
      ]);

    if (quoteError && !isMissingTableOrColumnError(quoteError)) {
      console.warn("[notifications] admin change-requests quote label load failed", {
        error: serializeSupabaseError(quoteError) ?? quoteError,
      });
    }

    if (seenError && !isMissingTableOrColumnError(seenError)) {
      console.warn("[notifications] admin change-requests seen lookup failed", {
        error: serializeSupabaseError(seenError) ?? seenError,
      });
    }

    const quoteMap = new Map(
      (Array.isArray(quoteRows) ? quoteRows : [])
        .filter((row) => Boolean(row?.id))
        .map((row) => [row.id, row]),
    );

    const seen = new Set(
      (Array.isArray(seenRows) ? seenRows : [])
        .map((row) => normalizeId(row.entity_id))
        .filter(Boolean),
    );

    const out: NotificationDescriptor[] = [];

    for (const row of rows) {
      const changeRequestId = normalizeId(row.id);
      const quoteId = normalizeId(row.quote_id);
      if (!changeRequestId || !quoteId) continue;
      if (seen.has(changeRequestId)) continue;

      const typeLabel = formatChangeRequestTypeLabel(row.change_type);
      const notesExcerpt = truncateOneLine(row.notes, 140);
      const quoteLabel = quoteLabelFromRow(quoteMap.get(quoteId) ?? null, quoteId);

      out.push({
        userId: args.userId,
        type: "change_request_submitted",
        entityType: "change_request",
        entityId: changeRequestId,
        title: "Change request submitted",
        body: `Quote ${quoteLabel} · Type: ${typeLabel}${
          notesExcerpt ? ` · ${notesExcerpt}` : ""
        }`,
        href: `/admin/quotes/${quoteId}#change-requests`,
        createdAt: safeIso(row.created_at) ?? nowIso(),
      });

      if (out.length >= LIMIT) break;
    }

    return out;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] computeAdminChangeRequestSubmittedNotifications crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

function isWinnerQuoteLite(row: CustomerQuoteLite): boolean {
  const status = normalizeQuoteStatus(row.status ?? undefined);
  return (
    Boolean(row.awarded_at) ||
    Boolean(row.awarded_bid_id) ||
    Boolean(row.awarded_supplier_id) ||
    status === "won"
  );
}

function quoteTitleLite(row: CustomerQuoteLite): string {
  return row.file_name ?? row.company ?? `Quote ${row.id.slice(0, 6)}`;
}

async function computeCustomerBidAndAwardNotifications(args: {
  userId: string;
  customerEmail: string;
}): Promise<NotificationDescriptor[]> {
  const customerEmail = args.customerEmail.trim();
  if (!customerEmail) return [];

  try {
    const { data: quotes, error: quoteError } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,status,file_name,company,created_at,awarded_at,awarded_supplier_id,awarded_bid_id")
      .ilike("customer_email", customerEmail)
      .order("updated_at", { ascending: false })
      .limit(150)
      .returns<CustomerQuoteLite[]>();

    if (quoteError) {
      if (isMissingTableOrColumnError(quoteError)) return [];
      console.error("[notifications] customer quote load failed", {
        userId: args.userId,
        error: serializeSupabaseError(quoteError) ?? quoteError,
      });
      return [];
    }

    const quoteRows = Array.isArray(quotes) ? quotes : [];
    const openQuotes = quoteRows.filter((q) => isOpenQuoteStatus(normalizeQuoteStatus(q.status ?? undefined)));
    const openQuoteIds = openQuotes.map((q) => q.id);
    if (openQuoteIds.length === 0) return [];

    const { data: bids, error: bidError } = await supabaseServer
      .from("supplier_bids")
      .select("quote_id,updated_at,created_at")
      .in("quote_id", openQuoteIds)
      .order("updated_at", { ascending: false })
      .limit(4000)
      .returns<BidLite[]>();

    if (bidError) {
      if (isMissingTableOrColumnError(bidError)) return [];
      console.error("[notifications] customer bid load failed", {
        userId: args.userId,
        error: serializeSupabaseError(bidError) ?? bidError,
      });
      return [];
    }

    const bidsRows = Array.isArray(bids) ? bids : [];
    const bidsByQuoteId = new Map<string, { count: number; latestAt: string | null }>();
    for (const bid of bidsRows) {
      const quoteId = normalizeId(bid.quote_id);
      if (!quoteId) continue;
      const ts = safeIso(bid.updated_at) ?? safeIso(bid.created_at);
      const existing = bidsByQuoteId.get(quoteId) ?? { count: 0, latestAt: null };
      existing.count += 1;
      if (ts && (!existing.latestAt || ts > existing.latestAt)) {
        existing.latestAt = ts;
      }
      bidsByQuoteId.set(quoteId, existing);
    }

    // Determine last "seen" timestamp for new_bid_on_rfq per quote.
    const { data: seenRows, error: seenError } = await supabaseServer
      .from(NOTIFICATIONS_TABLE)
      .select("type,entity_type,entity_id,created_at,read_at,is_read")
      .eq("user_id", args.userId)
      .eq("type", "new_bid_on_rfq")
      .eq("entity_type", "quote")
      .in("entity_id", openQuoteIds)
      .limit(2000)
      .returns<NotificationSeenRow[]>();

    if (seenError && !isMissingTableOrColumnError(seenError)) {
      console.warn("[notifications] customer bid seen lookup failed", {
        userId: args.userId,
        error: serializeSupabaseError(seenError) ?? seenError,
      });
    }

    const latestSeenByQuoteId = new Map<string, string>();
    for (const row of Array.isArray(seenRows) ? seenRows : []) {
      const quoteId = normalizeId(row.entity_id);
      if (!quoteId) continue;
      const seenAt = safeIso(row.read_at) ?? safeIso(row.created_at);
      if (!seenAt) continue;
      const prev = latestSeenByQuoteId.get(quoteId) ?? null;
      if (!prev || seenAt > prev) {
        latestSeenByQuoteId.set(quoteId, seenAt);
      }
    }

    const NEW_BID_LIMIT = 20;
    const RFQ_READY_DAYS = 5;

    const out: NotificationDescriptor[] = [];

    for (const quote of openQuotes) {
      if (isWinnerQuoteLite(quote)) continue;
      const bidAgg = bidsByQuoteId.get(quote.id) ?? { count: 0, latestAt: null };

      if (bidAgg.count > 0 && bidAgg.latestAt) {
        const lastSeen = latestSeenByQuoteId.get(quote.id) ?? null;
        const isNewSinceSeen = !lastSeen || bidAgg.latestAt > lastSeen;
        if (isNewSinceSeen) {
          out.push({
            userId: args.userId,
            type: "new_bid_on_rfq",
            entityType: "quote",
            entityId: quote.id,
            title: "New bid on your RFQ",
            body: `${quoteTitleLite(quote)} received ${bidAgg.count} bid${bidAgg.count === 1 ? "" : "s"}.`,
            href: `/customer/quotes/${quote.id}#decision`,
            createdAt: bidAgg.latestAt,
          });
          if (out.length >= NEW_BID_LIMIT) break;
        }
      }

      // RFQ ready to award: open > N days, >=2 bids, no winner.
      const createdAt = safeIso(quote.created_at);
      const isOldEnough =
        createdAt && createdAt < daysAgoIso(RFQ_READY_DAYS);
      if (isOldEnough && bidAgg.count >= 2) {
        out.push({
          userId: args.userId,
          type: "rfq_ready_to_award",
          entityType: "quote",
          entityId: quote.id,
          title: "RFQ ready to award",
          body: `${quoteTitleLite(quote)} has multiple bids and is ready for a decision.`,
          href: `/customer/quotes/${quote.id}#decision`,
          createdAt: bidAgg.latestAt ?? createdAt,
        });
      }
    }

    return out;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] computeCustomerBidAndAwardNotifications crashed", {
      userId: args.userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeCustomerLowQualityNotifications(args: {
  userId: string;
  customerEmail: string;
}): Promise<NotificationDescriptor[]> {
  const customerEmail = args.customerEmail.trim();
  if (!customerEmail) return [];

  const QUALITY_LIMIT = 8;

  try {
    const { data: quotes, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("id,status,file_name,company,created_at,awarded_at,awarded_supplier_id,awarded_bid_id")
      .ilike("customer_email", customerEmail)
      .order("created_at", { ascending: false })
      .limit(40)
      .returns<CustomerQuoteLite[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[notifications] customer low-quality quote load failed", {
        userId: args.userId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    const open = (Array.isArray(quotes) ? quotes : [])
      .filter((q) => isOpenQuoteStatus(normalizeQuoteStatus(q.status ?? undefined)))
      .filter((q) => !isWinnerQuoteLite(q));

    const out: NotificationDescriptor[] = [];

    for (const quote of open) {
      if (out.length >= QUALITY_LIMIT) break;
      const summary = await computeRfqQualitySummary(quote.id);
      if ((summary.score ?? 100) >= 60) continue;

      const issues: string[] = [];
      if (summary.missingCad) issues.push("CAD missing");
      if (summary.missingDrawings) issues.push("drawings missing");
      if (summary.partsCoverage === "none") issues.push("parts not listed");
      if (summary.partsCoverage === "needs_attention") issues.push("parts coverage incomplete");

      out.push({
        userId: args.userId,
        type: "rfq_low_quality",
        entityType: "quote",
        entityId: quote.id,
        title: "Improve your RFQ",
        body:
          issues.length > 0
            ? `${quoteTitleLite(quote)}: ${issues.join(", ")} (score ${summary.score}/100).`
            : `${quoteTitleLite(quote)} looks incomplete (score ${summary.score}/100).`,
        href: `/customer/quotes/${quote.id}`,
        createdAt: safeIso(quote.created_at) ?? nowIso(),
      });
    }

    return out;
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] computeCustomerLowQualityNotifications crashed", {
      userId: args.userId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

type AwardedQuoteLite = {
  id: string;
  status: string | null;
  file_name: string | null;
  company: string | null;
  awarded_at: string | null;
  awarded_supplier_id: string | null;
  kickoff_completed_at?: string | null;
};

async function computeKickoffOverdueNotifications(args: {
  userId: string;
  role: "supplier" | "admin";
  supplierId?: string;
}): Promise<NotificationDescriptor[]> {
  const OVERDUE_DAYS = 7;

  try {
    let query = supabaseServer
      .from("quotes")
      .select(
        "id,status,file_name,company,awarded_at,awarded_supplier_id,kickoff_completed_at",
      )
      .not("awarded_at", "is", null)
      .limit(400);

    if (args.role === "supplier") {
      const supplierId = normalizeId(args.supplierId);
      if (!supplierId) return [];
      query = query.eq("awarded_supplier_id", supplierId);
    }

    const { data, error } = await query.returns<AwardedQuoteLite[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[notifications] kickoff overdue query failed", {
        role: args.role,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    const rows = Array.isArray(data) ? data : [];
    const cutoff = daysAgoIso(OVERDUE_DAYS);

    return rows
      .filter((row) => {
        const awardedAt = safeIso(row.awarded_at);
        if (!awardedAt) return false;
        if (row.kickoff_completed_at) return false;
        return awardedAt < cutoff;
      })
      .slice(0, 50)
      .map((row) => ({
        userId: args.userId,
        type: "kickoff_overdue" as const,
        entityType: "quote",
        entityId: row.id,
        title: "Kickoff overdue",
        body: `${row.file_name ?? row.company ?? `Quote ${row.id.slice(0, 6)}`} is past due for kickoff completion.`,
        href: args.role === "supplier" ? `/supplier/quotes/${row.id}#kickoff` : `/admin/quotes/${row.id}#kickoff`,
        createdAt: safeIso(row.awarded_at) ?? nowIso(),
      }));
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] computeKickoffOverdueNotifications crashed", {
      role: args.role,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeSupplierCapacityStaleNotifications(args: {
  userId: string;
  supplierId: string;
}): Promise<NotificationDescriptor[]> {
  const supplierId = normalizeId(args.supplierId);
  if (!supplierId) return [];

  const STALE_DAYS = 30;
  const cutoff = daysAgoIso(STALE_DAYS);

  try {
    const { data, error } = await supabaseServer
      .from("supplier_capacity_snapshots")
      .select("created_at")
      .eq("supplier_id", supplierId)
      .order("created_at", { ascending: false })
      .limit(1)
      .returns<Array<{ created_at: string | null }>>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return [];
      console.error("[notifications] supplier capacity snapshot query failed", {
        supplierId,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }

    const latestAt = safeIso(data?.[0]?.created_at ?? null);
    if (latestAt && latestAt >= cutoff) {
      return [];
    }

    return [
      {
        userId: args.userId,
        type: "capacity_stale",
        entityType: "supplier",
        entityId: supplierId,
        title: "Update your capacity",
        body: latestAt
          ? `Your last capacity update was over ${STALE_DAYS} days ago.`
          : "Add your capacity so we can route RFQs accurately.",
        href: "/supplier/settings/capacity",
        createdAt: latestAt ?? nowIso(),
      },
    ];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return [];
    console.error("[notifications] computeSupplierCapacityStaleNotifications crashed", {
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeAdminCapacityStaleNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  const STALE_DAYS = 30;
  const cutoff = daysAgoIso(STALE_DAYS);

  try {
    const rows = await loadAdminSupplierBenchHealth();

    const stale = rows
      .filter((row) => {
        const last = safeIso(row.lastCapacityUpdateAt);
        return !last || last < cutoff;
      })
      .slice(0, 25);

    if (stale.length === 0) return [];

    return stale.map((row) => ({
      userId: args.userId,
      type: "capacity_stale" as const,
      entityType: "supplier",
      entityId: row.supplierId,
      title: "Supplier capacity stale",
      body: `${row.supplierName} has not updated capacity in >${STALE_DAYS} days.`,
      href: "/admin/suppliers/bench-health",
      createdAt: row.lastCapacityUpdateAt ?? nowIso(),
    }));
  } catch (error) {
    console.error("[notifications] computeAdminCapacityStaleNotifications failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeAdminNewBidNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  try {
    const result = await getAdminQuotesInbox({
      page: 1,
      pageSize: 100,
      sort: "latest_bid_activity",
      filter: { hasBids: true, awarded: false },
    });

    const rows = result.ok ? result.data.rows : [];
    const out: NotificationDescriptor[] = [];

    // Similar "since last check" behavior: compare latest_bid_at against last seen.
    const quoteIds = rows.map((r) => r.id);

    if (quoteIds.length === 0) return [];

    const { data: seenRows, error: seenError } = await supabaseServer
      .from(NOTIFICATIONS_TABLE)
      .select("type,entity_type,entity_id,created_at,read_at,is_read")
      .eq("user_id", args.userId)
      .eq("type", "new_bid_on_rfq")
      .eq("entity_type", "quote")
      .in("entity_id", quoteIds)
      .limit(5000)
      .returns<NotificationSeenRow[]>();

    if (seenError && !isMissingTableOrColumnError(seenError)) {
      console.warn("[notifications] admin bid seen lookup failed", {
        userId: args.userId,
        error: serializeSupabaseError(seenError) ?? seenError,
      });
    }

    const latestSeenByQuoteId = new Map<string, string>();
    for (const row of Array.isArray(seenRows) ? seenRows : []) {
      const quoteId = normalizeId(row.entity_id);
      if (!quoteId) continue;
      const seenAt = safeIso(row.read_at) ?? safeIso(row.created_at);
      if (!seenAt) continue;
      const prev = latestSeenByQuoteId.get(quoteId) ?? null;
      if (!prev || seenAt > prev) {
        latestSeenByQuoteId.set(quoteId, seenAt);
      }
    }

    for (const row of rows) {
      if (!row.latest_bid_at) continue;
      const latestBidAt = safeIso(row.latest_bid_at);
      if (!latestBidAt) continue;

      const lastSeen = latestSeenByQuoteId.get(row.id) ?? null;
      if (lastSeen && latestBidAt <= lastSeen) continue;

      out.push({
        userId: args.userId,
        type: "new_bid_on_rfq" as const,
        entityType: "quote",
        entityId: row.id,
        title: "New bid on RFQ",
        body: `${row.file_name ?? row.company ?? `Quote ${row.id.slice(0, 6)}`} received ${row.bid_count} bid${row.bid_count === 1 ? "" : "s"}.`,
        href: `/admin/quotes/${row.id}#decision`,
        createdAt: latestBidAt,
      });

      if (out.length >= 20) break;
    }

    return out;
  } catch (error) {
    console.error("[notifications] computeAdminNewBidNotifications failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeAdminRfqReadyToAwardNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  const RFQ_READY_DAYS = 5;

  try {
    const result = await getAdminQuotesInbox({
      page: 1,
      pageSize: 200,
      sort: "newest_rfq",
      filter: { awarded: false },
    });

    const rows = result.ok ? result.data.rows : [];

    const out: NotificationDescriptor[] = [];
    for (const row of rows) {
      if (row.has_awarded_bid) continue;
      if (row.bid_count < 2) continue;
      const createdAt = safeIso(row.created_at);
      if (!createdAt) continue;
      if (createdAt >= daysAgoIso(RFQ_READY_DAYS)) continue;

      out.push({
        userId: args.userId,
        type: "rfq_ready_to_award" as const,
        entityType: "quote",
        entityId: row.id,
        title: "RFQ ready to award",
        body: `${row.file_name ?? row.company ?? `Quote ${row.id.slice(0, 6)}`} has multiple bids and needs an award decision.`,
        href: `/admin/quotes/${row.id}#decision`,
        createdAt: row.latest_bid_at ?? row.created_at ?? nowIso(),
      });

      if (out.length >= 25) break;
    }

    return out;
  } catch (error) {
    console.error("[notifications] computeAdminRfqReadyToAwardNotifications failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

const SYSTEM_ENTITY_ID = "00000000-0000-0000-0000-000000000000";

async function computeAdminBenchOverusedNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  try {
    const rows = await loadAdminSupplierBenchHealth();
    const overused = rows.filter((row) => row.benchStatus === "overused" && (row.awardsLast30d ?? 0) > 0);
    if (overused.length === 0) return [];

    return [
      {
        userId: args.userId,
        type: "bench_overused" as const,
        entityType: "system",
        entityId: SYSTEM_ENTITY_ID,
        title: "Bench overused",
        body: `${overused.length} supplier${overused.length === 1 ? " is" : "s are"} flagged overused with recent awards.`,
        href: "/admin/suppliers/bench-health?benchStatus=overused",
        createdAt: nowIso(),
      },
    ];
  } catch (error) {
    console.error("[notifications] computeAdminBenchOverusedNotifications failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}

async function computeAdminSystemHealthNotifications(args: {
  userId: string;
}): Promise<NotificationDescriptor[]> {
  try {
    const health = await loadSystemHealth();
    if (health.status === "ok") return [];

    return [
      {
        userId: args.userId,
        type: "system_health_degraded" as const,
        entityType: "system",
        entityId: SYSTEM_ENTITY_ID,
        title: "System health degraded",
        body:
          health.status === "error"
            ? "One or more checks are failing. Review system health."
            : "Some checks are degraded. Review system health.",
        href: "/admin/system-health",
        createdAt: nowIso(),
      },
    ];
  } catch (error) {
    console.error("[notifications] computeAdminSystemHealthNotifications failed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }
}
