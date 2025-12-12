import { supabaseServer } from "@/lib/supabaseServer";
import {
  isMissingTableOrColumnError,
  isRowLevelSecurityDeniedError,
  serializeSupabaseError,
} from "@/server/admin/logging";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuoteMessageSenderRole =
  | "admin"
  | "customer"
  | "supplier"
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
};

export type LoadQuoteMessagesResult = {
  ok: boolean;
  messages: QuoteMessageRecord[];
  reason?: "not_found" | "schema_error" | "unauthorized" | "unknown";
  error?: unknown;
};

export type CreateQuoteMessageResult = {
  ok: boolean;
  message: QuoteMessageRecord | null;
  reason?: "validation" | "schema_error" | "unauthorized" | "unknown";
  error?: unknown;
};

type CreateQuoteMessageParams = {
  quoteId: string;
  senderId: string;
  senderRole: QuoteMessageSenderRole;
  body: string;
  senderName?: string | null;
  senderEmail?: string | null;
  supabase?: SupabaseClient;
};

const MESSAGE_COLUMNS =
  "id,quote_id,sender_id,sender_role,sender_name,sender_email,body,created_at,updated_at";

export async function loadQuoteMessages(
  quoteId: string,
): Promise<LoadQuoteMessagesResult> {
  const normalizedQuoteId = normalizeId(quoteId);

  if (!normalizedQuoteId) {
    return {
      ok: false,
      messages: [],
      reason: "not_found",
      error: "quoteId is required",
    };
  }

  console.log("[quote messages] load start", { quoteId: normalizedQuoteId });

  try {
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select(MESSAGE_COLUMNS)
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: true });

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
    console.log("[quote messages] load result", {
      quoteId: normalizedQuoteId,
      count: rows.length,
    });

    return {
      ok: true,
      messages: rows,
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

  console.log("[quote messages] insert start", {
    quoteId: normalizedQuoteId,
    senderId: normalizedSenderId,
    senderRole: normalizedSenderRole,
  });

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

    console.log("[quote messages] insert success", {
      quoteId: normalizedQuoteId,
      senderId: normalizedSenderId,
      senderRole: normalizedSenderRole,
      messageId: data.id,
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
  if (trimmed === "admin" || trimmed === "customer" || trimmed === "supplier") {
    return trimmed;
  }
  return value.trim();
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
