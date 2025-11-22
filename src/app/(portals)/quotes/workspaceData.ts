import { supabaseServer } from "@/lib/supabaseServer";
import { getQuoteFilePreviews } from "@/server/quotes/files";
import type { QuoteWithUploadsRow, UploadMeta } from "@/server/quotes/types";
import { loadQuoteMessages, type QuoteMessage } from "@/server/quotes/messages";

export type QuoteWorkspaceData = {
  quote: QuoteWithUploadsRow;
  uploadMeta: UploadMeta | null;
  filePreviews: Awaited<ReturnType<typeof getQuoteFilePreviews>>;
  messages: QuoteMessage[];
  messagesError?: string | null;
};

export async function loadQuoteWorkspaceData(
  quoteId: string,
): Promise<QuoteWorkspaceData | null> {
  const { data: quote, error } = await supabaseServer
    .from("quotes_with_uploads")
    .select("*")
    .eq("id", quoteId)
    .maybeSingle<QuoteWithUploadsRow>();

  if (error) {
    console.error("Portal workspace loader: failed to load quote", error);
  }

  if (!quote) {
    return null;
  }

  let uploadMeta: UploadMeta | null = null;
  if (quote.upload_id) {
    const { data: meta, error: metaError } = await supabaseServer
      .from("uploads")
      .select(
        "first_name,last_name,phone,company,manufacturing_process,quantity,shipping_postal_code,export_restriction,rfq_reason,notes,itar_acknowledged,terms_accepted",
      )
      .eq("id", quote.upload_id)
      .maybeSingle<UploadMeta>();

    if (metaError) {
      console.error("Portal workspace loader: failed to load upload meta", metaError);
    } else {
      uploadMeta = meta;
    }
  }

  const filePreviews = await getQuoteFilePreviews(quote);
  const { messages, error: messagesError } = await loadQuoteMessages(quote.id);

  return {
    quote,
    uploadMeta,
    filePreviews,
    messages: messages ?? [],
    messagesError,
  };
}
