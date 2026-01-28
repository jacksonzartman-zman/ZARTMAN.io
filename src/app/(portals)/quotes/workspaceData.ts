import { supabaseServer } from "@/lib/supabaseServer";
import {
  getQuoteFilePreviews,
  buildQuoteFilesFromRow,
  type QuoteFilePreviewOptions,
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
import { getQuoteMessages } from "@/server/messages/quoteMessages";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import {
  SAFE_QUOTE_WITH_UPLOADS_FIELDS,
  type SafeQuoteWithUploadsField,
} from "@/server/suppliers/types";
import {
  serializeSupabaseError,
  isMissingTableOrColumnError,
} from "@/server/admin/logging";
import { getRfqOffers, type RfqOffer } from "@/server/rfqs/offers";
import {
  getRfqDestinations,
  type RfqDestination,
  getRfqDestinationsLite,
} from "@/server/rfqs/destinations";
import { getProviderStatusByIds } from "@/server/providers";
import { listOpsEventsForQuote, type OpsEventRecord } from "@/server/ops/events";
import {
  getCustomerKickoffSummary,
  type CustomerKickoffSummary,
} from "@/server/quotes/kickoffSummary";
import { debugOnce } from "@/server/db/schemaErrors";
import { isDemoModeEnabled } from "@/server/demo/demoMode";

export type QuoteWorkspaceQuote = QuoteWithUploadsRow & {
  files: QuoteFileMeta[];
  fileCount: number;
};

export type QuoteWorkspaceData = {
  quote: QuoteWorkspaceQuote;
  uploadMeta: UploadMeta | null;
  uploadGroups: QuoteUploadGroup[];
  filePreviews: Awaited<ReturnType<typeof getQuoteFilePreviews>>;
  parts: QuotePartWithFiles[];
  rfqOffers: RfqOffer[];
  rfqDestinations: RfqDestination[];
  award: RfqAward | null;
  /**
   * Customer-safe kickoff summary (counts + safe next pending title).
   * Only included when `includeKickoffSummary` is enabled.
   */
  kickoffSummary?: CustomerKickoffSummary;
  opsEvents?: OpsEventRecord[];
  messages: QuoteMessageRecord[];
  messagesError?: string | null;
  filesUnavailable?: boolean;
  /**
   * True when the quote advertises legacy filenames (quotes.file_name / file_names)
   * but has no canonical `files_valid`/`files` rows. In this state, the portal must
   * not offer preview links (no canonical row => no preview).
   */
  filesMissingCanonical?: boolean;
  legacyFileNames?: string[];
};

export type RfqAward = {
  rfq_id: string;
  offer_id: string;
  provider_id: string;
  destination_id: string | null;
  awarded_at: string;
  awarded_by: string | null;
};

export type QuotePartFileRole = "cad" | "drawing" | "other";

export type QuotePartWithFiles = {
  id: string;
  partLabel: string;
  partNumber: string | null;
  notes: string | null;
  sortOrder: number | null;
  files: Array<{
    quoteUploadFileId: string;
    path: string;
    filename: string;
    extension: string | null;
    sizeBytes: number | null;
    isFromArchive: boolean;
    role: QuotePartFileRole;
  }>;
};

type LoaderResult<TData> = {
  ok: boolean;
  data: TData | null;
  error?: string | null;
};

type LoadQuoteWorkspaceOptions = {
  safeOnly?: boolean;
  /**
   * When provided, file previews (Storage-backed) will be tokenized for this user.
   * This enables portal users (non-admin) to render previews via `/api/cad-preview`.
   */
  viewerUserId?: string | null;
  /**
   * When provided, message attachment download links can be tokenized for this user.
   */
  viewerRole?: "admin" | "customer" | "supplier" | (string & {}) | null;
  /**
   * When true, fetch normalized offers for admin comparison views.
   */
  includeOffers?: boolean;
  /**
   * When true, include recent ops events for feed enrichment.
   */
  includeOpsEvents?: boolean;
  /**
   * When false, fetch a minimal destinations shape (no provider join / detail fields).
   * Useful when destination details are not visible.
   */
  includeDestinationDetails?: boolean;
  /**
   * When true, include a customer-safe kickoff progress summary.
   */
  includeKickoffSummary?: boolean;
};

type SafeQuoteRow = Pick<QuoteWithUploadsRow, SafeQuoteWithUploadsField>;

type QuoteExtrasRow = Pick<
  QuoteWithUploadsRow,
  | "customer_id"
  | "dfm_notes"
  | "internal_notes"
  | "selected_provider_id"
  | "selected_offer_id"
  | "selected_at"
  | "po_number"
  | "ship_to"
  | "inspection_requirements"
  | "selection_confirmed_at"
>;

type UploadMetaRow = UploadMeta & {
  id?: string | null;
  file_name: string | null;
  file_path: string | null;
  mime_type: string | null;
  // Optional canonical storage identity (some deployments).
  storage_bucket_id?: string | null;
  storage_path?: string | null;
  // Optional legacy bucket column (some deployments).
  bucket_id?: string | null;
};

export async function loadQuoteWorkspaceData(
  quoteId: string,
  options?: LoadQuoteWorkspaceOptions,
): Promise<LoaderResult<QuoteWorkspaceData>> {
  try {
    const safeOnly = Boolean(options?.safeOnly);
    let quote: QuoteWithUploadsRow | null = null;

    if (safeOnly) {
      const { data: safeQuote, error } = await supabaseServer()
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

      const { data: extras, error: extrasError } = await supabaseServer()
        .from("quotes")
        .select(
          "customer_id,dfm_notes,internal_notes,selected_provider_id,selected_offer_id,selected_at,po_number,ship_to,inspection_requirements,selection_confirmed_at",
        )
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
        selected_provider_id: extras?.selected_provider_id ?? null,
        selected_offer_id: extras?.selected_offer_id ?? null,
        selected_at: extras?.selected_at ?? null,
        po_number: extras?.po_number ?? null,
        ship_to: extras?.ship_to ?? null,
        inspection_requirements: extras?.inspection_requirements ?? null,
        selection_confirmed_at: extras?.selection_confirmed_at ?? null,
      };
    } else {
      const { data: fullQuote, error } = await supabaseServer()
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
    if (quote.upload_id) {
      // IMPORTANT: Do not reference non-existent columns in select lists.
      // Use `*` and normalize in-code across schema variants.
      const first = await supabaseServer()
        .from("uploads")
        .select("*")
        .eq("id", quote.upload_id)
        .maybeSingle<UploadMetaRow>();

      let meta = first.data as UploadMetaRow | null;
      let metaError = first.error;

      if (metaError) {
        console.error("Portal workspace loader: failed to load upload meta", metaError);
      } else if (meta) {
        uploadMeta = meta;
      }
    }

    let filesUnavailable = false;
    let filesErrorLogged = false;
    const filePreviewOptions: QuoteFilePreviewOptions = {
      viewerUserId: options?.viewerUserId ?? null,
    };
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
    const parts = await loadQuotePartsWithFiles(quoteId);
    const includeOffers = Boolean(options?.includeOffers);
    const rfqOffersRaw: RfqOffer[] = includeOffers ? await getRfqOffers(quote.id) : [];
    const includeDestinationDetails = options?.includeDestinationDetails ?? true;
    const rfqDestinationsRaw = includeDestinationDetails
      ? await getRfqDestinations(quote.id)
      : await getRfqDestinationsLite(quote.id);
    const distinctOfferStatuses = Array.from(
      new Set(
        (rfqOffersRaw ?? [])
          .map((offer) => (offer?.status ?? "").trim().toLowerCase())
          .filter(Boolean),
      ),
    ).sort();

    // Best-effort: match offers -> destinations by (rfq_id, provider_id) when
    // destination_id is missing on the offer row.
    const destinationIdByProviderId = new Map<string, string>();
    const duplicateDestinationProviderIds = new Set<string>();
    for (const destination of rfqDestinationsRaw ?? []) {
      const providerId =
        typeof destination?.provider_id === "string" ? destination.provider_id.trim() : "";
      const destinationId = typeof destination?.id === "string" ? destination.id.trim() : "";
      if (!providerId || !destinationId) continue;
      if (destinationIdByProviderId.has(providerId)) {
        duplicateDestinationProviderIds.add(providerId);
        continue;
      }
      destinationIdByProviderId.set(providerId, destinationId);
    }
    for (const providerId of duplicateDestinationProviderIds) {
      destinationIdByProviderId.delete(providerId);
    }

    let offersPatchedDestinationId = 0;
    const rfqOffersWithDestinationIds: RfqOffer[] = rfqOffersRaw.map((offer): RfqOffer => {
      if (offer.destination_id) return offer;
      if (!offer.provider_id) return offer;
      const providerId = typeof offer.provider_id === "string" ? offer.provider_id.trim() : "";
      if (!providerId) return offer;
      const destinationId = destinationIdByProviderId.get(providerId) ?? null;
      if (!destinationId) return offer;
      offersPatchedDestinationId += 1;
      return { ...offer, destination_id: destinationId };
    });

    let rfqOffers: RfqOffer[] = rfqOffersWithDestinationIds;
    let rfqDestinations = rfqDestinationsRaw;

    if (options?.viewerRole === "customer") {
      if (isDemoModeEnabled()) {
        debugOnce("demo:customer_offers:load_raw", "[demo offers] customer workspace load", {
          rfq_id: quote.id,
          destinations_loaded: rfqDestinationsRaw.length,
          rfq_offers_loaded: rfqOffersRaw.length,
          offer_statuses: distinctOfferStatuses,
          offers_patched_destination_id: offersPatchedDestinationId,
        });
      }

      const providerIds = new Set<string>();
      for (const offer of rfqOffersWithDestinationIds) {
        if (offer.provider_id) providerIds.add(offer.provider_id);
      }
      for (const destination of rfqDestinationsRaw) {
        if (destination.provider_id) providerIds.add(destination.provider_id);
      }

      if (providerIds.size > 0) {
        const providerStatuses = await getProviderStatusByIds(Array.from(providerIds));
        const isVisibleToCustomer = (providerId: string) => {
          const snapshot = providerStatuses.get(providerId);
          if (!snapshot) return false;
          return snapshot.is_active && snapshot.verification_status === "verified";
        };
        const offerHasProviderId = (
          offer: RfqOffer,
        ): offer is RfqOffer & { provider_id: string } =>
          typeof offer.provider_id === "string" && offer.provider_id.trim().length > 0;
        const attachProviderStatus = <
          T extends { provider_id: string; provider?: Record<string, unknown> | null },
        >(
          item: T,
        ): T => {
          const snapshot = providerStatuses.get(item.provider_id);
          if (!snapshot || !item.provider) return item;
          return {
            ...item,
            provider: {
              ...item.provider,
              verification_status:
                snapshot.verification_status ?? item.provider.verification_status ?? null,
              source: snapshot.source ?? item.provider.source ?? null,
              is_active: snapshot.is_active ?? item.provider.is_active ?? null,
            },
          };
        };

        if (providerStatuses.size === 0) {
          if (isDemoModeEnabled()) {
            debugOnce(
              "demo:customer_offers:provider_statuses_empty",
              "[demo offers] provider status lookup returned empty; clearing offers/destinations",
              {
                rfq_id: quote.id,
                provider_count: providerIds.size,
                rfq_offers_before: rfqOffersWithDestinationIds.length,
                destinations_before: rfqDestinationsRaw.length,
                offer_statuses: distinctOfferStatuses,
              },
            );
          }
          rfqOffers = [];
          rfqDestinations = [];
        } else {
          const offersBefore = rfqOffersWithDestinationIds.length;
          const destinationsBefore = rfqDestinationsRaw.length;

          rfqOffers = rfqOffersWithDestinationIds
            .filter(offerHasProviderId)
            .filter((offer) => isVisibleToCustomer(offer.provider_id))
            .map((offer) => attachProviderStatus(offer));
          rfqDestinations = rfqDestinationsRaw
            .filter((destination) => isVisibleToCustomer(destination.provider_id))
            .map((destination) => attachProviderStatus(destination));

          if (isDemoModeEnabled()) {
            debugOnce(
              "demo:customer_offers:provider_filter",
              "[demo offers] customer provider visibility filter applied",
              {
                rfq_id: quote.id,
                destinations_before: destinationsBefore,
                destinations_after: rfqDestinations.length,
                rfq_offers_before: offersBefore,
                rfq_offers_after: rfqOffers.length,
                filtered_offers_removed: offersBefore - rfqOffers.length,
                filtered_destinations_removed:
                  destinationsBefore - rfqDestinations.length,
                offer_statuses: distinctOfferStatuses,
              },
            );
          }
        }
      }
    }

    let award: RfqAward | null = null;
    try {
      const { data, error } = await supabaseServer()
        .from("rfq_awards")
        .select("rfq_id,offer_id,provider_id,destination_id,awarded_at,awarded_by")
        .eq("rfq_id", quote.id)
        .maybeSingle<RfqAward>();

      if (error) {
        if (!isMissingTableOrColumnError(error)) {
          console.warn("[portal workspace] rfq_awards load failed", {
            quoteId: quote.id,
            error: serializeSupabaseError(error) ?? error,
          });
        }
      } else if (data) {
        award = data;
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.warn("[portal workspace] rfq_awards load crashed", {
          quoteId: quote.id,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }

    const legacyDeclared = buildQuoteFilesFromRow(quote);
    const filesMissingCanonical = filePreviews.length === 0 && legacyDeclared.length > 0;
    const legacyFileNames = legacyDeclared.map((f) => f.filename);
    if (filesMissingCanonical) {
      if (process.env.LOG_CANONICAL_QUOTE_FILES === "1") {
        console.warn("[portal workspace] quote has legacy filenames but no canonical file rows", {
          quoteId,
          legacyCount: legacyFileNames.length,
          legacyFileNames: legacyFileNames.slice(0, 10),
        });
      }
    }
    const files: QuoteFileMeta[] = filePreviews.map((file) => ({
      filename: (file.fileName ?? file.label).trim(),
    }));
    const fileCount = filePreviews.length;
    const enrichedQuote: QuoteWorkspaceQuote = {
      ...quote,
      files,
      fileCount,
    };

    const messagesResult = await getQuoteMessages({
      quoteId: enrichedQuote.id,
      viewerUserId: options?.viewerUserId ?? null,
      viewerRole: options?.viewerRole ?? null,
    });
    const messages: QuoteMessageRecord[] = messagesResult.messages;
    const messagesError = messagesResult.ok
      ? null
      : typeof messagesResult.error === "string"
        ? messagesResult.error
        : messagesResult.missing
          ? "missing_schema"
          : "message-load-error";
    const includeOpsEvents = Boolean(options?.includeOpsEvents);
    const opsEventsResult = includeOpsEvents
      ? await listOpsEventsForQuote(enrichedQuote.id, { limit: 25 })
      : null;
    const opsEvents = opsEventsResult?.ok ? opsEventsResult.events : [];

    const includeKickoffSummary = Boolean(options?.includeKickoffSummary);
    const kickoffCompletedAt =
      (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? null;
    const kickoffSummary = includeKickoffSummary
      ? await getCustomerKickoffSummary(enrichedQuote.id, {
          awardedSupplierId: enrichedQuote.awarded_supplier_id ?? null,
          kickoffCompletedAt,
        })
      : undefined;

    const filesIssue = filesUnavailable || filesErrorLogged;

    return {
      ok: true,
      data: {
        quote: enrichedQuote,
        uploadMeta,
        uploadGroups,
        filePreviews,
        parts,
        rfqOffers,
        rfqDestinations,
        award,
        kickoffSummary: includeKickoffSummary ? kickoffSummary : undefined,
        opsEvents: includeOpsEvents ? opsEvents : undefined,
        messages: messages ?? [],
        messagesError,
        filesUnavailable: filesIssue,
        filesMissingCanonical,
        legacyFileNames: legacyFileNames.length > 0 ? legacyFileNames : undefined,
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

type QuotePartRow = {
  id: string;
  quote_id: string;
  part_label: string;
  part_number: string | null;
  notes: string | null;
  sort_order: number | null;
  created_at: string;
};

type QuotePartFileRow = {
  id: string;
  quote_part_id: string;
  quote_upload_file_id: string;
  role: string;
  created_at: string;
};

type QuoteUploadFileRow = {
  id: string;
  path: string;
  filename: string;
  extension: string | null;
  size_bytes: number | null;
  is_from_archive: boolean;
};

function normalizeQuotePartRole(value: unknown): QuotePartFileRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "cad") return "cad";
  if (normalized === "drawing") return "drawing";
  return "other";
}

function compareNullableNumberAsc(a: number | null, b: number | null): number {
  const aIsNumber = typeof a === "number" && Number.isFinite(a);
  const bIsNumber = typeof b === "number" && Number.isFinite(b);
  if (aIsNumber && bIsNumber) return (a as number) - (b as number);
  if (aIsNumber) return -1;
  if (bIsNumber) return 1;
  return 0;
}

async function loadQuotePartsWithFiles(quoteId: string): Promise<QuotePartWithFiles[]> {
  if (typeof quoteId !== "string" || quoteId.trim().length === 0) {
    return [];
  }

  let partRows: QuotePartRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_parts")
      .select("id,quote_id,part_label,part_number,notes,sort_order,created_at")
      .eq("quote_id", quoteId)
      .returns<QuotePartRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return [];
      }
      console.error("[quote parts] failed to load parts", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      return [];
    }

    partRows = Array.isArray(data) ? data : [];
  } catch (error) {
    if (isMissingTableOrColumnError(error)) {
      return [];
    }
    console.error("[quote parts] load parts crashed", {
      quoteId,
      error: serializeSupabaseError(error),
    });
    return [];
  }

  if (partRows.length === 0) {
    return [];
  }

  partRows.sort((a, b) => {
    const byOrder = compareNullableNumberAsc(a.sort_order ?? null, b.sort_order ?? null);
    if (byOrder !== 0) return byOrder;
    const aCreated = Date.parse(a.created_at);
    const bCreated = Date.parse(b.created_at);
    if (Number.isFinite(aCreated) && Number.isFinite(bCreated) && aCreated !== bCreated) {
      return aCreated - bCreated;
    }
    return a.id.localeCompare(b.id);
  });

  const partIds = partRows.map((row) => row.id);

  let partFileRows: QuotePartFileRow[] = [];
  try {
    const { data, error } = await supabaseServer()
      .from("quote_part_files")
      .select("id,quote_part_id,quote_upload_file_id,role,created_at")
      .in("quote_part_id", partIds)
      .returns<QuotePartFileRow[]>();

    if (error) {
      if (isMissingTableOrColumnError(error)) {
        return partRows.map((row) => ({
          id: row.id,
          partLabel: row.part_label,
          partNumber: row.part_number,
          notes: row.notes,
          sortOrder: row.sort_order,
          files: [],
        }));
      }
      console.error("[quote parts] failed to load part files", {
        quoteId,
        error: serializeSupabaseError(error),
      });
      partFileRows = [];
    } else {
      partFileRows = Array.isArray(data) ? data : [];
    }
  } catch (error) {
    if (!isMissingTableOrColumnError(error)) {
      console.error("[quote parts] load part files crashed", {
        quoteId,
        error: serializeSupabaseError(error),
      });
    }
    partFileRows = [];
  }

  const quoteUploadFileIds = Array.from(
    new Set(
      partFileRows
        .map((row) =>
          typeof row?.quote_upload_file_id === "string" ? row.quote_upload_file_id : "",
        )
        .filter((id) => id.trim().length > 0),
    ),
  );

  const uploadFilesById = new Map<string, QuoteUploadFileRow>();
  if (quoteUploadFileIds.length > 0) {
    try {
      const { data, error } = await supabaseServer()
        .from("quote_upload_files")
        .select("id,path,filename,extension,size_bytes,is_from_archive")
        .in("id", quoteUploadFileIds)
        .eq("quote_id", quoteId)
        .returns<QuoteUploadFileRow[]>();

      if (error) {
        if (isMissingTableOrColumnError(error)) {
          // If file enumeration isn't available, parts still exist but won't show entries.
        } else {
          console.error("[quote parts] failed to load upload file entries", {
            quoteId,
            error: serializeSupabaseError(error),
          });
        }
      } else if (Array.isArray(data)) {
        for (const row of data) {
          if (row?.id) {
            uploadFilesById.set(row.id, row);
          }
        }
      }
    } catch (error) {
      if (!isMissingTableOrColumnError(error)) {
        console.error("[quote parts] load upload files crashed", {
          quoteId,
          error: serializeSupabaseError(error),
        });
      }
    }
  }

  const filesByPartId = new Map<string, QuotePartWithFiles["files"]>();
  for (const row of partFileRows) {
    const partId = typeof row.quote_part_id === "string" ? row.quote_part_id.trim() : "";
    const uploadFileId =
      typeof row.quote_upload_file_id === "string" ? row.quote_upload_file_id.trim() : "";
    if (!partId || !uploadFileId) continue;
    const uploadFile = uploadFilesById.get(uploadFileId);
    if (!uploadFile) continue;

    if (!filesByPartId.has(partId)) {
      filesByPartId.set(partId, []);
    }
    filesByPartId.get(partId)!.push({
      quoteUploadFileId: uploadFileId,
      path: uploadFile.path,
      filename: uploadFile.filename,
      extension: uploadFile.extension,
      sizeBytes: uploadFile.size_bytes,
      isFromArchive: uploadFile.is_from_archive,
      role: normalizeQuotePartRole(row.role),
    });
  }

  // Stable file ordering inside each part.
  for (const [partId, files] of filesByPartId.entries()) {
    files.sort((a, b) => a.filename.localeCompare(b.filename) || a.path.localeCompare(b.path));
    filesByPartId.set(partId, files);
  }

  return partRows.map((row) => ({
    id: row.id,
    partLabel: row.part_label,
    partNumber: row.part_number,
    notes: row.notes,
    sortOrder: row.sort_order,
    files: filesByPartId.get(row.id) ?? [],
  }));
}
