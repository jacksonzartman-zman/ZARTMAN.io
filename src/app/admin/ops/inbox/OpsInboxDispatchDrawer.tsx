"use client";

import clsx from "clsx";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/formatDate";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { computeDestinationNeedsAction } from "@/lib/ops/sla";
import {
  DESTINATION_STATUS_META,
  EMPTY_OFFER_DRAFT,
  buildOfferDraft,
  formatEnumLabel,
  formatOfferSummary,
  type OfferDraft,
} from "@/components/admin/rfq/destinationHelpers";
import {
  DestinationEmailModal,
  DestinationErrorModal,
  OfferModal,
} from "@/components/admin/rfq/destinationModals";
import type { RfqOffer } from "@/server/rfqs/offers";
import type { RfqDestinationStatus } from "@/server/rfqs/destinations";
import type { AdminOpsInboxRow } from "@/server/ops/inbox";
import {
  generateDestinationEmailAction,
  updateDestinationStatusAction,
  upsertRfqOffer,
  type UpsertRfqOfferState,
} from "@/app/admin/quotes/[id]/actions";

type OpsInboxDispatchDrawerProps = {
  row: AdminOpsInboxRow;
  actionClassName: string;
};

type FeedbackTone = "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

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

export function OpsInboxDispatchDrawer({ row, actionClassName }: OpsInboxDispatchDrawerProps) {
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

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setFeedback(null);
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
            onClick={() => setIsOpen(false)}
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
                  onClick={() => setIsOpen(false)}
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
                        const isEmailMode = destination.quoting_mode === "email";
                        const isEmailGenerating = pending && emailLoadingId === destination.id;
                        const emailError = emailErrorsById[destination.id];
                        const statusKey = normalizeStatus(destination.status);
                        const statusMeta =
                          statusKey === "unknown"
                            ? { label: "Unknown", className: "border-slate-700 bg-slate-900/40 text-slate-200" }
                            : DESTINATION_STATUS_META[statusKey];
                        const offer = offersByProviderId.get(destination.provider_id) ?? null;
                        const offerSummary = offer ? formatOfferSummary(offer) : null;
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
                        );
                        const needsActionMeta =
                          needsActionResult.needsAction && needsActionResult.reason
                            ? NEEDS_ACTION_META[needsActionResult.reason]
                            : null;

                        return (
                          <div
                            key={destination.id}
                            className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div>
                                <p className="text-sm font-semibold text-slate-100">
                                  {providerLabel}
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  {providerType} · {providerMode}
                                </p>
                              </div>
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

      <DestinationErrorModal
        isOpen={Boolean(errorDestination)}
        errorNote={errorNote}
        errorFeedback={errorFeedback}
        pending={pending}
        onClose={closeErrorPrompt}
        onChange={setErrorNote}
        onSubmit={submitError}
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
