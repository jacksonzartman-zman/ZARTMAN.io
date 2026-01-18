"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { computeDestinationNeedsAction, type SlaConfig } from "@/lib/ops/sla";
import {
  DESTINATION_STATUS_META,
  EMPTY_OFFER_DRAFT,
  buildOfferDraft,
  formatEnumLabel,
  formatOfferSummary,
  type OfferDraft,
} from "@/components/admin/rfq/destinationHelpers";
import {
  BulkDestinationEmailModal,
  DestinationEmailModal,
  DestinationErrorModal,
  DestinationWebFormModal,
  OfferModal,
  type BulkDestinationEmailResult,
} from "@/components/admin/rfq/destinationModals";
import { CopyTextButton } from "@/components/CopyTextButton";
import type { RfqOffer } from "@/server/rfqs/offers";
import type { RfqDestinationStatus } from "@/server/rfqs/destinations";
import type { AdminOpsInboxRow } from "@/server/ops/inbox";
import {
  generateDestinationEmailAction,
  generateDestinationWebFormInstructionsAction,
  updateDestinationStatusAction,
  upsertRfqOffer,
  type UpsertRfqOfferState,
} from "@/app/admin/quotes/[id]/actions";
import { buildPublicUrl } from "@/lib/publicUrl";
import { resolveDispatchModeValue } from "@/lib/adapters/providerDispatchMode";

type OpsInboxDispatchDrawerProps = {
  row: AdminOpsInboxRow;
  actionClassName: string;
  slaConfig: SlaConfig;
};

type FeedbackTone = "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

type BulkActionStatus = "success" | "error" | "skipped";

type BulkActionResult = {
  destinationId: string;
  providerLabel: string;
  status: BulkActionStatus;
  message: string;
};

type BulkActionSummary = {
  actionLabel: string;
  results: BulkActionResult[];
};

type BulkActionType = "generate" | "markSent" | "markError";

type DestinationStatusKey = RfqDestinationStatus | "unknown";

type NeedsActionMeta = {
  label: string;
  className: string;
};

const EMPTY_OFFER_STATE: UpsertRfqOfferState = {
  ok: true,
  message: "",
  offerId: "",
};

const STATUS_ORDER: DestinationStatusKey[] = [
  "queued",
  "sent",
  "error",
  "viewed",
  "quoted",
  "declined",
  "draft",
  "unknown",
];

const NEEDS_ACTION_META: Record<Exclude<ReturnType<typeof computeDestinationNeedsAction>["reason"], null>, NeedsActionMeta> = {
  queued_too_long: {
    label: "Queued stale",
    className: "pill-info",
  },
  sent_no_reply: {
    label: "Needs reply",
    className: "pill-warning",
  },
  error: {
    label: "Error",
    className: "border-red-400/60 bg-red-500/15 text-red-100",
  },
};

const BULK_CONCURRENCY_LIMIT = 3;

