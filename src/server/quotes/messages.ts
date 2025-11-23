import { supabaseServer } from "@/lib/supabaseServer";

export type QuoteMessageAuthorType = "admin" | "customer" | "supplier";

export type QuoteMessage = {
  id: string;
  quote_id: string;
  author_type: QuoteMessageAuthorType;
  author_name: string | null;
  author_email: string | null;
  body: string;
  created_at: string;
};

type QuoteMessageOperationResult<T> = {
  data: T;
  error: string | null;
};

export type CreateQuoteMessageParams = {
  quoteId: string;
  body: string;
  authorType: QuoteMessageAuthorType;
  authorName?: string | null;
  authorEmail?: string | null;
};

type QuoteMessagesLoadResult = {
  messages: QuoteMessage[];
  error: string | null;
};

const QUOTE_MESSAGE_COLUMNS =
  "id,quote_id,author_type,author_name,author_email,body,created_at";

export async function loadQuoteMessages(
  quoteId: string,
): Promise<QuoteMessagesLoadResult> {
  const normalizedId = quoteId?.trim();

  if (!normalizedId) {
    return { messages: [], error: "quoteId is required" };
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .select(QUOTE_MESSAGE_COLUMNS)
      .eq("quote_id", normalizedId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadQuoteMessages: query failed", { quoteId, error });
      return {
        messages: [],
        error: "Unable to load messages right now.",
      };
    }

    return {
      messages: (data as QuoteMessage[]) ?? [],
      error: null,
    };
  } catch (unexpectedError) {
    // Soft-fail so the quote page keeps rendering even if Supabase hiccups.
    console.error("loadQuoteMessages: unexpected error", {
      quoteId: normalizedId,
      error: unexpectedError,
    });
    return {
      messages: [],
      error: "Unable to load messages right now.",
    };
  }
}

export async function createAdminQuoteMessage(params: {
  quoteId: string;
  body: string;
}): Promise<QuoteMessageOperationResult<QuoteMessage | null>> {
  const { quoteId, body } = params;

  return createQuoteMessage({
    quoteId,
    body,
    authorType: "admin",
    authorName: "Zartman admin",
    authorEmail: null,
  });
}

export async function createQuoteMessage({
  quoteId,
  body,
  authorType,
  authorName,
  authorEmail,
}: CreateQuoteMessageParams): Promise<
  QuoteMessageOperationResult<QuoteMessage | null>
> {
  const normalizedId = quoteId?.trim();
  const trimmedBody = body?.trim();
  const normalizedAuthorType =
    authorType === "admin" || authorType === "customer" || authorType === "supplier"
      ? authorType
      : null;
  const trimmedAuthorName =
    typeof authorName === "string" ? authorName.trim().slice(0, 120) : null;
  const trimmedAuthorEmail =
    typeof authorEmail === "string" ? authorEmail.trim().toLowerCase() : null;

  if (!normalizedId || !trimmedBody || !normalizedAuthorType) {
    return {
      data: null,
      error: "Missing message parameters.",
    };
  }

  try {
    const payload = {
      quote_id: normalizedId,
      author_type: normalizedAuthorType,
      author_name: trimmedAuthorName,
      author_email: trimmedAuthorEmail,
      body: trimmedBody,
    };

    const { data, error } = await supabaseServer
      .from("quote_messages")
      .insert(payload)
      .select(QUOTE_MESSAGE_COLUMNS)
      .single<QuoteMessage>();

    if (error || !data) {
      console.error("createQuoteMessage: insert failed", {
        quoteId: normalizedId,
        authorType: normalizedAuthorType,
        error,
      });
      return {
        data: null,
        error: "Failed to post message.",
      };
    }

    return {
      data,
      error: null,
    };
  } catch (unexpectedError) {
    console.error("createQuoteMessage: unexpected error", unexpectedError);
    return {
      data: null,
      error: "Failed to post message.",
    };
  }
}
