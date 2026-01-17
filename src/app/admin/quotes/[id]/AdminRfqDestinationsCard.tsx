"use client";

import clsx from "clsx";
import { useMemo, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { ProviderRow } from "@/server/providers";
import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";
import {
  addDestinationsAction,
  generateDestinationEmailAction,
  updateDestinationStatusAction,
  upsertRfqOffer,
  type UpsertRfqOfferState,
} from "./actions";
import { ctaSizeClasses, dangerCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import type { RfqOffer } from "@/server/rfqs/offers";
import { CopyTextButton } from "@/components/CopyTextButton";

type AdminRfqDestinationsCardProps = {
  quoteId: string;
  providers: ProviderRow[];
  destinations: RfqDestination[];
  offers: RfqOffer[];
};

type FeedbackTone = "success" | "error";

type FeedbackState = {
  tone: FeedbackTone;
  message: string;
};

type StatusMeta = {
  label: string;
  className: string;
};

type OfferDraft = {
  totalPrice: string;
  unitPrice: string;
  toolingPrice: string;
  shippingPrice: string;
  leadTimeDaysMin: string;
  leadTimeDaysMax: string;
  confidenceScore: string;
  riskFlags: string;
  assumptions: string;
};

const STATUS_META: Record<RfqDestinationStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    className: "border-slate-700 bg-slate-900/40 text-slate-200",
  },
  queued: {
    label: "Queued",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
  },
  sent: {
    label: "Sent",
    className: "border-blue-500/40 bg-blue-500/10 text-blue-100",
  },
  viewed: {
    label: "Viewed",
    className: "border-indigo-500/40 bg-indigo-500/10 text-indigo-100",
  },
  quoted: {
    label: "Quoted",
    className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  },
  declined: {
    label: "Declined",
    className: "border-red-500/40 bg-red-500/10 text-red-100",
  },
  error: {
    label: "Error",
    className: "border-red-500/60 bg-red-500/15 text-red-100",
  },
};

const EMPTY_OFFER_DRAFT: OfferDraft = {
  totalPrice: "",
  unitPrice: "",
  toolingPrice: "",
  shippingPrice: "",
  leadTimeDaysMin: "",
  leadTimeDaysMax: "",
  confidenceScore: "",
  riskFlags: "",
  assumptions: "",
};

const EMPTY_OFFER_STATE: UpsertRfqOfferState = {
  ok: true,
  message: "",
  offerId: "",
};

