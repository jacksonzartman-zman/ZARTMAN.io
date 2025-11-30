import { supabaseServer } from "@/lib/supabaseServer";
import type { LoadResult, MutationResult } from "@/server/types/results";

export type QuoteMessageAuthorType = "admin" | "customer" | "supplier";

export type QuoteMessageRow = {
  id: string;
  quote_id: string;
  author_type: QuoteMessageAuthorType;
  author_name: string | null;
  author_email: string | null;
  body: string;
  created_at: string;
};

export type QuoteMessage = QuoteMessageRow;

export type CreateQuoteMessageParams = {
  quoteId: string;
  body: string;
  authorType: QuoteMessageAuthorType;
  authorName?: string | null;
  authorEmail?: string | null;
};

export type CreatePortalQuoteMessageParams = Pick<
  CreateQuoteMessageParams,
  "quoteId" | "body"
> & {
  authorName?: string | null;
  authorEmail?: string | null;
};

const QUOTE_MESSAGE_COLUMNS =
  "id,quote_id,author_type,author_name,author_email,body,created_at";

export async function loadQuoteMessages(
  quoteId: string,
): Promise<LoadResult<QuoteMessageRow[]>> {
  const normalizedQuoteId =
    typeof quoteId === "string" ? quoteId.trim() : "";

  if (!normalizedQuoteId) {
    return {
      ok: false,
      data: null,
      error: "quoteId is required",
    };
  }

  console.log("[quote messages] load start", { quoteId: normalizedQuoteId });

  try {
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select(QUOTE_MESSAGE_COLUMNS)
      .eq("quote_id", normalizedQuoteId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[quote messages] load failed", {
        quoteId: normalizedQuoteId,
        error,
      });
      return {
        ok: false,
        data: null,
        error: "Unable to load messages right now.",
      };
    }

    const rows = (data ?? []) as QuoteMessageRow[];
    console.log("[quote messages] load result", {
      quoteId: normalizedQuoteId,
      count: rows.length,
    });

    return {
      ok: true,
      data: rows,
      error: null,
    };
  } catch (error) {
    console.error("[quote messages] load crashed", {
      quoteId: normalizedQuoteId,
      error,
    });
    return {
      ok: false,
      data: null,
      error: "Unable to load messages right now.",
    };
  }
}

export async function createQuoteMessage({
  quoteId,
  body,
  authorType,
  authorName,
  authorEmail,
}: CreateQuoteMessageParams): Promise<MutationResult<QuoteMessageRow>> {
  const normalizedQuoteId =
    typeof quoteId === "string" ? quoteId.trim() : "";
  const trimmedBody = sanitizeMessageBody(body);
  const normalizedAuthorType = normalizeAuthorType(authorType);
  const normalizedAuthorName = sanitizeAuthorName(authorName);
  const normalizedAuthorEmail = sanitizeAuthorEmail(authorEmail);

  if (!normalizedQuoteId || !trimmedBody || !normalizedAuthorType) {
    console.error("[quote messages] create failed", {
      quoteId,
      authorType,
      reason: "invalid-input",
    });
    return {
      ok: false,
      data: null,
      error: "Missing required message fields.",
    };
  }

  console.log("[quote messages] create start", {
    quoteId: normalizedQuoteId,
    authorType: normalizedAuthorType,
  });

  try {
    const payload = {
      quote_id: normalizedQuoteId,
      author_type: normalizedAuthorType,
      author_name: normalizedAuthorName,
      author_email: normalizedAuthorEmail,
      body: trimmedBody,
    };

    const { data, error } = await supabaseServer
      .from("quote_messages")
      .insert(payload)
      .select(QUOTE_MESSAGE_COLUMNS)
      .single<QuoteMessageRow>();

    if (error || !data) {
      console.error("[quote messages] create failed", {
        quoteId: normalizedQuoteId,
        authorType: normalizedAuthorType,
        error,
      });
      return {
        ok: false,
        data: null,
        error: "Failed to post message.",
      };
    }

    console.log("[quote messages] create success", {
      quoteId: normalizedQuoteId,
      authorType: normalizedAuthorType,
      messageId: data.id,
    });

    return {
      ok: true,
      data,
      error: null,
    };
  } catch (error) {
    console.error("[quote messages] create crashed", {
      quoteId: normalizedQuoteId,
      authorType: normalizedAuthorType,
      error,
    });
    return {
      ok: false,
      data: null,
      error: "Failed to post message.",
    };
  }
}

export async function createAdminQuoteMessage({
  quoteId,
  body,
  authorName,
  authorEmail,
}: Omit<CreateQuoteMessageParams, "authorType">): Promise<
  MutationResult<QuoteMessageRow>
> {
  return createQuoteMessage({
    quoteId,
    body,
    authorType: "admin",
    authorName: authorName ?? "Zartman admin",
    authorEmail: authorEmail ?? null,
  });
}

export async function createCustomerQuoteMessage({
  quoteId,
  body,
  authorName,
  authorEmail,
}: CreatePortalQuoteMessageParams): Promise<
  MutationResult<QuoteMessageRow>
> {
  return createQuoteMessage({
    quoteId,
    body,
    authorType: "customer",
    authorName,
    authorEmail,
  });
}

export async function createSupplierQuoteMessage({
  quoteId,
  body,
  authorName,
  authorEmail,
}: CreatePortalQuoteMessageParams): Promise<
  MutationResult<QuoteMessageRow>
> {
  return createQuoteMessage({
    quoteId,
    body,
    authorType: "supplier",
    authorName,
    authorEmail,
  });
}

function sanitizeMessageBody(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2000) {
    return trimmed.slice(0, 2000);
  }
  return trimmed;
}

function normalizeAuthorType(
  value: string | null | undefined,
): QuoteMessageAuthorType | null {
  if (value === "admin" || value === "customer" || value === "supplier") {
    return value;
  }
  return null;
}

function sanitizeAuthorName(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().slice(0, 120);
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAuthorEmail(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}
