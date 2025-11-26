import { supabaseServer } from "@/lib/supabaseServer";
import {
  getQuoteFilePreviews,
  type QuoteFilePreviewOptions,
  type UploadFileReference,
} from "@/server/quotes/files";
import type { QuoteWithUploadsRow, UploadMeta } from "@/server/quotes/types";
import { loadQuoteMessages, type QuoteMessage } from "@/server/quotes/messages";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";

export type QuoteWorkspaceData = {
  quote: QuoteWithUploadsRow;
  uploadMeta: UploadMeta | null;
  filePreviews: Awaited<ReturnType<typeof getQuoteFilePreviews>>;
  messages: QuoteMessage[];
  messagesError?: string | null;
  filesUnavailable?: boolean;
};

type LoadQuoteWorkspaceOptions = {
  safeOnly?: boolean;
};

type SafeQuoteRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;

type QuoteExtrasRow = Pick<
  QuoteWithUploadsRow,
  "customer_id" | "dfm_notes" | "internal_notes"
>;

type UploadMetaRow = UploadMeta & {
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
};

export async function loadQuoteWorkspaceData(
  quoteId: string,
  options?: LoadQuoteWorkspaceOptions,
): Promise<QuoteWorkspaceData | null> {
  const safeOnly = Boolean(options?.safeOnly);
  let quote: QuoteWithUploadsRow | null = null;

  if (safeOnly) {
    const { data: safeQuote, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select(SAFE_QUOTE_WITH_UPLOADS_FIELDS.join(","))
      .eq("id", quoteId)
      .maybeSingle<SafeQuoteRow>();

    if (error) {
      console.error("Portal workspace loader: failed to load quote", error);
    }

    if (!safeQuote) {
      return null;
    }

    const { data: extras, error: extrasError } = await supabaseServer
      .from("quotes")
      .select("customer_id,dfm_notes,internal_notes")
      .eq("id", quoteId)
      .maybeSingle<QuoteExtrasRow>();

    if (extrasError) {
      console.error(
        "Portal workspace loader: failed to load quote extras",
        extrasError,
      );
    }

    quote = {
      ...safeQuote,
      customer_id: extras?.customer_id ?? null,
      dfm_notes: extras?.dfm_notes ?? null,
      internal_notes: extras?.internal_notes ?? null,
    };
  } else {
    const { data: fullQuote, error } = await supabaseServer
      .from("quotes_with_uploads")
      .select("*")
      .eq("id", quoteId)
      .maybeSingle<QuoteWithUploadsRow>();

    if (error) {
      console.error("Portal workspace loader: failed to load quote", error);
    }

    if (!fullQuote) {
      return null;
    }

    quote = fullQuote;
  }

  let uploadMeta: UploadMeta | null = null;
  let uploadFileReference: UploadFileReference | undefined;
  if (quote.upload_id) {
    const { data: meta, error: metaError } = await supabaseServer
      .from("uploads")
      .select(
        "first_name,last_name,phone,company,manufacturing_process,quantity,shipping_postal_code,export_restriction,rfq_reason,notes,itar_acknowledged,terms_accepted,file_name,file_path,mime_type",
      )
      .eq("id", quote.upload_id)
      .maybeSingle<UploadMetaRow>();

    if (metaError) {
      console.error("Portal workspace loader: failed to load upload meta", metaError);
    } else if (meta) {
      uploadMeta = meta;
      uploadFileReference = {
        file_name: meta.file_name,
        file_path: meta.file_path,
        mime_type: meta.mime_type ?? undefined,
      };
    }
  }

  let filesUnavailable = safeOnly;
  let filesErrorLogged = false;
  const filePreviewOptions: QuoteFilePreviewOptions = {
    includeFilesTable: !safeOnly,
  };
  if (typeof uploadFileReference !== "undefined") {
    filePreviewOptions.uploadFileOverride = uploadFileReference;
  }
  filePreviewOptions.onFilesError = (error) => {
    filesUnavailable = true;
    filesErrorLogged = true;
    console.error("Portal workspace loader: files query failed", {
      quoteId,
      error,
    });
  };

  const filePreviews = await getQuoteFilePreviews(quote, filePreviewOptions);
  const { messages, error: messagesError } = await loadQuoteMessages(quote.id);

  return {
    quote,
    uploadMeta,
    filePreviews,
    messages: messages ?? [],
    messagesError,
    filesUnavailable: filesUnavailable || filesErrorLogged,
  };
}
