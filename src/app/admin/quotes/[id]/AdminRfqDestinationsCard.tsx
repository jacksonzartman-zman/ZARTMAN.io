"use client";

import clsx from "clsx";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";
import type { ProviderContactRow, ProviderEmailColumn } from "@/server/providers";
import type { EligibleProvidersForQuoteResult } from "@/server/providers/eligibility";
import type { RfqDestination, RfqDestinationStatus } from "@/server/rfqs/destinations";
import {
  addDestinationsAction,
  generateDestinationEmailAction,
  generateDestinationWebFormInstructionsAction,
  markDestinationSubmittedAction,
  updateDestinationStatusAction,
  upsertRfqOffer,
  type UpsertRfqOfferState,
} from "./actions";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatRelativeTimeFromTimestamp, toTimestamp } from "@/lib/relativeTime";
import type { RfqOffer } from "@/server/rfqs/offers";
import {
  EMPTY_OFFER_DRAFT,
  buildOfferDraft,
  formatEnumLabel,
  formatOfferSummary,
  type OfferDraft,
} from "@/components/admin/rfq/destinationHelpers";
import { scoreOfferCompleteness } from "@/lib/aggregator/scoring";
import {
  DestinationErrorModal,
  DestinationMismatchOverrideModal,
  DestinationSubmittedModal,
  OfferModal,
  type DestinationMismatchOverrideItem,
} from "@/components/admin/rfq/destinationModals";
import { DispatchActions } from "@/components/admin/rfq/DispatchActions";
import { DispatchCard } from "@/components/admin/rfq/DispatchCard";
import { CopyTextButton } from "@/components/CopyTextButton";
import { buildMailtoUrl } from "@/lib/adapters/mailtoAdapter";
import { buildPublicUrl } from "@/lib/publicUrl";
import {
  getDestinationDispatchReadiness,
  resolveEffectiveDispatchMode,
  type EffectiveDispatchMode,
} from "@/lib/ops/dispatchReadiness";
import { recordDispatchStarted } from "@/lib/ops/dispatchStartedClient";
import { deriveProviderQuoteMismatch } from "@/lib/provider/quoteMismatch";

