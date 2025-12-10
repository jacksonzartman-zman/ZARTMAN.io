import { loadQuoteMessages, type QuoteMessageRow } from "@/server/quotes/messages";
import type { LoadResult } from "@/server/types/results";

export type QuoteMessageRole = QuoteMessageRow["author_type"];

export type QuoteThreadMessage = {
  id: string;
  quoteId: string;
  role: QuoteMessageRole;
  displayName: string;
  body: string;
  createdAt: string;
  email: string | null;
};

export type QuoteThread = {
  quoteId: string;
  messages: QuoteThreadMessage[];
};

export async function loadQuoteThreadForQuote(
  quoteId: string,
): Promise<LoadResult<QuoteThread>> {
  const normalizedQuoteId =
    typeof quoteId === "string" ? quoteId.trim() : "";

  if (!normalizedQuoteId) {
    return {
      ok: false,
      data: null,
      error: "quoteId is required",
    };
  }

  const result = await loadQuoteMessages(normalizedQuoteId);
  if (!result.ok || !result.data) {
    return {
      ok: false,
      data: null,
      error: result.error ?? "Unable to load messages.",
    };
  }

  const thread: QuoteThread = {
    quoteId: normalizedQuoteId,
    messages: result.data.map(mapQuoteMessageRowToThreadMessage),
  };

  return {
    ok: true,
    data: thread,
    error: null,
  };
}

function mapQuoteMessageRowToThreadMessage(
  row: QuoteMessageRow,
): QuoteThreadMessage {
  const role = normalizeRole(row.author_type);
  return {
    id: row.id,
    quoteId: row.quote_id,
    role,
    displayName: resolveDisplayName(row, role),
    body: row.body,
    createdAt: row.created_at,
    email: row.author_email ?? null,
  };
}

function normalizeRole(role: string | null | undefined): QuoteMessageRole {
  if (role === "customer" || role === "supplier" || role === "admin") {
    return role;
  }
  return "admin";
}

function resolveDisplayName(
  row: QuoteMessageRow,
  role: QuoteMessageRole,
): string {
  if (row.author_name && row.author_name.trim().length > 0) {
    return row.author_name.trim();
  }

  if (row.author_email && row.author_email.trim().length > 0) {
    return row.author_email.trim();
  }

  switch (role) {
    case "customer":
      return "Customer";
    case "supplier":
      return "Supplier";
    case "admin":
    default:
      return "Zartman admin";
  }
}
