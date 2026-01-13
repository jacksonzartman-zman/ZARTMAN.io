import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitQuoteEvent } from "@/server/quotes/events";
import { signPreviewToken } from "@/server/cadPreviewToken";

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

const MESSAGE_COLUMNS =
  "id,quote_id,sender_id,sender_role,sender_name,sender_email,body,created_at,updated_at";
const MESSAGE_COLUMNS_WITH_METADATA = `${MESSAGE_COLUMNS},metadata`;

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

  try {
    const run = async (columns: string) => {
      const { data, error } = await supabaseServer
        .from("quote_messages")
        .select(columns)
        .eq("quote_id", normalizedQuoteId)
        .order("created_at", { ascending: true })
        .limit(limit);
      return { data, error };
    };

    const attempt1 = await run(MESSAGE_COLUMNS_WITH_METADATA);
    let data = attempt1.data;
    let error = attempt1.error;

    if (error && isMissingTableOrColumnError(error)) {
      const attempt2 = await run(MESSAGE_COLUMNS);
      data = attempt2.data;
      error = attempt2.error;
    }

    if (error) {
      const serialized = serializeSupabaseError(error);
      const reason = isMissingTableOrColumnError(error)
        ? "schema_error"
        : "unknown";
      console.error("[quote messages] load failed", {
        quoteId: normalizedQuoteId,
        error: serialized ?? error,
        reason,
      });
      return {
        ok: false,
        messages: [],
        reason,
        error: serialized ?? error,
      };
    }

    const rows = (data ?? []) as QuoteMessageRecord[];
    const decorated = decorateMessagesForViewer(rows, {
      viewerRole: typeof viewerRole === "string" ? viewerRole : null,
      viewerUserId: typeof viewerUserId === "string" ? viewerUserId : null,
    });

    return {
      ok: true,
      messages: decorated,
    };
  } catch (error) {
    console.error("[quote messages] load failed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return {
      ok: false,
      messages: [],
      reason: "unknown",
      error,
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
    const payload = {
      quote_id: normalizedQuoteId,
      sender_id: normalizedSenderId,
      sender_role: normalizedSenderRole,
      sender_name: normalizedSenderName,
      sender_email: normalizedSenderEmail,
      body: trimmedBody,
    };

    const { data, error } = await supabase
      .from("quote_messages")
      .insert(payload)
      .select(MESSAGE_COLUMNS)
      .single<QuoteMessageRecord>();

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
      console.error("[quote messages] insert failed", {
        quoteId: normalizedQuoteId,
        senderId: normalizedSenderId,
        senderRole: normalizedSenderRole,
        error: serialized ?? error,
        reason,
      });
      return {
        ok: false,
        message: null,
        reason,
        error: serialized ?? error,
      };
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
        messageId: data.id,
        actorRole: normalizedSenderRole,
        supplierId:
          normalizedSenderRole === "supplier" ? normalizedSupplierId : null,
        customerId:
          normalizedSenderRole === "customer" ? normalizedCustomerId : null,

        // Back-compat keys.
        message_id: data.id,
        sender_role: normalizedSenderRole,
        sender_name: data.sender_name ?? null,
        sender_email: data.sender_email ?? null,
      },
      createdAt: data.created_at,
    });

    return {
      ok: true,
      message: data,
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