export function OpsInboxDispatchDrawer({
  row,
  actionClassName,
  slaConfig,
}: OpsInboxDispatchDrawerProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [errorDestination, setErrorDestination] = useState<AdminOpsInboxRow["destinations"][number] | null>(null);
  const [errorNote, setErrorNote] = useState("");
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);
  const [offerDestination, setOfferDestination] = useState<AdminOpsInboxRow["destinations"][number] | null>(null);
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(EMPTY_OFFER_DRAFT);
  const [offerFieldErrors, setOfferFieldErrors] = useState<Record<string, string>>({});
  const [offerError, setOfferError] = useState<string | null>(null);
  const [emailDestination, setEmailDestination] =
    useState<AdminOpsInboxRow["destinations"][number] | null>(null);
  const [emailPackage, setEmailPackage] = useState<{ subject: string; body: string } | null>(null);
  const [emailLoadingId, setEmailLoadingId] = useState<string | null>(null);
  const [emailErrorsById, setEmailErrorsById] = useState<Record<string, string>>({});
  const [webFormDestination, setWebFormDestination] =
    useState<AdminOpsInboxRow["destinations"][number] | null>(null);
  const [webFormPackage, setWebFormPackage] = useState<{
    url: string;
    instructions: string;
  } | null>(null);
  const [webFormLoadingId, setWebFormLoadingId] = useState<string | null>(null);
  const [webFormErrorsById, setWebFormErrorsById] = useState<Record<string, string>>({});
  const [selectedDestinationIds, setSelectedDestinationIds] = useState<Set<string>>(new Set());
  const [bulkActionSummary, setBulkActionSummary] = useState<BulkActionSummary | null>(null);
  const [bulkActionType, setBulkActionType] = useState<BulkActionType | null>(null);
  const [bulkEmailResults, setBulkEmailResults] = useState<BulkDestinationEmailResult[]>([]);
  const [bulkEmailModalOpen, setBulkEmailModalOpen] = useState(false);
  const [bulkErrorNote, setBulkErrorNote] = useState("");
  const [bulkErrorFeedback, setBulkErrorFeedback] = useState<string | null>(null);
  const [bulkErrorPromptOpen, setBulkErrorPromptOpen] = useState(false);

  const offersByProviderId = useMemo(() => {
    const map = new Map<string, RfqOffer>();
    for (const offer of row.offers) {
      map.set(offer.provider_id, offer);
    }
    return map;
  }, [row.offers]);

  const offerProviderIds = useMemo(() => {
    return new Set(row.offers.map((offer) => offer.provider_id));
  }, [row.offers]);

  const groupedDestinations = useMemo(() => {
    const groups = new Map<DestinationStatusKey, AdminOpsInboxRow["destinations"][number][]>();
    for (const status of STATUS_ORDER) {
      groups.set(status, []);
    }
    for (const destination of row.destinations) {
      const statusKey = normalizeStatus(destination.status);
      const bucket = groups.get(statusKey) ?? groups.get("unknown");
      if (bucket) {
        bucket.push(destination);
      }
    }
    return STATUS_ORDER.map((status) => ({
      status,
      destinations: groups.get(status) ?? [],
    })).filter((group) => group.destinations.length > 0);
  }, [row.destinations]);

  const quoteHref = `/admin/quotes/${row.quote.id}`;
  const quoteTitle = row.quote.title?.trim() || row.quote.id;
  const selectedDestinations = useMemo(() => {
    if (selectedDestinationIds.size === 0) return [];
    return row.destinations.filter((destination) => selectedDestinationIds.has(destination.id));
  }, [row.destinations, selectedDestinationIds]);
  const selectedCount = selectedDestinations.length;
  const selectedEmailDestinations = useMemo(
    () =>
      selectedDestinations.filter(
        (destination) =>
          resolveDispatchModeValue(destination.dispatch_mode, destination.quoting_mode) === "email",
      ),
    [selectedDestinations],
  );
  const selectedEmailCount = selectedEmailDestinations.length;
  const selectedCountLabel =
    selectedCount > 0 ? `${selectedCount} selected` : "No destinations selected";
  const bulkSummaryCounts = useMemo(() => {
    if (!bulkActionSummary) return null;
    return bulkActionSummary.results.reduce(
      (counts, result) => {
        counts[result.status] += 1;
        return counts;
      },
      { success: 0, error: 0, skipped: 0 },
    );
  }, [bulkActionSummary]);
  const isBulkGenerating = bulkActionType === "generate";
  const isBulkMarkingSent = bulkActionType === "markSent";
  const isBulkMarkingError = bulkActionType === "markError";
  const bulkBusy = pending || bulkActionType !== null;

  const handleStatusUpdate = (destinationId: string, status: RfqDestinationStatus) => {
    if (pending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await updateDestinationStatusAction({ destinationId, status });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        router.refresh();
        return;
      }
      setFeedback({ tone: "error", message: result.error });
    });
  };

  const openOfferModal = (destination: AdminOpsInboxRow["destinations"][number]) => {
    const offer = offersByProviderId.get(destination.provider_id) ?? null;
    setOfferFieldErrors({});
    setOfferError(null);
    setOfferDestination(destination);
    setOfferDraft(buildOfferDraft(offer));
  };

  const closeOfferModal = () => {
    setOfferFieldErrors({});
    setOfferError(null);
    setOfferDestination(null);
    setOfferDraft(EMPTY_OFFER_DRAFT);
  };

  const updateOfferField = (field: keyof OfferDraft, value: string) => {
    setOfferDraft((prev) => ({ ...prev, [field]: value }));
  };

  const submitOffer = () => {
    if (!offerDestination || pending) return;
    setOfferFieldErrors({});
    setOfferError(null);
    setFeedback(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("providerId", offerDestination.provider_id);
      formData.set("destinationId", offerDestination.id);
      formData.set("totalPrice", offerDraft.totalPrice);
      formData.set("unitPrice", offerDraft.unitPrice);
      formData.set("toolingPrice", offerDraft.toolingPrice);
      formData.set("shippingPrice", offerDraft.shippingPrice);
      formData.set("leadTimeDaysMin", offerDraft.leadTimeDaysMin);
      formData.set("leadTimeDaysMax", offerDraft.leadTimeDaysMax);
      formData.set("confidenceScore", offerDraft.confidenceScore);
      formData.set("qualityRiskFlags", offerDraft.riskFlags);
      formData.set("assumptions", offerDraft.assumptions);
      const result = await upsertRfqOffer(row.quote.id, EMPTY_OFFER_STATE, formData);
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        closeOfferModal();
        router.refresh();
        return;
      }
      setOfferError(result.error);
      setOfferFieldErrors(result.fieldErrors ?? {});
    });
  };

  const openErrorPrompt = (destination: AdminOpsInboxRow["destinations"][number]) => {
    setErrorFeedback(null);
    setErrorDestination(destination);
    setErrorNote(destination.error_message ?? "");
  };

  const closeErrorPrompt = () => {
    setErrorFeedback(null);
    setErrorDestination(null);
    setErrorNote("");
  };

  const submitError = () => {
    if (!errorDestination || pending) return;
    setErrorFeedback(null);
    startTransition(async () => {
      const result = await updateDestinationStatusAction({
        destinationId: errorDestination.id,
        status: "error",
        errorMessage: errorNote.trim(),
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: "Error recorded." });
        closeErrorPrompt();
        router.refresh();
        return;
      }
      setErrorFeedback(result.error);
    });
  };

  const openEmailModal = (
    destination: AdminOpsInboxRow["destinations"][number],
    subject: string,
    body: string,
  ) => {
    setEmailDestination(destination);
    setEmailPackage({ subject, body });
  };

  const closeEmailModal = () => {
    setEmailDestination(null);
    setEmailPackage(null);
  };

  const handleGenerateEmail = (destination: AdminOpsInboxRow["destinations"][number]) => {
    if (pending) return;
    setEmailErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setEmailDestination(null);
    setEmailPackage(null);
    setEmailLoadingId(destination.id);
    startTransition(async () => {
      const result = await generateDestinationEmailAction({
        quoteId: row.quote.id,
        destinationId: destination.id,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: "Email generated." });
        openEmailModal(destination, result.subject, result.body);
      } else {
        setFeedback({ tone: "error", message: result.error });
        setEmailErrorsById((prev) => ({ ...prev, [destination.id]: result.error }));
      }
      setEmailLoadingId(null);
    });
  };

  const openWebFormModal = (
    destination: AdminOpsInboxRow["destinations"][number],
    url: string,
    instructions: string,
  ) => {
    setWebFormDestination(destination);
    setWebFormPackage({ url, instructions });
  };

  const closeWebFormModal = () => {
    setWebFormDestination(null);
    setWebFormPackage(null);
  };

  const handleGenerateWebFormInstructions = (
    destination: AdminOpsInboxRow["destinations"][number],
  ) => {
    if (pending) return;
    setWebFormErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setWebFormDestination(null);
    setWebFormPackage(null);
    setWebFormLoadingId(destination.id);
    startTransition(async () => {
      const result = await generateDestinationWebFormInstructionsAction({
        destinationId: destination.id,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: "Instructions generated." });
        openWebFormModal(destination, result.url, result.instructions);
      } else {
        setFeedback({ tone: "error", message: result.error });
        setWebFormErrorsById((prev) => ({ ...prev, [destination.id]: result.error }));
      }
      setWebFormLoadingId(null);
    });
  };

  const toggleDestinationSelected = (destinationId: string) => {
    setSelectedDestinationIds((prev) => {
      const next = new Set(prev);
      if (next.has(destinationId)) {
        next.delete(destinationId);
      } else {
        next.add(destinationId);
      }
      return next;
    });
  };

  const closeDrawer = () => {
    setIsOpen(false);
    setSelectedDestinationIds(new Set());
    setBulkActionSummary(null);
    setBulkActionType(null);
    setBulkEmailResults([]);
    setBulkEmailModalOpen(false);
    setBulkErrorNote("");
    setBulkErrorFeedback(null);
    setBulkErrorPromptOpen(false);
  };

  const openBulkErrorPrompt = () => {
    setBulkErrorFeedback(null);
    setBulkErrorNote("");
    setBulkErrorPromptOpen(true);
  };

  const closeBulkErrorPrompt = () => {
    setBulkErrorFeedback(null);
    setBulkErrorNote("");
    setBulkErrorPromptOpen(false);
  };

  const handleBulkGenerateEmails = () => {
    if (pending || isBulkGenerating || selectedEmailCount === 0) return;
    setFeedback(null);
    setBulkActionSummary(null);
    setBulkActionType("generate");
    setBulkEmailResults([]);
    setBulkEmailModalOpen(false);
    startTransition(async () => {
      const results = await runWithConcurrency<
        AdminOpsInboxRow["destinations"][number],
        BulkDestinationEmailResult
      >(
        selectedDestinations,
        BULK_CONCURRENCY_LIMIT,
        async (destination): Promise<BulkDestinationEmailResult> => {
          const providerLabel =
            destination.provider_name || destination.provider_id || "Provider";
          if (
            resolveDispatchModeValue(destination.dispatch_mode, destination.quoting_mode) !==
            "email"
          ) {
            return {
              destinationId: destination.id,
              providerLabel,
              status: "skipped",
              message: "Email mode only.",
            };
          }
          try {
            const result = await generateDestinationEmailAction({
              quoteId: row.quote.id,
              destinationId: destination.id,
            });
            if (result.ok) {
              return {
                destinationId: destination.id,
                providerLabel,
                status: "success",
                message: "Email generated.",
                subject: result.subject,
                body: result.body,
              };
            }
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: result.error,
            };
          } catch (error) {
            console.error("[ops inbox bulk email] action crashed", error);
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: "Email generation failed.",
            };
          }
        },
      );

      setBulkEmailResults(results);
      setBulkEmailModalOpen(true);
      setBulkActionSummary({
        actionLabel: "Generate emails",
        results: results.map(({ subject, body, ...rest }) => rest),
      });
      setBulkActionType(null);
      router.refresh();
    });
  };

  const handleBulkMarkSent = () => {
    if (pending || isBulkMarkingSent || selectedCount === 0) return;
    setFeedback(null);
    setBulkActionSummary(null);
    setBulkActionType("markSent");
    startTransition(async () => {
      const results = await runWithConcurrency<
        AdminOpsInboxRow["destinations"][number],
        BulkActionResult
      >(
        selectedDestinations,
        BULK_CONCURRENCY_LIMIT,
        async (destination): Promise<BulkActionResult> => {
          const providerLabel =
            destination.provider_name || destination.provider_id || "Provider";
          try {
            const result = await updateDestinationStatusAction({
              destinationId: destination.id,
              status: "sent",
            });
            if (result.ok) {
              return {
                destinationId: destination.id,
                providerLabel,
                status: "success",
                message: result.message,
              };
            }
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: result.error,
            };
          } catch (error) {
            console.error("[ops inbox bulk mark sent] action crashed", error);
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: "Update failed.",
            };
          }
        },
      );

      setBulkActionSummary({
        actionLabel: "Mark sent",
        results,
      });
      setBulkActionType(null);
      router.refresh();
    });
  };

  const submitBulkError = () => {
    if (pending || isBulkMarkingError || selectedCount === 0) return;
    setBulkErrorFeedback(null);
    setFeedback(null);
    setBulkActionSummary(null);
    setBulkActionType("markError");
    startTransition(async () => {
      const results = await runWithConcurrency<
        AdminOpsInboxRow["destinations"][number],
        BulkActionResult
      >(
        selectedDestinations,
        BULK_CONCURRENCY_LIMIT,
        async (destination): Promise<BulkActionResult> => {
          const providerLabel =
            destination.provider_name || destination.provider_id || "Provider";
          try {
            const result = await updateDestinationStatusAction({
              destinationId: destination.id,
              status: "error",
              errorMessage: bulkErrorNote.trim(),
            });
            if (result.ok) {
              return {
                destinationId: destination.id,
                providerLabel,
                status: "success",
                message: "Error recorded.",
              };
            }
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: result.error,
            };
          } catch (error) {
            console.error("[ops inbox bulk mark error] action crashed", error);
            return {
              destinationId: destination.id,
              providerLabel,
              status: "error",
              message: "Update failed.",
            };
          }
        },
      );

      setBulkActionSummary({
        actionLabel: "Mark error",
        results,
      });
      setBulkActionType(null);
      closeBulkErrorPrompt();
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
          setSelectedDestinationIds(new Set());
          setBulkActionSummary(null);
          setBulkActionType(null);
          setBulkEmailResults([]);
          setBulkEmailModalOpen(false);
          setBulkErrorNote("");
          setBulkErrorFeedback(null);
          setBulkErrorPromptOpen(false);
          setIsOpen(true);
        }}
        className={clsx(actionClassName, "cursor-pointer")}
      >
        Dispatch
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 px-4 py-6">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close dispatch drawer"
            onClick={closeDrawer}
          />
          <aside className="relative flex h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-900/70 bg-slate-950/95 shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-900/60 px-5 py-4">
              <div className="flex flex-col">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Dispatch drawer
                </p>
                <Link
                  href={quoteHref}
                  className="text-base font-semibold text-emerald-100 hover:text-emerald-200"
                >
                  {quoteTitle}
                </Link>
                {row.quote.title && row.quote.title.trim() !== row.quote.id ? (
                  <span className="text-xs text-slate-500">{row.quote.id}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href={`${quoteHref}#destinations`}
                  className={clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
                >
                  Full detail
                </Link>
                <button
                  type="button"
                  onClick={closeDrawer}
                  className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-sm text-slate-200">
              {feedback ? (
                <p
                  className={clsx(
                    "rounded-xl border px-3 py-2 text-sm",
                    feedback.tone === "success"
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                      : "border-amber-500/30 bg-amber-500/10 text-amber-100",
                  )}
                  role={feedback.tone === "success" ? "status" : "alert"}
                >
                  {feedback.message}
                </p>
              ) : null}

              <div className="rounded-2xl border border-slate-900/60 bg-slate-950/60 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Bulk actions
                    </p>
                    <p className="text-sm text-slate-200">{selectedCountLabel}</p>
                    {selectedCount > 0 ? (
                      <p className="mt-1 text-xs text-slate-400">
                        {selectedEmailCount} email-mode selected
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleBulkGenerateEmails}
                      disabled={bulkBusy || selectedEmailCount === 0}
                      className={clsx(
                        "rounded-full border border-indigo-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-100 transition",
                        bulkBusy || selectedEmailCount === 0
                          ? "cursor-not-allowed opacity-60"
                          : "hover:border-indigo-400 hover:text-white",
                      )}
                    >
                      {isBulkGenerating ? "Generating..." : "Generate emails"}
                    </button>
                    <button
                      type="button"
                      onClick={handleBulkMarkSent}
                      disabled={bulkBusy || selectedCount === 0}
                      className={clsx(
                        "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition",
                        bulkBusy || selectedCount === 0
                          ? "cursor-not-allowed opacity-60"
                          : "hover:border-slate-500 hover:text-white",
                      )}
                    >
                      {isBulkMarkingSent ? "Marking..." : "Mark sent"}
                    </button>
                    <button
                      type="button"
                      onClick={openBulkErrorPrompt}
                      disabled={bulkBusy || selectedCount === 0}
                      className={clsx(
                        "rounded-full border border-red-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-100 transition",
                        bulkBusy || selectedCount === 0
                          ? "cursor-not-allowed opacity-60"
                          : "hover:border-red-400 hover:text-white",
                      )}
                    >
                      {isBulkMarkingError ? "Saving..." : "Mark error"}
                    </button>
                  </div>
                </div>
                {selectedCount > 0 && selectedEmailCount < selectedCount ? (
                  <p className="mt-2 text-xs text-slate-500">
                    Only email-mode destinations generate drafts.
                  </p>
                ) : null}
              </div>

              {bulkActionSummary ? (
                <div className="rounded-2xl border border-slate-900/60 bg-slate-950/60 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Bulk summary
                      </p>
                      <p className="text-sm font-semibold text-slate-100">
                        {bulkActionSummary.actionLabel}
                      </p>
                      {bulkSummaryCounts ? (
                        <p className="mt-1 text-xs text-slate-400">
                          {bulkSummaryCounts.success} success, {bulkSummaryCounts.error} failed,{" "}
                          {bulkSummaryCounts.skipped} skipped
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setBulkActionSummary(null)}
                      className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto text-xs">
                    {bulkActionSummary.results.map((result) => {
                      const statusLabel =
                        result.status === "success"
                          ? "Success"
                          : result.status === "skipped"
                            ? "Skipped"
                            : "Failed";
                      const statusClass =
                        result.status === "success"
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                          : result.status === "skipped"
                            ? "border-slate-700 bg-slate-900/60 text-slate-200"
                            : "border-amber-500/40 bg-amber-500/10 text-amber-100";
                      return (
                        <div
                          key={result.destinationId}
                          className="flex items-start justify-between gap-3 rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2"
                        >
                          <div>
                            <p className="text-sm font-semibold text-slate-100">
                              {result.providerLabel}
                            </p>
                            <p className="text-xs text-slate-400">{result.message}</p>
                          </div>
                          <span
                            className={clsx(
                              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              statusClass,
                            )}
                          >
                            {statusLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {groupedDestinations.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-400">
                  No destinations yet. Add providers from the quote detail page.
                </p>
              ) : (
                groupedDestinations.map((group) => (
                  <div key={group.status} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {group.status === "unknown"
                          ? "Other"
                          : DESTINATION_STATUS_META[group.status].label}{" "}
                        ({group.destinations.length})
                      </p>
                    </div>
                    <div className="space-y-3">
                      {group.destinations.map((destination) => {
                        const providerLabel =
                          destination.provider_name || destination.provider_id || "Provider";
                        const providerType = formatEnumLabel(destination.provider_type);
                        const providerMode = formatEnumLabel(destination.quoting_mode);
                        const dispatchMode = resolveDispatchModeValue(
                          destination.dispatch_mode,
                          destination.quoting_mode,
                        );
                        const isEmailMode = dispatchMode === "email";
                        const isWebFormMode = dispatchMode === "web_form";
                        const webFormUrl =
                          destination.provider_rfq_url || destination.provider_website || "";
                        const isEmailGenerating = pending && emailLoadingId === destination.id;
                        const isWebFormGenerating = pending && webFormLoadingId === destination.id;
                        const emailError = emailErrorsById[destination.id];
                        const webFormError = webFormErrorsById[destination.id];
                        const statusKey = normalizeStatus(destination.status);
                        const statusMeta =
                          statusKey === "unknown"
                            ? { label: "Unknown", className: "border-slate-700 bg-slate-900/40 text-slate-200" }
                            : DESTINATION_STATUS_META[statusKey];
                        const offer = offersByProviderId.get(destination.provider_id) ?? null;
                        const offerSummary = offer ? formatOfferSummary(offer) : null;
                        const offerToken =
                          typeof destination.offer_token === "string"
                            ? destination.offer_token.trim()
                            : "";
                        const offerLink = offerToken
                          ? buildPublicUrl(`/provider/offer/${offerToken}`)
                          : "";
                        const copyOfferButtonBaseClass =
                          "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition";
                        const copyOfferButtonEnabledClass = `${copyOfferButtonBaseClass} hover:border-slate-500 hover:text-white`;
                        const copyOfferButtonDisabledClass = `${copyOfferButtonBaseClass} cursor-not-allowed opacity-60`;
                        const needsActionResult = computeDestinationNeedsAction(
                          {
                            status: destination.status,
                            created_at: destination.created_at,
                            last_status_at: destination.last_status_at,
                            sent_at: destination.sent_at,
                            provider_id: destination.provider_id,
                            hasOffer: offerProviderIds.has(destination.provider_id),
                          },
                          new Date(),
                          slaConfig,
                        );
                        const needsActionMeta =
                          needsActionResult.needsAction && needsActionResult.reason
                            ? NEEDS_ACTION_META[needsActionResult.reason]
                            : null;
                        const isSelected = selectedDestinationIds.has(destination.id);

                        return (
                          <div
                            key={destination.id}
                            className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <label className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleDestinationSelected(destination.id)}
                                  disabled={bulkBusy}
                                  aria-label={`Select ${providerLabel} for bulk actions`}
                                  className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                                />
                                <div>
                                  <p className="text-sm font-semibold text-slate-100">
                                    {providerLabel}
                                  </p>
                                  <p className="text-[11px] text-slate-500">
                                    {providerType} · {providerMode}
                                  </p>
                                </div>
                              </label>
                              <div className="flex flex-col items-end gap-2">
                                <span
                                  className={clsx(
                                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                                    statusMeta.className,
                                  )}
                                >
                                  {statusMeta.label}
                                </span>
                                {needsActionMeta ? (
                                  <span className={clsx("pill pill-table", needsActionMeta.className)}>
                                    {needsActionMeta.label}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="mt-2 text-[11px] text-slate-500">
                              Last update:{" "}
                              {formatDateTime(destination.last_status_at, {
                                includeTime: true,
                                fallback: "-",
                              })}
                            </div>
                            {destination.error_message ? (
                              <p className="mt-2 text-[11px] text-red-200">
                                Error: {destination.error_message}
                              </p>
                            ) : null}
                            <div className="mt-2 text-[11px] text-slate-400">
                              {offerSummary ?? "No offer yet"}
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {isEmailMode ? (
                                <button
                                  type="button"
                                  onClick={() => handleGenerateEmail(destination)}
                                  disabled={pending || isEmailGenerating}
                                  className={clsx(
                                    "rounded-full border border-indigo-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-100 transition",
                                    pending || isEmailGenerating
                                      ? "cursor-not-allowed opacity-60"
                                      : "hover:border-indigo-400 hover:text-white",
                                  )}
                                >
                                  {isEmailGenerating ? "Generating..." : "Generate Email"}
                                </button>
                              ) : null}
                              {isWebFormMode ? (
                                webFormUrl ? (
                                  <a
                                    href={webFormUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={copyOfferButtonEnabledClass}
                                  >
                                    Open RFQ page
                                  </a>
                                ) : (
                                  <span title="RFQ URL unavailable." className="inline-flex">
                                    <button
                                      type="button"
                                      disabled
                                      className={copyOfferButtonDisabledClass}
                                    >
                                      Open RFQ page
                                    </button>
                                  </span>
                                )
                              ) : null}
                              {isWebFormMode ? (
                                <button
                                  type="button"
                                  onClick={() => handleGenerateWebFormInstructions(destination)}
                                  disabled={pending || isWebFormGenerating}
                                  className={clsx(
                                    "rounded-full border border-indigo-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-100 transition",
                                    pending || isWebFormGenerating
                                      ? "cursor-not-allowed opacity-60"
                                      : "hover:border-indigo-400 hover:text-white",
                                  )}
                                >
                                  {isWebFormGenerating ? "Generating..." : "Generate RFQ Instructions"}
                                </button>
                              ) : null}
                              {offerToken ? (
                                <CopyTextButton
                                  text={offerLink}
                                  idleLabel="Copy Offer Link"
                                  className={copyOfferButtonEnabledClass}
                                />
                              ) : (
                                <span title="Token unavailable." className="inline-flex">
                                  <button
                                    type="button"
                                    disabled
                                    className={copyOfferButtonDisabledClass}
                                  >
                                    Copy Offer Link
                                  </button>
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => handleStatusUpdate(destination.id, "sent")}
                                disabled={pending}
                                className={clsx(
                                  "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition",
                                  pending
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:border-slate-500 hover:text-white",
                                )}
                              >
                                Mark Sent
                              </button>
                              <button
                                type="button"
                                onClick={() => openOfferModal(destination)}
                                disabled={pending}
                                className={clsx(
                                  "rounded-full border border-emerald-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-100 transition",
                                  pending
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:border-emerald-400 hover:text-white",
                                )}
                              >
                                Add / Edit Offer
                              </button>
                              <button
                                type="button"
                                onClick={() => openErrorPrompt(destination)}
                                disabled={pending}
                                className={clsx(
                                  "rounded-full border border-red-500/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-red-100 transition",
                                  pending
                                    ? "cursor-not-allowed opacity-60"
                                    : "hover:border-red-400 hover:text-white",
                                )}
                              >
                                Mark Error
                              </button>
                              {emailError ? (
                                <p className="basis-full text-xs text-amber-200" role="alert">
                                  {emailError}
                                </p>
                              ) : null}
                              {webFormError ? (
                                <p className="basis-full text-xs text-amber-200" role="alert">
                                  {webFormError}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <OfferModal
        isOpen={Boolean(offerDestination)}
        providerLabel={
          offerDestination
            ? offerDestination.provider_name || offerDestination.provider_id
            : "Provider"
        }
        offerDraft={offerDraft}
        offerFieldErrors={offerFieldErrors}
        offerError={offerError}
        pending={pending}
        onClose={closeOfferModal}
        onChange={updateOfferField}
        onSubmit={submitOffer}
      />

      <DestinationEmailModal
        isOpen={Boolean(emailDestination && emailPackage)}
        providerLabel={
          emailDestination
            ? emailDestination.provider_name || emailDestination.provider_id
            : "Provider"
        }
        subject={emailPackage?.subject ?? ""}
        body={emailPackage?.body ?? ""}
        pending={pending}
        onClose={closeEmailModal}
        onMarkSent={() => {
          if (!emailDestination) return;
          handleStatusUpdate(emailDestination.id, "sent");
        }}
      />

      <DestinationWebFormModal
        isOpen={Boolean(webFormDestination && webFormPackage)}
        providerLabel={
          webFormDestination
            ? webFormDestination.provider_name || webFormDestination.provider_id
            : "Provider"
        }
        url={webFormPackage?.url ?? ""}
        instructions={webFormPackage?.instructions ?? ""}
        pending={pending}
        onClose={closeWebFormModal}
        onMarkSent={() => {
          if (!webFormDestination) return;
          handleStatusUpdate(webFormDestination.id, "sent");
        }}
      />

      <BulkDestinationEmailModal
        isOpen={bulkEmailModalOpen}
        results={bulkEmailResults}
        pending={pending}
        onClose={() => setBulkEmailModalOpen(false)}
      />

      <DestinationErrorModal
        isOpen={Boolean(errorDestination)}
        errorNote={errorNote}
        errorFeedback={errorFeedback}
        pending={pending}
        onClose={closeErrorPrompt}
        onChange={setErrorNote}
        onSubmit={submitError}
      />

      <DestinationErrorModal
        isOpen={bulkErrorPromptOpen}
        errorNote={bulkErrorNote}
        errorFeedback={bulkErrorFeedback}
        pending={pending}
        onClose={closeBulkErrorPrompt}
        onChange={setBulkErrorNote}
        onSubmit={submitBulkError}
        title="Log dispatch errors"
        description="Add one note to apply to all selected destinations."
        submitLabel="Save errors"
      />
    </>
  );
}

function normalizeStatus(value: string | null | undefined): DestinationStatusKey {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "draft" ||
    normalized === "queued" ||
    normalized === "sent" ||
    normalized === "viewed" ||
    normalized === "quoted" ||
    normalized === "declined" ||
    normalized === "error"
  ) {
    return normalized;
  }
  return "unknown";
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await handler(items[currentIndex], currentIndex);
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, Math.max(items.length, 1)) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
