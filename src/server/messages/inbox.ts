import { supabaseServer } from "@/lib/supabaseServer";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { getCustomerByEmail, getCustomerByUserId } from "@/server/customers";
import { loadSupplierProfileByUserId } from "@/server/suppliers";
import { requireAdminUser } from "@/server/auth";
import { loadUnreadMessageSummary } from "@/server/quotes/messageReads";
import { deriveQuotePrimaryLabel } from "@/server/quotes/fileSummary";
import { buildQuoteFilesFromRow } from "@/server/quotes/files";
import { getQuoteStatusLabel } from "@/server/quotes/status";
import {
  isMissingTableOrColumnError,
  serializeSupabaseError,
} from "@/server/admin/logging";

export type InboxRow = {
  quoteId: string;
  // Basic context
  rfqLabel: string;
  roleView: "customer" | "supplier" | "admin";
  // Message info
  lastMessageAt: string;
  lastMessagePreview: string;
  needsReplyFrom: "customer" | "supplier" | "admin" | "none" | "unknown";
  unreadCount: number;
  // Workflow hints
  quoteStatus: string;
  hasWinner: boolean;
  kickoffStatus: "not_started" | "in_progress" | "complete" | "n/a";
};

type QuoteRow = {
  id: string;
  file_name: string | null;
  company: string | null;
  customer_name: string | null;
  customer_email: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  file_names?: string[] | null;
  upload_file_names?: string[] | null;
  file_count?: number | null;
  upload_file_count?: number | null;
  awarded_at?: string | null;
  awarded_supplier_id?: string | null;
  awarded_bid_id?: string | null;
};

const QUOTES_WITH_UPLOADS_COLUMNS =
  "id,file_name,company,customer_name,customer_email,status,created_at,updated_at,file_names,upload_file_names,file_count,upload_file_count,awarded_at,awarded_supplier_id,awarded_bid_id";

type KickoffTotals = { total: number; completed: number };

type ThreadRoleTimestamps = {
  quoteId: string;
  lastMessageAt: string | null;
  lastMessageAuthorRole: "customer" | "supplier" | "admin" | null;
  lastCustomerMessageAt: string | null;
  lastSupplierMessageAt: string | null;
  lastAdminMessageAt: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isWinnerQuote(row: QuoteRow): boolean {
  const status = (row.status ?? "").trim().toLowerCase();
  return (
    Boolean(row.awarded_at) ||
    Boolean(row.awarded_bid_id) ||
    Boolean(row.awarded_supplier_id) ||
    status === "won"
  );
}

function deriveKickoffStatus(input: {
  hasWinner: boolean;
  kickoffCompletedAt: string | null;
  totals: KickoffTotals | null;
}): InboxRow["kickoffStatus"] {
  if (!input.hasWinner) return "n/a";
  if (input.kickoffCompletedAt) return "complete";
  const totals = input.totals ?? { total: 0, completed: 0 };
  if (totals.total <= 0) return "not_started";
  if (totals.completed <= 0) return "not_started";
  if (totals.completed >= totals.total) return "complete";
  return "in_progress";
}

function normalizeRole(value: unknown): "customer" | "supplier" | "admin" | null {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "customer" || normalized === "supplier" || normalized === "admin") {
    return normalized;
  }
  return null;
}

function computeNeedsReplyFrom(signal: ThreadRoleTimestamps): InboxRow["needsReplyFrom"] {
  const lastRole = signal.lastMessageAuthorRole;
  const lastMessageAt = signal.lastMessageAt;
  if (!lastRole || !lastMessageAt) return "none";

  const lastCustomer = signal.lastCustomerMessageAt;
  const lastSupplier = signal.lastSupplierMessageAt;
  const lastAdmin = signal.lastAdminMessageAt;

  if (lastRole === "customer") {
    if (!lastSupplier || (lastCustomer && lastSupplier < lastCustomer)) return "supplier";
    if (!lastAdmin || (lastCustomer && lastAdmin < lastCustomer)) return "admin";
    return "none";
  }

  if (lastRole === "supplier") {
    if (!lastCustomer || (lastSupplier && lastCustomer < lastSupplier)) return "customer";
    if (!lastAdmin || (lastSupplier && lastAdmin < lastSupplier)) return "admin";
    return "none";
  }

  if (lastRole === "admin") {
    const a = lastCustomer ?? null;
    const b = lastSupplier ?? null;
    if (!a && !b) return "none";
    if (a && (!b || a >= b)) return "customer";
    return "supplier";
  }

  return "unknown";
}

