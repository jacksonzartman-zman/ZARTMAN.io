import { supabaseServer } from "@/lib/supabaseServer";
import {
  buildQuoteFilesFromRow,
  getQuoteFilePreviews,
  type QuoteFilePreviewOptions,
  type UploadFileReference,
} from "@/server/quotes/files";
import type {
  QuoteFileMeta,
  QuoteWithUploadsRow,
  UploadMeta,
} from "@/server/quotes/types";
import {
  loadQuoteUploadGroups,
  type QuoteUploadGroup,
} from "@/server/quotes/uploadFiles";
import {
  loadQuoteMessages,
  type QuoteMessageRecord,
} from "@/server/quotes/messages";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";

export type QuoteWorkspaceQuote = QuoteWithUploadsRow & {
  files: QuoteFileMeta[];
  fileCount: number;
};

export type QuoteWorkspaceData = {
  quote: QuoteWorkspaceQuote;
  uploadMeta: UploadMeta | null;
  uploadGroups: QuoteUploadGroup[];
  filePreviews: Awaited<ReturnType<typeof getQuoteFilePreviews>>;
  messages: QuoteMessageRecord[];
  messagesError?: string | null;
  filesUnavailable?: boolean;
};

type LoaderResult<TData> = {
  ok: boolean;
  data: TData | null;
  error?: string | null;
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
): Promise<LoaderResult<QuoteWorkspaceData>> {
  try {
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
        return {
          ok: false,
          data: null,
          error: "Quote not found",
        };
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
        return {
          ok: false,
          data: null,
          error: "Quote not found",
        };
      }

      quote = fullQuote;
    }

    if (!quote) {
      return {
        ok: false,
        data: null,
        error: "Quote not found",
      };
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
      const serializedError = serializeSupabaseError(error);

      if (isMissingTableOrColumnError(error)) {
        console.warn(
          "Portal workspace loader: files schema missing; treating as zero files",
          {
            quoteId,
            error: serializedError,
          },
        );
        return;
      }

      filesUnavailable = true;
      filesErrorLogged = true;
      console.error("Portal workspace loader: files query failed", {
        quoteId,
        error: serializedError,
      });
    };

    const filePreviews = await getQuoteFilePreviews(quote, filePreviewOptions);
    const uploadGroups = await loadQuoteUploadGroups(quoteId);
    const files = buildQuoteFilesFromRow(quote);
    const fileCount = files.length;
    const enrichedQuote: QuoteWorkspaceQuote = {
      ...quote,
      files,
      fileCount,
    };

    const messagesResult = await loadQuoteMessages(enrichedQuote.id);
    const messages: QuoteMessageRecord[] = messagesResult.messages;
    const messagesError = messagesResult.ok
      ? null
      : typeof messagesResult.error === "string"
        ? messagesResult.error
        : "message-load-error";

    const filesIssue = filesUnavailable || filesErrorLogged;

    return {
      ok: true,
      data: {
        quote: enrichedQuote,
        uploadMeta,
        uploadGroups,
        filePreviews,
        messages: messages ?? [],
        messagesError,
        filesUnavailable: filesIssue,
      },
        error: filesIssue
          ? "files-unavailable"
          : messagesError ?? null,
    };
  } catch (error) {
    console.error("Portal workspace loader: unexpected error", {
      quoteId,
      error,
    });
    return {
      ok: false,
      data: null,
      error: "Unexpected error loading quote workspace",
    };
  }
}
