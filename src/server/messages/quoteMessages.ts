import { supabaseServer } from "@/lib/supabaseServer";
import { signPreviewToken } from "@/server/cadPreviewToken";
import {
  isMissingSupabaseRelationError,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  markSupabaseRelationMissing,
  serializeSupabaseError,
} from "@/server/admin/logging";
import {
  UnauthorizedError,
  createAuthClient,
  requireAdminUser,
  requireUser,
} from "@/server/auth";
import { logOpsEvent } from "@/server/ops/events";
import type { QuoteMessageRecord, QuoteMessageSenderRole } from "@/server/quotes/messages";

export type QuoteMessageAuthorRole =
  | "admin"
  | "customer"
  | "provider"
  | "system"
  | (string & {});

export type GetQuoteMessagesInput = {
  quoteId: string;
  limit?: number;
  viewerRole?: QuoteMessageSenderRole | null;
  viewerUserId?: string | null;
};

export type GetQuoteMessagesResult = {
  ok: boolean;
  missing: boolean;
  messages: QuoteMessageRecord[];
  error?: string;
};

export type PostQuoteMessageInput = {
  quoteId: string;
  message: string;
  authorRole: QuoteMessageAuthorRole;
  providerId?: string | null;
};

export type PostQuoteMessageResult = {
  ok: boolean;
  missing: boolean;
  message: QuoteMessageRecord | null;
  reason?: "validation" | "unauthorized" | "unknown";
  error?: string;
};

type AttachmentMeta = {
  filename: string;
  storageBucketId: string;
  storagePath: string;
  sizeBytes?: number | null;
  mime?: string | null;
  quoteFileId?: string | null;
  downloadUrl?: string;
};

const QUOTE_MESSAGES_RELATION = "quote_messages";
const PROVIDERS_RELATION = "providers";
const MAX_MESSAGE_LENGTH = 4000;

let forceLegacyInsert = false;

const DEBUG_ONCE_KEYS = new Set<string>();

function debugOnce(key: string, message: string, context?: Record<string, unknown>) {
  if (DEBUG_ONCE_KEYS.has(key)) return;
  DEBUG_ONCE_KEYS.add(key);
  if (context && Object.keys(context).length > 0) {
    console.debug(message, context);
    return;
  }
  console.debug(message);
}

function normalizeId(value?: string | null): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function normalizePath(value?: string | null): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function normalizeLimit(limit?: number): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(Math.floor(limit), 250));
}

function normalizeAuthorRole(value: unknown): QuoteMessageAuthorRole | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed === "supplier") return "provider";
  return trimmed as QuoteMessageAuthorRole;
}

function normalizeSenderRole(value: unknown): QuoteMessageSenderRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "provider") return "supplier";
  if (
    normalized === "admin" ||
    normalized === "customer" ||
    normalized === "supplier" ||
    normalized === "system"
  ) {
    return normalized;
  }
  if (typeof value === "string" && value.trim()) {
    return value.trim() as QuoteMessageSenderRole;
  }
  return "system";
}

function sanitizeMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function loadProviderNames(providerIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(providerIds.map(normalizeId).filter(Boolean)));
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  if (isSupabaseRelationMarkedMissing(PROVIDERS_RELATION)) return map;

  try {
    type ProviderRow = { id: string | null; name: string | null };
    const { data, error } = await supabaseServer
      .from(PROVIDERS_RELATION)
      .select("id,name")
      .in("id", ids)
      .returns<ProviderRow[]>();

    if (error) {
      if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
        const missingRelation = isMissingSupabaseRelationError(error);
        if (missingRelation) {
          markSupabaseRelationMissing(PROVIDERS_RELATION);
        }
        debugOnce(
          missingRelation
            ? "quote_messages:providers_missing"
            : "quote_messages:providers_columns_missing",
          "[quote_messages] providers missing; skipping",
          { code: serializeSupabaseError(error)?.code ?? null },
        );
        return map;
      }
      console.warn("[quote_messages] providers lookup failed", {
        error: serializeSupabaseError(error) ?? error,
      });
      return map;
    }

    for (const row of data ?? []) {
      const id = normalizeId(row?.id ?? null);
      const name = readString(row?.name ?? null);
      if (!id || !name) continue;
      map.set(id, name);
    }
  } catch (error) {
    if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
      const missingRelation = isMissingSupabaseRelationError(error);
      if (missingRelation) {
        markSupabaseRelationMissing(PROVIDERS_RELATION);
      }
      debugOnce(
        missingRelation
          ? "quote_messages:providers_missing_crash"
          : "quote_messages:providers_columns_missing_crash",
        "[quote_messages] providers missing; skipping",
        { code: serializeSupabaseError(error)?.code ?? null },
      );
      return map;
    }
    console.warn("[quote_messages] providers lookup crashed", {
      error: serializeSupabaseError(error) ?? error,
    });
  }

  return map;
}

