"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition, type ChangeEvent } from "react";
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
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import type { RfqOffer } from "@/server/rfqs/offers";
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
import { CopyTextButton } from "@/components/CopyTextButton";
import { buildPublicUrl } from "@/lib/publicUrl";

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

const EMPTY_OFFER_STATE: UpsertRfqOfferState = {
  ok: true,
  message: "",
  offerId: "",
};

const isVerifiedActiveProvider = (provider: ProviderRow) =>
  provider.is_active && provider.verification_status === "verified";

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
  const [showAllProviders, setShowAllProviders] = useState(false);

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

  const verifiedActiveProviders = useMemo(
    () => providers.filter((provider) => isVerifiedActiveProvider(provider)),
    [providers],
  );

  const reviewProviders = useMemo(
    () => providers.filter((provider) => !isVerifiedActiveProvider(provider)),
    [providers],
  );

  const visibleProviders = showAllProviders ? providers : verifiedActiveProviders;

  const visibleProviderIds = useMemo(() => {
    return new Set(visibleProviders.map((provider) => provider.id));
  }, [visibleProviders]);

  useEffect(() => {
    if (!showAllProviders) {
      setSelectedProviderIds((prev) => prev.filter((id) => visibleProviderIds.has(id)));
    }
  }, [showAllProviders, visibleProviderIds]);

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
  const selectedNeedsReviewCount = selectedProviderIds.filter((providerId) => {
    const provider = providerById.get(providerId);
    return provider ? !isVerifiedActiveProvider(provider) : false;
  }).length;
  const selectedNeedsReviewLabel =
    selectedNeedsReviewCount > 0
      ? `${selectedNeedsReviewCount} unverified or inactive`
      : null;

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
              Add verified providers as destinations for this RFQ.
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
          {visibleProviders.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
              {showAllProviders ? "No providers available." : "No verified providers available."}
            </p>
          ) : (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {showAllProviders ? "Providers" : "Verified providers"}
              </label>
              <select
                multiple
                value={selectedProviderIds}
                onChange={handleProviderChange}
                className="min-h-[140px] w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                {showAllProviders ? (
                  <>
                    {verifiedActiveProviders.length > 0 ? (
                      <optgroup label="Verified + active">
                        {verifiedActiveProviders.map((provider) => {
                          const typeLabel = formatEnumLabel(provider.provider_type);
                          const modeLabel = formatEnumLabel(provider.quoting_mode);
                          return (
                            <option key={provider.id} value={provider.id}>
                              {provider.name} ({typeLabel}, {modeLabel})
                            </option>
                          );
                        })}
                      </optgroup>
                    ) : null}
                    {reviewProviders.length > 0 ? (
                      <optgroup label="Needs review">
                        {reviewProviders.map((provider) => {
                          const typeLabel = formatEnumLabel(provider.provider_type);
                          const modeLabel = formatEnumLabel(provider.quoting_mode);
                          const statusFlags = [
                            provider.verification_status !== "verified" ? "Unverified" : null,
                            provider.is_active ? null : "Inactive",
                          ].filter(Boolean);
                          const statusNote = statusFlags.length > 0 ? ` — ${statusFlags.join(", ")}` : "";
                          return (
                            <option key={provider.id} value={provider.id}>
                              {provider.name} ({typeLabel}, {modeLabel}){statusNote}
                            </option>
                          );
                        })}
                      </optgroup>
                    ) : null}
                  </>
                ) : (
                  verifiedActiveProviders.map((provider) => {
                    const typeLabel = formatEnumLabel(provider.provider_type);
                    const modeLabel = formatEnumLabel(provider.quoting_mode);
                    return (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} ({typeLabel}, {modeLabel})
                      </option>
                    );
                  })
                )}
              </select>
              <div className="text-xs text-slate-500">
                <p>{selectedCountLabel}</p>
                {selectedNeedsReviewLabel ? <p>{selectedNeedsReviewLabel}</p> : null}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={showAllProviders}
                  onChange={() => setShowAllProviders((prev) => !prev)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                />
                Include unverified or inactive providers
              </label>
              {showAllProviders ? (
                <p className="text-xs text-slate-500">
                  Unverified or inactive providers stay hidden from customers until approved.
                </p>
              ) : null}
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
                const statusMeta =
                  DESTINATION_STATUS_META[destination.status] ?? DESTINATION_STATUS_META.draft;
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
                const offerToken =
                  typeof destination.offer_token === "string" ? destination.offer_token.trim() : "";
                const offerLink = offerToken
                  ? buildPublicUrl(`/provider/offer/${offerToken}`)
                  : "";
                const copyOfferButtonBaseClass =
                  "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition";
                const copyOfferButtonEnabledClass = `${copyOfferButtonBaseClass} hover:border-slate-500 hover:text-white`;
                const copyOfferButtonDisabledClass = `${copyOfferButtonBaseClass} cursor-not-allowed opacity-60`;
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

      <OfferModal
        isOpen={Boolean(offerDestination)}
        providerLabel={
          offerDestination
            ? providerById.get(offerDestination.provider_id)?.name ?? offerDestination.provider_id
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
            ? providerById.get(emailDestination.provider_id)?.name ?? emailDestination.provider_id
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
    </div>
  );
}

