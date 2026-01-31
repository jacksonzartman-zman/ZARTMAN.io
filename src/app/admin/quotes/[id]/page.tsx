// src/app/admin/quotes/[id]/page.tsx
/**
 * Phase 1 Polish checklist
 * - Done: Empty states (no bids, no messages) with calm guidance
 * - Done: Signals note when thread SLA falls back (non-blocking)
 * - Done: Error surface copy is actionable (refresh / back)
 * - Done: Copy normalization (Decision/Kickoff/Messages/Uploads match rail)
 */

import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/formatDate";
import { formatAwardedByLabel, formatShortId } from "@/lib/awards";
import { supabaseServer } from "@/lib/supabaseServer";
import { getQuoteMessages } from "@/server/messages/quoteMessages";
import {
  computeThreadNeedsReplyFromLastMessage,
  computeThreadNeedsReplyFromMessages,
} from "@/server/messages/threadNeedsReply";
import type { QuoteMessageRecord } from "@/server/quotes/messages";
import { getCustomerReplyToAddress, getSupplierReplyToAddress } from "@/server/quotes/emailBridge";
import { getEmailOutboundStatus } from "@/server/quotes/emailOutbound";
import { loadOutboundFileOptions } from "@/server/quotes/outboundFilePicker";
import { CopyTextButton } from "@/components/CopyTextButton";
import { getQuoteFilePreviews } from "@/server/quotes/files";
import type { UploadMeta } from "@/server/quotes/types";
import { buildAdminRfqPackText } from "@/lib/admin/rfqPack";
import {
  DEFAULT_QUOTE_STATUS,
  QUOTE_STATUS_LABELS,
  normalizeQuoteStatus,
  type QuoteStatus,
} from "@/server/quotes/status";
import { loadQuoteBidAggregates } from "@/server/quotes/bidAggregates";
import {
  formatAdminBestPriceLabel,
  formatAdminBidCountLabel,
  formatAdminLeadTimeLabel,
} from "@/server/quotes/adminSummary";
import AdminDashboardShell from "../../AdminDashboardShell";
import QuoteUpdateForm from "../QuoteUpdateForm";
import { QuoteMessagesThread } from "@/app/(portals)/components/QuoteMessagesThread";
import { QuoteTimeline } from "@/app/(portals)/components/QuoteTimeline";
import { QuoteFilesCard } from "./QuoteFilesCard";
import { ReplyNowButton } from "./ReplyNowButton";
import { QuoteUploadsStructuredList } from "@/components/QuoteUploadsStructuredList";
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { QuoteAtAGlanceBar } from "@/components/QuoteAtAGlanceBar";
import { resolvePrimaryAction } from "@/lib/quote/resolvePrimaryAction";
import {
  deriveAdminQuoteAttentionState,
  loadAdminQuoteDetail,
} from "@/server/admin/quotes";
import { isWinningBidStatus } from "@/lib/bids/status";
import { loadBidsForQuote } from "@/server/bids";
import { loadAdminUploadDetail } from "@/server/admin/uploads";
import { listSupplierBidsForQuote } from "@/server/suppliers/bids";
import { SupplierBidsCard, type AdminSupplierBidRow } from "./SupplierBidsCard";
import { AddExternalOfferButton } from "./AddExternalOfferButton";
import { CustomerExclusionsSection } from "./CustomerExclusionsSection";
import ChangeRequestsCard from "./ChangeRequestsCard";
import {
  loadQuoteProjectForQuote,
  type QuoteProjectRecord,
} from "@/server/quotes/projects";
import { AdminQuoteProjectCard } from "./AdminQuoteProjectCard";
import {
  ensureDefaultKickoffTasksForQuote,
  getKickoffTasksForQuote,
  buildKickoffCompletionSummary,
  type QuoteKickoffTask,
} from "@/server/quotes/kickoffTasks";
import { AdminKickoffReviewCard } from "./AdminKickoffReviewCard";
import {
  resolveKickoffProgressBasis,
  formatKickoffTasksRatio,
} from "@/lib/quote/kickoffChecklist";
import { postQuoteMessage as postAdminQuoteMessage } from "./actions";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";
import { CollapsibleCard } from "@/components/CollapsibleCard";
import { DisclosureSection } from "@/components/DisclosureSection";
import { QuoteSectionRail } from "@/components/QuoteSectionRail";
import type { QuoteSectionRailSection } from "@/components/QuoteSectionRail";
import { AdminDecisionCtas } from "./AdminDecisionCtas";
import { AdminInviteSupplierCard } from "./AdminInviteSupplierCard";
import { HashScrollLink } from "@/app/(portals)/components/hashScroll";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import { resolveThreadStatusLabel } from "@/lib/messages/needsReply";
import { loadAdminThreadSlaForQuotes } from "@/server/admin/messageSla";
import {
  inferLastMessageAuthorRole,
  loadQuoteMessageRollups,
} from "@/server/quotes/messageState";
import {
  getCapacitySnapshotsForSupplierWeek,
  type AdminCapacityLevel,
  type AdminCapacitySnapshotRow,
} from "@/server/admin/capacity";
import { getNextWeekStartDateIso } from "@/lib/dates/weekStart";
import { getRoutingSuggestionForQuote } from "@/server/admin/routing";
import { CapacitySummaryPills } from "@/app/admin/components/CapacitySummaryPills";
import { RequestCapacityUpdateButton } from "./RequestCapacityUpdateButton";
import {
  isCapacityRequestSuppressed,
  loadRecentCapacityUpdateRequest,
  type CapacityUpdateRequestReason,
} from "@/server/admin/capacityRequests";
import { AwardOutcomeCard } from "./AwardOutcomeCard";
import { loadLatestAwardFeedbackForQuote } from "@/server/quotes/awardFeedback";
import { formatAwardFeedbackReasonLabel } from "@/lib/awardFeedback";
import { AwardEmailGenerator } from "./AwardEmailGenerator";
import { AwardProviderModal } from "./AwardProviderModal";
import { getLatestKickoffNudgedAt } from "@/server/quotes/kickoffNudge";
import { EmptyStateCard } from "@/components/EmptyStateCard";
import { loadQuoteUploadGroups } from "@/server/quotes/uploadFiles";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { loadQuoteWorkspaceData } from "@/app/(portals)/quotes/workspaceData";
import { computeRfqQualitySummary } from "@/server/quotes/rfqQualitySignals";
import { isRfqFeedbackEnabled } from "@/server/quotes/rfqFeedback";
import { getRfqDestinations } from "@/server/rfqs/destinations";
import { getAdminRfqOffers, summarizeRfqOffers } from "@/server/rfqs/offers";
import { listRfqEventsForRfq } from "@/server/rfqs/events";
import {
  findCustomerExclusionMatch,
  loadCustomerExclusions,
} from "@/server/customers/exclusions";
import { listProvidersWithContact } from "@/server/providers";
import {
  buildProviderEligibilityCriteria,
  getEligibleProvidersForQuote,
} from "@/server/providers/eligibility";
import { listOpsEventsForQuote, type OpsEventRecord } from "@/server/ops/events";
import { schemaGate } from "@/server/db/schemaContract";
import {
  handleMissingSupabaseRelation,
  isMissingTableOrColumnError,
  isSupabaseRelationMarkedMissing,
  serializeSupabaseError,
} from "@/server/admin/logging";
import { formatEnumLabel } from "@/components/admin/rfq/destinationHelpers";
import { loadBidComparisonSummary } from "@/server/quotes/bidCompare";
import { loadSupplierReputationForSuppliers } from "@/server/suppliers/reputation";
import { ensureCadFeaturesForQuote, loadCadFeaturesForQuote } from "@/server/quotes/cadFeatures";
import {
  createQuotePartAction,
  updateQuotePartFilesForQuoteAction,
} from "./actions";
import { AdminPartsFilesSection } from "./AdminPartsFilesSection";
import { EmailSupplierForm } from "./EmailSupplierForm";
import { EmailCustomerForm } from "./EmailCustomerForm";
import { InviteEmailThreadButton } from "./InviteEmailThreadButton";
import { AdminRfqDestinationsCard } from "./AdminRfqDestinationsCard";
import { RfqTimelineCard } from "./RfqTimelineCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoteProviderAwardRow = {
  awarded_provider_id: string | null;
  awarded_offer_id: string | null;
  award_notes: string | null;
};

type QuoteDetailPageProps = {
  params: Promise<{ id: string }>;
};

type QuoteRfqFeedbackAdminRow = {
  supplier_id: string | null;
  categories: string[] | null;
  note: string | null;
  created_at: string | null;
};