function safeDownloadUrlForViewer(args: {
  viewerRole: QuoteMessageSenderRole | null;
  viewerUserId: string | null;
  bucket: string;
  path: string;
  filename: string;
}): string | null {
  const role = typeof args.viewerRole === "string" ? args.viewerRole.trim().toLowerCase() : "";
  const bucket = normalizeId(args.bucket);
  const path = normalizePath(args.path);
  const filename = (args.filename ?? "").trim() || "file";
  if (!bucket || !path) return null;

  if (role === "admin") {
    const qs = new URLSearchParams();
    qs.set("bucket", bucket);
    qs.set("path", path);
    qs.set("disposition", "attachment");
    qs.set("filename", filename);
    return `/api/storage-download?${qs.toString()}`;
  }

  const viewerUserId = normalizeId(args.viewerUserId);
  if (!viewerUserId) return null;

  try {
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = signPreviewToken({ userId: viewerUserId, bucket, path, exp });
    const qs = new URLSearchParams();
    qs.set("token", token);
    qs.set("disposition", "attachment");
    qs.set("filename", filename);
    return `/api/storage-download?${qs.toString()}`;
  } catch {
    return null;
  }
}

function decorateMessagesForViewer(
  messages: QuoteMessageRecord[],
  viewer: { viewerRole: QuoteMessageSenderRole | null; viewerUserId: string | null },
): QuoteMessageRecord[] {
  const role = typeof viewer.viewerRole === "string" ? viewer.viewerRole : null;
  const viewerUserId = typeof viewer.viewerUserId === "string" ? viewer.viewerUserId : null;
  if (!role && !viewerUserId) return messages;

  return messages.map((message) => {
    const meta = message?.metadata;
    if (!meta || typeof meta !== "object") return message;

    const record = meta as Record<string, unknown>;
    const attachmentsRaw = record.attachments;
    if (!Array.isArray(attachmentsRaw) || attachmentsRaw.length === 0) return message;

    const attachments: AttachmentMeta[] = [];
    for (const item of attachmentsRaw) {
      if (!item || typeof item !== "object") continue;
      const a = item as Record<string, unknown>;
      const filename = readString(a.filename) ?? "";
      const storageBucketId = readString(a.storageBucketId) ?? "";
      const storagePath = readString(a.storagePath) ?? "";
      if (!filename || !storageBucketId || !storagePath) continue;

      const downloadUrl = safeDownloadUrlForViewer({
        viewerRole: role,
        viewerUserId,
        bucket: storageBucketId,
        path: storagePath,
        filename,
      });

      attachments.push({
        filename,
        storageBucketId,
        storagePath,
        sizeBytes: typeof a.sizeBytes === "number" ? a.sizeBytes : null,
        mime: readString(a.mime),
        quoteFileId: readString(a.quoteFileId),
        ...(downloadUrl ? { downloadUrl } : {}),
      });
    }

    if (attachments.length === 0) return message;

    return {
      ...message,
      metadata: {
        ...record,
        attachments,
      },
    };
  });
}

function normalizeQuoteMessageRow(
  row: Record<string, unknown>,
  providerNameById: Map<string, string>,
): QuoteMessageRecord | null {
  const id = normalizeId(row.id as string);
  const quoteId = normalizeId(row.quote_id as string);
  const createdAt = readString(row.created_at) ?? "";
  if (!id || !quoteId || !createdAt) return null;

  const senderId = normalizeId(
    readString(row.author_user_id) ??
      readString(row.sender_id) ??
      readString(row.provider_id) ??
      id,
  );
  if (!senderId) return null;

  const rawRole = readString(row.author_role) ?? readString(row.sender_role) ?? readString(row.author_type);
  const senderRole = normalizeSenderRole(rawRole);

  const body = typeof row.message === "string" ? row.message : typeof row.body === "string" ? row.body : "";
  const updatedAt = readString(row.updated_at);

  const providerId = readString(row.provider_id);
  const providerName = providerId ? providerNameById.get(providerId) ?? null : null;
  const senderName = readString(row.sender_name) ?? providerName ?? null;

  const metadata = "metadata" in row ? (row as { metadata?: unknown }).metadata : undefined;

  return {
    id,
    quote_id: quoteId,
    sender_id: senderId,
    sender_role: senderRole,
    sender_name: senderName,
    sender_email: null,
    body,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(typeof metadata === "undefined" ? {} : { metadata }),
  };
}