type AdminRfqDestinationsCardProps = {
  quoteId: string;
  providers: ProviderContactRow[];
  destinations: RfqDestination[];
  offers: RfqOffer[];
  providerEmailColumn?: ProviderEmailColumn | null;
  providerEligibility?: EligibleProvidersForQuoteResult | null;
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

const isVerifiedActiveProvider = (provider: ProviderContactRow) =>
  provider.is_active && provider.verification_status === "verified";

export function AdminRfqDestinationsCard({
  quoteId,
  providers,
  destinations,
  offers,
  providerEmailColumn,
  providerEligibility,
}: AdminRfqDestinationsCardProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selectedProviderIds, setSelectedProviderIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [errorDestination, setErrorDestination] = useState<RfqDestination | null>(null);
  const [errorNote, setErrorNote] = useState("");
  const [errorFeedback, setErrorFeedback] = useState<string | null>(null);
  const [submittedDestination, setSubmittedDestination] = useState<RfqDestination | null>(null);
  const [submittedNotes, setSubmittedNotes] = useState("");
  const [submittedFeedback, setSubmittedFeedback] = useState<string | null>(null);
  const [submittedDispatchMode, setSubmittedDispatchMode] =
    useState<EffectiveDispatchMode | null>(null);
  const [mismatchOverrideItems, setMismatchOverrideItems] = useState<
    DestinationMismatchOverrideItem[]
  >([]);
  const [mismatchOverrideReason, setMismatchOverrideReason] = useState("");
  const [mismatchOverrideError, setMismatchOverrideError] = useState<string | null>(null);
  const [mismatchOverrideOpen, setMismatchOverrideOpen] = useState(false);
  const [offerDestination, setOfferDestination] = useState<RfqDestination | null>(null);
  const [offerDraft, setOfferDraft] = useState<OfferDraft>(EMPTY_OFFER_DRAFT);
  const [offerFieldErrors, setOfferFieldErrors] = useState<Record<string, string>>({});
  const [offerError, setOfferError] = useState<string | null>(null);
  const [dispatchStartedById, setDispatchStartedById] = useState<Record<string, string>>({});
  const [emailPackagesById, setEmailPackagesById] = useState<
    Record<string, { subject: string; body: string }>
  >({});
  const [emailLoadingId, setEmailLoadingId] = useState<string | null>(null);
  const [emailErrorsById, setEmailErrorsById] = useState<Record<string, string>>({});
  const [webFormPackagesById, setWebFormPackagesById] = useState<
    Record<string, { url: string; instructions: string }>
  >({});
  const [webFormLoadingId, setWebFormLoadingId] = useState<string | null>(null);
  const [webFormErrorsById, setWebFormErrorsById] = useState<Record<string, string>>({});
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [includeUnverifiedProviders, setIncludeUnverifiedProviders] = useState(false);

  const providerById = useMemo(() => {
    const map = new Map<string, ProviderContactRow>();
    for (const provider of providers) {
      map.set(provider.id, provider);
    }
    return map;
  }, [providers]);

  const offersByProviderId = useMemo(() => {
    const map = new Map<string, RfqOffer>();
    for (const offer of offers) {
      if (typeof offer.provider_id === "string" && offer.provider_id.trim()) {
        map.set(offer.provider_id, offer);
      }
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

  const eligibilityRankById = useMemo(() => {
    const map = new Map<string, number>();
    (providerEligibility?.rankedProviderIds ?? []).forEach((providerId, index) => {
      if (providerId) {
        map.set(providerId, index);
      }
    });
    return map;
  }, [providerEligibility]);

  const eligibleProviderIds = useMemo(() => {
    return new Set(providerEligibility?.eligibleProviderIds ?? []);
  }, [providerEligibility]);

  const hasEligibilityCriteria = Boolean(
    providerEligibility?.criteria?.process ||
      providerEligibility?.criteria?.shipToState ||
      providerEligibility?.criteria?.shipToCountry,
  );

  const mismatchByProviderId = useMemo(() => {
    const quoteProcess = providerEligibility?.criteria?.process ?? null;
    const map = new Map<string, ReturnType<typeof deriveProviderQuoteMismatch>>();
    for (const provider of providers) {
      map.set(
        provider.id,
        deriveProviderQuoteMismatch({
          quoteProcess,
          quoteMaterialRequirements: null,
          providerProcesses: provider.processes ?? null,
          providerMaterials: provider.materials ?? null,
        }),
      );
    }
    return map;
  }, [providerEligibility?.criteria?.process, providers]);

  const mismatchedProviderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [providerId, mismatch] of mismatchByProviderId.entries()) {
      if (mismatch.isMismatch) {
        ids.add(providerId);
      }
    }
    return ids;
  }, [mismatchByProviderId]);

  const sortByEligibility = useCallback(
    (list: ProviderContactRow[]) => {
      return [...list].sort((a, b) => {
        const rankA = eligibilityRankById.get(a.id);
        const rankB = eligibilityRankById.get(b.id);
        if (typeof rankA === "number" || typeof rankB === "number") {
          const normalizedA = typeof rankA === "number" ? rankA : Number.MAX_SAFE_INTEGER;
          const normalizedB = typeof rankB === "number" ? rankB : Number.MAX_SAFE_INTEGER;
          if (normalizedA !== normalizedB) return normalizedA - normalizedB;
        }
        const nameDiff = a.name.localeCompare(b.name);
        if (nameDiff !== 0) return nameDiff;
        return a.id.localeCompare(b.id);
      });
    },
    [eligibilityRankById],
  );

  const sortedVerifiedProviders = useMemo(
    () => sortByEligibility(verifiedActiveProviders),
    [sortByEligibility, verifiedActiveProviders],
  );

  const sortedReviewProviders = useMemo(
    () => sortByEligibility(reviewProviders),
    [reviewProviders, sortByEligibility],
  );

  const showEligibleOnly = hasEligibilityCriteria && !showAllProviders;

  const visibleVerifiedProviders = useMemo(() => {
    const base = showEligibleOnly
      ? sortedVerifiedProviders.filter((provider) => eligibleProviderIds.has(provider.id))
      : sortedVerifiedProviders;
    return showAllProviders ? base : base.filter((provider) => !mismatchedProviderIds.has(provider.id));
  }, [
    eligibleProviderIds,
    mismatchedProviderIds,
    showAllProviders,
    showEligibleOnly,
    sortedVerifiedProviders,
  ]);

  const visibleReviewProviders = useMemo(() => {
    if (!includeUnverifiedProviders) return [];
    const base = showEligibleOnly
      ? sortedReviewProviders.filter((provider) => eligibleProviderIds.has(provider.id))
      : sortedReviewProviders;
    return showAllProviders ? base : base.filter((provider) => !mismatchedProviderIds.has(provider.id));
  }, [
    eligibleProviderIds,
    includeUnverifiedProviders,
    mismatchedProviderIds,
    showAllProviders,
    showEligibleOnly,
    sortedReviewProviders,
  ]);

  const visibleProviders = useMemo(() => {
    return includeUnverifiedProviders
      ? [...visibleVerifiedProviders, ...visibleReviewProviders]
      : visibleVerifiedProviders;
  }, [includeUnverifiedProviders, visibleReviewProviders, visibleVerifiedProviders]);

  const visibleProviderIds = useMemo(() => {
    return new Set(visibleProviders.map((provider) => provider.id));
  }, [visibleProviders]);

  useEffect(() => {
    setSelectedProviderIds((prev) => prev.filter((id) => visibleProviderIds.has(id)));
  }, [visibleProviderIds]);

  const handleProviderChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const selections = Array.from(event.target.selectedOptions).map((option) => option.value);
    setSelectedProviderIds(selections);
  };

  const handleAddDestinations = () => {
    if (selectedProviderIds.length === 0 || pending) return;
    setFeedback(null);

    const mismatchedSelected = selectedProviderIds.filter((providerId) =>
      mismatchedProviderIds.has(providerId),
    );

    if (mismatchedSelected.length > 0) {
      const items: DestinationMismatchOverrideItem[] = mismatchedSelected.map((providerId) => {
        const provider = providerById.get(providerId);
        const mismatch = mismatchByProviderId.get(providerId);
        return {
          providerId,
          providerLabel: provider?.name ?? providerId,
          mismatchReasonLabels: mismatch?.mismatchReasonLabels ?? ["Mismatch"],
        };
      });
      setMismatchOverrideItems(items);
      setMismatchOverrideReason("");
      setMismatchOverrideError(null);
      setMismatchOverrideOpen(true);
      return;
    }

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

  const closeMismatchOverride = () => {
    setMismatchOverrideOpen(false);
    setMismatchOverrideItems([]);
    setMismatchOverrideReason("");
    setMismatchOverrideError(null);
  };

  const submitMismatchOverride = () => {
    if (selectedProviderIds.length === 0 || pending) return;
    const trimmed = mismatchOverrideReason.trim();
    if (trimmed.length < 5) {
      setMismatchOverrideError("Add at least 5 characters of override reason.");
      return;
    }
    setMismatchOverrideError(null);
    startTransition(async () => {
      const result = await addDestinationsAction({
        quoteId,
        providerIds: selectedProviderIds,
        mismatchOverrideReason: trimmed,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        closeMismatchOverride();
        setSelectedProviderIds([]);
        router.refresh();
        return;
      }
      setMismatchOverrideError(result.error);
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

  const openSubmittedPrompt = (destination: RfqDestination, dispatchMode: EffectiveDispatchMode) => {
    setSubmittedFeedback(null);
    setSubmittedNotes("");
    setSubmittedDestination(destination);
    setSubmittedDispatchMode(dispatchMode);
  };

  const closeSubmittedPrompt = () => {
    setSubmittedFeedback(null);
    setSubmittedNotes("");
    setSubmittedDestination(null);
    setSubmittedDispatchMode(null);
  };

  const submitSubmitted = () => {
    if (!submittedDestination || pending) return;
    const trimmedNotes = submittedNotes.trim();
    const requiresNotes = submittedDispatchMode === "web_form";
    if (requiresNotes && trimmedNotes.length < 5) {
      setSubmittedFeedback("Add at least 5 characters of notes for web form submissions.");
      return;
    }
    setSubmittedFeedback(null);
    startTransition(async () => {
      const result = await markDestinationSubmittedAction({
        destinationId: submittedDestination.id,
        notes: trimmedNotes,
        dispatchMode: submittedDispatchMode ?? undefined,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
        closeSubmittedPrompt();
        router.refresh();
        return;
      }
      setSubmittedFeedback(result.error);
    });
  };

  const handleSubmittedNotesChange = (value: string) => {
    setSubmittedNotes(value);
    if (submittedFeedback) {
      setSubmittedFeedback(null);
    }
  };

  const resolveProviderEmail = useCallback(
    (provider: ProviderContactRow | null | undefined) => {
      if (!provider) return "";
      if (providerEmailColumn === "primary_email" && provider.primary_email) {
        return provider.primary_email.trim();
      }
      if (providerEmailColumn === "email" && provider.email) {
        return provider.email.trim();
      }
      if (providerEmailColumn === "contact_email" && provider.contact_email) {
        return provider.contact_email.trim();
      }
      const fallback = provider.primary_email ?? provider.email ?? provider.contact_email ?? "";
      return typeof fallback === "string" ? fallback.trim() : "";
    },
    [providerEmailColumn],
  );

  const buildEmailCopyText = (subject: string, body: string) => {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    if (trimmedSubject && trimmedBody) {
      return `Subject: ${trimmedSubject}\n\n${trimmedBody}`;
    }
    if (trimmedBody) return trimmedBody;
    if (trimmedSubject) return `Subject: ${trimmedSubject}`;
    return "";
  };

  const handleDispatchStarted = (destinationId: string) => {
    const normalized = destinationId.trim();
    if (!normalized) return;
    setDispatchStartedById((prev) =>
      prev[normalized] ? prev : { ...prev, [normalized]: new Date().toISOString() },
    );
    recordDispatchStarted({ destinationId: normalized, quoteId });
  };

  const loadEmailPackage = async (destination: RfqDestination) => {
    const cached = emailPackagesById[destination.id];
    if (cached) return cached;
    const result = await generateDestinationEmailAction({
      quoteId,
      destinationId: destination.id,
    });
    if (!result.ok) {
      setEmailErrorsById((prev) => ({ ...prev, [destination.id]: result.error }));
      return null;
    }
    const next = { subject: result.subject, body: result.body };
    setEmailPackagesById((prev) => ({ ...prev, [destination.id]: next }));
    return next;
  };

  const loadWebFormPackage = async (destination: RfqDestination) => {
    const cached = webFormPackagesById[destination.id];
    if (cached) return cached;
    const result = await generateDestinationWebFormInstructionsAction({
      destinationId: destination.id,
    });
    if (!result.ok) {
      setWebFormErrorsById((prev) => ({ ...prev, [destination.id]: result.error }));
      return null;
    }
    const next = { url: result.url, instructions: result.instructions };
    setWebFormPackagesById((prev) => ({ ...prev, [destination.id]: next }));
    return next;
  };

  const handleCopyEmail = (destination: RfqDestination) => {
    if (pending) return;
    setFeedback(null);
    setEmailErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setEmailLoadingId(destination.id);
    startTransition(async () => {
      const packageResult = await loadEmailPackage(destination);
      if (!packageResult) {
        setEmailLoadingId(null);
        return;
      }
      const emailText = buildEmailCopyText(packageResult.subject, packageResult.body);
      if (!emailText) {
        setEmailErrorsById((prev) => ({
          ...prev,
          [destination.id]: "Email content was empty.",
        }));
        setEmailLoadingId(null);
        return;
      }
      try {
        await navigator.clipboard.writeText(emailText);
        setFeedback({ tone: "success", message: "Email copied." });
      } catch (error) {
        console.error("[dispatch copy] email copy failed", error);
        setEmailErrorsById((prev) => ({
          ...prev,
          [destination.id]: "Unable to copy email.",
        }));
      }
      setEmailLoadingId(null);
    });
  };

  const handleCopyMailto = (destination: RfqDestination, providerEmail: string) => {
    if (pending || !providerEmail) return;
    setFeedback(null);
    setEmailErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setEmailLoadingId(destination.id);
    startTransition(async () => {
      const packageResult = await loadEmailPackage(destination);
      if (!packageResult) {
        setEmailLoadingId(null);
        return;
      }
      const mailto = buildMailtoUrl({
        to: providerEmail,
        subject: packageResult.subject,
        body: packageResult.body,
      });
      try {
        await navigator.clipboard.writeText(mailto);
        setFeedback({ tone: "success", message: "Mailto link copied." });
      } catch (error) {
        console.error("[dispatch copy] mailto copy failed", error);
        setEmailErrorsById((prev) => ({
          ...prev,
          [destination.id]: "Unable to copy mailto link.",
        }));
      }
      setEmailLoadingId(null);
    });
  };

  const handleCopyWebFormInstructions = (destination: RfqDestination) => {
    if (pending) return;
    setFeedback(null);
    setWebFormErrorsById((prev) => ({ ...prev, [destination.id]: "" }));
    setWebFormLoadingId(destination.id);
    startTransition(async () => {
      const packageResult = await loadWebFormPackage(destination);
      if (!packageResult) {
        setWebFormLoadingId(null);
        return;
      }
      const instructions = packageResult.instructions.trim();
      if (!instructions) {
        setWebFormErrorsById((prev) => ({
          ...prev,
          [destination.id]: "Instructions were empty.",
        }));
        setWebFormLoadingId(null);
        return;
      }
      try {
        await navigator.clipboard.writeText(instructions);
        setFeedback({ tone: "success", message: "Web-form instructions copied." });
      } catch (error) {
        console.error("[dispatch copy] instructions copy failed", error);
        setWebFormErrorsById((prev) => ({
          ...prev,
          [destination.id]: "Unable to copy instructions.",
        }));
      }
      setWebFormLoadingId(null);
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
  const selectedMismatchCount = selectedProviderIds.filter((providerId) =>
    mismatchedProviderIds.has(providerId),
  ).length;
  const selectedMismatchLabel = selectedMismatchCount > 0 ? `${selectedMismatchCount} mismatch` : null;

  const emptyProviderLabel = showEligibleOnly
    ? includeUnverifiedProviders
      ? "No eligible providers available."
      : "No eligible verified providers available."
    : includeUnverifiedProviders
      ? "No providers available."
      : "No verified providers available.";

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
              {emptyProviderLabel}
            </p>
          ) : (
            <>
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {includeUnverifiedProviders ? "Providers" : "Verified providers"}
              </label>
              <select
                multiple
                value={selectedProviderIds}
                onChange={handleProviderChange}
                className="min-h-[140px] w-full rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-emerald-400 focus:outline-none"
              >
                {includeUnverifiedProviders ? (
                  <>
                    {visibleVerifiedProviders.length > 0 ? (
                      <optgroup label="Verified + active">
                        {visibleVerifiedProviders.map((provider) => {
                          const typeLabel = formatEnumLabel(provider.provider_type);
                          const modeLabel = formatEnumLabel(provider.quoting_mode);
                          return (
                            <option key={provider.id} value={provider.id}>
                              {provider.name} ({typeLabel}, {modeLabel})
                              {showAllProviders && mismatchByProviderId.get(provider.id)?.isMismatch
                                ? " — Mismatch"
                                : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    ) : null}
                    {visibleReviewProviders.length > 0 ? (
                      <optgroup label="Needs review">
                        {visibleReviewProviders.map((provider) => {
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
                              {showAllProviders && mismatchByProviderId.get(provider.id)?.isMismatch
                                ? " — Mismatch"
                                : ""}
                            </option>
                          );
                        })}
                      </optgroup>
                    ) : null}
                  </>
                ) : (
                  visibleVerifiedProviders.map((provider) => {
                    const typeLabel = formatEnumLabel(provider.provider_type);
                    const modeLabel = formatEnumLabel(provider.quoting_mode);
                    return (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} ({typeLabel}, {modeLabel})
                        {showAllProviders && mismatchByProviderId.get(provider.id)?.isMismatch
                          ? " — Mismatch"
                          : ""}
                      </option>
                    );
                  })
                )}
              </select>
              <div className="text-xs text-slate-500">
                <p>{selectedCountLabel}</p>
                {selectedNeedsReviewLabel ? <p>{selectedNeedsReviewLabel}</p> : null}
                {selectedMismatchLabel ? <p className="text-amber-200">{selectedMismatchLabel}</p> : null}
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={showAllProviders}
                  onChange={() => setShowAllProviders((prev) => !prev)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                />
                Show all providers
              </label>
              {showEligibleOnly ? (
                <p className="text-xs text-slate-500">
                  Eligible providers match the intake process or ship-to location. Mismatches stay hidden unless “Show all providers” is enabled.
                </p>
              ) : null}
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={includeUnverifiedProviders}
                  onChange={() => setIncludeUnverifiedProviders((prev) => !prev)}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-950/60 text-emerald-500"
                />
                Include unverified or inactive providers
              </label>
              {includeUnverifiedProviders ? (
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
          <div className="space-y-3 px-4 py-4">
            {destinations.map((destination) => {
              const providerRecord = providerById.get(destination.provider_id) ?? null;
              const providerFallback = destination.provider ?? null;
              const providerName =
                providerRecord?.name ?? providerFallback?.name ?? destination.provider_id;
              const providerType = formatEnumLabel(
                providerRecord?.provider_type ?? providerFallback?.provider_type,
              );
              const providerMode = formatEnumLabel(
                providerRecord?.quoting_mode ?? providerFallback?.quoting_mode,
              );
              const providerEmail = resolveProviderEmail(providerRecord);
              const webFormUrl = providerRecord?.rfq_url ?? "";
              const dispatchInput = {
                id: destination.id,
                dispatch_mode: providerRecord?.dispatch_mode ?? null,
                quoting_mode:
                  providerRecord?.quoting_mode ?? providerFallback?.quoting_mode ?? null,
                provider_email: providerEmail,
                provider_rfq_url: providerRecord?.rfq_url ?? null,
              };
              const dispatchReadiness = getDestinationDispatchReadiness(dispatchInput);
              const dispatchMode = resolveEffectiveDispatchMode(dispatchInput);
              const isEmailGenerating = emailLoadingId === destination.id;
              const isWebFormGenerating = webFormLoadingId === destination.id;
              const emailError = emailErrorsById[destination.id];
              const webFormError = webFormErrorsById[destination.id];
              const offer = offersByProviderId.get(destination.provider_id) ?? null;
              const offerSummary = offer ? formatOfferSummary(offer) : null;
              const offerCompletenessWarning = offer ? buildOfferCompletenessWarning(offer) : null;
              const offerToken =
                typeof destination.offer_token === "string" ? destination.offer_token.trim() : "";
              const offerLink = offerToken
                ? buildPublicUrl(`/provider/offer/${offerToken}`)
                : "";
              const dispatchStartedAt =
                dispatchStartedById[destination.id] ?? destination.dispatch_started_at;
              const hasSubmitted = Boolean(destination.submitted_at);
              const hasDispatchStarted = Boolean(dispatchStartedAt);
              const dispatchStatus = offer
                ? "offer_received"
                : hasSubmitted
                  ? "submitted"
                  : hasDispatchStarted
                    ? "in_progress"
                    : "not_started";
              const dispatchStartedLabel = formatDateTime(
                dispatchStartedAt,
                { includeTime: true, fallback: "-" },
              );
              const submittedAtLabel = formatDateTime(destination.submitted_at, {
                includeTime: true,
                fallback: "-",
              });
              const submittedRelativeLabel = formatRelativeTimeFromTimestamp(
                toTimestamp(destination.submitted_at),
              );
              const submittedMetaLabel = hasSubmitted
                ? `Submitted ${submittedRelativeLabel ?? submittedAtLabel}`
                : undefined;
              const lastUpdateLabel = formatDateTime(destination.last_status_at, {
                includeTime: true,
                fallback: "-",
              });
              const copyOfferButtonBase =
                "rounded-full border border-slate-700 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-200 transition";
              const copyOfferButtonEnabledClass = `${copyOfferButtonBase} hover:border-slate-500 hover:text-white`;
              const copyOfferButtonDisabledClass = `${copyOfferButtonBase} cursor-not-allowed opacity-60`;
              const dispatchActions = hasSubmitted ? null : (
                <DispatchActions
                  dispatchMode={dispatchMode}
                  dispatchReadiness={dispatchReadiness}
                  pending={pending}
                  isEmailGenerating={isEmailGenerating}
                  isWebFormGenerating={isWebFormGenerating}
                  providerEmail={providerEmail}
                  webFormUrl={webFormUrl}
                  onCopyEmail={() => handleCopyEmail(destination)}
                  onCopyMailto={() => handleCopyMailto(destination, providerEmail)}
                  onCopyInstructions={() => handleCopyWebFormInstructions(destination)}
                  onMarkSubmitted={() => openSubmittedPrompt(destination, dispatchMode)}
                  onDispatchStarted={() => handleDispatchStarted(destination.id)}
                />
              );

              return (
                <DispatchCard
                  key={destination.id}
                  providerLabel={providerName}
                  providerTypeLabel={providerType}
                  providerModeLabel={providerMode}
                  dispatchMode={dispatchMode}
                  dispatchStatus={dispatchStatus}
                  dispatchStartedLabel={dispatchStartedLabel}
                  submittedLabel={submittedAtLabel}
                  submittedMetaLabel={submittedMetaLabel}
                  lastUpdateLabel={lastUpdateLabel}
                  offerSummary={offerSummary}
                  completenessWarning={offerCompletenessWarning}
                  errorMessage={destination.error_message}
                  primaryAction={dispatchActions}
                  secondaryAction={null}
                  markSubmittedAction={null}
                  extraActions={
                    <>
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
                      {webFormError ? (
                        <p className="basis-full text-xs text-amber-200" role="alert">
                          {webFormError}
                        </p>
                      ) : null}
                    </>
                  }
                />
              );
            })}
          </div>
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

      <DestinationSubmittedModal
        isOpen={Boolean(submittedDestination)}
        providerLabel={
          submittedDestination
            ? providerById.get(submittedDestination.provider_id)?.name ??
              submittedDestination.provider_id
            : "Provider"
        }
        notes={submittedNotes}
        notesError={submittedFeedback}
        requiresNotes={submittedDispatchMode === "web_form"}
        pending={pending}
        onClose={closeSubmittedPrompt}
        onChange={handleSubmittedNotesChange}
        onSubmit={submitSubmitted}
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

      <DestinationMismatchOverrideModal
        isOpen={mismatchOverrideOpen}
        items={mismatchOverrideItems}
        overrideReason={mismatchOverrideReason}
        error={mismatchOverrideError}
        pending={pending}
        onClose={closeMismatchOverride}
        onChange={(value) => {
          setMismatchOverrideReason(value);
          if (mismatchOverrideError) {
            setMismatchOverrideError(null);
          }
        }}
        onSubmit={submitMismatchOverride}
      />
    </div>
  );
}

function buildOfferCompletenessWarning(offer: RfqOffer): string | null {
  const completeness = scoreOfferCompleteness(offer);
  const missingLeadTime = completeness.missing.includes("Missing lead time");
  const missingPrice = !completeness.isActionable;
  if (!missingLeadTime && !missingPrice) {
    return null;
  }
  const missingLabels: string[] = [];
  if (missingPrice) {
    missingLabels.push("price");
  }
  if (missingLeadTime) {
    missingLabels.push("lead time");
  }
  return `Incomplete offer: missing ${missingLabels.join(" and ")}.`;
}

