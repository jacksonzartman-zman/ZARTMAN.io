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

const QUOTE_MESSAGE_COLUMNS =
  "id,quote_id,author_type,author_name,author_email,body,created_at";

export async function loadQuoteMessages(
  quoteId: string,
): Promise<QuoteMessageOperationResult<QuoteMessage[]>> {
  const normalizedId = quoteId?.trim();

  if (!normalizedId) {
    return { data: [], error: "quoteId is required" };
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
        data: [],
        error: "Failed to load quote messages.",
      };
    }

    return {
      data: (data as QuoteMessage[]) ?? [],
      error: null,
    };
  } catch (unexpectedError) {
    console.error("loadQuoteMessages: unexpected error", unexpectedError);
    return {
      data: [],
      error: "Failed to load quote messages.",
    };
  }
}

type CreateAdminQuoteMessageParams = {
  quoteId: string;
  body: string;
};

export async function createAdminQuoteMessage({
  quoteId,
  body,
}: CreateAdminQuoteMessageParams): Promise<
  QuoteMessageOperationResult<QuoteMessage | null>
> {
  const normalizedId = quoteId?.trim();
  const trimmedBody = body?.trim();

  if (!normalizedId || !trimmedBody) {
    return {
      data: null,
      error: "Missing message parameters.",
    };
  }

  try {
    const { data, error } = await supabaseServer
      .from("quote_messages")
      .insert({
        quote_id: normalizedId,
        author_type: "admin",
        author_name: "Zartman admin",
        author_email: null,
        body: trimmedBody,
      })
      .select(QUOTE_MESSAGE_COLUMNS)
      .single<QuoteMessage>();

    if (error || !data) {
      console.error("createAdminQuoteMessage: insert failed", {
        quoteId: normalizedId,
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
    console.error(
      "createAdminQuoteMessage: unexpected error",
      unexpectedError,
    );
    return {
      data: null,
      error: "Failed to post message.",
    };
  }
}