function sortMessagesByCreatedAt(messages: QuoteMessageRecord[]): QuoteMessageRecord[] {
  return [...messages].sort((a, b) => {
    const aTime = Date.parse(a.created_at);
    const bTime = Date.parse(b.created_at);
    if (!Number.isNaN(aTime) && !Number.isNaN(bTime)) {
      if (aTime !== bTime) return aTime - bTime;
      return a.id.localeCompare(b.id);
    }
    if (!Number.isNaN(aTime)) return -1;
    if (!Number.isNaN(bTime)) return 1;
    return a.id.localeCompare(b.id);
  });
}

export async function getQuoteMessages({
  quoteId,
  limit = 50,
  viewerRole = null,
  viewerUserId = null,
}: GetQuoteMessagesInput): Promise<GetQuoteMessagesResult> {
  const normalizedQuoteId = normalizeId(quoteId);
  const cappedLimit = normalizeLimit(limit);

  if (!normalizedQuoteId) {
    return {
      ok: false,
      missing: false,
      messages: [],
      error: "quoteId is required",
    };
  }

  if (isSupabaseRelationMarkedMissing(QUOTE_MESSAGES_RELATION)) {
    return { ok: false, missing: true, messages: [] };
  }

  try {
    const { data, error } = await supabaseServer
      .from(QUOTE_MESSAGES_RELATION)
      .select("*")
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: false })
      .limit(cappedLimit)
      .returns<Record<string, unknown>[]>();

    if (error) {
      if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
        markSupabaseRelationMissing(QUOTE_MESSAGES_RELATION);
        debugOnce("quote_messages:missing_schema", "[quote_messages] missing schema; skipping", {
          code: serializeSupabaseError(error)?.code ?? null,
        });
        return { ok: false, missing: true, messages: [] };
      }
      console.error("[quote_messages] load failed", {
        quoteId: normalizedQuoteId,
        error: serializeSupabaseError(error) ?? error,
      });
      return {
        ok: false,
        missing: false,
        messages: [],
        error: "Unable to load messages.",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    const providerIds = rows
      .map((row) => readString(row?.provider_id))
      .filter((id): id is string => Boolean(id));
    const providerNameById = await loadProviderNames(providerIds);

    const normalized = rows
      .map((row) => (row && typeof row === "object" ? normalizeQuoteMessageRow(row, providerNameById) : null))
      .filter((row): row is QuoteMessageRecord => Boolean(row));

    const ordered = sortMessagesByCreatedAt(normalized);
    const decorated = decorateMessagesForViewer(ordered, {
      viewerRole,
      viewerUserId,
    });

    return {
      ok: true,
      missing: false,
      messages: decorated,
    };
  } catch (error) {
    if (isMissingSupabaseRelationError(error) || isMissingTableOrColumnError(error)) {
      markSupabaseRelationMissing(QUOTE_MESSAGES_RELATION);
      debugOnce("quote_messages:missing_schema_crash", "[quote_messages] missing schema; skipping", {
        code: serializeSupabaseError(error)?.code ?? null,
      });
      return { ok: false, missing: true, messages: [] };
    }
    console.error("[quote_messages] load crashed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(error) ?? error,
    });
    return {
      ok: false,
      missing: false,
      messages: [],
      error: "Unable to load messages.",
    };
  }
}

