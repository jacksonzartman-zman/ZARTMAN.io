import { supabaseServer } from "@/lib/supabaseServer";
import {
  handleMissingSupabaseSchema,
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  isSupabaseRelationMarkedMissing,
  isSupabaseSelectIncompatibleError,
  serializeSupabaseError,
  warnOnce,
} from "@/server/admin/logging";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitQuoteEvent } from "@/server/quotes/events";
import { signPreviewToken } from "@/server/cadPreviewToken";
import { hasColumns } from "@/server/db/schemaContract";
import { debugOnce } from "@/server/db/schemaErrors";

export type QuoteMessageSenderRole =
  | "admin"
  | "customer"
  | "supplier"
  | "system"
  | (string & {});

export type QuoteMessageRecord = {
  id: string;
  quote_id: string;
  sender_id: string;
  sender_role: QuoteMessageSenderRole;
  sender_name: string | null;
  sender_email: string | null;
  body: string;
  created_at: string;
  updated_at: string | null;
  // Optional across schema variants.
  metadata?: unknown;
};

export type LoadQuoteMessagesResult = {
  ok: boolean;
  messages: QuoteMessageRecord[];
  reason?: "not_found" | "schema_error" | "unauthorized" | "unknown";
  error?: unknown;
};

export type LoadQuoteMessagesInput =
  | string
  | {
      quoteId: string;
      /**
       * Placeholder for v0 viewer-aware loaders. Access is currently enforced
       * via RLS (for authed clients) or via admin service role.
       */
      viewer?: unknown;
      viewerUserId?: string | null;
      viewerRole?: "admin" | "customer" | "supplier" | (string & {}) | null;
      limit?: number;
    };

export type CreateQuoteMessageResult = {
  ok: boolean;
  message: QuoteMessageRecord | null;
  reason?: "validation" | "schema_error" | "unauthorized" | "unknown";
  error?: unknown;
};

export type PostQuoteMessageInput = {
  quoteId: string;
  body: string;
  actorUserId: string;
  actorRole: QuoteMessageSenderRole;
  supplierId?: string | null;
  customerId?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  supabase?: SupabaseClient;
};