export function AdminRfqDestinationsCard({
  quoteId,
  providers,
  destinations,
  offers,
}: AdminRfqDestinationsCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [errorDestination, setErrorDestination] = useState<RfqDestination | null>(null);
  const [errorNote, setErrorNote] = useState("");
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);
  const [offerDestination, setOfferDestination] = useState<RfqDestination | null>(null);
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(EMPTY_OFFER_DRAFT);
  const [offerFieldErrors, setOfferFieldErrors] = useState<Record<string, string>>({});
  const [offerError, setOfferError] = useState<string | null>(null);
  const [emailDestination, setEmailDestination] = useState<RfqDestination | null>(null);
  const [emailPackage, setEmailPackage] = useState<{ subject: string; body: string } | null>(null);
  const [emailLoadingId, setEmailLoadingId] = useState<string | null>(null);
  const [emailErrorsById, setEmailErrorsById] = useState<Record<string, string>>({});

  const providerById = useMemo(() => {
    const map = new Map<string, ProviderRow>();
    for (const provider of providers) {
      map.set(provider.id, provider);
    }
    return map;
  }, [providers]);

  const offersByProviderId = useMemo(() => {
    const map = new Map<string, RfqOffer>();
    for (const offer of offers) {
      map.set(offer.provider_id, offer);
    }
    return map;
  }, [offers]);

  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selections = Array.from(event.target.selectedOptions).map((option) => option.value);
    setSelectedProviderIds(selections);
  };

  const handleAddDestinations = () => {
    if (selectedProviderIds.length === 0 || pending) return;
    setFeedback(null);
    startTransition(async () => {
      const result = await addDestinationsAction({
        quoteId,
        providerIds: selectedProviderIds,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        setSelectedProviderIds([]);
        router.refresh();
        return;
      }
      setFeedback({ tone: "error", message: result.error });
    });
  };

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

  const openOfferModal = (destination: RfqDestination) => {
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
      const result = await upsertRfqOffer(quoteId, EMPTY_OFFER_STATE, formData);
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

  const openErrorPrompt = (destination: RfqDestination) => {
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

  const openEmailModal = (destination: RfqDestination, subject: string, body: string) => {
    setEmailDestination(destination);
    setEmailPackage({ subject, body });
  };

  const closeEmailModal = () => {
    setEmailDestination(null);
    setEmailPackage(null);
  };

  const handleGenerateEmail = (destination: RfqDestination) => {
    if (pending) return;
    setEmailErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setEmailDestination(null);
    setEmailPackage(null);
    setEmailLoadingId(destination.id);
    startTransition(async () => {
      const result = await generateDestinationEmailAction({
        quoteId,
        destinationId: destination.id,
      });
      if (result.ok) {
        openEmailModal(destination, result.subject, result.body);
      } else {
        setEmailErrorsById((prev) => ({ ...prev, [destination.id]: result.error }));
      }
      setEmailLoadingId(null);
    });
  };

  const selectedCountLabel =
    selectedProviderIds.length > 0
      ? `${selectedProviderIds.length} selected`
      : "No providers selected";

  const destinationsCountLabel = `${destinations.length} destination${
    destinations.length === 1 ? "" : "s"
  }`;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Provider picker
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Add active providers as destinations for this RFQ.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAddDestinations}
            disabled={pending || selectedProviderIds.length === 0}
            className={clsx(
              secondaryCtaClasses,
              ctaSizeClasses.sm,
              pending || selectedProviderIds.length === 0 ? "cursor-not-allowed opacity-60" : null,
            )}
          >
            {pending ? "Adding..." : "Add destinations"}
          </button>
        </div>

        <div className="mt-3 grid gap-2">
          {providers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
              No active providers available.
            </p>
          ) : (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Active providers
              </label>
              <select
                multiple
                value={selectedProviderIds}
                onChange={handleProviderChange}
                className="min-h-[140px] w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                {providers.map((provider) => {
                  const typeLabel = formatEnumLabel(provider.provider_type);
                  const modeLabel = formatEnumLabel(provider.quoting_mode);
                  return (
                    <option key={provider.id} value={provider.id}>
                      {provider.name} ({typeLabel}, {modeLabel})
                    </option>
                  );
                })}
              </select>
              <p className="text-xs text-slate-500">{selectedCountLabel}</p>
            </>
          )}
        </div>

        {feedback ? (
          <p
            className={clsx(
              "mt-3 text-sm",
              feedback.tone === "success" ? "text-emerald-200" : "text-amber-200",
            )}
            role={feedback.tone === "success" ? "status" : "alert"}
          >
            {feedback.message}
          </p>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
        <div className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Destinations
          </p>
          <span className="text-xs text-slate-400">{destinationsCountLabel}</span>
        </div>
        {destinations.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-400">
            No destinations yet. Use the picker above to add providers.
          </div>
        ) : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-950/40">
              <tr>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Provider
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Type
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Mode
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Status
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Sent At
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Last Update
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Offer
                </th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60">
              {destinations.map((destination) => {
                const provider =
                  destination.provider ?? providerById.get(destination.provider_id) ?? null;
                const providerName = provider?.name ?? destination.provider_id;
                const providerType = formatEnumLabel(provider?.provider_type);
                const providerMode = formatEnumLabel(provider?.quoting_mode);
                const isEmailMode = provider?.quoting_mode === "email";
                const isEmailGenerating = pending && emailLoadingId === destination.id;
                const emailError = emailErrorsById[destination.id];
                const statusMeta = STATUS_META[destination.status] ?? STATUS_META.draft;
                const sentAtLabel = formatDateTime(destination.sent_at, {
                  includeTime: true,
                  fallback: "-",
                });
                const lastUpdateLabel = formatDateTime(destination.last_status_at, {
                  includeTime: true,
                  fallback: "-",
                });
                const offer = offersByProviderId.get(destination.provider_id) ?? null;
                const offerSummary = offer ? formatOfferSummary(offer) : null;
                return (
                  <tr key={destination.id}>
                    <td className="px-4 py-2 align-top font-medium text-slate-100">
                      {providerName}
                    </td>
                    <td className="px-4 py-2 align-top text-slate-300">{providerType}</td>
                    <td className="px-4 py-2 align-top text-slate-300">{providerMode}</td>
                    <td className="px-4 py-2 align-top">
                      <div className="flex flex-col gap-1">
                        <span
                          className={clsx(
                            "inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                            statusMeta.className,
                          )}
                        >
                          {statusMeta.label}
                        </span>
                        {destination.status === "error" && destination.error_message ? (
                          <p className="text-[11px] text-red-200">{destination.error_message}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2 align-top text-slate-300">{sentAtLabel}</td>
                    <td className="px-4 py-2 align-top text-slate-300">{lastUpdateLabel}</td>
                    <td className="px-4 py-2 align-top">
                      {offerSummary ? (
                        <p className="text-xs text-slate-200">{offerSummary}</p>
                      ) : (
                        <p className="text-xs text-slate-500">No offer yet</p>
                      )}
                    </td>
                    <td className="px-4 py-2 align-top">
                      <div className="flex flex-wrap gap-2">
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
                            {isEmailGenerating ? "Generating..." : "Generate RFQ Email"}
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
                          onClick={() => handleStatusUpdate(destination.id, "quoted")}
                          disabled={pending}
                          className={clsx(
                            "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition",
                            pending
                              ? "cursor-not-allowed opacity-60"
                              : "hover:border-slate-500 hover:text-white",
                          )}
                        >
                          Mark Quoted
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStatusUpdate(destination.id, "declined")}
                          disabled={pending}
                          className={clsx(
                            "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition",
                            pending
                              ? "cursor-not-allowed opacity-60"
                              : "hover:border-slate-500 hover:text-white",
                          )}
                        >
                          Mark Declined
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {offerDestination ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Add or edit offer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeOfferModal();
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Add offer details</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Capture normalized pricing and lead time for{" "}
                  <span className="font-semibold text-slate-100">
                    {providerById.get(offerDestination.provider_id)?.name ??
                      offerDestination.provider_id}
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={closeOfferModal}
                className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={offerDraft.totalPrice}
                    onChange={(event) => updateOfferField("totalPrice", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.totalPrice ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.totalPrice}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Unit price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={offerDraft.unitPrice}
                    onChange={(event) => updateOfferField("unitPrice", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.unitPrice ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.unitPrice}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Tooling price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={offerDraft.toolingPrice}
                    onChange={(event) => updateOfferField("toolingPrice", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.toolingPrice ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.toolingPrice}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Shipping price
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={offerDraft.shippingPrice}
                    onChange={(event) => updateOfferField("shippingPrice", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.shippingPrice ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.shippingPrice}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lead time min days
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={offerDraft.leadTimeDaysMin}
                    onChange={(event) => updateOfferField("leadTimeDaysMin", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.leadTimeDaysMin ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.leadTimeDaysMin}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Lead time max days
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    step={1}
                    value={offerDraft.leadTimeDaysMax}
                    onChange={(event) => updateOfferField("leadTimeDaysMax", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0"
                  />
                  {offerFieldErrors.leadTimeDaysMax ? (
                    <p className="text-xs text-amber-200">{offerFieldErrors.leadTimeDaysMax}</p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Confidence score
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={offerDraft.confidenceScore}
                    onChange={(event) => updateOfferField("confidenceScore", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="0-100"
                  />
                  {offerFieldErrors.confidenceScore ? (
                    <p className="text-xs text-amber-200">
                      {offerFieldErrors.confidenceScore}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Risk flags
                  </label>
                  <input
                    type="text"
                    value={offerDraft.riskFlags}
                    onChange={(event) => updateOfferField("riskFlags", event.target.value)}
                    className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                    placeholder="comma-separated"
                  />
                  <p className="text-xs text-slate-500">
                    Use commas to separate multiple flags.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Assumptions
                </label>
                <textarea
                  value={offerDraft.assumptions}
                  onChange={(event) => updateOfferField("assumptions", event.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                  placeholder="Optional notes about scope, exclusions, or context."
                  maxLength={2000}
                />
              </div>

              {offerError ? (
                <p className="text-sm text-amber-200" role="alert">
                  {offerError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeOfferModal}
                  className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitOffer}
                  disabled={pending}
                  className={clsx(
                    secondaryCtaClasses,
                    ctaSizeClasses.sm,
                    pending ? "cursor-not-allowed opacity-60" : null,
                  )}
                >
                  {pending ? "Saving..." : "Save offer"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {emailDestination && emailPackage ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Generate RFQ email"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEmailModal();
          }}
        >
          <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Outbound RFQ email</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Draft for{" "}
                  <span className="font-semibold text-slate-100">
                    {providerById.get(emailDestination.provider_id)?.name ??
                      emailDestination.provider_id}
                  </span>
                  .
                </p>
              </div>
              <button
                type="button"
                onClick={closeEmailModal}
                className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Subject
                </label>
                <input
                  value={emailPackage.subject}
                  readOnly
                  className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
                />
                <CopyTextButton text={emailPackage.subject} idleLabel="Copy subject" />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Body
                </label>
                <textarea
                  value={emailPackage.body}
                  readOnly
                  rows={12}
                  className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
                />
                <CopyTextButton text={emailPackage.body} idleLabel="Copy body" />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => handleStatusUpdate(emailDestination.id, "sent")}
                  disabled={pending}
                  className={clsx(
                    "rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition",
                    pending
                      ? "cursor-not-allowed opacity-60"
                      : "hover:border-slate-500 hover:text-white",
                  )}
                >
                  Mark Sent
                </button>
                <button
                  type="button"
                  onClick={closeEmailModal}
                  className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {errorDestination ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Mark destination as error"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeErrorPrompt();
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Log dispatch error</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Add a short note for the error status on this destination.
                </p>
              </div>
              <button
                type="button"
                onClick={closeErrorPrompt}
                className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Close
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Error message
              </label>
              <textarea
                value={errorNote}
                onChange={(event) => setErrorNote(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-400 focus:outline-none"
                placeholder="Describe what went wrong with this dispatch..."
                maxLength={1000}
              />
              {errorFeedback ? (
                <p className="text-sm text-amber-200" role="alert">
                  {errorFeedback}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeErrorPrompt}
                  className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitError}
                  disabled={pending}
                  className={clsx(
                    dangerCtaClasses,
                    ctaSizeClasses.sm,
                    pending ? "cursor-not-allowed opacity-60" : null,
                  )}
                >
                  {pending ? "Saving..." : "Save error"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatEnumLabel(value?: string | null): string {
  if (!value) return "-";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "-";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}

function buildOfferDraft(offer: RfqOffer | null): OfferDraft {
  if (!offer) {
    return { ...EMPTY_OFFER_DRAFT };
  }
  return {
    ...EMPTY_OFFER_DRAFT,
    totalPrice: formatDraftValue(offer.total_price),
    unitPrice: formatDraftValue(offer.unit_price),
    toolingPrice: formatDraftValue(offer.tooling_price),
    shippingPrice: formatDraftValue(offer.shipping_price),
    leadTimeDaysMin: formatDraftValue(offer.lead_time_days_min),
    leadTimeDaysMax: formatDraftValue(offer.lead_time_days_max),
    confidenceScore: formatDraftValue(offer.confidence_score),
    riskFlags: Array.isArray(offer.quality_risk_flags)
      ? offer.quality_risk_flags.join(", ")
      : "",
    assumptions: offer.assumptions ?? "",
  };
}

function formatDraftValue(value: number | string | null | undefined): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }
  return "";
}

function formatOfferSummary(offer: RfqOffer): string {
  const parts: string[] = [];
  const currency = offer.currency ?? "USD";
  const total = toFiniteNumber(offer.total_price);
  const unit = toFiniteNumber(offer.unit_price);
  if (typeof total === "number") {
    parts.push(`Total ${formatCurrency(total, currency)}`);
  } else if (typeof unit === "number") {
    parts.push(`Unit ${formatCurrency(unit, currency)}`);
  }

  const leadTimeLabel = formatLeadTimeSummary(
    offer.lead_time_days_min,
    offer.lead_time_days_max,
  );
  if (leadTimeLabel) {
    parts.push(leadTimeLabel);
  }

  if (typeof offer.confidence_score === "number") {
    parts.push(`Confidence ${offer.confidence_score}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "Offer saved";
}

function formatLeadTimeSummary(
  minDays: number | null,
  maxDays: number | null,
): string | null {
  if (typeof minDays === "number" && typeof maxDays === "number") {
    return `${minDays}-${maxDays} days`;
  }
  if (typeof minDays === "number") {
    return `${minDays}+ days`;
  }
  if (typeof maxDays === "number") {
    return `Up to ${maxDays} days`;
  }
  return null;
}

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