export async function postQuoteMessage(
  input: PostQuoteMessageInput,
): Promise<PostQuoteMessageResult> {
  const normalizedQuoteId = normalizeId(input.quoteId);
  if (!normalizedQuoteId) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "validation",
      error: "quoteId is required.",
    };
  }

  const body = sanitizeMessage(input.message);
  if (!body) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "validation",
      error: "Message body is required.",
    };
  }
  if (body.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "validation",
      error: `Message body must be ${MAX_MESSAGE_LENGTH} characters or fewer.`,
    };
  }

  const authorRole = normalizeAuthorRole(input.authorRole);
  if (!authorRole || (authorRole !== "admin" && authorRole !== "customer" && authorRole !== "provider")) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "validation",
      error: "Invalid author role.",
    };
  }
  const providerId = normalizeId(input.providerId ?? null) || null;
  if (authorRole === "provider" && !providerId) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "validation",
      error: "providerId is required for provider messages.",
    };
  }

  let actorUserId = "";
  let supabase = supabaseServer;

  try {
    if (authorRole === "admin" || authorRole === "provider") {
      const admin = await requireAdminUser();
      actorUserId = admin.id;
      supabase = supabaseServer;
    } else {
      const user = await requireUser();
      actorUserId = user.id;
      supabase = createAuthClient();
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return {
        ok: false,
        missing: false,
        message: null,
        reason: "unauthorized",
        error: "Not authorized to post messages.",
      };
    }
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "unknown",
      error: "Unable to verify permissions.",
    };
  }

  if (isSupabaseRelationMarkedMissing(QUOTE_MESSAGES_RELATION)) {
    return { ok: false, missing: true, message: null, reason: "unknown" };
  }

  const payloadNew: Record<string, unknown> = {
    quote_id: normalizedQuoteId,
    author_role: authorRole,
    author_user_id: actorUserId || null,
    message: body,
  };
  if (providerId) {
    payloadNew.provider_id = providerId;
  }

  const legacyRole = normalizeSenderRole(authorRole);
  const payloadLegacy: Record<string, unknown> = {
    quote_id: normalizedQuoteId,
    sender_role: legacyRole,
    sender_id: actorUserId,
    body,
  };

  const runInsert = async (payload: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from(QUOTE_MESSAGES_RELATION)
      .insert(payload)
      .select("*")
      .single<Record<string, unknown>>();
    return { data, error };
  };

  let row: Record<string, unknown> | null = null;
  let insertError: unknown = null;

  if (!forceLegacyInsert) {
    const attempt = await runInsert(payloadNew);
    if (!attempt.error && attempt.data) {
      row = attempt.data;
    } else if (attempt.error) {
      if (isMissingSupabaseRelationError(attempt.error) || isMissingTableOrColumnError(attempt.error)) {
        const relationMissing = isMissingSupabaseRelationError(attempt.error);
        if (relationMissing) {
          markSupabaseRelationMissing(QUOTE_MESSAGES_RELATION);
          debugOnce("quote_messages:missing_schema_insert", "[quote_messages] missing schema; skipping", {
            code: serializeSupabaseError(attempt.error)?.code ?? null,
          });
          return { ok: false, missing: true, message: null, reason: "unknown" };
        }
        forceLegacyInsert = true;
      } else {
        insertError = attempt.error;
      }
    }
  }

  if (!row && forceLegacyInsert) {
    const attempt = await runInsert(payloadLegacy);
    if (!attempt.error && attempt.data) {
      row = attempt.data;
    } else if (attempt.error) {
      if (isMissingSupabaseRelationError(attempt.error) || isMissingTableOrColumnError(attempt.error)) {
        markSupabaseRelationMissing(QUOTE_MESSAGES_RELATION);
        debugOnce("quote_messages:missing_schema_insert_legacy", "[quote_messages] missing schema; skipping", {
          code: serializeSupabaseError(attempt.error)?.code ?? null,
        });
        return { ok: false, missing: true, message: null, reason: "unknown" };
      }
      insertError = attempt.error;
    }
  }

  if (!row) {
    console.error("[quote_messages] insert failed", {
      quoteId: normalizedQuoteId,
      error: serializeSupabaseError(insertError) ?? insertError,
    });
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "unknown",
      error: "Unable to post message.",
    };
  }

  const providerNameById = providerId ? await loadProviderNames([providerId]) : new Map<string, string>();
  const normalizedMessage = normalizeQuoteMessageRow(row, providerNameById);
  if (!normalizedMessage) {
    return {
      ok: false,
      missing: false,
      message: null,
      reason: "unknown",
      error: "Unable to normalize message.",
    };
  }

  void logOpsEvent({
    quoteId: normalizedQuoteId,
    eventType: "message_posted",
    payload: { authorRole },
  });

  return {
    ok: true,
    missing: false,
    message: normalizedMessage,
  };
}