type SupplierLiteRow = {
  id: string;
  company_name: string | null;
  primary_email: string | null;
};

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const resolvedParams = await params;

  const quoteResult = await loadAdminQuoteDetail(resolvedParams.id);

  if (!quoteResult.ok) {
    return (
      <main className="py-10">
        <PortalContainer>
          <section className="mx-auto max-w-3xl rounded-2xl border border-red-500/30 bg-red-950/40 p-6 text-center">
            <h1 className="text-xl font-semibold text-red-50">
              We couldn’t load this quote.
            </h1>
            <p className="mt-2 text-sm text-red-100">
              Try refreshing the page. If this keeps happening, contact support.
            </p>
            <details className="mt-4 rounded-xl border border-red-500/20 bg-red-950/20 px-4 py-3 text-left text-xs text-red-100">
              <summary className="cursor-pointer select-none font-semibold text-red-50">
                Technical details
              </summary>
              <div className="mt-2 space-y-1 font-mono">
                <div>quoteId: {resolvedParams.id}</div>
                <div>error: {quoteResult.error ?? "unknown"}</div>
              </div>
            </details>
            <div className="mt-4">
              <Link
                href={`/admin/quotes/${resolvedParams.id}`}
                className={clsx(
                  primaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex mr-2",
                )}
              >
                Refresh
              </Link>
              <Link
                href="/admin/quotes"
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex",
                )}
              >
                Back to quotes
              </Link>
            </div>
          </section>
        </PortalContainer>
      </main>
    );
  }

  const quote = quoteResult.data;

  if (!quote) {
    return (
      <main className="py-10">
        <PortalContainer>
          <section className="mx-auto max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/60 p-6 text-center">
            <h1 className="text-xl font-semibold text-slate-50">
              Quote not found
            </h1>
            <p className="mt-2 text-sm text-slate-400">
              We couldn’t find a quote with ID{" "}
              <span className="font-mono text-slate-200">
                {resolvedParams.id}
              </span>
              .
            </p>
            <div className="mt-4">
              <Link
                href="/admin/quotes"
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "inline-flex",
                )}
              >
                Back to quotes
              </Link>
            </div>
          </section>
        </PortalContainer>
      </main>
    );
  }

  let inviteCount = 0;
  try {
    const { count, error } = await supabaseServer()
      .from("quote_invites")
      .select("id", { count: "exact", head: true })
      .eq("quote_id", quote.id);
    if (!error && typeof count === "number") {
      inviteCount = count;
    }
  } catch (error) {
    console.warn("[admin quote] invite count lookup crashed", {
      quoteId: quote.id,
      error,
    });
  }

  let openChangeRequestCount: number | null = null;
  try {
    const { count, error } = await supabaseServer()
      .from("quote_change_requests")
      .select("id", { count: "exact", head: true })
      .eq("quote_id", quote.id)
      .eq("status", "open");
    if (!error && typeof count === "number") {
      openChangeRequestCount = count;
    }
  } catch (error) {
    console.warn("[admin quote] open change request count lookup crashed", {
      quoteId: quote.id,
      error,
    });
  }

  let assignedSupplierEmail: string | null = null;
  let assignedSupplierName: string | null = null;
  try {
    const { data, error } = await supabaseServer()
      .from("quotes_with_uploads")
      .select("assigned_supplier_email,assigned_supplier_name")
      .eq("id", quote.id)
      .maybeSingle<{
        assigned_supplier_email: string | null;
        assigned_supplier_name: string | null;
      }>();
    if (!error && data) {
      assignedSupplierEmail = data.assigned_supplier_email ?? null;
      assignedSupplierName = data.assigned_supplier_name ?? null;
    }
  } catch (error) {
    console.warn("[admin quote] assigned supplier lookup crashed", {
      quoteId: quote.id,
      error,
    });
  }

  const projectResult = await loadQuoteProjectForQuote(quote.id);
  const hasProject = projectResult.ok;
  const project = hasProject ? projectResult.project : null;
  const projectUnavailable = !hasProject && projectResult.reason !== "not_found";

  let uploadMeta: UploadMeta | null = null;
  if (quote.upload_id) {
    const uploadResult = await loadAdminUploadDetail(quote.upload_id);
    if (!uploadResult.ok) {
      console.warn("Failed to load upload metadata for quote", {
        uploadId: quote.upload_id,
        error: uploadResult.error,
      });
    } else if (uploadResult.data) {
      const data = uploadResult.data;
      uploadMeta = {
        first_name: data.first_name,
        last_name: data.last_name,
        phone: data.phone,
        company: data.company,
        manufacturing_process: data.manufacturing_process,
        quantity: data.quantity,
        shipping_postal_code: data.shipping_postal_code,
        export_restriction: data.export_restriction,
        rfq_reason: data.rfq_reason,
        notes: data.notes,
        intake_idempotency_key: data.intake_idempotency_key ?? null,
        itar_acknowledged: data.itar_acknowledged,
        terms_accepted: data.terms_accepted,
      };
    }
  }

    const status: QuoteStatus = normalizeQuoteStatus(
      quote.status ?? DEFAULT_QUOTE_STATUS,
    );
    const customerName =
      [uploadMeta?.first_name, uploadMeta?.last_name]
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => (value ?? "").trim())
        .join(" ")
        .trim() ||
      (typeof quote.customer_name === "string" &&
      quote.customer_name.trim().length > 0
        ? quote.customer_name
        : "Unknown customer");
    const customerEmail =
      typeof quote.customer_email === "string" && quote.customer_email.includes("@")
        ? quote.customer_email
        : null;
    const companyName =
      (typeof uploadMeta?.company === "string" &&
      (uploadMeta?.company ?? "").trim().length > 0
        ? uploadMeta?.company
        : null) ||
      (typeof quote.company === "string" && quote.company.trim().length > 0
        ? quote.company
        : null);
    const contactPhone =
      typeof uploadMeta?.phone === "string" && uploadMeta.phone.trim().length > 0
        ? uploadMeta.phone.trim()
        : null;
    const intakeSummaryItems = uploadMeta
      ? [
          {
            label: "Company",
            value: uploadMeta.company || companyName || "—",
          },
          {
            label: "Manufacturing process",
            value: uploadMeta.manufacturing_process || "—",
          },
          {
            label: "Quantity / volumes",
            value: uploadMeta.quantity || "—",
          },
          {
            label: "Export restriction",
            value: uploadMeta.export_restriction || "—",
          },
          {
            label: "Shipping ZIP / Postal code",
            value: uploadMeta.shipping_postal_code || "—",
          },
          {
            label: "RFQ reason",
            value: uploadMeta.rfq_reason || "—",
          },
          {
            label: "ITAR acknowledgement",
            value: uploadMeta.itar_acknowledged ? "Acknowledged" : "Not confirmed",
          },
          {
            label: "Terms acceptance",
            value: uploadMeta.terms_accepted ? "Accepted" : "Not accepted",
          },
        ]
      : null;
    const intakeNotes =
      typeof uploadMeta?.notes === "string" && uploadMeta.notes.trim().length > 0
        ? uploadMeta.notes
        : null;
    const normalizedPrice =
      typeof quote.price === "number"
        ? quote.price
        : typeof quote.price === "string"
          ? Number(quote.price)
          : null;
    const priceValue =
      typeof normalizedPrice === "number" && Number.isFinite(normalizedPrice)
        ? normalizedPrice
        : null;
    const currencyValue =
      typeof quote.currency === "string" && quote.currency.trim().length > 0
        ? quote.currency.trim().toUpperCase()
        : null;
    const targetDateValue =
      typeof quote.target_date === "string" && quote.target_date.trim().length > 0
        ? quote.target_date
        : null;
    const statusLabel = QUOTE_STATUS_LABELS[status] ?? "Unknown";
    const filePreviews = await getQuoteFilePreviews(quote);
    const uploadGroups = await loadQuoteUploadGroups(quote.id);
    const workspaceResult = await loadQuoteWorkspaceData(quote.id, {
      safeOnly: true,
      includeOffers: true,
    });
    const workspaceQuote =
      workspaceResult.ok && workspaceResult.data ? workspaceResult.data.quote : null;
    const selectedOfferId = workspaceQuote?.selected_offer_id ?? null;
    const selectionConfirmedAt = workspaceQuote?.selection_confirmed_at ?? null;
    const orderDetailsPoNumber =
      typeof workspaceQuote?.po_number === "string" && workspaceQuote.po_number.trim().length > 0
        ? workspaceQuote.po_number.trim()
        : null;
    const orderDetailsShipTo =
      typeof workspaceQuote?.ship_to === "string" && workspaceQuote.ship_to.trim().length > 0
        ? workspaceQuote.ship_to.trim()
        : null;
    const quotePoNumber =
      typeof quote.po_number === "string" && quote.po_number.trim().length > 0
        ? quote.po_number.trim()
        : null;
    const quoteShipTo =
      typeof quote.ship_to === "string" && quote.ship_to.trim().length > 0
        ? quote.ship_to.trim()
        : null;
    const effectivePoNumber = orderDetailsPoNumber ?? project?.po_number ?? quotePoNumber;
    const effectiveShipTo = orderDetailsShipTo ?? quoteShipTo;
    const needsOrderDetailsForOps =
      status === "won" && (!effectivePoNumber || !effectiveShipTo);
    const orderDetailsConfirmedAtLabel = selectionConfirmedAt
      ? formatDateTime(selectionConfirmedAt, { includeTime: true }) ?? selectionConfirmedAt
      : null;
    const showOrderDetailsConfirmation =
      Boolean(selectionConfirmedAt) || Boolean(orderDetailsPoNumber) || Boolean(orderDetailsShipTo);

    const needByLabel =
      targetDateValue
        ? formatDateTime(targetDateValue, { includeTime: false }) ?? targetDateValue
        : null;
    const rfqPackText = buildAdminRfqPackText({
      quoteId: quote.id,
      intakeKey: uploadMeta?.intake_idempotency_key ?? null,
      manufacturingProcess: uploadMeta?.manufacturing_process ?? null,
      quantity: uploadMeta?.quantity ?? null,
      needBy: needByLabel,
      customerNotes: intakeNotes,
      poNumber:
        orderDetailsPoNumber ??
        project?.po_number ??
        (typeof quote.po_number === "string" && quote.po_number.trim().length > 0
          ? quote.po_number.trim()
          : null),
      shipTo: {
        freeform: orderDetailsShipTo,
        name: quote.ship_to_name ?? null,
        company: quote.ship_to_company ?? null,
        address1: quote.ship_to_address1 ?? null,
        address2: quote.ship_to_address2 ?? null,
        city: quote.ship_to_city ?? null,
        state: quote.ship_to_state ?? null,
        postalCode: quote.ship_to_postal_code ?? null,
        country: quote.ship_to_country ?? null,
      },
      canonicalFiles: filePreviews.map((file) => ({
        fileName: file.fileName ?? file.label ?? null,
        storageSource: file.storageSource
          ? { bucket: file.storageSource.bucket, path: file.storageSource.path }
          : null,
      })),
      uploadEntries: uploadGroups.flatMap((group) =>
        (group.entries ?? []).map((entry) => ({
          filename: entry.filename,
          path: entry.path,
        })),
      ),
    });
    const parts = workspaceResult.ok && workspaceResult.data ? workspaceResult.data.parts : [];
    const cadFeaturesByFileId = await (async () => {
      // Best-effort pre-population: never block the page on heavy work.
      try {
        const ensurePromise = ensureCadFeaturesForQuote(quote.id).catch((error) => {
          console.warn("[admin quote] cad ensure crashed", { quoteId: quote.id, error });
        });
        await Promise.race([
          ensurePromise,
          new Promise((resolve) => setTimeout(resolve, 1200)),
        ]);
      } catch (error) {
        console.warn("[admin quote] cad ensure wrapper crashed", { quoteId: quote.id, error });
      }

      try {
        return await loadCadFeaturesForQuote(quote.id);
      } catch (error) {
        console.warn("[admin quote] cad features load crashed", { quoteId: quote.id, error });
        return {};
      }
    })();
    const { perPart, summary: partsCoverageSummary } = computePartsCoverage(parts ?? []);
    const rfqQualitySummary = await computeRfqQualitySummary(quote.id);
    const [providersResult, rfqDestinations, rfqOffers, opsEventsResult, providerAwardRow] =
      await Promise.all([
        listProvidersWithContact(),
        getRfqDestinations(quote.id),
        getAdminRfqOffers(quote.id),
        listOpsEventsForQuote(quote.id, { limit: 20 }),
        (async () => {
          try {
            const { data, error } = await supabaseServer()
              .from("quotes")
              .select("awarded_provider_id,awarded_offer_id,award_notes")
              .eq("id", quote.id)
              .maybeSingle<QuoteProviderAwardRow>();
            if (error) return null;
            return data ?? null;
          } catch {
            return null;
          }
        })(),
      ]);
    const providers = providersResult.providers;
    const awardedProviderId = providerAwardRow?.awarded_provider_id ?? null;
    const awardedOfferId = providerAwardRow?.awarded_offer_id ?? null;
    const awardNotes = providerAwardRow?.award_notes ?? null;
    const shipToPostalCode =
      quote.ship_to_postal_code ?? uploadMeta?.shipping_postal_code ?? null;
    const providerEligibilityCriteria = buildProviderEligibilityCriteria({
      process: uploadMeta?.manufacturing_process ?? null,
      quantity: uploadMeta?.quantity ?? null,
      shipToState: quote.ship_to_state ?? null,
      shipToCountry: quote.ship_to_country ?? null,
      shipToPostalCode,
    });
    const providerEligibility = await getEligibleProvidersForQuote(
      quote.id,
      providerEligibilityCriteria,
      {
        providers,
        emailColumn: providersResult.emailColumn,
      },
    );
    const opsEvents = opsEventsResult.ok ? opsEventsResult.events : [];
    const providerLabelById = new Map<string, string>();
    for (const provider of providers) {
      if (provider?.id && provider.name) {
        providerLabelById.set(provider.id, provider.name);
      }
    }
    for (const destination of rfqDestinations) {
      if (!providerLabelById.has(destination.provider_id)) {
        const fallback =
          destination.provider?.name ?? `Provider ${formatShortId(destination.provider_id)}`;
        providerLabelById.set(destination.provider_id, fallback);
      }
    }
    const destinationById = new Map(rfqDestinations.map((destination) => [destination.id, destination]));

    let rfqFeedbackRows: QuoteRfqFeedbackAdminRow[] = [];
    let rfqFeedbackSchemaMissing = false;
    const supplierNameById = new Map<string, string>();
    try {
      if (!isRfqFeedbackEnabled()) {
        rfqFeedbackSchemaMissing = true;
      } else if (isSupabaseRelationMarkedMissing("quote_rfq_feedback")) {
        rfqFeedbackSchemaMissing = true;
      } else {
        const hasSchema = await schemaGate({
          enabled: true,
          relation: "quote_rfq_feedback",
          requiredColumns: ["quote_id", "supplier_id", "categories", "note", "created_at"],
          warnPrefix: "[rfq_feedback]",
        });
        if (!hasSchema) {
          rfqFeedbackSchemaMissing = true;
        } else {
        const { data, error } = await supabaseServer()
          .from("quote_rfq_feedback")
          .select("supplier_id,categories,note,created_at")
          .eq("quote_id", quote.id)
          .order("created_at", { ascending: false })
          .limit(50)
          .returns<QuoteRfqFeedbackAdminRow[]>();

        if (error) {
          if (
            handleMissingSupabaseRelation({
              relation: "quote_rfq_feedback",
              error,
              warnPrefix: "[rfq_feedback]",
            })
          ) {
            rfqFeedbackSchemaMissing = true;
          } else if (isMissingTableOrColumnError(error)) {
            rfqFeedbackSchemaMissing = true;
          } else {
            console.error("[admin quote] failed to load rfq feedback", {
              quoteId: quote.id,
              error: serializeSupabaseError(error) ?? error,
            });
          }
        } else {
          rfqFeedbackRows = Array.isArray(data) ? data : [];
        }
        }
      }
    } catch (error) {
      if (
        handleMissingSupabaseRelation({
          relation: "quote_rfq_feedback",
          error,
          warnPrefix: "[rfq_feedback]",
        })
      ) {
        rfqFeedbackSchemaMissing = true;
      } else if (isMissingTableOrColumnError(error)) {
        rfqFeedbackSchemaMissing = true;
      } else {
        console.error("[admin quote] rfq feedback load crashed", {
          quoteId: quote.id,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }

    const supplierIdsForFeedback = Array.from(
      new Set(
        rfqFeedbackRows
          .map((row) => (typeof row?.supplier_id === "string" ? row.supplier_id.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (supplierIdsForFeedback.length > 0) {
      try {
        const { data, error } = await supabaseServer()
          .from("suppliers")
          .select("id,company_name,primary_email")
          .in("id", supplierIdsForFeedback)
          .returns<SupplierLiteRow[]>();

        if (error) {
          console.warn("[admin quote] supplier lookup for rfq feedback failed", {
            quoteId: quote.id,
            supplierCount: supplierIdsForFeedback.length,
            error: serializeSupabaseError(error) ?? error,
          });
        } else {
          for (const row of data ?? []) {
            const supplierId = typeof row?.id === "string" ? row.id.trim() : "";
            if (!supplierId) continue;
            const name =
              (typeof row?.company_name === "string" && row.company_name.trim()
                ? row.company_name.trim()
                : null) ??
              (typeof row?.primary_email === "string" && row.primary_email.trim()
                ? row.primary_email.trim()
                : null) ??
              supplierId;
            supplierNameById.set(supplierId, name);
          }
        }
      } catch (error) {
        console.warn("[admin quote] supplier lookup for rfq feedback crashed", {
          quoteId: quote.id,
          supplierCount: supplierIdsForFeedback.length,
          error: serializeSupabaseError(error) ?? error,
        });
      }
    }
    const partsCoverageSummaryLine = partsCoverageSummary.anyParts
      ? `${partsCoverageSummary.totalParts} part${
          partsCoverageSummary.totalParts === 1 ? "" : "s"
        } • ${partsCoverageSummary.fullyCoveredParts} fully covered • ${
          partsCoverageSummary.partsNeedingCad
        } need CAD • ${partsCoverageSummary.partsNeedingDrawing} need drawings`
      : null;
    const dfmNotes =
      typeof quote.dfm_notes === "string" && quote.dfm_notes.trim().length > 0
        ? quote.dfm_notes
        : null;
    const internalNotes =
      typeof quote.internal_notes === "string" &&
      quote.internal_notes.trim().length > 0
        ? quote.internal_notes
        : null;
    const opsStatus =
      typeof quote.ops_status === "string" && quote.ops_status.trim().length > 0
        ? quote.ops_status.trim()
        : null;
    const opsStatusSuggestion = needsOrderDetailsForOps ? "awaiting_order_details" : null;
    const messagesResult = await getQuoteMessages({
      quoteId: quote.id,
      viewerRole: "admin",
    });
    if (!messagesResult.ok) {
      console.error("Failed to load quote messages", {
        quoteId: quote.id,
        error: messagesResult.error ?? "message-load-error",
      });
    }
    const quoteMessages: QuoteMessageRecord[] = messagesResult.messages;
    const quoteMessagesError = messagesResult.ok
      ? null
      : messagesResult.error ?? (messagesResult.missing ? "missing_schema" : null);

    const threadSlaByQuoteId = await loadAdminThreadSlaForQuotes({ quoteIds: [quote.id] });
    const threadSla = threadSlaByQuoteId[quote.id] ?? null;
    const messageRollupsByQuoteId = await loadQuoteMessageRollups([quote.id]);
    const messageRollup = messageRollupsByQuoteId[quote.id] ?? null;
    const lastMessageAtForState =
      messageRollup?.lastMessageAt ?? threadSla?.lastMessageAt ?? null;
    const lastMessageAuthorRoleForState =
      messageRollup ? inferLastMessageAuthorRole(messageRollup) : threadSla?.lastMessageAuthorRole ?? null;
    const threadNeedsReplyForState = messagesResult.missing
      ? computeThreadNeedsReplyFromLastMessage({
          lastMessageAt: lastMessageAtForState,
          lastMessageAuthorRole: lastMessageAuthorRoleForState,
        })
      : computeThreadNeedsReplyFromMessages(quoteMessages);
    const adminNeedsReply = !messagesResult.missing && threadNeedsReplyForState.needs_reply_role === "admin";
    const adminOverdue = adminNeedsReply && threadNeedsReplyForState.sla_bucket === ">24h";
    const lastMessage = quoteMessages.length > 0 ? quoteMessages[quoteMessages.length - 1] : null;
    const lastMessagePreview = lastMessage ? truncateThreadPreview(lastMessage.body, 80) : null;
    const bidsResult = await loadBidsForQuote(quote.id);
    const bidAggregateMap = await loadQuoteBidAggregates([quote.id]);
    const bidAggregate = bidAggregateMap[quote.id];
    const baseBids = bidsResult.ok ? bidsResult.data : [];
    let bids: AdminSupplierBidRow[] = baseBids.map((bid) => ({
      ...bid,
      supplier: null,
    }));

    if (baseBids.length > 0) {
      try {
        const enrichedBids = await listSupplierBidsForQuote(quote.id);
        if (enrichedBids.length > 0) {
          const supplierByBidId = new Map(
            enrichedBids.map((bid) => [bid.id, bid.supplier ?? null]),
          );
          bids = baseBids.map((bid) => ({
            ...bid,
            supplier: supplierByBidId.get(bid.id) ?? null,
          }));
        }
      } catch (error) {
        console.error("[admin quote] enriched bids failed", {
          quoteId: quote.id,
          error,
        });
      }
    }

    const bidComparisonSummary = await loadBidComparisonSummary(quote.id);
    const bidCompareRows = bidComparisonSummary.rows ?? [];
    const comparisonBySupplierId = Object.fromEntries(
      bidCompareRows.map((row) => [
        row.supplierId,
        {
          matchHealth: row.matchHealth,
          benchStatus: row.benchStatus,
          partsCoverage: row.partsCoverage,
          compositeScore: row.compositeScore,
        },
      ]),
    );
    const compareRowsByScore = [...bidCompareRows].sort((a, b) => {
      const sa = typeof a.compositeScore === "number" ? a.compositeScore : -1;
      const sb = typeof b.compositeScore === "number" ? b.compositeScore : -1;
      if (sb !== sa) return sb - sa;
      return a.supplierName.localeCompare(b.supplierName);
    });
    const bestCompositeScore =
      compareRowsByScore.length > 0 && typeof compareRowsByScore[0]?.compositeScore === "number"
        ? compareRowsByScore[0]!.compositeScore
        : null;
    const recommendedSupplierIds = compareRowsByScore
      .filter((row) => typeof row.compositeScore === "number")
      .filter((row) =>
        bestCompositeScore === null ? false : (row.compositeScore ?? -1) >= bestCompositeScore - 5,
      )
      .slice(0, 2)
      .map((row) => row.supplierId);

    const supplierIdsForReputation = Array.from(
      new Set(bidCompareRows.map((row) => row.supplierId).filter(Boolean)),
    );
    const reputationBySupplierId =
      supplierIdsForReputation.length > 0
        ? await loadSupplierReputationForSuppliers(supplierIdsForReputation)
        : {};
    const reputationLiteBySupplierId = Object.fromEntries(
      supplierIdsForReputation.map((supplierId) => {
        const rep = reputationBySupplierId[supplierId] ?? null;
        return [supplierId, { score: rep?.score ?? null, label: rep?.label ?? "unknown" }];
      }),
    );

    const decisionAssistantReputationNote = (() => {
      const topTwo = compareRowsByScore
        .filter((row) => typeof row.compositeScore === "number")
        .slice(0, 2);
      if (topTwo.length < 2) return null;
      const [first, second] = topTwo;
      if (!first || !second) return null;
      const r1 = reputationLiteBySupplierId[first.supplierId] ?? null;
      const r2 = reputationLiteBySupplierId[second.supplierId] ?? null;
      if (!r1 || !r2) return null;

      const rank = (label: string) => {
        switch ((label ?? "").toLowerCase()) {
          case "excellent":
            return 4;
          case "good":
            return 3;
          case "fair":
            return 2;
          case "limited":
            return 1;
          default:
            return 0;
        }
      };
      const repGapNote =
        rank(r1.label) - rank(r2.label) >= 2
          ? `${first.supplierName} has a much higher reputation.`
          : rank(r2.label) - rank(r1.label) >= 2
            ? `${second.supplierName} has a much higher reputation.`
            : null;
      if (!repGapNote) return null;

      const s1 = typeof first.compositeScore === "number" ? first.compositeScore : null;
      const s2 = typeof second.compositeScore === "number" ? second.compositeScore : null;
      if (s1 === null || s2 === null) return null;
      const close = Math.abs(s1 - s2) <= 5;
      return close ? repGapNote : null;
    })();

    const fallbackBestPriceBid = findBestPriceBid(bids);
    const fallbackBestPriceAmount =
      typeof fallbackBestPriceBid?.amount === "number" &&
      Number.isFinite(fallbackBestPriceBid.amount)
        ? fallbackBestPriceBid.amount
        : null;
    const fallbackBestPriceCurrency = fallbackBestPriceBid?.currency ?? null;
    const fallbackFastestLeadTime = findFastestLeadTime(bids);
    const aggregateBidCount = bidAggregate?.bidCount ?? bids.length;
    const rfqOfferSummary = summarizeRfqOffers(rfqOffers ?? []);
    const rfqOfferCount = rfqOfferSummary.nonWithdrawn;
    const canonicalAwardedBidId =
      typeof quote.awarded_bid_id === "string" ? quote.awarded_bid_id.trim() : "";
    const hasWinningBid =
      Boolean(canonicalAwardedBidId) ||
      Boolean(quote.awarded_supplier_id) ||
      Boolean(quote.awarded_at) ||
      Boolean((awardedProviderId ?? "").trim()) ||
      bids.some((bid) => isWinningBidStatus(bid?.status));
    const winningBidRow =
      (canonicalAwardedBidId
        ? bids.find((bid) => bid.id === canonicalAwardedBidId) ?? null
        : null) ??
      bids.find((bid) => isWinningBidStatus(bid?.status)) ??
      null;
    let quoteKickoffTasks: QuoteKickoffTask[] = [];
    let kickoffTasksUnavailable = false;
    if (hasWinningBid) {
      const kickoffSchemaReady = await schemaGate({
        enabled: true,
        relation: "quote_kickoff_tasks",
        requiredColumns: [
          "id",
          "quote_id",
          "task_key",
          "title",
          "description",
          "sort_order",
          "status",
          "completed_at",
          "completed_by_user_id",
          "blocked_reason",
          "created_at",
          "updated_at",
        ],
        warnPrefix: "[admin kickoff review]",
        warnKey: "admin_kickoff_review:missing_schema",
      });

      if (!kickoffSchemaReady) {
        kickoffTasksUnavailable = true;
      } else {
        try {
          await ensureDefaultKickoffTasksForQuote(quote.id);
        } catch (error) {
          // Best-effort: do not fail page render on seed issues.
        }
        quoteKickoffTasks = await getKickoffTasksForQuote(quote.id);
      }
    }

    const kickoffCompletionSummary = buildKickoffCompletionSummary(quoteKickoffTasks);
    const kickoffTotalCount = kickoffCompletionSummary.total;
    const kickoffCompletedCount = kickoffCompletionSummary.completedCount;
    const kickoffBlockedCount = kickoffCompletionSummary.blockedCount;
    const kickoffStatus =
      kickoffTotalCount === 0
        ? "not-started"
        : kickoffCompletedCount >= kickoffTotalCount
          ? "complete"
          : kickoffCompletedCount === 0 && kickoffBlockedCount === 0
            ? "not-started"
            : "in-progress";
    const kickoffLastUpdatedAt = (() => {
      let bestTs: number | null = null;
      let bestIso: string | null = null;
      for (const task of quoteKickoffTasks) {
        const iso = typeof task.updatedAt === "string" ? task.updatedAt.trim() : "";
        if (!iso) continue;
        const ts = Date.parse(iso);
        if (!Number.isFinite(ts)) continue;
        if (bestTs === null || ts > bestTs) {
          bestTs = ts;
          bestIso = iso;
        }
      }
      return bestIso;
    })();
    const kickoffCompleteFromQuote =
      typeof (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ===
        "string" &&
      ((quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? "").trim()
        .length > 0;
    const kickoffSummaryLabel = hasWinningBid
      ? kickoffCompleteFromQuote
        ? "Kickoff complete"
        : kickoffTasksUnavailable
          ? "Checklist unavailable in this environment"
          : kickoffTotalCount === 0
            ? "Kickoff not started"
            : kickoffStatus === "complete"
              ? "Kickoff complete"
              : kickoffStatus === "in-progress"
                ? `Kickoff: ${kickoffCompletedCount}/${kickoffTotalCount} complete${
                    kickoffBlockedCount > 0 ? ` • ${kickoffBlockedCount} blocked` : ""
                  }`
                : "Kickoff not started"
      : "Waiting for winner";
    const kickoffSummaryTone =
      kickoffCompleteFromQuote || kickoffStatus === "complete"
        ? "text-emerald-300"
        : kickoffStatus === "in-progress"
          ? "text-blue-200"
          : "text-slate-200";
    const kickoffStatusValue =
      kickoffCompleteFromQuote || kickoffStatus === "complete"
        ? "Complete"
        : kickoffStatus === "in-progress"
          ? "In progress"
          : kickoffStatus === "not-started"
            ? "Not started"
            : "—";
    const kickoffCompletedValue =
      kickoffTotalCount > 0 ? `${kickoffCompletedCount} / ${kickoffTotalCount}` : "—";
    const kickoffLastUpdatedValue = kickoffLastUpdatedAt
      ? formatRelativeTimeFromTimestamp(toTimestamp(kickoffLastUpdatedAt)) ?? "—"
      : "—";
    const kickoffProgressBasis = resolveKickoffProgressBasis({
      kickoffCompletedAt: (quote as { kickoff_completed_at?: string | null })?.kickoff_completed_at ?? null,
      completedCount: kickoffTotalCount > 0 ? kickoffCompletedCount : null,
      totalCount: kickoffTotalCount > 0 ? kickoffTotalCount : null,
    });
    const kickoffProgressRatio = formatKickoffTasksRatio(kickoffProgressBasis);

    const kickoffStalled = (() => {
      if (!hasWinningBid) return false;
      if (kickoffTasksUnavailable) return false;
      if (kickoffProgressBasis.isComplete) return false;
      if (kickoffTotalCount <= 0) return false;

      const awardedAtIso = typeof quote.awarded_at === "string" ? quote.awarded_at.trim() : "";
      const awardedAtMs = awardedAtIso ? Date.parse(awardedAtIso) : Number.NaN;
      if (!Number.isFinite(awardedAtMs)) return false;

      const now = Date.now();
      const awardedAgeMs = now - awardedAtMs;
      const kickoffUpdateMs = kickoffLastUpdatedAt ? Date.parse(kickoffLastUpdatedAt) : Number.NaN;
      const kickoffUpdateAgeMs = Number.isFinite(kickoffUpdateMs) ? now - kickoffUpdateMs : Number.POSITIVE_INFINITY;

      return (
        kickoffCompletionSummary.percentComplete < 40 &&
        awardedAgeMs > 72 * 60 * 60 * 1000 &&
        kickoffUpdateAgeMs > 48 * 60 * 60 * 1000
      );
    })();

    const winningSupplierIdForNudge =
      typeof winningBidRow?.supplier_id === "string" && winningBidRow.supplier_id.trim().length > 0
        ? winningBidRow.supplier_id.trim()
        : typeof quote.awarded_supplier_id === "string" && quote.awarded_supplier_id.trim().length > 0
          ? quote.awarded_supplier_id.trim()
          : null;
    const latestKickoffNudgedAt = winningSupplierIdForNudge
      ? await getLatestKickoffNudgedAt({
          quoteId: quote.id,
          supplierId: winningSupplierIdForNudge,
        })
      : null;
    const latestKickoffNudgedRelative = latestKickoffNudgedAt
      ? formatRelativeTimeFromTimestamp(toTimestamp(latestKickoffNudgedAt)) ?? null
      : null;
    const attentionState = deriveAdminQuoteAttentionState({
      quoteId: quote.id,
      status,
      bidCount: aggregateBidCount,
      hasWinner: hasWinningBid,
      hasProject,
    });
    const headerTitleSource = companyName || customerName || "Unnamed customer";
    const headerTitle = `Quote for ${headerTitleSource}`;
    const headerDescription =
      "Details, files, pricing, and messages for this RFQ.";
    const cardClasses =
      "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4";
    const fileCountText =
      filePreviews.length === 0
        ? "None attached"
        : filePreviews.length === 1
          ? "1 attached"
          : `${filePreviews.length} attached`;
    const fileCardAnchorId = "quote-files-card";
    const bidCountLabel =
      bidAggregate && aggregateBidCount >= 0
        ? formatAdminBidCountLabel(bidAggregate)
        : rfqOfferCount === 0
          ? "No offers yet"
          : `${rfqOfferCount} offer${rfqOfferCount === 1 ? "" : "s"} received`;
    const offerCountLabel = bidCountLabel.replace(/\bbids?\b/gi, (match) =>
      match.toLowerCase() === "bid" ? "offer" : "offers",
    );
    const bestPriceDisplay =
      formatAdminBestPriceLabel(
        bidAggregate?.bestPriceAmount ?? fallbackBestPriceAmount,
        bidAggregate?.bestPriceCurrency ?? fallbackBestPriceCurrency,
      ) ?? (aggregateBidCount > 0 ? "Awaiting pricing" : "Pending");
    const fastestLeadTimeDisplay =
      formatAdminLeadTimeLabel(
        bidAggregate?.fastestLeadTimeDays ?? fallbackFastestLeadTime,
      ) ?? (aggregateBidCount > 0 ? "Awaiting lead time" : "Pending");
    const lastBidAtLabel =
      bidAggregate?.lastBidAt
        ? formatDateTime(bidAggregate.lastBidAt, { includeTime: true })
        : rfqOfferCount > 0
          ? "See offer table"
          : "No offers yet";
    const winningBidExists = bidAggregate?.hasWinningBid || hasWinningBid;
    const fallbackWinningAmount =
      typeof winningBidRow?.amount === "number" ? winningBidRow.amount : null;
    const fallbackWinningCurrency = winningBidRow?.currency ?? null;
    const winningBidAmountLabel =
      formatAdminBestPriceLabel(
        bidAggregate?.winningBidAmount ?? fallbackWinningAmount,
        bidAggregate?.winningBidCurrency ?? fallbackWinningCurrency,
      ) ?? bestPriceDisplay;
    const fallbackWinningLeadTime =
      typeof winningBidRow?.lead_time_days === "number"
        ? winningBidRow.lead_time_days
        : null;
    const winningLeadTimeLabel =
      formatAdminLeadTimeLabel(
        bidAggregate?.winningBidLeadTimeDays ?? fallbackWinningLeadTime,
      ) ?? fastestLeadTimeDisplay;
    const winningSupplierName =
      winningBidRow?.supplier?.company_name ??
      winningBidRow?.supplier?.primary_email ??
      winningBidRow?.supplier_id ??
      null;
    const winningSupplierEmail =
      winningBidRow?.supplier?.primary_email ?? null;
    const awardedAtLabel = quote.awarded_at
      ? formatDateTime(quote.awarded_at, { includeTime: true })
      : null;
    const awardedByLabel = formatAwardedByLabel(quote.awarded_by_role);
    const awardedBidDisplayId = quote.awarded_bid_id ?? winningBidRow?.id ?? null;
    const awardedBidDisplay =
      awardedBidDisplayId
        ? `${formatShortId(awardedBidDisplayId)} · ${winningSupplierName ?? "Supplier selected"}`
        : winningSupplierName ?? "Supplier selected";

    const awardedSupplierId =
      (typeof quote.awarded_supplier_id === "string" && quote.awarded_supplier_id.trim()
        ? quote.awarded_supplier_id.trim()
        : typeof winningBidRow?.supplier_id === "string" && winningBidRow.supplier_id.trim()
          ? winningBidRow.supplier_id.trim()
          : null) ?? null;

    const supplierReplyToResult = awardedSupplierId
      ? getSupplierReplyToAddress({ quoteId: quote.id, supplierId: awardedSupplierId })
      : null;
    const supplierReplyToAddress =
      supplierReplyToResult && supplierReplyToResult.ok ? supplierReplyToResult.address : "";
    const supplierReplyToStatusCopy =
      supplierReplyToResult && supplierReplyToResult.ok
        ? "Supplier can reply via email to update the thread."
        : supplierReplyToResult?.reason === "disabled"
          ? "Email reply not configured."
          : supplierReplyToResult
            ? "Email reply address unavailable."
            : "";

    const customerId =
      typeof (quote as { customer_id?: unknown })?.customer_id === "string" &&
      ((quote as { customer_id?: string }).customer_id ?? "").trim().length > 0
        ? ((quote as { customer_id?: string }).customer_id ?? "").trim()
        : null;
    const customerExclusions = customerId ? await loadCustomerExclusions(customerId) : [];
    const excludedSourceNames = customerExclusions
      .map((row) => (typeof row.excluded_source_name === "string" ? row.excluded_source_name.trim() : ""))
      .filter((name) => name.length > 0);
    const excludedOfferSummaries = (() => {
      if (!customerId || customerExclusions.length === 0) return [];
      return (rfqOffers ?? [])
        .map((offer) => {
          const match = findCustomerExclusionMatch({
            exclusions: customerExclusions,
            providerId: offer?.provider_id ?? null,
            sourceName: (offer as { source_name?: string | null })?.source_name ?? null,
          });
          if (!match) return null;
          const offerId = typeof offer?.id === "string" ? offer.id : "";
          const providerLabel =
            typeof offer?.provider?.name === "string" && offer.provider.name.trim()
              ? offer.provider.name.trim()
              : offer?.provider_id
                ? providerLabelById.get(offer.provider_id) ?? offer.provider_id
                : null;
          const matchLabel =
            match.kind === "provider"
              ? `Provider ${providerLabel ?? match.providerId}`
              : `Source ${match.sourceName}`;
          return offerId ? `${matchLabel} (offer ${formatShortId(offerId)})` : matchLabel;
        })
        .filter((value): value is string => Boolean(value));
    })();
    const customerReplyToResult = customerId
      ? getCustomerReplyToAddress({ quoteId: quote.id, customerId })
      : null;
    const customerReplyToAddress =
      customerReplyToResult && customerReplyToResult.ok ? customerReplyToResult.address : "";
    const customerReplyToStatusCopy =
      customerReplyToResult && customerReplyToResult.ok
        ? "Customer can reply via email to update the thread (opt-in required)."
        : customerReplyToResult?.reason === "disabled"
          ? "Email reply not configured."
          : customerReplyToResult
            ? "Email reply address unavailable."
            : "";

    const selectionRecordedExists = Boolean(
      (typeof quote.awarded_supplier_id === "string" && quote.awarded_supplier_id.trim()) ||
        (typeof quote.awarded_bid_id === "string" && quote.awarded_bid_id.trim()) ||
        (typeof awardedProviderId === "string" && awardedProviderId.trim()) ||
        quote.awarded_at,
    );
    const awardedProviderLabel =
      typeof awardedProviderId === "string" && awardedProviderId.trim().length > 0
        ? providerLabelById.get(awardedProviderId) ?? awardedProviderId
        : null;
    const selectionSupplierDisplay = selectionRecordedExists
      ? (winningSupplierName ?? awardedSupplierId ?? awardedProviderLabel ?? "Supplier selected")
      : "—";
    const lastUpdatedSummary =
      quote.updated_at
        ? (formatRelativeTimeFromTimestamp(toTimestamp(quote.updated_at)) ??
          formatDateTime(quote.updated_at, { includeTime: true }) ??
          quote.updated_at)
        : null;
    const changeRequestsSummaryValue =
      typeof openChangeRequestCount === "number" && openChangeRequestCount > 0
        ? `Open ${openChangeRequestCount}`
        : "—";
    const stateSummaryItems = [
      { label: "Status", value: statusLabel },
      { label: "Selection", value: selectionSupplierDisplay },
      ...(lastUpdatedSummary ? [{ label: "Last updated", value: lastUpdatedSummary }] : []),
    ].slice(0, 3);
    const selectionRecordedItems = selectionRecordedExists
      ? winningBidExists
        ? [
            { label: "Supplier", value: selectionSupplierDisplay },
            { label: "Awarded price", value: winningBidAmountLabel },
            { label: "Lead time", value: winningLeadTimeLabel },
            ...(awardedAtLabel ? [{ label: "Recorded", value: awardedAtLabel }] : []),
          ].slice(0, 4)
        : [
            { label: "Provider", value: awardedProviderLabel ?? "Provider selected" },
            { label: "Offer", value: awardedOfferId ? formatShortId(awardedOfferId) : "—" },
            { label: "Recorded", value: awardedAtLabel ?? "—" },
            { label: "Notes", value: awardNotes ? "Recorded" : "—" },
          ].slice(0, 4)
      : null;
    const awardFeedback = awardedSupplierId
      ? await loadLatestAwardFeedbackForQuote({
          quoteId: quote.id,
          supplierId: awardedSupplierId,
        })
      : null;

    const winningBidCallout =
      winningBidExists && !selectionRecordedExists ? (
        <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100">
          <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-emerald-200">
            <span className="pill pill-success px-3 py-0.5 text-[11px] font-semibold">
              Winning supplier
            </span>
            <span>Selection detected</span>
          </div>
          <p className="break-anywhere mt-2 text-base font-semibold text-white">
            {winningSupplierName ?? "Supplier selected"}
          </p>
          {winningSupplierEmail ? (
            <a
              href={`mailto:${winningSupplierEmail}`}
              className="break-anywhere text-xs text-emerald-200 hover:underline"
            >
              {winningSupplierEmail}
            </a>
          ) : null}
          <p className="mt-1 text-xs text-emerald-100">
            {winningBidAmountLabel} • {winningLeadTimeLabel}
          </p>
        </div>
      ) : null;

    const projectStatusKickoffLabel = !hasWinningBid
      ? "Waiting for winner"
      : kickoffProgressBasis.isComplete
        ? "Kickoff complete"
        : kickoffProgressRatio
          ? `Kickoff in progress (${kickoffProgressRatio} tasks)`
          : "Kickoff in progress";

    const projectStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Project status
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Shared kickoff status across supplier + customer.
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              kickoffProgressBasis.isComplete
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : hasWinningBid
                  ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
                  : "border-slate-800 bg-slate-900/60 text-slate-200",
            )}
          >
            {kickoffProgressBasis.isComplete ? "Complete" : hasWinningBid ? "In progress" : "—"}
          </span>
        </header>
        <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-3">
          <SnapshotField
            label="Supplier"
            value={hasWinningBid ? (winningSupplierName ?? "Supplier selected") : "—"}
          />
          <SnapshotField
            label="Awarded on"
            value={hasWinningBid ? (awardedAtLabel ?? "Pending") : "—"}
          />
          <SnapshotField label="Kickoff" value={projectStatusKickoffLabel} />
          {latestKickoffNudgedRelative ? (
            <SnapshotField
              label="Customer nudged kickoff"
              value={latestKickoffNudgedRelative}
            />
          ) : null}
        </dl>
      </section>
    );

    const bidSummaryPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Offer summary
            </p>
            <p className="text-xs text-slate-400">
              {aggregateBidCount > 0
                ? "Latest supplier offer snapshot."
                : "We’ll surface supplier offers here as they arrive."}
            </p>
          </div>
          <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-xs font-semibold text-slate-100">
            {offerCountLabel}
          </span>
        </div>
        <dl className="mt-4 grid gap-4 text-slate-100 sm:grid-cols-3">
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Best price
            </dt>
            <dd className="mt-1 font-semibold">{bestPriceDisplay}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Fastest lead time
            </dt>
            <dd className="mt-1 font-semibold">{fastestLeadTimeDisplay}</dd>
          </div>
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">
              Last bid
            </dt>
            <dd className="mt-1 font-semibold">{lastBidAtLabel}</dd>
          </div>
        </dl>
        {winningBidCallout}
      </section>
    );

    const workflowPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Workflow & next steps
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Next action
            </p>
            <p
              className={clsx(
                "mt-1 font-semibold",
                attentionState.needsDecision ? "text-amber-200" : "text-slate-300",
              )}
            >
              {attentionState.needsDecision
                ? "Needs award decision"
                : "No pending actions"}
            </p>
          </div>
        </div>
      </section>
    );

    const threadStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Thread status
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Role-based “needs reply” and staleness.
            </p>
          </div>
          {(() => {
            const label = adminOverdue ? "Overdue" : adminNeedsReply ? "Needs reply" : "Up to date";
            const pillClasses =
              label === "Overdue"
                ? "border-red-500/40 bg-red-500/10 text-red-100"
                : label === "Needs reply"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                : label === "Up to date"
                  ? "border-slate-800 bg-slate-950/50 text-slate-300"
                  : "border-slate-800 bg-slate-900/40 text-slate-200";
            return (
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={clsx(
                    "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
                    pillClasses,
                  )}
                >
                  {label}
                </span>
                {adminNeedsReply ? (
                  <ReplyNowButton
                    quoteId={quote.id}
                    className={
                      adminOverdue
                        ? "bg-red-400 hover:bg-red-300 text-slate-950"
                        : undefined
                    }
                  />
                ) : null}
              </div>
            );
          })()}
        </header>

        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-400">
            Last message{" "}
            {lastMessageAtForState
              ? formatRelativeTimeFromTimestamp(toTimestamp(lastMessageAtForState)) ?? "—"
              : "—"}
            {threadSla?.stalenessBucket === "very_stale" ? (
              <span className="ml-2 inline-flex rounded-full border border-slate-800 bg-slate-900/60 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-200">
                Stale
              </span>
            ) : null}
          </p>
          <p className="text-sm text-slate-100">
            {lastMessagePreview ? (
              <span className="text-slate-200">{lastMessagePreview}</span>
            ) : (
              <span className="text-slate-500">No messages yet.</span>
            )}
          </p>
          <a
            href="#messages"
            className="text-sm font-semibold text-emerald-200 underline-offset-4 hover:underline"
          >
            Open messages
          </a>
        </div>
      </section>
    );

    const kickoffStatusPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Kickoff status
            </p>
            <p className={clsx("mt-1 font-semibold", kickoffSummaryTone)}>
              {kickoffSummaryLabel}
            </p>
          </div>
          <HashScrollLink
            hash="kickoff"
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
          >
            View kickoff
          </HashScrollLink>
        </div>
        <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-4">
          <SnapshotField label="Status" value={kickoffStatusValue} />
          <SnapshotField label="Completed" value={kickoffCompletedValue} />
          <SnapshotField
            label="Blocked"
            value={kickoffTotalCount > 0 ? `${kickoffBlockedCount}` : "—"}
          />
          <SnapshotField label="Last updated" value={kickoffLastUpdatedValue} />
        </dl>
      </section>
    );

    const partsCoveragePanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Parts coverage
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-100">Parts coverage</h2>
          </div>
          {partsCoverageSummary.anyParts ? (
            <span
              className={clsx(
                "rounded-full border px-3 py-1 text-[11px] font-semibold",
                partsCoverageSummary.allCovered
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-100",
              )}
            >
              Coverage: {partsCoverageSummary.allCovered ? "Good" : "Needs attention"}
            </span>
          ) : null}
        </header>

        {!partsCoverageSummary.anyParts ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-300">
              No parts have been defined for this RFQ yet.
            </p>
            <HashScrollLink
              hash="uploads"
              className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
            >
              Go to uploads
            </HashScrollLink>
          </div>
        ) : (
          <>
            <p className="mt-3 text-sm text-slate-300">{partsCoverageSummaryLine}</p>
            <div className="mt-4 overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-[minmax(0,1.5fr)_90px_105px_minmax(0,1fr)] gap-3 border-b border-slate-900/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <div>Part</div>
                <div className="text-right">CAD</div>
                <div className="text-right">Drawings</div>
                <div>Status</div>
              </div>
              <div className="divide-y divide-slate-900/60">
                {perPart.map((part) => {
                  const statusLabel = part.hasCad
                    ? part.hasDrawing
                      ? "Covered"
                      : "Needs drawing"
                    : part.hasDrawing
                      ? "Needs CAD"
                      : "Needs CAD + drawing";
                  const partDisplay = part.partNumber
                    ? `${part.partLabel} (${part.partNumber})`
                    : part.partLabel;
                  return (
                    <div
                      key={part.partId}
                      className="grid grid-cols-[minmax(0,1.5fr)_90px_105px_minmax(0,1fr)] gap-3 px-4 py-2 text-sm text-slate-200"
                    >
                      <div className="min-w-0 truncate font-medium text-slate-100">
                        {partDisplay}
                      </div>
                      <div className="text-right tabular-nums">{part.cadCount}</div>
                      <div className="text-right tabular-nums">{part.drawingCount}</div>
                      <div className="text-slate-300">{statusLabel}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </section>
    );
    const projectSnapshotPanel =
      hasProject && project ? (
        <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Project snapshot
              </p>
              <h2 className="text-base font-semibold text-slate-100">Winner handoff</h2>
            </div>
            <span
              className={clsx(
                "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                mapProjectStatusToPill(project.status).pillClasses,
              )}
            >
              {mapProjectStatusToPill(project.status).label}
            </span>
          </header>
          {projectUnavailable ? (
            <p className="mt-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
              Project details are temporarily unavailable.
            </p>
          ) : null}
          <dl className="mt-4 grid gap-3 text-slate-100 sm:grid-cols-2">
            <SnapshotField
              label="Created"
              value={
                project.created_at
                  ? formatDateTime(project.created_at, { includeTime: true }) ?? project.created_at
                  : "Awaiting kickoff"
              }
            />
            <SnapshotField
              label="Winning supplier"
              value={winningSupplierName ?? "Supplier selected"}
            />
            <SnapshotField label="Winning offer" value={winningBidAmountLabel} />
            <SnapshotField label="Lead time" value={winningLeadTimeLabel} />
          </dl>
          <p className="mt-3 text-xs text-slate-400">
            {kickoffSummaryLabel} &middot; keep supplier + customer in sync via messages below.
          </p>
        </section>
      ) : null;

    const rfqSummaryCard = (
      <section className={cardClasses}>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            RFQ summary
          </p>
          <h2 className="text-base font-semibold text-slate-100">
            Intake snapshot
          </h2>
        </div>
        {intakeSummaryItems ? (
          <dl className="mt-4 grid gap-4 text-sm text-slate-200 sm:grid-cols-2">
            {intakeSummaryItems.map((item) => (
              <div
                key={item.label}
                className="space-y-1 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2"
              >
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  {item.label}
                </dt>
                <dd className="font-medium text-slate-100">{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-3 text-sm text-slate-400">
            No structured intake metadata was captured for this quote.
          </p>
        )}
      </section>
    );

    const projectNotesCard = (
      <section className={cardClasses}>
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Project details / notes
          </p>
          <h2 className="text-base font-semibold text-slate-100">
            Customer notes
          </h2>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm text-slate-200">
          {intakeNotes ?? "No additional notes captured during intake."}
        </p>
      </section>
    );

    const uploadsContent = (
      <div className="space-y-5 lg:grid lg:grid-cols-[minmax(0,0.6fr)_minmax(0,0.4fr)] lg:gap-5 lg:space-y-0">
        <div className="space-y-4 lg:space-y-5">
          <QuoteUploadsStructuredList uploadGroups={uploadGroups} enableLegacyPreviews />
          <QuoteFilesCard id={fileCardAnchorId} files={filePreviews} />
          {rfqSummaryCard}
        </div>
        <div className="space-y-4 lg:space-y-5">{projectNotesCard}</div>
      </div>
    );

    const partsWorkArea = (
      <AdminPartsFilesSection
        quoteId={quote.id}
        parts={parts ?? []}
        uploadGroups={uploadGroups}
        cadFeaturesByFileId={cadFeaturesByFileId}
        createPartAction={createQuotePartAction.bind(null, quote.id)}
        updatePartFilesAction={updateQuotePartFilesForQuoteAction.bind(null, quote.id)}
      />
    );

    const messagesSchemaMissing = messagesResult.missing;
    const messagesUnavailable = !messagesResult.ok || Boolean(quoteMessagesError);
    const postMessageAction = postAdminQuoteMessage.bind(null, quote.id);
    const outboundEmailEnabled = getEmailOutboundStatus().enabled;
    const outboundFileOptions = await loadOutboundFileOptions({ quoteId: quote.id, limit: 50 });
    const messagesContent = (
      <div className="space-y-3">
        {supplierReplyToResult ? (
          <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Supplier reply-to
                </p>
                <p className="mt-1 text-xs text-slate-400">{supplierReplyToStatusCopy}</p>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                <CopyTextButton
                  text={supplierReplyToAddress}
                  idleLabel="Copy email address"
                  logPrefix="[email_bridge]"
                />
                <InviteEmailThreadButton quoteId={quote.id} kind="supplier" enabled={outboundEmailEnabled} />
              </div>
            </div>
            <p className="break-anywhere mt-3 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 text-xs text-slate-100">
              {supplierReplyToAddress || "Not configured"}
            </p>
          </div>
        ) : null}
        {customerReplyToResult ? (
          <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Customer reply-to
                </p>
                <p className="mt-1 text-xs text-slate-400">{customerReplyToStatusCopy}</p>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                <CopyTextButton
                  text={customerReplyToAddress}
                  idleLabel="Copy email address"
                  logPrefix="[email_bridge]"
                />
                <InviteEmailThreadButton quoteId={quote.id} kind="customer" enabled={outboundEmailEnabled} />
              </div>
            </div>
            <p className="break-anywhere mt-3 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 text-xs text-slate-100">
              {customerReplyToAddress || "Not configured"}
            </p>
          </div>
        ) : null}
        <EmailSupplierForm quoteId={quote.id} enabled={outboundEmailEnabled} fileOptions={outboundFileOptions} />
        <EmailCustomerForm quoteId={quote.id} enabled={outboundEmailEnabled} fileOptions={outboundFileOptions} />
        {messagesSchemaMissing ? (
          <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/30 px-5 py-3 text-sm text-slate-400">
            Messaging not enabled in this environment.
          </p>
        ) : messagesUnavailable ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-5 py-3 text-sm text-yellow-100">
            Messages are temporarily unavailable. Refresh the page to try again.
          </p>
        ) : null}
        {!messagesSchemaMissing &&
        threadNeedsReplyForState.needs_reply_role === "admin" ? (
          <div
            className={clsx(
              "rounded-xl border px-5 py-3 text-sm",
              threadNeedsReplyForState.sla_bucket === ">24h"
                ? "border-red-500/30 bg-red-500/10 text-red-100"
                : "border-amber-500/30 bg-amber-500/10 text-amber-100",
            )}
          >
            <p className="font-semibold text-white">Needs reply</p>
            <p className="mt-1 text-xs">
              SLA bucket: {threadNeedsReplyForState.sla_bucket}
            </p>
          </div>
        ) : null}
        {!messagesSchemaMissing ? (
          <QuoteMessagesThread
            quoteId={quote.id}
            messages={quoteMessages}
            canPost
            postAction={postMessageAction}
            currentUserId={null}
            viewerRole="admin"
            title="Customer & supplier messages"
            description="One shared conversation across portals."
            helperText="Replies notify the customer inbox immediately."
            emptyStateCopy="Send the first update to keep the customer and suppliers aligned."
          />
        ) : null}
      </div>
    );

    const editContent = (
      <section className={cardClasses}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Quote actions
        </p>
        <h2 className="mt-1 text-base font-semibold text-slate-50">Update quote</h2>
        <p className="mt-1 text-sm text-slate-400">
          Adjust status, pricing, currency, target date, and internal/DFM notes.
        </p>
        <div className="mt-4">
          <AdminDecisionCtas
            quoteId={quote.id}
            status={status}
            showAwardLink={false}
          />
        </div>
        <QuoteUpdateForm
          quote={{
            id: quote.id,
            status,
            price: priceValue,
            currency: currencyValue,
            targetDate: targetDateValue,
            internalNotes,
            dfmNotes,
            opsStatus,
            opsStatusSuggestion: !opsStatus ? opsStatusSuggestion : null,
          }}
        />
      </section>
    );

    const viewerContent = (
      <div className="space-y-4 lg:space-y-5">
        <section className={cardClasses}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            3D viewer workspace
          </p>
          <h2 className="text-base font-semibold text-slate-50">Interactive preview</h2>
          <p className="mt-1 text-sm text-slate-400">
            Pick a file below to launch the STL modal. Non-STL uploads will show
            the fallback message so you know why a preview is unavailable.
          </p>
          <p className="mt-3 text-xs text-slate-500">
            The viewer uses the same CAD pipeline from the summary tab&mdash;this
            workspace just keeps it front and center.
          </p>
        </section>
        <QuoteFilesCard files={filePreviews} />
      </div>
    );

    const rfqEventsResult = await listRfqEventsForRfq(quote.id, { limit: 200 });
    const rfqEvents = rfqEventsResult.events;

    const trackingContent = (
      <div className="space-y-4 lg:space-y-5">
        <section className={cardClasses}>
          <RfqTimelineCard
            events={rfqEvents}
            emptyState={
              rfqEventsResult.ok
                ? "No events yet. Activity will appear here as your RFQ progresses."
                : "Timeline is temporarily unavailable."
            }
          />
        </section>
        <div className={cardClasses}>
          <QuoteTimeline
            quoteId={quote.id}
            actorRole="admin"
            actorUserId={null}
            emptyState="No quote events yet. Activity will appear here as your RFQ progresses."
          />
        </div>
      </div>
    );

    const opsTimelineContent = (
      <section className={cardClasses}>
        {opsEvents.length === 0 ? (
          <p className="text-sm text-slate-400">No ops events yet.</p>
        ) : (
          <div className="divide-y divide-slate-900/60">
            {opsEvents.map((event) => {
              const timestamp =
                formatDateTime(event.created_at, { includeTime: true }) ?? event.created_at;
              return (
                <div
                  key={event.id}
                  className="grid gap-3 py-3 sm:grid-cols-[150px_minmax(0,1fr)]"
                >
                  <div className="text-xs text-slate-400">{timestamp}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">
                      {formatOpsEventTypeLabel(event.event_type)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {renderOpsEventSummary({
                        event,
                        providerLabelById,
                        destinationById,
                      })}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );

    const decisionAwardedSupplier =
      winningBidExists && (winningSupplierName ?? "").trim().length > 0
        ? (winningSupplierName ?? "").trim()
        : winningBidExists
          ? "Supplier selected"
          : "Not awarded";
    const decisionAwardedAt = awardedAtLabel ?? (winningBidExists ? "Pending" : "—");
    const decisionAwardedBy =
      winningBidExists || awardedAtLabel
        ? awardedByLabel || "—"
        : "—";
    const hasAssignedSupplier = Boolean(
      (assignedSupplierEmail ?? "").trim() || (assignedSupplierName ?? "").trim(),
    );
    const quoteIsAwarded = Boolean(
      (quote.awarded_supplier_id ?? "").trim() || quote.awarded_at,
    );
    const showInviteSupplierCta =
      !quoteIsAwarded && !hasAssignedSupplier && inviteCount === 0;

    const nextWeekStartDateIso = getNextWeekStartDateIso();
    const nextWeekLabel = formatWeekOfLabel(nextWeekStartDateIso);
    const resolvedCapacitySupplierId = resolveCapacitySupplierId({
      awardedSupplierId: quote.awarded_supplier_id,
      baseBids,
    });

    const routingSuggestion = await getRoutingSuggestionForQuote({
      quoteId: quote.id,
    });
    const routingWeekLabel = formatWeekOfLabel(routingSuggestion.weekStartDate);

    const capacityRequestCandidate =
      routingSuggestion.supplierSummaries.length > 0
        ? routingSuggestion.supplierSummaries[0]
        : null;
    const capacityRequestSupplierId =
      routingSuggestion.resolvedSupplierId ?? capacityRequestCandidate?.supplierId ?? null;
    const capacityRequestReason: CapacityUpdateRequestReason | null =
      capacityRequestCandidate && capacityRequestSupplierId
        ? inferCapacityRequestReason({
            coverageCount: capacityRequestCandidate.coverageCount,
            lastUpdatedAt: capacityRequestCandidate.lastUpdatedAt,
          })
        : null;

    const supplierCapacityLastUpdatedAt = capacityRequestCandidate?.lastUpdatedAt ?? null;
    const { createdAt: lastCapacityRequestCreatedAt } =
      capacityRequestSupplierId && capacityRequestReason
        ? await loadRecentCapacityUpdateRequest({
            supplierId: capacityRequestSupplierId,
            weekStartDate: routingSuggestion.weekStartDate,
            lookbackDays: 7,
          })
        : { createdAt: null };
    const suppressCapacityRequest = isCapacityRequestSuppressed({
      requestCreatedAt: lastCapacityRequestCreatedAt,
      supplierLastUpdatedAt: supplierCapacityLastUpdatedAt,
    });

    let capacitySnapshots: AdminCapacitySnapshotRow[] = [];
    let capacitySnapshotsError: string | null = null;
    if (resolvedCapacitySupplierId) {
      const capacityResult = await getCapacitySnapshotsForSupplierWeek({
        supplierId: resolvedCapacitySupplierId,
        weekStartDate: nextWeekStartDateIso,
      });
      capacitySnapshots = capacityResult.data.snapshots ?? [];
      capacitySnapshotsError = capacityResult.ok ? null : capacityResult.error ?? null;
    }

    const capacityLevelByCapability = new Map<string, AdminCapacityLevel | string>();
    for (const snapshot of capacitySnapshots) {
      const key = (snapshot?.capability ?? "").trim().toLowerCase();
      if (!key) continue;
      if (!capacityLevelByCapability.has(key)) {
        capacityLevelByCapability.set(key, snapshot.capacity_level);
      }
    }

    const capacityPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Capacity (Next Week)
            </h2>
            <p className="mt-1 text-xs text-slate-400">Week of {nextWeekLabel}</p>
          </div>
          {resolvedCapacitySupplierId ? (
            <Link
              href={`/admin/capacity?supplierId=${encodeURIComponent(resolvedCapacitySupplierId)}`}
              className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
            >
              View capacity calendar
            </Link>
          ) : null}
        </header>

        {!resolvedCapacitySupplierId ? (
          <p className="mt-4 text-sm text-slate-400">No supplier selected yet.</p>
        ) : capacitySnapshotsError ? (
          <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
            {capacitySnapshotsError}
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {capacitySnapshots.length === 0 ? (
              <p className="text-sm text-slate-400">No capacity signal for this week.</p>
            ) : null}
            <dl className="grid gap-2">
              {CAPACITY_SNAPSHOT_UNIVERSE.map((capability) => {
                const level = capacityLevelByCapability.get(capability.key) ?? null;
                const display = formatCapacityLevelLabel(level);
                const pill = display ? (
                  <span className={clsx("rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", capacityLevelPillClasses(level))}>
                    {display}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-slate-400">Not set</span>
                );

                return (
                  <div
                    key={capability.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
                  >
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {capability.label}
                    </dt>
                    <dd className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                      {pill}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        )}
      </section>
    );

    const routingSuggestionPanel = (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-200">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Routing suggestion
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Based on supplier capacity for next week.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200">
              Week of {routingWeekLabel}
            </span>
            {capacityRequestSupplierId && capacityRequestReason ? (
              <RequestCapacityUpdateButton
                quoteId={quote.id}
                supplierId={capacityRequestSupplierId}
                weekStartDate={routingSuggestion.weekStartDate}
                reason={capacityRequestReason}
                suppressed={suppressCapacityRequest}
                lastRequestCreatedAt={lastCapacityRequestCreatedAt}
              />
            ) : null}
          </div>
        </header>

        {routingSuggestion.resolvedSupplierId ? (
          routingSuggestion.supplierSummaries.length > 0 ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Selected supplier
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                    {routingSuggestion.supplierSummaries[0]?.supplierName ??
                      routingSuggestion.resolvedSupplierId}
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      insightMatchHealthPillClasses(
                        routingSuggestion.supplierSummaries[0]?.benchHealth?.matchHealth ??
                          "unknown",
                      ),
                    )}
                  >
                    Match:{" "}
                    {formatInsightMatchHealthLabel(
                      routingSuggestion.supplierSummaries[0]?.benchHealth?.matchHealth ??
                        "unknown",
                    )}
                  </span>
                  <span
                    className={clsx(
                      "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                      insightBenchStatusPillClasses(
                        routingSuggestion.supplierSummaries[0]?.benchHealth?.benchStatus ??
                          "unknown",
                      ),
                    )}
                  >
                    Bench:{" "}
                    {formatInsightBenchStatusLabel(
                      routingSuggestion.supplierSummaries[0]?.benchHealth?.benchStatus ??
                        "unknown",
                    )}
                  </span>
                </div>
              </div>

              <CapacitySummaryPills
                coverageCount={routingSuggestion.supplierSummaries[0]?.coverageCount ?? 0}
                totalCount={routingSuggestion.supplierSummaries[0]?.totalCount ?? 4}
                levels={routingSuggestion.supplierSummaries[0]?.levels ?? {}}
                lastUpdatedAt={routingSuggestion.supplierSummaries[0]?.lastUpdatedAt ?? null}
                align="start"
              />

              <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Historical win reasons (90d)
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  {formatTopWinReasons(
                    routingSuggestion.supplierSummaries[0]?.awardFeedbackSummary?.byReason ?? {},
                    2,
                  ) ?? "No award feedback yet"}
                </p>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-400">
              Capacity signals are temporarily unavailable.
            </p>
          )
        ) : routingSuggestion.supplierSummaries.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">
            No supplier selected yet. Capacity suggestions are temporarily unavailable.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {routingSuggestion.supplierSummaries.map((summary) => (
              <div
                key={summary.supplierId}
                className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">
                      {summary.supplierName ?? "Unnamed supplier"}
                    </p>
                    {summary.matchHealth === "poor" && summary.blockingReason ? (
                      <p className="mt-1 text-xs text-red-200">
                        {summary.blockingReason}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span
                      className={clsx(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        insightMatchHealthPillClasses(
                          summary.benchHealth?.matchHealth ?? "unknown",
                        ),
                      )}
                    >
                      Match:{" "}
                      {formatInsightMatchHealthLabel(
                        summary.benchHealth?.matchHealth ?? "unknown",
                      )}
                    </span>
                    <span
                      className={clsx(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
                        insightBenchStatusPillClasses(
                          summary.benchHealth?.benchStatus ?? "unknown",
                        ),
                      )}
                    >
                      Bench:{" "}
                      {formatInsightBenchStatusLabel(
                        summary.benchHealth?.benchStatus ?? "unknown",
                      )}
                    </span>
                  </div>
                </div>
                <div className="mt-2">
                  <CapacitySummaryPills
                    coverageCount={summary.coverageCount}
                    totalCount={summary.totalCount}
                    levels={summary.levels}
                    lastUpdatedAt={summary.lastUpdatedAt}
                    align="start"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    );

    const rfqInsightsPanel = (
      <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              RFQ quality
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Read-only signals derived from parts, invites, bids, and messages.
            </p>
          </div>
          <span
            className={clsx(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              rfqQualitySummary.score >= 85
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                : rfqQualitySummary.score >= 70
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                  : rfqQualitySummary.score >= 50
                    ? "border-red-500/40 bg-red-500/10 text-red-100"
                    : "border-red-500/60 bg-red-950/30 text-red-50",
            )}
          >
            Score: {rfqQualitySummary.score}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Missing CAD</p>
            <p className="mt-1 font-semibold text-slate-100">
              {rfqQualitySummary.missingCad ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Missing drawings</p>
            <p className="mt-1 font-semibold text-slate-100">
              {rfqQualitySummary.missingDrawings ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Parts coverage</p>
            <p className="mt-1 font-semibold text-slate-100">
              {rfqQualitySummary.partsCoverage === "good"
                ? "Good"
                : rfqQualitySummary.partsCoverage === "needs_attention"
                  ? "Needs attention"
                  : "None"}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Supplier behavior
          </p>
          <dl className="mt-2 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Suppliers declined
              </dt>
              <dd className="mt-1 font-semibold text-slate-100">
                {rfqQualitySummary.suppliersDeclined}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Suppliers requested clarification
              </dt>
              <dd className="mt-1 font-semibold text-slate-100">
                {rfqQualitySummary.suppliersRequestedClarification}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-slate-500">
            Declines are persisted from supplier portal feedback; clarification is inferred from pre-bid supplier messages.
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
          <div className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Supplier feedback (declines)
            </p>
            <span className="text-xs text-slate-400">
              {rfqFeedbackSchemaMissing
                ? "Unavailable"
                : `${rfqFeedbackRows.length} item${rfqFeedbackRows.length === 1 ? "" : "s"}`}
            </span>
          </div>
          {rfqFeedbackSchemaMissing ? (
            <div className="px-4 py-4 text-sm text-slate-400">
              Feedback table unavailable (schema not deployed in this environment yet).
            </div>
          ) : rfqFeedbackRows.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400">
              No supplier decline feedback captured yet.
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-950/40">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Supplier
                  </th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Categories
                  </th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Note
                  </th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Timestamp
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {rfqFeedbackRows.map((row, idx) => {
                  const supplierId =
                    typeof row?.supplier_id === "string" ? row.supplier_id.trim() : "";
                  const supplierName = supplierId
                    ? supplierNameById.get(supplierId) ?? supplierId
                    : "Unknown supplier";
                  const categories = Array.isArray(row?.categories)
                    ? row.categories.filter((value): value is string => typeof value === "string")
                    : [];
                  const categoriesDisplay =
                    categories.length > 0
                      ? categories.map(formatRfqSignalCategory).join(", ")
                      : "—";
                  const note =
                    typeof row?.note === "string" && row.note.trim().length > 0
                      ? row.note.trim()
                      : "—";
                  const timestamp =
                    typeof row?.created_at === "string" && row.created_at.trim().length > 0
                      ? formatDateTime(row.created_at, { includeTime: true }) ?? row.created_at
                      : "—";
                  return (
                    <tr key={`${supplierId}-${idx}`}>
                      <td className="px-4 py-2 align-top font-medium text-slate-100">
                        {supplierName}
                      </td>
                      <td className="px-4 py-2 align-top text-slate-300">
                        {categoriesDisplay}
                      </td>
                      <td className="px-4 py-2 align-top text-slate-300">{note}</td>
                      <td className="px-4 py-2 align-top text-slate-400">{timestamp}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
          <div className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Signals
            </p>
            <span className="text-xs text-slate-400">
              {rfqQualitySummary.signals.length} item{rfqQualitySummary.signals.length === 1 ? "" : "s"}
            </span>
          </div>
          {rfqQualitySummary.signals.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400">
              No RFQ quality signals detected yet.
            </div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-950/40">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Category
                  </th>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60">
                {rfqQualitySummary.signals.map((signal, idx) => (
                  <tr key={`${signal.category}-${signal.supplierId}-${idx}`}>
                    <td className="px-4 py-2 align-top font-medium text-slate-100">
                      {formatRfqSignalCategory(signal.category)}
                    </td>
                    <td className="px-4 py-2 align-top text-slate-300">
                      {signal.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    );

    const adminPrimaryAction = resolvePrimaryAction({
      role: "admin",
      quote: {
        id: quote.id,
        status,
        primaryActionHints: {
          needsDecision: attentionState.needsDecision,
          hasWinner: hasWinningBid,
        },
      },
    });
    const adminWhatsNext = attentionState.needsDecision
      ? "Needs award decision."
      : "No pending actions.";
    const adminPills = [
      { key: "quote", label: "Quote", value: formatShortId(quote.id) },
      {
        key: "bids",
        label: "Offers",
        value: offerCountLabel,
        tone: attentionState.needsDecision ? "warning" : "neutral",
        href: "#decision",
      },
      { key: "bestPrice", label: "Best price", value: bestPriceDisplay },
      { key: "leadTime", label: "Fastest lead", value: fastestLeadTimeDisplay },
      {
        key: "kickoff",
        label: "Kickoff",
        value: kickoffSummaryLabel,
        tone: kickoffProgressBasis.isComplete
          ? "success"
          : hasWinningBid
            ? "info"
            : "neutral",
        href: "#kickoff",
      },
      {
        key: "messages",
        label: "Messages",
        value: `${quoteMessages.length}`,
        tone: threadSla?.needsReplyFrom ? "warning" : "neutral",
        href: "#messages",
      },
    ] as const;

    return (
      <AdminDashboardShell
        eyebrow="Admin · Quote"
        title={headerTitle}
        description={headerDescription}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CopyTextButton
              text={rfqPackText}
              idleLabel="Copy RFQ pack"
              className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "whitespace-nowrap")}
              logPrefix="[rfq_pack]"
            />
            {quote.upload_id ? (
              <Link
                href={`/admin/uploads/${quote.upload_id}`}
                className={clsx(
                  secondaryCtaClasses,
                  ctaSizeClasses.sm,
                  "whitespace-nowrap",
                )}
              >
                View upload
              </Link>
            ) : null}
          </div>
        }
      >
        <div className="space-y-6">
          <QuoteAtAGlanceBar
            role="admin"
            statusLabel={statusLabel}
            whatsNext={adminWhatsNext}
            pills={[...adminPills]}
            primaryAction={adminPrimaryAction}
            below={
              <QuoteSectionRail
                sections={buildAdminQuoteSections({
                  bidCount: aggregateBidCount,
                  hasWinner: hasWinningBid,
                  kickoffRatio: kickoffProgressRatio,
                  kickoffComplete: kickoffProgressBasis.isComplete,
                  messageCount: quoteMessages.length,
                  needsReply: adminNeedsReply,
                  fileCount: filePreviews.length,
                  opsEventCount: opsEvents.length,
                })}
              />
            }
          />

          {stateSummaryItems.length > 0 ? (
            <section
              aria-label="State summary"
              className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-3"
            >
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                {stateSummaryItems.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {item.label}
                    </dt>
                    <dd
                      className="break-anywhere mt-1 min-w-0 text-sm font-semibold text-slate-100 lg:truncate"
                      title={item.value}
                    >
                      {item.value}
                    </dd>
                  </div>
                ))}
                <div key="Change requests" className="min-w-0 hidden lg:block">
                  <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Change requests
                  </dt>
                  <dd
                    className="break-anywhere mt-1 min-w-0 text-sm font-semibold text-slate-100 lg:truncate"
                    title={changeRequestsSummaryValue}
                  >
                    {changeRequestsSummaryValue}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}

          {selectionRecordedItems ? (
            <section
              aria-label="Selection recorded"
              className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200">
                Selection recorded
              </p>
              <dl className="mt-3 grid gap-3 sm:grid-cols-4">
                {selectionRecordedItems.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wide text-emerald-200/80">
                      {item.label}
                    </dt>
                    <dd className="break-anywhere mt-1 text-sm font-semibold text-emerald-50">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <DisclosureSection
            id="details"
            className="scroll-mt-24"
            title="Details"
            description="IDs and metadata for troubleshooting."
            defaultOpen={false}
            summary={
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                {formatShortId(quote.id)}
              </span>
            }
          >
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400">
              <span>
                Quote ID:{" "}
                <span className="break-anywhere font-mono text-slate-300">{quote.id}</span>
              </span>
              {quote.upload_id && (
                <span>
                  Upload ID:{" "}
                  <span className="break-anywhere font-mono text-slate-300">
                    {quote.upload_id}
                  </span>
                </span>
              )}
              <span>
                Created:{" "}
                {formatDateTime(quote.created_at, { includeTime: true }) ?? "—"}
              </span>
              <span>
                Updated:{" "}
                {formatDateTime(quote.updated_at, { includeTime: true }) ?? "—"}
              </span>
            </div>
          </DisclosureSection>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="break-anywhere font-medium text-slate-50">{customerName}</span>
              {customerEmail && (
                <a
                  href={`mailto:${customerEmail}`}
                  className="break-anywhere text-emerald-300 hover:underline"
                >
                  {customerEmail}
                </a>
              )}
              {contactPhone && (
                <a
                  href={`tel:${contactPhone}`}
                  className="break-anywhere text-slate-400 hover:text-emerald-200"
                >
                  {contactPhone}
                </a>
              )}
              {companyName && (
                <span className="break-anywhere text-slate-400">{companyName}</span>
              )}
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)]">
              {bidSummaryPanel}
              <div className="space-y-4">
                <DisclosureSection
                  id="signals"
                  title="Signals"
                  description="Thread SLA, kickoff status, routing health, and capacity."
                  defaultOpen
                  summary={
                    adminOverdue ? (
                      <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-100">
                        Overdue
                      </span>
                    ) : adminNeedsReply ? (
                      <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                        Needs reply
                      </span>
                    ) : (
                      <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold text-slate-200">
                        No reply needed
                      </span>
                    )
                  }
                >
                  <div className="space-y-4">
                    {threadSla?.usingFallback ? (
                      <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-xs text-slate-300">
                        SLA signal unavailable; using basic staleness.
                      </p>
                    ) : null}
                    {threadStatusPanel}
                    {kickoffStatusPanel}
                    {partsCoveragePanel}
                    {routingSuggestionPanel}
                    {capacityPanel}
                  </div>
                </DisclosureSection>

                <ChangeRequestsCard quoteId={quote.id} messagesHref="#messages" />
              </div>
            </div>
          </div>

          <DisclosureSection
            id="decision"
            className="scroll-mt-24"
            hashAliases={["bids-panel", "suppliers-panel"]}
            title="Decision"
            description="Invite suppliers, review offers, and award a winner."
            defaultOpen={!hasWinningBid && aggregateBidCount > 0}
            summary={
              hasWinningBid ? (
                <span className="pill pill-success px-3 py-0.5 text-[11px] font-semibold">
                  Awarded
                </span>
              ) : (
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                  {offerCountLabel}
                </span>
              )
            }
          >
            <div className="space-y-4">
              {excludedOfferSummaries.length > 0 ? (
                <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-5 py-4 text-sm text-amber-100">
                  <p className="font-semibold text-amber-50">
                    Warning: {excludedOfferSummaries.length} offer
                    {excludedOfferSummaries.length === 1 ? "" : "s"} violate customer exclusions.
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-100/90">
                    {excludedOfferSummaries.slice(0, 6).map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                    {excludedOfferSummaries.length > 6 ? (
                      <li>{excludedOfferSummaries.length - 6} more…</li>
                    ) : null}
                  </ul>
                </div>
              ) : null}
              {bidCompareRows.length === 1 ? (
                <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4 text-sm text-slate-200">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Decision assistant
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    Only one supplier has submitted an offer on this RFQ so far.
                  </p>
                </div>
              ) : bidCompareRows.length > 1 ? (
                <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4 text-sm text-slate-200">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Decision assistant
                  </p>
                  <p className="mt-1 text-sm text-slate-300">
                    {(() => {
                      const candidates = compareRowsByScore
                        .filter((row) => typeof row.compositeScore === "number")
                        .slice(0, 2)
                        .map((row) => row.supplierName);
                      if (candidates.length === 0) {
                        return "Review offers below to make an award decision.";
                      }
                      if (candidates.length === 1) {
                        return `Based on price, lead time, and supplier fit, ${candidates[0]} looks like the best candidate.`;
                      }
                      const base = `Based on price, lead time, and supplier fit, ${candidates[0]} and ${candidates[1]} look like the best candidates.`;
                      return decisionAssistantReputationNote
                        ? `${base} ${decisionAssistantReputationNote}`
                        : base;
                    })()}
                  </p>
                </div>
              ) : null}
              {rfqOfferCount === 0 && !hasWinningBid ? (
                <EmptyStateCard
                  title="No offers yet"
                  description="Invite a supplier to start quoting, or check back later."
                  action={
                    showInviteSupplierCta
                      ? { label: "Invite a supplier", href: "#suppliers-panel" }
                      : { label: "Open messages", href: "#messages" }
                  }
                  secondaryAction={
                    showInviteSupplierCta ? { label: "Open messages", href: "#messages" } : null
                  }
                />
              ) : null}
              {showInviteSupplierCta ? (
                <div id="suppliers-panel" className="scroll-mt-24">
                  <AdminInviteSupplierCard quoteId={quote.id} />
                </div>
              ) : null}
              {partsCoverageSummary.anyParts && !partsCoverageSummary.allCovered ? (
                <p className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-5 py-3 text-xs text-slate-300">
                  Some parts are missing CAD or drawings. Confirm scope during kickoff.
                </p>
              ) : null}

              <SupplierBidsCard
                id="bids-panel"
                quoteId={quote.id}
                quoteStatus={status}
                awardedBidId={quote.awarded_bid_id ?? null}
                awardedSupplierId={quote.awarded_supplier_id ?? null}
                bids={bids}
                bidComparisonBySupplierId={comparisonBySupplierId}
                reputationBySupplierId={reputationLiteBySupplierId}
                recommendedSupplierIds={recommendedSupplierIds}
                bidsLoaded={bidsResult.ok}
                errorMessage={bidsResult.error ?? null}
                headerActions={
                  <AddExternalOfferButton
                    quoteId={quote.id}
                    excludedSourceNames={excludedSourceNames}
                    buttonSize="xs"
                  />
                }
              />
            </div>
          </DisclosureSection>

          <div className="space-y-4">
            <DisclosureSection
              id="exclusions"
              className="scroll-mt-24"
              title="Exclusions"
              description="Block offers from specific providers or external sources for this customer."
              defaultOpen={customerExclusions.length > 0}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {customerExclusions.length} exclusion{customerExclusions.length === 1 ? "" : "s"}
                </span>
              }
            >
              {customerId ? (
                <CustomerExclusionsSection
                  quoteId={quote.id}
                  customerId={customerId}
                  providers={providers.map((provider) => ({
                    id: provider.id,
                    name: provider.name ?? null,
                  }))}
                  exclusions={customerExclusions}
                />
              ) : (
                <p className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-300">
                  This quote is not linked to a customer profile; exclusions can’t be applied.
                </p>
              )}
            </DisclosureSection>

            <DisclosureSection
              id="destinations"
              className="scroll-mt-24"
              title="Destinations (Kayak Dispatch)"
              description="Add providers and track RFQ dispatch status."
              defaultOpen={rfqDestinations.length === 0}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {rfqDestinations.length} destination{rfqDestinations.length === 1 ? "" : "s"}
                </span>
              }
            >
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4 text-sm text-slate-200">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Award supplier (admin)
                    </p>
                    <p className="mt-1 text-sm text-slate-300">
                      Select the winning provider (optionally tie to a specific offer).
                    </p>
                    {awardedProviderLabel ? (
                      <p className="mt-2 text-xs text-emerald-200">
                        Awarded: {awardedProviderLabel}
                        {awardedOfferId ? ` · offer ${formatShortId(awardedOfferId)}` : ""}
                        {awardNotes ? " · notes recorded" : ""}
                      </p>
                    ) : null}
                  </div>
                  <AwardProviderModal
                    quoteId={quote.id}
                    providers={providers}
                    offers={rfqOffers}
                    disabled={Boolean((quote.awarded_at ?? "").trim())}
                    initialProviderId={awardedProviderId}
                    initialOfferId={awardedOfferId}
                  />
                </div>
                <AwardEmailGenerator
                  quoteId={quote.id}
                  selectedOfferId={selectedOfferId}
                  selectionConfirmedAt={selectionConfirmedAt}
                />
                {showOrderDetailsConfirmation ? (
                  <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4 text-sm text-slate-200">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Order confirmation
                    </p>
                    <p className="mt-1 text-sm font-semibold text-white">
                      {selectionConfirmedAt ? "Order details confirmed" : "Order details pending"}
                    </p>
                    {orderDetailsConfirmedAtLabel ? (
                      <p className="mt-1 text-xs text-slate-400">
                        Confirmed {orderDetailsConfirmedAtLabel}
                      </p>
                    ) : null}
                    {orderDetailsPoNumber || orderDetailsShipTo ? (
                      <dl className="mt-4 grid gap-3 rounded-xl border border-slate-800 bg-black/20 px-4 py-3 text-sm">
                        {orderDetailsPoNumber ? (
                          <div className="space-y-1">
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              PO number
                            </dt>
                            <dd className="break-anywhere text-slate-100">{orderDetailsPoNumber}</dd>
                          </div>
                        ) : null}
                        {orderDetailsShipTo ? (
                          <div className="space-y-1">
                            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                              Ship-to
                            </dt>
                            <dd className="whitespace-pre-line break-words text-slate-100">
                              {orderDetailsShipTo}
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="mt-3 text-xs text-slate-400">
                        No PO number or ship-to details captured yet.
                      </p>
                    )}
                  </div>
                ) : null}
                <AdminRfqDestinationsCard
                  quoteId={quote.id}
                  providers={providers}
                  destinations={rfqDestinations}
                  offers={rfqOffers}
                  providerEmailColumn={providersResult.emailColumn}
                  providerEligibility={providerEligibility}
                />
              </div>
            </DisclosureSection>

            <DisclosureSection
              id="uploads"
              className="scroll-mt-24"
              hashAliases={["uploads-panel"]}
              title="Uploads"
              description="Files, structured intake metadata, and customer notes."
              defaultOpen={false}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {fileCountText}
                </span>
              }
            >
              {uploadsContent}
            </DisclosureSection>

            <DisclosureSection
              id="parts"
              className="scroll-mt-24"
              hashAliases={["components"]}
              title="Parts & files"
              description="Define parts and attach CAD/drawings from uploads."
              defaultOpen={parts.length === 0}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {parts.length} part{parts.length === 1 ? "" : "s"}
                </span>
              }
            >
              {partsWorkArea}
            </DisclosureSection>

            <DisclosureSection
              id="kickoff"
              className="scroll-mt-24"
              title="Kickoff"
              description="Customer PO, ship date, and handoff notes (visible to winner)."
              defaultOpen={false}
              summary={
                <span className={clsx("rounded-full border px-3 py-1", kickoffSummaryTone)}>
                  {kickoffSummaryLabel}
                </span>
              }
            >
              <AdminQuoteProjectCard
                quoteId={quote.id}
                project={project}
                projectUnavailable={projectUnavailable}
                className={cardClasses}
              />
              <div className="mt-4">
                <AdminKickoffReviewCard
                  quoteId={quote.id}
                  hasWinner={hasWinningBid}
                  tasks={quoteKickoffTasks.map((task) => ({
                    taskKey: task.taskKey,
                    title: task.title,
                    description: task.description,
                    sortOrder: task.sortOrder,
                    status: task.status,
                    completedAt: task.completedAt,
                    blockedReason: task.blockedReason,
                    updatedAt: task.updatedAt,
                  }))}
                  summary={kickoffCompletionSummary}
                  kickoffStalled={kickoffStalled}
                  unavailable={hasWinningBid && kickoffTasksUnavailable}
                />
              </div>
            </DisclosureSection>

            <DisclosureSection
              id="messages"
              className="scroll-mt-24"
              hashAliases={["messages-panel"]}
              title="Messages"
              description="Shared customer + supplier thread for this RFQ."
              defaultOpen={adminNeedsReply}
              summary={
                <div className="flex flex-wrap items-center gap-2">
                  {adminOverdue ? (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold text-red-100">
                      Overdue
                    </span>
                  ) : adminNeedsReply ? (
                    <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                      Needs reply
                    </span>
                  ) : null}
                  <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                    {quoteMessages.length} message{quoteMessages.length === 1 ? "" : "s"}
                  </span>
                </div>
              }
            >
              {messagesContent}
            </DisclosureSection>

            <CollapsibleCard
              title="Edit quote"
              description="Status, pricing, target date, internal and DFM notes."
              defaultOpen={false}
            >
              {editContent}
            </CollapsibleCard>

            <DisclosureSection
              id="rfq-insights"
              className="scroll-mt-24"
              title="RFQ Insights"
              description="Quality and competitiveness signals for this RFQ."
              defaultOpen={rfqQualitySummary.score < 80}
              summary={
                <span
                  className={clsx(
                    "rounded-full border px-3 py-1 text-[11px] font-semibold",
                    rfqQualitySummary.score >= 85
                      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                      : rfqQualitySummary.score >= 70
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
                        : "border-red-500/40 bg-red-500/10 text-red-100",
                  )}
                >
                  Score {rfqQualitySummary.score}
                </span>
              }
            >
              {rfqInsightsPanel}
            </DisclosureSection>

            <DisclosureSection
              id="timeline"
              className="scroll-mt-24"
              title="Timeline"
              description="Updates and milestones for this RFQ."
              defaultOpen={false}
            >
              {trackingContent}
            </DisclosureSection>

            <DisclosureSection
              id="ops-timeline"
              className="scroll-mt-24"
              title="Ops Timeline"
              description="Dispatch and provider events for this RFQ."
              defaultOpen={false}
              summary={
                <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                  {opsEvents.length} event{opsEvents.length === 1 ? "" : "s"}
                </span>
              }
            >
              {opsTimelineContent}
            </DisclosureSection>

            <CollapsibleCard
              title="3D viewer workspace"
              description="Open STL previews in the interactive modal."
              defaultOpen={false}
            >
              {viewerContent}
            </CollapsibleCard>
          </div>
        </div>
      </AdminDashboardShell>
    );
}

function buildAdminQuoteSections(args: {
  bidCount: number;
  hasWinner: boolean;
  kickoffRatio: string | null;
  kickoffComplete: boolean;
  messageCount: number;
  needsReply: boolean;
  fileCount: number;
  opsEventCount: number;
}): QuoteSectionRailSection[] {
  const decisionBadge = args.hasWinner
    ? "Awarded"
    : args.bidCount > 0
      ? `${args.bidCount}`
      : undefined;
  const kickoffBadge = args.kickoffComplete
    ? "Complete"
    : args.kickoffRatio
      ? args.kickoffRatio
      : args.hasWinner
        ? "In progress"
        : "Locked";
  const uploadsBadge = args.fileCount > 0 ? `${args.fileCount}` : undefined;
  const messagesBadge = args.needsReply ? "Reply" : args.messageCount > 0 ? `${args.messageCount}` : undefined;
  const opsBadge = args.opsEventCount > 0 ? `${args.opsEventCount}` : undefined;

  return [
    {
      key: "decision",
      label: "Decision",
      href: "#decision",
      badge: decisionBadge,
      tone: args.hasWinner ? "neutral" : args.bidCount > 0 ? "warning" : "neutral",
    },
    {
      key: "kickoff",
      label: "Kickoff",
      href: "#kickoff",
      badge: kickoffBadge,
      tone: args.kickoffComplete ? "neutral" : args.hasWinner ? "info" : "neutral",
    },
    {
      key: "messages",
      label: "Messages",
      href: "#messages",
      badge: messagesBadge,
      tone: args.needsReply ? "warning" : "neutral",
    },
    { key: "uploads", label: "Uploads", href: "#uploads", badge: uploadsBadge },
    { key: "details", label: "Details", href: "#details" },
    { key: "timeline", label: "Timeline", href: "#timeline" },
    { key: "ops-timeline", label: "Ops Timeline", href: "#ops-timeline", badge: opsBadge },
  ];
}

function SnapshotField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-100">{value}</dd>
    </div>
  );
}

function mapProjectStatusToPill(status?: string | null): {
  label: string;
  pillClasses: string;
} {
  const normalized = typeof status === "string" ? status.trim().toLowerCase() : "";
  switch (normalized) {
    case "kickoff":
    case "in_progress":
    case "in-progress":
      return {
        label: "Kickoff in progress",
        pillClasses: "border-blue-500/40 bg-blue-500/10 text-blue-100",
      };
    case "production":
    case "in_production":
      return {
        label: "In production",
        pillClasses: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
      };
    default:
      return {
        label: "Planning",
        pillClasses: "border-slate-700 bg-slate-900/40 text-slate-200",
      };
  }
}

function findBestPriceBid(
  bids: AdminSupplierBidRow[],
): AdminSupplierBidRow | null {
  return bids.reduce<AdminSupplierBidRow | null>((currentBest, bid) => {
    if (typeof bid.amount !== "number" || Number.isNaN(bid.amount)) {
      return currentBest;
    }
    if (!currentBest || (currentBest.amount ?? Infinity) > bid.amount) {
      return bid;
    }
    return currentBest;
  }, null);
}

function findFastestLeadTime(bids: AdminSupplierBidRow[]): number | null {
  return bids.reduce<number | null>((currentBest, bid) => {
    if (
      typeof bid.lead_time_days !== "number" ||
      Number.isNaN(bid.lead_time_days)
    ) {
      return currentBest;
    }
    if (currentBest === null || bid.lead_time_days < currentBest) {
      return bid.lead_time_days;
    }
    return currentBest;
  }, null);
}

const CAPACITY_SNAPSHOT_UNIVERSE: Array<{ key: string; label: string }> = [
  { key: "cnc_mill", label: "CNC Mill" },
  { key: "cnc_lathe", label: "CNC Lathe" },
  { key: "mjp", label: "MJP" },
  { key: "sla", label: "SLA" },
];

function resolveCapacitySupplierId(args: {
  awardedSupplierId?: string | null;
  baseBids: Array<{ supplier_id?: string | null }>;
}): string | null {
  const awarded =
    typeof args.awardedSupplierId === "string" ? args.awardedSupplierId.trim() : "";
  if (awarded) return awarded;
  if (args.baseBids.length !== 1) return null;
  const bidSupplier =
    typeof args.baseBids[0]?.supplier_id === "string" ? args.baseBids[0].supplier_id.trim() : "";
  return bidSupplier || null;
}

function formatWeekOfLabel(weekStartDateIso: string): string {
  const parsed = Date.parse(`${weekStartDateIso}T00:00:00.000Z`);
  if (Number.isNaN(parsed)) return weekStartDateIso;
  return new Date(parsed).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function inferCapacityRequestReason(args: {
  coverageCount: number;
  lastUpdatedAt: string | null;
}): CapacityUpdateRequestReason {
  const coverageCount =
    typeof args.coverageCount === "number" && Number.isFinite(args.coverageCount)
      ? args.coverageCount
      : 0;
  const lastUpdatedAt =
    typeof args.lastUpdatedAt === "string" && args.lastUpdatedAt.trim()
      ? args.lastUpdatedAt.trim()
      : null;
  const parsed = lastUpdatedAt ? Date.parse(lastUpdatedAt) : Number.NaN;
  const isStale =
    Number.isFinite(parsed) && Date.now() - parsed > 14 * 24 * 60 * 60 * 1000;
  if (isStale) return "stale";
  if (coverageCount < 2) return "missing";
  return "manual";
}

function formatCapacityLevelLabel(level: unknown): string | null {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  if (!normalized) return null;
  if (normalized === "high") return "High";
  if (normalized === "medium") return "Medium";
  if (normalized === "low") return "Low";
  if (normalized === "unavailable") return "Unavailable";
  if (normalized === "overloaded") return "Overloaded";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function capacityLevelPillClasses(level: unknown): string {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";
  switch (normalized) {
    case "high":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "medium":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "low":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "unavailable":
      return "border-slate-700 bg-slate-900/40 text-slate-200";
    case "overloaded":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-700 bg-slate-900/40 text-slate-200";
  }
}

function matchHealthPillClasses(health: unknown): string {
  const normalized = typeof health === "string" ? health.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    case "caution":
    default:
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  }
}

function formatMatchHealthLabel(health: unknown): string {
  const normalized = typeof health === "string" ? health.trim().toLowerCase() : "";
  if (normalized === "good") return "Good";
  if (normalized === "poor") return "Poor";
  return "Caution";
}

function formatInsightMatchHealthLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "good") return "Good";
  if (normalized === "caution") return "Caution";
  if (normalized === "poor") return "Poor";
  return "Unknown";
}

function insightMatchHealthPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "good":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "caution":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    case "poor":
      return "border-red-500/40 bg-red-500/10 text-red-100";
    default:
      return "border-slate-800 bg-slate-950/50 text-slate-200";
  }
}

function formatInsightBenchStatusLabel(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "underused") return "Underused";
  if (normalized === "balanced") return "Balanced";
  if (normalized === "overused") return "Overused";
  return "Unknown";
}

function insightBenchStatusPillClasses(value: unknown): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "underused":
      return "border-blue-500/40 bg-blue-500/10 text-blue-100";
    case "balanced":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
    case "overused":
      return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    default:
      return "border-slate-800 bg-slate-950/50 text-slate-200";
  }
}

function formatTopWinReasons(byReason: Record<string, number>, limit: number): string | null {
  const entries = Object.entries(byReason ?? {})
    .filter(([reason, count]) => typeof reason === "string" && reason.trim() && typeof count === "number")
    .sort((a, b) => {
      const dc = (b[1] ?? 0) - (a[1] ?? 0);
      if (dc !== 0) return dc;
      return a[0].localeCompare(b[0]);
    })
    .slice(0, Math.max(0, Math.floor(limit)));

  if (entries.length === 0) return null;

  const parts = entries.map(([reason, count]) => {
    const label =
      formatAwardFeedbackReasonLabel(reason) ??
      reason.replace(/[_-]+/g, " ").trim().replace(/^\w/, (m) => m.toUpperCase());
    return `${label} (${count})`;
  });
  return parts.join(", ");
}

function truncateThreadPreview(value: unknown, maxLen: number): string | null {
  const raw = typeof value === "string" ? value : "";
  const squashed = raw.replace(/\s+/g, " ").trim();
  if (!squashed) return null;
  if (squashed.length <= maxLen) return squashed;
  return `${squashed.slice(0, Math.max(0, maxLen - 1))}…`;
}

function formatRfqSignalCategory(value: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return "Other";
  return normalized
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^\w/, (m) => m.toUpperCase());
}

function formatOpsEventTypeLabel(value: string): string {
  const label = formatEnumLabel(value);
  return label === "-" ? "Event" : label;
}

function renderOpsEventSummary(args: {
  event: OpsEventRecord;
  providerLabelById: Map<string, string>;
  destinationById: Map<string, { provider_id: string }>;
}): ReactNode {
  const payload = args.event.payload ?? {};
  const destinationId =
    resolvePayloadString(payload, "destination_id") ?? args.event.destination_id ?? null;
  const destination = destinationId ? args.destinationById.get(destinationId) ?? null : null;
  const providerId =
    resolvePayloadString(payload, "provider_id") ?? destination?.provider_id ?? null;

  const providerLabel = providerId
    ? args.providerLabelById.get(providerId) ?? `Provider ${formatShortId(providerId)}`
    : null;

  const providerLink = providerId ? (
    <Link
      href={`/admin/ops/inbox?provider=${providerId}`}
      className="text-emerald-200 underline-offset-4 hover:underline"
    >
      {providerLabel}
    </Link>
  ) : null;

  const destinationLink = destinationId ? (
    <HashScrollLink
      hash="destinations"
      className="text-emerald-200 underline-offset-4 hover:underline"
    >
      {formatShortId(destinationId)}
    </HashScrollLink>
  ) : null;

  const summaryParts: ReactNode[] = [];
  switch (args.event.event_type) {
    case "destination_added": {
      summaryParts.push("Destination added");
      break;
    }
    case "destinations_added": {
      const chosenProviders = Array.isArray(payload?.chosen_provider_ids)
        ? payload.chosen_provider_ids.filter((value) => typeof value === "string")
        : [];
      const eligibleCount =
        typeof payload?.eligible_count === "number" ? payload.eligible_count : null;
      if (chosenProviders.length > 0 && typeof eligibleCount === "number") {
        summaryParts.push(
          `Destinations added (${chosenProviders.length} chosen, ${eligibleCount} eligible)`,
        );
      } else if (chosenProviders.length > 0) {
        summaryParts.push(`Destinations added (${chosenProviders.length} chosen)`);
      } else {
        summaryParts.push("Destinations added");
      }
      break;
    }
    case "destination_status_updated": {
      const statusFrom = formatOpsStatusLabel(resolvePayloadString(payload, "status_from"));
      const statusTo = formatOpsStatusLabel(resolvePayloadString(payload, "status_to"));
      if (statusFrom && statusTo) {
        summaryParts.push(`Status ${statusFrom} to ${statusTo}`);
      } else if (statusTo) {
        summaryParts.push(`Status set to ${statusTo}`);
      } else {
        summaryParts.push("Status updated");
      }
      break;
    }
    case "destination_submitted": {
      summaryParts.push("Destination submitted");
      break;
    }
    case "outbound_email_generated": {
      summaryParts.push("Outbound email draft generated");
      break;
    }
    case "offer_upserted": {
      const offerStatus = formatOpsStatusLabel(resolvePayloadString(payload, "status"));
      summaryParts.push(offerStatus ? `Offer saved (${offerStatus})` : "Offer saved");
      break;
    }
    case "offer_revised": {
      const offerStatus = formatOpsStatusLabel(resolvePayloadString(payload, "status"));
      summaryParts.push(offerStatus ? `Offer revised (${offerStatus})` : "Offer revised");
      break;
    }
    case "offer_selected": {
      const offerId = resolvePayloadString(payload, "offer_id");
      summaryParts.push(offerId ? `Offer ${formatShortId(offerId)} selected` : "Offer selected");
      break;
    }
    default: {
      summaryParts.push("Ops event recorded");
      break;
    }
  }

  if (destinationLink) {
    summaryParts.push(<>Destination {destinationLink}</>);
  }
  if (providerLink) {
    summaryParts.push(<>Provider {providerLink}</>);
  }

  return <>{joinSummaryParts(summaryParts)}</>;
}

function formatOpsStatusLabel(value: string | null): string | null {
  const label = formatEnumLabel(value);
  return label === "-" ? null : label;
}

function resolvePayloadString(
  payload: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  const value = payload?.[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function joinSummaryParts(parts: ReactNode[]): ReactNode {
  return parts.reduce<ReactNode[]>((acc, part, index) => {
    if (index > 0) acc.push(" · ");
    acc.push(part);
    return acc;
  }, []);
}