type CreateQuoteMessageParams = {
  quoteId: string;
  senderId: string;
  senderRole: QuoteMessageSenderRole;
  body: string;
  senderName?: string | null;
  senderEmail?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  supabase?: SupabaseClient;
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

function normalizePath(value?: string | null): string {
  const raw = typeof value === "string" ? value.trim() : "";
  return raw.replace(/^\/+/, "");
}

function safeDownloadUrlForViewer(args: {
  viewerRole: string | null;
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

  // Admin can use direct bucket/path (API enforces admin).
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
  viewer: { viewerRole: string | null; viewerUserId: string | null },
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
      const filename = typeof a.filename === "string" ? a.filename.trim() : "";
      const storageBucketId = typeof a.storageBucketId === "string" ? a.storageBucketId.trim() : "";
      const storagePath = typeof a.storagePath === "string" ? a.storagePath.trim() : "";
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
        mime: typeof a.mime === "string" ? a.mime : null,
        quoteFileId: typeof a.quoteFileId === "string" ? a.quoteFileId : null,
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

const QUOTE_MESSAGES_RELATION = "quote_messages";

// Process-level escape hatch:
// - If this deployment rejects our "minimal safe select" (PostgREST schema cache drift,
//   select parser issues, relationship embedding issues), we stop retrying it and go
//   straight to `select("*")` on subsequent calls to avoid repeated 400 spam.
let forceFallbackSelectAll = false;

const QUOTE_MESSAGES_COLUMN_CACHE = new Map<string, boolean>();

async function hasQuoteMessagesColumn(column: string): Promise<boolean> {
  const key = typeof column === "string" ? column.trim() : "";
  if (!key) return false;
  const cached = QUOTE_MESSAGES_COLUMN_CACHE.get(key);
  if (typeof cached === "boolean") return cached;
  const ok = await hasColumns(QUOTE_MESSAGES_RELATION, [key]);
  QUOTE_MESSAGES_COLUMN_CACHE.set(key, ok);
  return ok;
}

async function buildQuoteMessagesMinimalSelect(): Promise<string> {
  // Core columns (most likely to exist).
  const cols: string[] = ["id", "quote_id", "sender_id", "sender_role", "body", "created_at"];

  // Optional columns (schema drift tolerant).
  if (await hasQuoteMessagesColumn("updated_at")) cols.push("updated_at");
  if (await hasQuoteMessagesColumn("sender_name")) cols.push("sender_name");
  if (await hasQuoteMessagesColumn("metadata")) cols.push("metadata");

  // Intentionally excluded:
  // - sender_email (do not select by default; do not expose to UI models)
  return cols.join(",");
}

/**
 * Manual verification checklist:
 * - Deployment where quote_messages.sender_email is missing: no repeated 400s; thread still renders.
 * - Attachments render when metadata.attachments exists.
 * - "Email" badge renders when metadata.via === "email".
 * - No emails are displayed anywhere (admin/customer/supplier portals).
 */
function normalizeQuoteMessageRow(row: Record<string, unknown>): QuoteMessageRecord | null {
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const quoteId = typeof row.quote_id === "string" ? row.quote_id.trim() : "";
  const senderId = typeof row.sender_id === "string" ? row.sender_id.trim() : "";
  const senderRole =
    typeof row.sender_role === "string" && row.sender_role.trim()
      ? (row.sender_role.trim() as QuoteMessageSenderRole)
      : ("system" as QuoteMessageSenderRole);
  const body = typeof row.body === "string" ? row.body : "";
  const createdAt = typeof row.created_at === "string" ? row.created_at : "";

  if (!id || !quoteId || !senderId || !createdAt) return null;

  const senderNameRaw = (row as any).sender_name;
  const senderName =
    typeof senderNameRaw === "string" && senderNameRaw.trim().length > 0
      ? senderNameRaw.trim()
      : null;

  const updatedAtRaw = (row as any).updated_at;
  const updatedAt =
    typeof updatedAtRaw === "string" && updatedAtRaw.trim().length > 0 ? updatedAtRaw : null;

  // Metadata is optional. Keep it null-safe and do NOT assume it's an object.
  const metadata = "metadata" in row ? ((row as any).metadata ?? null) : undefined;

  return {
    id,
    quote_id: quoteId,
    sender_id: senderId,
    sender_role: senderRole,
    sender_name: senderName,
    // Enforce "no email leakage": never surface sender_email into the UI model.
    sender_email: null,
    body,
    created_at: createdAt,
    updated_at: updatedAt,
    ...(typeof metadata === "undefined" ? {} : { metadata }),
  };
}

export async function loadQuoteMessages(
  input: LoadQuoteMessagesInput,
): Promise<LoadQuoteMessagesResult> {
  const quoteId = typeof input === "string" ? input : input.quoteId;
  const normalizedQuoteId = normalizeId(quoteId);
  const limit =
    typeof input === "object" && input !== null && "limit" in input
      ? normalizeLimit((input as { limit?: number }).limit)
      : 50;
  const viewerRole =
    typeof input === "object" && input !== null && "viewerRole" in input
      ? ((input as { viewerRole?: string | null }).viewerRole ?? null)
      : null;
  const viewerUserId =
    typeof input === "object" && input !== null && "viewerUserId" in input
      ? ((input as { viewerUserId?: string | null }).viewerUserId ?? null)
      : null;

  if (!normalizedQuoteId) {
    return {
      ok: false,
      messages: [],
      reason: "not_found",
      error: "quoteId is required",
    };
  }

  if (isSupabaseRelationMarkedMissing(QUOTE_MESSAGES_RELATION)) {
    return { ok: true, messages: [] };
  }

  try {
    const run = async (columns: string) => {
      const { data, error } = await supabaseServer
        .from(QUOTE_MESSAGES_RELATION)
        .select(columns as any)
        .eq("quote_id", normalizedQuoteId)
        .order("created_at", { ascending: true })
        .limit(limit);
      return {
        data: (Array.isArray(data) ? data : []) as unknown as Array<Record<string, unknown>>,
        error,
      };
    };

    // Strategy:
    // - Attempt 1: minimal safe select (built dynamically via hasColumns)
    // - Attempt 2: select("*") when schema variant rejects attempt 1
    let rows: Array<Record<string, unknown>> = [];
    let shouldFallback = forceFallbackSelectAll;

    if (!shouldFallback) {
      const select = await buildQuoteMessagesMinimalSelect();
      const attempt1 = await run(select);
      if (!attempt1.error) {
        rows = Array.isArray(attempt1.data)
          ? (attempt1.data as Array<Record<string, unknown>>)
          : [];
      } else if (isSupabaseSelectIncompatibleError(attempt1.error)) {
        const serialized = serializeSupabaseError(attempt1.error);
        const logOnce = isMissingTableOrColumnError(attempt1.error) ? debugOnce : warnOnce;
        logOnce(
          "quote_messages:select_incompatible",
          "[quote_messages] select incompatible; falling back",
          { code: serialized.code, message: serialized.message },
        );
        forceFallbackSelectAll = true;
        shouldFallback = true;
      } else if (
        handleMissingSupabaseSchema({
          relation: QUOTE_MESSAGES_RELATION,
          error: attempt1.error,
          warnPrefix: "[quote_messages]",
          warnKey: "quote_messages:missing_schema",
        })
      ) {
        return { ok: true, messages: [] };
      } else {
        const serialized = serializeSupabaseError(attempt1.error);
        warnOnce("quote_messages:load_failed", "[quote_messages] load failed", {
          code: serialized.code,
          message: serialized.message,
        });
        return { ok: false, messages: [], reason: "unknown", error: serialized ?? attempt1.error };
      }
    }

    if (shouldFallback) {
      const attempt2 = await run("*" as any);
      if (attempt2.error) {
        if (
          handleMissingSupabaseSchema({
            relation: QUOTE_MESSAGES_RELATION,
            error: attempt2.error,
            warnPrefix: "[quote_messages]",
            warnKey: "quote_messages:missing_schema",
          })
        ) {
          return { ok: true, messages: [] };
        }
        const serialized = serializeSupabaseError(attempt2.error);
        warnOnce("quote_messages:load_failed_fallback", "[quote_messages] fallback load failed", {
          code: serialized.code,
          message: serialized.message,
        });
        return { ok: false, messages: [], reason: "unknown", error: serialized ?? attempt2.error };
      }

      rows = Array.isArray(attempt2.data)
        ? (attempt2.data as Array<Record<string, unknown>>)
        : [];
    }

    const normalized = rows
      .map((row) => (row && typeof row === "object" ? normalizeQuoteMessageRow(row) : null))
      .filter((row): row is QuoteMessageRecord => Boolean(row));

    const decorated = decorateMessagesForViewer(normalized, {
      viewerRole: typeof viewerRole === "string" ? viewerRole : null,
      viewerUserId: typeof viewerUserId === "string" ? viewerUserId : null,
    });

    return {
      ok: true,
      messages: decorated,
    };
  } catch (error) {
    if (
      handleMissingSupabaseSchema({
        relation: QUOTE_MESSAGES_RELATION,
        error,
        warnPrefix: "[quote_messages]",
        warnKey: "quote_messages:missing_schema",
      }) ||
      isMissingTableOrColumnError(error)
    ) {
      return { ok: true, messages: [] };
    }
    const serialized = serializeSupabaseError(error);
    warnOnce("quote_messages:load_crashed", "[quote_messages] load crashed", {
      code: serialized.code,
      message: serialized.message,
    });
    return {
      ok: false,
      messages: [],
      reason: "unknown",
      error: serialized ?? error,
    };
  }
}

export async function createQuoteMessage(
  params: CreateQuoteMessageParams,
): Promise<CreateQuoteMessageResult> {
  const normalizedQuoteId = normalizeId(params.quoteId);
  const normalizedSenderId = normalizeId(params.senderId);
  const normalizedSenderRole = normalizeRole(params.senderRole);
  const trimmedBody = sanitizeBody(params.body);
  const normalizedSenderName = sanitizeName(params.senderName);
  const normalizedSenderEmail = sanitizeEmail(params.senderEmail);
  const normalizedSupplierId = normalizeId(params.supplierId ?? null) || null;
  const normalizedCustomerId = normalizeId(params.customerId ?? null) || null;

  if (
    !normalizedQuoteId ||
    !normalizedSenderId ||
    !normalizedSenderRole ||
    !trimmedBody
  ) {
    console.error("[quote messages] insert failed", {
      quoteId: params.quoteId,
      senderId: params.senderId,
      senderRole: params.senderRole,
      reason: "validation",
    });
    return {
      ok: false,
      message: null,
      reason: "validation",
      error: "Missing required message fields.",
    };
  }

  try {
    const supabase = params.supabase ?? supabaseServer;
    const payload: Record<string, unknown> = {
      quote_id: normalizedQuoteId,
      sender_id: normalizedSenderId,
      sender_role: normalizedSenderRole,
      sender_name: normalizedSenderName,
      body: trimmedBody,
    };

    // Drift-tolerant: only include sender_email when the column exists.
    if (await hasQuoteMessagesColumn("sender_email")) {
      payload.sender_email = normalizedSenderEmail;
    }

    const select = await buildQuoteMessagesMinimalSelect();
    const { data, error } = await supabase
      .from(QUOTE_MESSAGES_RELATION)
      .insert(payload)
      .select(select)
      .single<Record<string, unknown>>();

    if (error || !data) {
      const serialized = serializeSupabaseError(error);
      if (isRowLevelSecurityDeniedError(error)) {
        console.warn("[quote messages] insert denied by RLS", {
          quoteId: normalizedQuoteId,
          senderId: normalizedSenderId,
          senderRole: normalizedSenderRole,
          error: serialized ?? error,
        });
        return {
          ok: false,
          message: null,
          reason: "unauthorized",
          error: serialized ?? error,
        };
      }
      const reason = isMissingTableOrColumnError(error)
        ? "schema_error"
        : isUniqueConstraintError(error)
          ? "validation"
          : "unknown";
      if (isMissingTableOrColumnError(error)) {
        debugOnce("quote_messages:insert_missing_schema", "[quote_messages] insert failed; missing schema", {
          code: serialized.code,
          message: serialized.message,
        });
      } else {
        console.error("[quote messages] insert failed", {
          quoteId: normalizedQuoteId,
          senderId: normalizedSenderId,
          senderRole: normalizedSenderRole,
          error: serialized ?? error,
          reason,
        });
      }
      return {
        ok: false,
        message: null,
        reason,
        error: serialized ?? error,
      };
    }

    const normalizedRow =
      data && typeof data === "object" ? normalizeQuoteMessageRow(data as Record<string, unknown>) : null;
    if (!normalizedRow) {
      warnOnce("quote_messages:insert_unexpected_shape", "[quote_messages] insert returned unexpected shape", {
        code: null,
        message: null,
      });
      return { ok: false, message: null, reason: "unknown", error: "insert_return_shape" };
    }

    // Durable audit trail (service role write).
    void emitQuoteEvent({
      quoteId: normalizedQuoteId,
      eventType: "quote_message_posted",
      actorRole: coerceActorRole(normalizedSenderRole),
      actorUserId: normalizedSenderId,
      actorSupplierId:
        normalizedSenderRole === "supplier" ? normalizedSupplierId : null,
      metadata: {
        // New canonical keys.
        messageId: normalizedRow.id,
        actorRole: normalizedSenderRole,
        supplierId:
          normalizedSenderRole === "supplier" ? normalizedSupplierId : null,
        customerId:
          normalizedSenderRole === "customer" ? normalizedCustomerId : null,

        // Back-compat keys.
        message_id: normalizedRow.id,
        sender_role: normalizedSenderRole,
        sender_name: normalizedRow.sender_name ?? null,
        sender_email: null,
      },
      createdAt: normalizedRow.created_at,
    });

    return {
      ok: true,
      message: normalizedRow,
    };
  } catch (error) {
    if (isRowLevelSecurityDeniedError(error)) {
      console.warn("[quote messages] insert denied by RLS", {
        quoteId: normalizedQuoteId,
        senderId: normalizedSenderId,
        senderRole: normalizedSenderRole,
        error: serializeSupabaseError(error) ?? error,
      });
      return {
        ok: false,
        message: null,
        reason: "unauthorized",
        error: serializeSupabaseError(error) ?? error,
      };
    }
    if (isMissingTableOrColumnError(error)) {
      const serialized = serializeSupabaseError(error);
      debugOnce("quote_messages:insert_missing_schema_crash", "[quote_messages] insert failed; missing schema", {
        code: serialized.code,
        message: serialized.message,
      });
      return {
        ok: false,
        message: null,
        reason: "schema_error",
        error: serialized ?? error,
      };
    }
    console.error("[quote messages] insert failed", {
      quoteId: normalizedQuoteId,
      senderId: normalizedSenderId,
      senderRole: normalizedSenderRole,
      error,
    });
    return {
      ok: false,
      message: null,
      reason: "unknown",
      error,
    };
  }
}

/**
 * v0-friendly API that matches the shared thread semantics:
 * - trims body
 * - enforces max length (2,000 chars)
 * - delegates persistence + audit emission to `createQuoteMessage`
 */
export async function postQuoteMessage(
  input: PostQuoteMessageInput,
): Promise<CreateQuoteMessageResult> {
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) {
    return {
      ok: false,
      message: null,
      reason: "validation",
      error: "Message body is required.",
    };
  }
  if (body.length > 2000) {
    return {
      ok: false,
      message: null,
      reason: "validation",
      error: "Message body must be 2000 characters or fewer.",
    };
  }
  return createQuoteMessage({
    quoteId: input.quoteId,
    senderId: input.actorUserId,
    senderRole: input.actorRole,
    body,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    supplierId: input.supplierId ?? null,
    customerId: input.customerId ?? null,
    supabase: input.supabase,
  });
}

function normalizeId(value?: string | null): string {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "";
}

function sanitizeBody(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.length > 2000 ? trimmed.slice(0, 2000) : trimmed;
}

function normalizeRole(
  value?: string | null,
): QuoteMessageSenderRole | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (
    trimmed === "admin" ||
    trimmed === "customer" ||
    trimmed === "supplier" ||
    trimmed === "system"
  ) {
    return trimmed;
  }
  return value.trim();
}

function coerceActorRole(value: QuoteMessageSenderRole): "admin" | "customer" | "supplier" | "system" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "admin" || normalized === "customer" || normalized === "supplier") {
    return normalized;
  }
  return "system";
}

function sanitizeName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, 120);
}

function sanitizeEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized.slice(0, 240) : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === "23505";
}

function normalizeLimit(value?: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }
  return Math.max(1, Math.min(Math.floor(value), 250));
}