async function loadKickoffCompletedAtByQuoteId(
  quoteIds: string[],
): Promise<Map<string, string | null>> {
  const map = new Map<string, string | null>();
  const ids = (Array.isArray(quoteIds) ? quoteIds : []).map(normalizeId).filter(Boolean);
  if (ids.length === 0) return map;

  for (const id of ids) {
    map.set(id, null);
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quotes")
      .select("id,kickoff_completed_at")
      .in("id", ids)
      .returns<{ id: string; kickoff_completed_at?: string | null }[]>();
    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[messages inbox] kickoff_completed_at query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }
    for (const row of data ?? []) {
      const id = normalizeId(row.id);
      if (!id) continue;
      const value =
        typeof row.kickoff_completed_at === "string" && row.kickoff_completed_at.trim()
          ? row.kickoff_completed_at
          : null;
      map.set(id, value);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[messages inbox] kickoff_completed_at query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadKickoffTotalsByWinnerSupplier(
  quotes: QuoteRow[],
): Promise<Map<string, KickoffTotals>> {
  const map = new Map<string, KickoffTotals>();

  const winnerPairs: Array<{ quoteId: string; supplierId: string }> = quotes
    .map((q) => {
      const quoteId = normalizeId(q.id);
      const supplierId = normalizeId(q.awarded_supplier_id);
      const hasWinner = isWinnerQuote(q);
      if (!quoteId || !supplierId || !hasWinner) return null;
      return { quoteId, supplierId };
    })
    .filter(Boolean) as Array<{ quoteId: string; supplierId: string }>;

  if (winnerPairs.length === 0) {
    return map;
  }

  const quoteIds = Array.from(new Set(winnerPairs.map((p) => p.quoteId)));
  const supplierIds = Array.from(new Set(winnerPairs.map((p) => p.supplierId)));
  const winnerSupplierByQuoteId = new Map<string, string>();
  for (const pair of winnerPairs) {
    winnerSupplierByQuoteId.set(pair.quoteId, pair.supplierId);
  }

  try {
    const { data, error } = await supabaseServer()
      .from("quote_kickoff_tasks")
      .select("quote_id,supplier_id,completed")
      .in("quote_id", quoteIds)
      .in("supplier_id", supplierIds)
      .returns<{ quote_id: string; supplier_id: string; completed: boolean | null }[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[messages inbox] kickoff tasks query failed", {
        quoteIdsCount: quoteIds.length,
        supplierIdsCount: supplierIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    const totals = new Map<string, KickoffTotals>();
    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      const supplierId = normalizeId(row.supplier_id);
      if (!quoteId || !supplierId) continue;
      const winnerSupplierId = winnerSupplierByQuoteId.get(quoteId);
      if (!winnerSupplierId || winnerSupplierId !== supplierId) {
        continue;
      }
      const key = `${quoteId}:${supplierId}`;
      const existing = totals.get(key) ?? { total: 0, completed: 0 };
      existing.total += 1;
      if (row.completed) {
        existing.completed += 1;
      }
      totals.set(key, existing);
    }

    for (const [key, value] of totals) {
      map.set(key, value);
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[messages inbox] kickoff tasks query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadThreadRoleTimestampsFromMessagesFallback(
  quoteIds: string[],
): Promise<Map<string, ThreadRoleTimestamps>> {
  const ids = Array.from(new Set((quoteIds ?? []).map(normalizeId).filter(Boolean)));
  const map = new Map<string, ThreadRoleTimestamps>();
  for (const id of ids) {
    map.set(id, {
      quoteId: id,
      lastMessageAt: null,
      lastMessageAuthorRole: null,
      lastCustomerMessageAt: null,
      lastSupplierMessageAt: null,
      lastAdminMessageAt: null,
    });
  }
  if (ids.length === 0) return map;

  type MsgRow = { quote_id: string; created_at: string; sender_role: string | null };
  const limit = Math.max(250, Math.min(8000, ids.length * 30));

  try {
    const { data, error } = await supabaseServer()
      .from("quote_messages")
      .select("quote_id,created_at,sender_role")
      .in("quote_id", ids)
      .order("created_at", { ascending: false })
      .limit(limit)
      .returns<MsgRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) return map;
      console.error("[messages inbox] quote_messages query failed", {
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const quoteId = normalizeId(row.quote_id);
      if (!quoteId) continue;
      const existing = map.get(quoteId);
      if (!existing) continue;

      const createdAt = typeof row.created_at === "string" ? row.created_at : "";
      if (!createdAt) continue;
      const role = normalizeRole(row.sender_role ?? null);
      if (!role) continue;

      if (!existing.lastMessageAt) {
        existing.lastMessageAt = createdAt;
        existing.lastMessageAuthorRole = role;
      }

      if (role === "customer") {
        if (!existing.lastCustomerMessageAt || createdAt > existing.lastCustomerMessageAt) {
          existing.lastCustomerMessageAt = createdAt;
        }
      } else if (role === "supplier") {
        if (!existing.lastSupplierMessageAt || createdAt > existing.lastSupplierMessageAt) {
          existing.lastSupplierMessageAt = createdAt;
        }
      } else if (role === "admin") {
        if (!existing.lastAdminMessageAt || createdAt > existing.lastAdminMessageAt) {
          existing.lastAdminMessageAt = createdAt;
        }
      }
    }
  } catch (error) {
    if (isMissingTableOrColumnError(error)) return map;
    console.error("[messages inbox] quote_messages query crashed", {
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

async function loadThreadRoleTimestampsForAdminViaRpc(
  quoteIds: string[],
): Promise<Map<string, ThreadRoleTimestamps> | null> {
  type RpcRow = {
    quote_id: string;
    last_message_at: string | null;
    last_message_author_role: string | null;
    last_customer_message_at: string | null;
    last_supplier_message_at: string | null;
    last_admin_message_at: string | null;
  };

  try {
    const { data, error } = await supabaseServer()
      .rpc("admin_message_sla_for_quotes", { p_quote_ids: quoteIds })
      .returns<RpcRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return null;
      }
      // Missing RPC manifests as PGRST202; treat as "not available" without failing the inbox.
      const code = (serializeSupabaseError(error) as any)?.code;
      if (code === "PGRST202") return null;
      console.error("[messages inbox] admin_message_sla_for_quotes RPC failed", {
        quoteIdsCount: quoteIds.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return null;
    }

    const map = new Map<string, ThreadRoleTimestamps>();
    const rows: RpcRow[] = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const quoteId = normalizeId(row.quote_id);
      if (!quoteId) continue;
      map.set(quoteId, {
        quoteId,
        lastMessageAt: typeof row.last_message_at === "string" ? row.last_message_at : null,
        lastMessageAuthorRole: normalizeRole(row.last_message_author_role ?? null),
        lastCustomerMessageAt:
          typeof row.last_customer_message_at === "string" ? row.last_customer_message_at : null,
        lastSupplierMessageAt:
          typeof row.last_supplier_message_at === "string" ? row.last_supplier_message_at : null,
        lastAdminMessageAt:
          typeof row.last_admin_message_at === "string" ? row.last_admin_message_at : null,
      });
    }
    return map;
  } catch (error) {
    const code = (serializeSupabaseError(error) as any)?.code;
    if (code === "PGRST202" || isMissingTableOrColumnError(error)) return null;
    console.error("[messages inbox] admin_message_sla_for_quotes RPC crashed", {
      quoteIdsCount: quoteIds.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return null;
  }
}

function buildInboxRows(args: {
  roleView: InboxRow["roleView"];
  quotes: QuoteRow[];
  unreadByQuoteId: Record<
    string,
    { unreadCount: number; lastMessage: { body: string; created_at: string } | null }
  >;
  threadSignalsByQuoteId: Map<string, ThreadRoleTimestamps>;
  kickoffCompletedAtByQuoteId: Map<string, string | null>;
  kickoffTotalsByKey: Map<string, KickoffTotals>;
}): InboxRow[] {
  const rows: InboxRow[] = [];

  for (const quote of args.quotes) {
    const quoteId = normalizeId(quote.id);
    if (!quoteId) continue;

    const unreadSummary = args.unreadByQuoteId[quoteId] ?? { unreadCount: 0, lastMessage: null };
    const lastMessage = unreadSummary.lastMessage;
    const lastMessageAt = lastMessage?.created_at ?? null;
    const lastMessagePreview = (lastMessage?.body ?? "").trim();

    // Only include quotes that have at least one message (this is an inbox).
    if (!lastMessageAt) continue;

    const files = buildQuoteFilesFromRow(quote);
    const rfqLabel = deriveQuotePrimaryLabel(quote, { files });
    const hasWinner = isWinnerQuote(quote);
    const kickoffCompletedAt = args.kickoffCompletedAtByQuoteId.get(quoteId) ?? null;
    const winnerSupplierId = normalizeId(quote.awarded_supplier_id) || null;
    const kickoffKey = winnerSupplierId ? `${quoteId}:${winnerSupplierId}` : null;
    const kickoffTotals = kickoffKey ? args.kickoffTotalsByKey.get(kickoffKey) ?? null : null;
    const kickoffStatus = deriveKickoffStatus({
      hasWinner,
      kickoffCompletedAt,
      totals: kickoffTotals,
    });

    const signal = args.threadSignalsByQuoteId.get(quoteId) ?? null;
    const needsReplyFrom = signal ? computeNeedsReplyFrom(signal) : "unknown";

    rows.push({
      quoteId,
      rfqLabel,
      roleView: args.roleView,
      lastMessageAt,
      lastMessagePreview: lastMessagePreview || "—",
      needsReplyFrom,
      unreadCount: Math.max(0, Math.floor(unreadSummary.unreadCount ?? 0)),
      quoteStatus: getQuoteStatusLabel(quote.status),
      hasWinner,
      kickoffStatus,
    });
  }

  rows.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  return rows;
}

export async function loadCustomerInbox(
  userIdOrEmail: { userId: string | null; email: string | null },
): Promise<InboxRow[]> {
  const userId = normalizeId(userIdOrEmail.userId);
  const email = normalizeEmailInput(userIdOrEmail.email ?? null);

  const customer = userId ? await getCustomerByUserId(userId) : null;
  const customerFallback = !customer && email ? await getCustomerByEmail(email) : null;
  const customerEmail = normalizeEmailInput(customer?.email ?? customerFallback?.email ?? email);
  if (!customerEmail) return [];

  let quoteRows: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select(QUOTES_WITH_UPLOADS_COLUMNS)
      .ilike("customer_email", customerEmail)
      .order("updated_at", { ascending: false })
      .returns<QuoteRow[]>();
    if (error) {
      console.error("[messages inbox][customer] quotes query failed", {
        userId: userId || null,
        email: customerEmail,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }
    quoteRows = (data ?? []) as QuoteRow[];
  } catch (error) {
    console.error("[messages inbox][customer] quotes query crashed", {
      userId: userId || null,
      email: customerEmail,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const quoteIds = quoteRows.map((row) => row.id).filter(Boolean);

  const unreadByQuoteId =
    userId && quoteIds.length > 0 ? await loadUnreadMessageSummary({ quoteIds, userId }) : {};

  const threadSignalsByQuoteId = await loadThreadRoleTimestampsFromMessagesFallback(quoteIds);
  const kickoffCompletedAtByQuoteId = await loadKickoffCompletedAtByQuoteId(quoteIds);
  const kickoffTotalsByKey = await loadKickoffTotalsByWinnerSupplier(quoteRows);

  return buildInboxRows({
    roleView: "customer",
    quotes: quoteRows,
    unreadByQuoteId,
    threadSignalsByQuoteId,
    kickoffCompletedAtByQuoteId,
    kickoffTotalsByKey,
  });
}

export async function loadSupplierInbox(supplierUserId: string): Promise<InboxRow[]> {
  const userId = normalizeId(supplierUserId);
  if (!userId) return [];

  const profile = await loadSupplierProfileByUserId(userId);
  const supplier = profile?.supplier ?? null;
  if (!supplier?.id) return [];
  const supplierId = normalizeId(supplier.id);
  if (!supplierId) return [];

  // Visibility = union of: awarded, has bid, has invite, assigned email match.
  const quoteIds = new Set<string>();
  try {
    const [awarded, bids, invites, assigned] = await Promise.all([
      supabaseServer()
        .from("quotes")
        .select("id")
        .eq("awarded_supplier_id", supplierId)
        .returns<{ id: string }[]>(),
      supabaseServer()
        .from("supplier_bids")
        .select("quote_id")
        .eq("supplier_id", supplierId)
        .returns<{ quote_id: string }[]>(),
      supabaseServer()
        .from("quote_invites")
        .select("quote_id")
        .eq("supplier_id", supplierId)
        .returns<{ quote_id: string }[]>(),
      supplier.primary_email
        ? supabaseServer()
            .from("quotes")
            .select("id")
            .eq("assigned_supplier_email", supplier.primary_email)
            .returns<{ id: string }[]>()
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    for (const row of awarded.data ?? []) {
      const id = normalizeId((row as any)?.id);
      if (id) quoteIds.add(id);
    }
    for (const row of bids.data ?? []) {
      const id = normalizeId((row as any)?.quote_id);
      if (id) quoteIds.add(id);
    }
    for (const row of invites.data ?? []) {
      const id = normalizeId((row as any)?.quote_id);
      if (id) quoteIds.add(id);
    }
    for (const row of assigned.data ?? []) {
      const id = normalizeId((row as any)?.id);
      if (id) quoteIds.add(id);
    }

    // Best-effort: if invites schema is missing in older envs, just ignore it.
    if (invites.error && !isMissingTableOrColumnError(invites.error)) {
      console.error("[messages inbox][supplier] quote_invites query failed", {
        supplierId,
        error: serializeSupabaseError(invites.error) ?? invites.error,
      });
    }
    if (bids.error && !isMissingTableOrColumnError(bids.error)) {
      console.error("[messages inbox][supplier] supplier_bids query failed", {
        supplierId,
        error: serializeSupabaseError(bids.error) ?? bids.error,
      });
    }
    if (awarded.error && !isMissingTableOrColumnError(awarded.error)) {
      console.error("[messages inbox][supplier] awarded quotes query failed", {
        supplierId,
        error: serializeSupabaseError(awarded.error) ?? awarded.error,
      });
    }
  } catch (error) {
    console.error("[messages inbox][supplier] visibility query crashed", {
      supplierId,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const ids = Array.from(quoteIds);
  if (ids.length === 0) return [];

  let quoteRows: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select(QUOTES_WITH_UPLOADS_COLUMNS)
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .returns<QuoteRow[]>();
    if (error) {
      console.error("[messages inbox][supplier] quotes_with_uploads query failed", {
        supplierId,
        quoteIdsCount: ids.length,
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }
    quoteRows = (data ?? []) as QuoteRow[];
  } catch (error) {
    console.error("[messages inbox][supplier] quotes_with_uploads query crashed", {
      supplierId,
      quoteIdsCount: ids.length,
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const quoteIdsList = quoteRows.map((row) => row.id).filter(Boolean);
  const unreadByQuoteId =
    quoteIdsList.length > 0 ? await loadUnreadMessageSummary({ quoteIds: quoteIdsList, userId }) : {};

  const threadSignalsByQuoteId = await loadThreadRoleTimestampsFromMessagesFallback(quoteIdsList);
  const kickoffCompletedAtByQuoteId = await loadKickoffCompletedAtByQuoteId(quoteIdsList);
  const kickoffTotalsByKey = await loadKickoffTotalsByWinnerSupplier(quoteRows);

  return buildInboxRows({
    roleView: "supplier",
    quotes: quoteRows,
    unreadByQuoteId,
    threadSignalsByQuoteId,
    kickoffCompletedAtByQuoteId,
    kickoffTotalsByKey,
  });
}

export async function loadAdminInbox(options?: {
  authenticatedAdminUserId?: string;
}): Promise<InboxRow[]> {
  const authenticatedAdminUserId = normalizeId(options?.authenticatedAdminUserId);
  const adminUser =
    authenticatedAdminUserId ? null : await requireAdminUser();
  const adminUserId = authenticatedAdminUserId || normalizeId(adminUser?.id);
  if (!adminUserId) return [];

  let quoteRows: QuoteRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select(QUOTES_WITH_UPLOADS_COLUMNS)
      .order("updated_at", { ascending: false })
      .limit(800)
      .returns<QuoteRow[]>();
    if (error) {
      console.error("[messages inbox][admin] quotes query failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return [];
    }
    quoteRows = (data ?? []) as QuoteRow[];
  } catch (error) {
    console.error("[messages inbox][admin] quotes query crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
    return [];
  }

  const quoteIds = quoteRows.map((row) => row.id).filter(Boolean);
  const unreadByQuoteId =
    quoteIds.length > 0 ? await loadUnreadMessageSummary({ quoteIds, userId: adminUserId }) : {};

  const rpcSignals = quoteIds.length > 0 ? await loadThreadRoleTimestampsForAdminViaRpc(quoteIds) : null;
  const threadSignalsByQuoteId =
    rpcSignals ?? (await loadThreadRoleTimestampsFromMessagesFallback(quoteIds));

  const kickoffCompletedAtByQuoteId = await loadKickoffCompletedAtByQuoteId(quoteIds);
  const kickoffTotalsByKey = await loadKickoffTotalsByWinnerSupplier(quoteRows);

  return buildInboxRows({
    roleView: "admin",
    quotes: quoteRows,
    unreadByQuoteId,
    threadSignalsByQuoteId,
    kickoffCompletedAtByQuoteId,
    kickoffTotalsByKey,
  });
}

