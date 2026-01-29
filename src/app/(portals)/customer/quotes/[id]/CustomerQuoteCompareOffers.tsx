"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TagPill } from "@/components/shared/primitives/TagPill";
import {
  ActionGroup,
  ActionGroupSection,
  ActionPillButton,
} from "@/components/actions/ActionGroup";
import { RequestIntroductionModal } from "./RequestIntroductionModal";
import type { CustomerCompareOffer } from "@/lib/customerTrustBadges";
import {
  awardOfferAction,
  toggleOfferShortlistAction,
  type AwardOfferActionResponse,
} from "./actions";
import {
  INTRO_REQUESTED_EVENT,
  loadIntroRequestedState,
  saveIntroRequestedState,
  type IntroRequestedState,
} from "./introRequestClientState";

type CustomerQuoteCompareOffersProps = {
  quoteId: string;
  offers: CustomerCompareOffer[];
  selectedOfferId?: string | null;
  shortlistedOfferIds?: string[];
  awardLocked?: boolean;
  awardLockedCopy?: string | null;
  introDefaultEmail?: string | null;
  introDefaultCompany?: string | null;
  introShortlistOnlyMode?: boolean;
  initialIntroRequested?: IntroRequestedState | null;
  matchContext?: {
    matchedOnProcess?: boolean;
    locationFilter?: string | null;
  };
};

const SORT_PARAM_KEY = "sort";
const SHORTLIST_PARAM_KEY = "shortlisted";
type SortKey = "bestValue" | "fastest";
type SortDirection = "asc" | "desc";

const SORT_KEYS: SortKey[] = ["bestValue", "fastest"];
const DEFAULT_SORT_KEY: SortKey = "bestValue";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "bestValue", label: "Best value" },
  { value: "fastest", label: "Fastest" },
];

function parseSortKey(value: string | null): SortKey | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return SORT_KEYS.includes(trimmed as SortKey) ? (trimmed as SortKey) : null;
}

function resolveSortKey(value: string | null): SortKey {
  return parseSortKey(value) ?? DEFAULT_SORT_KEY;
}

function parseShortlistedOnly(value: string | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function CustomerQuoteCompareOffers({
  quoteId,
  offers,
  selectedOfferId,
  shortlistedOfferIds: shortlistedOfferIdsProp,
  awardLocked: awardLockedProp,
  awardLockedCopy,
  introDefaultEmail,
  introDefaultCompany,
  introShortlistOnlyMode,
  initialIntroRequested,
  matchContext,
}: CustomerQuoteCompareOffersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingShortlist, startShortlistTransition] = useTransition();
  const [pendingAward, startAwardTransition] = useTransition();
  const [shortlistError, setShortlistError] = useState<string | null>(null);
  const [pendingShortlistOfferId, setPendingShortlistOfferId] = useState<string | null>(null);
  const [pendingAwardOfferId, setPendingAwardOfferId] = useState<string | null>(null);
  const [awardError, setAwardError] = useState<string | null>(null);
  const [awardResult, setAwardResult] = useState<AwardOfferActionResponse | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>(() =>
    resolveSortKey(searchParams.get(SORT_PARAM_KEY)),
  );
  const [showBadgeWinnersOnly, setShowBadgeWinnersOnly] = useState(false);
  const [showShortlistedOnly, setShowShortlistedOnly] = useState(() =>
    parseShortlistedOnly(searchParams.get(SHORTLIST_PARAM_KEY)),
  );
  const [expandedOfferId, setExpandedOfferId] = useState<string | null>(null);
  const [shortlistedOfferIds, setShortlistedOfferIds] = useState<Set<string>>(
    () => new Set(normalizeOfferIds(shortlistedOfferIdsProp)),
  );
  const [selectedOfferIdState, setSelectedOfferIdState] = useState<string | null>(
    () => (typeof selectedOfferId === "string" ? selectedOfferId : null),
  );
  const [introRequested, setIntroRequested] = useState<IntroRequestedState | null>(
    () => initialIntroRequested ?? null,
  );
  const [introModalOpen, setIntroModalOpen] = useState(false);

  const decoratedOffers = useMemo(() => offers, [offers]);

  useEffect(() => {
    const next = typeof selectedOfferId === "string" ? selectedOfferId : null;
    setSelectedOfferIdState((current) => (current === next ? current : next));
  }, [selectedOfferId]);

  const resolvedSelectedOfferId = selectedOfferIdState;
  const awardLocked = Boolean(awardLockedProp);
  const selectionLocked = Boolean(resolvedSelectedOfferId) || awardLocked;
  const hasQuickFilters = showBadgeWinnersOnly || showShortlistedOnly;

  const shortlistedCount = useMemo(() => {
    if (shortlistedOfferIds.size === 0) return 0;
    return decoratedOffers.reduce(
      (count, offer) => (shortlistedOfferIds.has(offer.id) ? count + 1 : count),
      0,
    );
  }, [decoratedOffers, shortlistedOfferIds]);

  useEffect(() => {
    const nextSortKey = resolveSortKey(searchParams.get(SORT_PARAM_KEY));
    setSortKey((current) => (current === nextSortKey ? current : nextSortKey));
  }, [searchParams]);

  useEffect(() => {
    const nextShortlistedOnly = parseShortlistedOnly(searchParams.get(SHORTLIST_PARAM_KEY));
    setShowShortlistedOnly((current) => (current === nextShortlistedOnly ? current : nextShortlistedOnly));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(SORT_PARAM_KEY) === sortKey) return;
    params.set(SORT_PARAM_KEY, sortKey);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, sortKey]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const shouldSet = showShortlistedOnly;
    const currentValue = params.get(SHORTLIST_PARAM_KEY);
    const isSet = parseShortlistedOnly(currentValue);
    if (shouldSet === isSet) return;
    if (shouldSet) {
      params.set(SHORTLIST_PARAM_KEY, "1");
    } else {
      params.delete(SHORTLIST_PARAM_KEY);
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, showShortlistedOnly]);

  useEffect(() => {
    setShortlistedOfferIds(new Set(normalizeOfferIds(shortlistedOfferIdsProp)));
  }, [shortlistedOfferIdsProp]);

  useEffect(() => {
    const stored = loadIntroRequestedState(quoteId);
    if (stored) {
      setIntroRequested(stored);
    } else if (initialIntroRequested) {
      // Seed the session for smoother back/forward navigation.
      saveIntroRequestedState(initialIntroRequested);
    }
  }, [quoteId, initialIntroRequested]);

  useEffect(() => {
    const handler = (event: Event) => {
      const custom = event as CustomEvent<IntroRequestedState>;
      if (!custom?.detail) return;
      if (custom.detail.quoteId !== quoteId) return;
      setIntroRequested(custom.detail);
    };
    window.addEventListener(INTRO_REQUESTED_EVENT, handler);
    return () => window.removeEventListener(INTRO_REQUESTED_EVENT, handler);
  }, [quoteId]);

  const handleShortlistToggle = useCallback(
    (offerId: string) => {
      if (awardLocked) return;
      if (pendingShortlistOfferId) return;
      const wasShortlisted = shortlistedOfferIds.has(offerId);
      const nextShortlisted = !wasShortlisted;

      setShortlistError(null);
      setShortlistedOfferIds((prev) => {
        const next = new Set(prev);
        if (nextShortlisted) {
          next.add(offerId);
        } else {
          next.delete(offerId);
        }
        return next;
      });

      setPendingShortlistOfferId(offerId);
      startShortlistTransition(async () => {
        try {
          const result = await toggleOfferShortlistAction({
            quoteId,
            offerId,
            shortlisted: nextShortlisted,
          });
          if (!result.ok) {
            setShortlistError(
              result.error ?? "We couldn’t update your shortlist. Please try again.",
            );
            setShortlistedOfferIds((prev) => {
              const next = new Set(prev);
              if (wasShortlisted) {
                next.add(offerId);
              } else {
                next.delete(offerId);
              }
              return next;
            });
          }
        } finally {
          setPendingShortlistOfferId(null);
        }
      });
    },
    [
      awardLocked,
      pendingShortlistOfferId,
      quoteId,
      shortlistedOfferIds,
      startShortlistTransition,
    ],
  );

  const handleAwardOffer = useCallback(
    (offerId: string) => {
      if (awardLocked) return;
      if (!offerId) return;
      if (pendingAwardOfferId) return;

      setAwardError(null);
      setAwardResult(null);
      setPendingAwardOfferId(offerId);
      startAwardTransition(async () => {
        try {
          const result = await awardOfferAction({ rfqId: quoteId, offerId });
          setAwardResult(result);
          if (result.ok) {
            setSelectedOfferIdState(offerId);
            router.refresh();
          } else {
            setAwardError(result.error ?? "We couldn’t record that selection. Please try again.");
          }
        } finally {
          setPendingAwardOfferId(null);
        }
      });
    },
    [awardLocked, pendingAwardOfferId, quoteId, router, startAwardTransition],
  );

  const filteredOffers = useMemo(() => {
    let next = decoratedOffers;
    if (showBadgeWinnersOnly) {
      // "Badge picks" should highlight decision-support badges (not baseline verification).
      next = next.filter((offer) => offer.trustBadges.some((badge) => badge.highlight));
    }
    if (showShortlistedOnly) {
      next = next.filter((offer) => shortlistedOfferIds.has(offer.id));
    }
    return next;
  }, [decoratedOffers, showBadgeWinnersOnly, showShortlistedOnly, shortlistedOfferIds]);

  const sortedOffers = useMemo(() => {
    const sorted = [...filteredOffers];
    sorted.sort((a, b) => compareOffers(a, b, sortKey));
    return sorted;
  }, [filteredOffers, sortKey]);

  if (offers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-5">
      {awardLocked ? (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          <p className="font-semibold text-white">Awarded supplier selected.</p>
          <p className="mt-1 text-xs text-emerald-100/80">
            {awardLockedCopy ??
              "Offers are shown for reference. To make changes, contact your awarded supplier in Messages."}
          </p>
        </div>
      ) : null}
      {introRequested ? (
        <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0">
            Introduction requested to{" "}
            <span className="font-semibold text-white">{introRequested.supplierName}</span>. We’ll
            connect you shortly.
          </p>
          <button
            type="button"
            onClick={() => setIntroModalOpen(true)}
            className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600 hover:text-white"
          >
            Request another introduction
          </button>
        </div>
      ) : null}
      {awardResult?.ok ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          Offer selected.
        </p>
      ) : null}
      {awardError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {awardError}
        </p>
      ) : null}
      {shortlistError ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {shortlistError}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-3xl border border-slate-900/60 bg-slate-950/30 shadow-[0_18px_55px_rgba(2,6,23,0.35)]">
        <div className="border-b border-slate-900/60 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Compare offers
              </p>
              <p className="mt-1 text-sm text-slate-300">
                Compare pricing and lead time. Select the option you want to proceed with.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-200">
                <span>View shortlisted</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={showShortlistedOnly}
                  onClick={() => setShowShortlistedOnly((prev) => !prev)}
                  className={clsx(
                    "relative inline-flex h-6 w-11 items-center rounded-full border transition",
                    showShortlistedOnly
                      ? "border-emerald-400/60 bg-emerald-500/20"
                      : "border-slate-800 bg-slate-950/40",
                  )}
                >
                  <span
                    className={clsx(
                      "inline-block h-5 w-5 rounded-full bg-white/90 transition",
                      showShortlistedOnly ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </label>
              <TagPill
                size="sm"
                tone={shortlistedCount > 0 ? "emerald" : "slate"}
                className="normal-case tracking-normal"
              >
                Shortlisted: {shortlistedCount}
              </TagPill>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              Sort
              <select
                value={sortKey}
                onChange={(event) => setSortKey(event.target.value as SortKey)}
                className="rounded-lg border border-slate-800 bg-slate-950/60 px-2 py-1 text-xs text-slate-100 outline-none transition focus:border-emerald-400"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBadgeWinnersOnly((prev) => !prev)}
                aria-pressed={showBadgeWinnersOnly}
                className={clsx(
                  "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
                  showBadgeWinnersOnly
                    ? "bg-slate-900 text-white"
                    : "text-slate-400 hover:text-white",
                )}
              >
                Badge picks
              </button>
            </div>
          </div>
        </div>
        <div className="p-6">
          {showShortlistedOnly && shortlistedCount === 0 ? (
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4 text-sm text-slate-300">
              No offers shortlisted yet.{" "}
              <button
                type="button"
                onClick={() => {
                  setShowBadgeWinnersOnly(false);
                  setShowShortlistedOnly(false);
                }}
                className="text-xs font-semibold text-slate-100 underline-offset-4 hover:underline"
              >
                Show all offers
              </button>
            </div>
          ) : sortedOffers.length === 0 && hasQuickFilters ? (
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4 text-sm text-slate-400">
              No offers match these quick filters.{" "}
              <button
                type="button"
                onClick={() => {
                  setShowBadgeWinnersOnly(false);
                  setShowShortlistedOnly(false);
                }}
                className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid gap-3">
              {sortedOffers.map((offer, index) => {
                const isSelected = resolvedSelectedOfferId === offer.id;
                const dimNonWinner = selectionLocked && Boolean(resolvedSelectedOfferId) && !isSelected;
                const isShortlisted = shortlistedOfferIds.has(offer.id);
                const isShortlistPending = pendingShortlist && pendingShortlistOfferId === offer.id;
                const isAwardPending = pendingAward && pendingAwardOfferId === offer.id;
                const hasAssumptions = Boolean(offer.assumptions?.trim());
                const optionLabel = `Option ${index + 1}`;

                const primaryBadges = offer.trustBadges.filter(
                  (badge) => badge.id === "best_value" || badge.id === "fastest",
                );
                const secondaryBadges = offer.trustBadges.filter(
                  (badge) => badge.id !== "best_value" && badge.id !== "fastest",
                );

                return (
                  <div
                    key={offer.id}
                    className={clsx(
                      "rounded-3xl border bg-slate-950/30 p-5",
                      "transition duration-200 ease-out motion-reduce:transition-none",
                      "hover:-translate-y-0.5 hover:border-slate-700/80 hover:bg-slate-950/40 hover:shadow-[0_18px_50px_rgba(2,6,23,0.45)] motion-reduce:hover:translate-y-0",
                      isSelected
                        ? "border-emerald-400/40 bg-emerald-500/10 shadow-lg shadow-emerald-500/5"
                        : "border-slate-900/60",
                      dimNonWinner && "opacity-65 hover:-translate-y-0",
                    )}
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                            Marketplace partner
                          </p>
                          <p className="text-xs font-semibold text-slate-200">{optionLabel}</p>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {primaryBadges.map((badge) => (
                            <TagPill
                              key={badge.id}
                              size="sm"
                              tone={badge.tone}
                              title={badge.tooltip}
                              className={clsx(
                                "normal-case tracking-normal",
                                badge.id === "best_value" ? "ring-1 ring-emerald-400/40" : "",
                                badge.id === "fastest" ? "ring-1 ring-blue-300/30" : "",
                              )}
                            >
                              {badge.label}
                            </TagPill>
                          ))}
                          {secondaryBadges.map((badge) => (
                            <TagPill key={badge.id} size="sm" tone={badge.tone} title={badge.tooltip}>
                              {badge.label}
                            </TagPill>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => setExpandedOfferId((prev) => (prev === offer.id ? null : offer.id))}
                          className="mt-3 text-xs font-semibold text-slate-300 transition hover:text-white"
                        >
                          {expandedOfferId === offer.id ? "Hide details" : "Details"}
                        </button>
                      </div>

                      <div className="grid w-full gap-3 sm:w-auto sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Total price
                          </p>
                          <p className="mt-1 tabular-nums text-base font-semibold text-white">
                            {offer.priceDisplay}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Lead time
                          </p>
                          <p className="mt-1 tabular-nums text-base font-semibold text-white">
                            {offer.leadTimeDisplay}
                          </p>
                        </div>
                      </div>

                      <div className="sm:ml-auto sm:w-[12rem]">
                        <ActionGroup>
                          <ActionGroupSection>
                            <OfferShortlistPill
                              shortlisted={isShortlisted}
                              pending={isShortlistPending}
                              disabled={pendingShortlist || awardLocked}
                              onClick={() => handleShortlistToggle(offer.id)}
                            />
                            <OfferSelectPill
                              disabled={(selectionLocked && !isSelected) || pendingAward}
                              selected={isSelected}
                              pending={isAwardPending}
                              onClick={() => handleAwardOffer(offer.id)}
                            />
                          </ActionGroupSection>
                        </ActionGroup>
                      </div>
                    </div>

                    {expandedOfferId === offer.id ? (
                      <div className="mt-4 rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          Assumptions
                        </p>
                        <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
                          {hasAssumptions ? offer.assumptions : "No assumptions provided."}
                        </p>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <RequestIntroductionModal
        open={introModalOpen}
        onClose={() => setIntroModalOpen(false)}
        quoteId={quoteId}
        offers={offers}
        shortlistedOfferIds={shortlistedOfferIdsProp ?? null}
        shortlistOnlyMode={introShortlistOnlyMode}
        defaultEmail={introDefaultEmail}
        defaultCompany={introDefaultCompany}
        onSubmitted={(payload) => {
          saveIntroRequestedState(payload);
          setIntroRequested(payload);
        }}
      />
    </div>
  );
}

function OfferSelectPill({
  disabled,
  selected,
  pending,
  onClick,
}: {
  disabled: boolean;
  selected: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const isDisabled = disabled || pending;
  const label = pending
    ? "SELECTING..."
    : selected
      ? "SELECTED"
      : disabled
        ? "LOCKED"
        : "SELECT";

  return (
    <ActionPillButton
      onClick={onClick}
      disabled={isDisabled}
      title={
        pending
          ? "Selecting offer…"
          : selected
            ? "Offer selected"
            : disabled
              ? "Selection locked"
              : "Select this offer"
      }
      className={clsx(
        "items-center justify-center text-center",
        selected
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
          : disabled
            ? "border-slate-800/80 text-slate-400"
            : "border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
      )}
    >
      {label}
    </ActionPillButton>
  );
}

function OfferShortlistPill({
  shortlisted,
  pending,
  disabled,
  onClick,
}: {
  shortlisted: boolean;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const label = shortlisted ? "Remove from shortlist" : "Add to shortlist";
  const isDisabled = disabled || pending;

  return (
    <ActionPillButton
      onClick={onClick}
      disabled={isDisabled}
      aria-pressed={shortlisted}
      aria-label={label}
      title={label}
      className={clsx(
        "items-center justify-center text-center",
        shortlisted
          ? "border-amber-400/70 bg-amber-500/15 text-amber-200"
          : "border-slate-800/80 bg-slate-950/50 text-slate-300 hover:border-amber-400/60 hover:text-amber-200",
        isDisabled &&
          "border-slate-800/80 text-slate-500 hover:border-slate-800/80 hover:text-slate-500",
      )}
    >
      <span className="inline-flex items-center gap-2">
        <StarIcon className="h-4 w-4" filled={shortlisted} />
        <span className="text-[11px] font-semibold">
          {shortlisted ? "Shortlisted" : "Shortlist"}
        </span>
      </span>
    </ActionPillButton>
  );
}

function StarIcon({ className, filled }: { className?: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.4}
      className={className}
      aria-hidden="true"
    >
      <path d="M10 1.6l2.7 5.47 6.04.88-4.37 4.26 1.03 6.02L10 15.6l-5.4 2.83 1.03-6.02-4.37-4.26 6.04-.88L10 1.6z" />
    </svg>
  );
}

function compareOffers(a: CustomerCompareOffer, b: CustomerCompareOffer, sortKey: SortKey): number {
  switch (sortKey) {
    case "fastest": {
      return compareBy(
        compareNullableNumber(a.leadTimeDaysAverage, b.leadTimeDaysAverage, "asc"),
        compareNullableNumber(a.totalPriceValue, b.totalPriceValue, "asc"),
        compareProviderName(a, b),
      );
    }
    case "bestValue":
    default: {
      const aBest = a.trustBadges.some((badge) => badge.id === "best_value");
      const bBest = b.trustBadges.some((badge) => badge.id === "best_value");
      return compareBy(
        aBest === bBest ? 0 : aBest ? -1 : 1,
        compareNullableNumber(a.leadTimeDaysAverage, b.leadTimeDaysAverage, "asc"),
        compareNullableNumber(a.totalPriceValue, b.totalPriceValue, "asc"),
        compareProviderName(a, b),
      );
    }
  }
}

function compareBy(...comparisons: number[]): number {
  for (const result of comparisons) {
    if (result !== 0) return result;
  }
  return 0;
}

function compareProviderName(a: CustomerCompareOffer, b: CustomerCompareOffer): number {
  return a.provider_id.localeCompare(b.provider_id);
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  direction: SortDirection,
): number {
  const aValue = typeof a === "number" && Number.isFinite(a) ? a : null;
  const bValue = typeof b === "number" && Number.isFinite(b) ? b : null;
  if (aValue !== null && bValue !== null) {
    const diff = aValue - bValue;
    if (diff === 0) return 0;
    return direction === "asc" ? diff : -diff;
  }
  if (aValue !== null) return -1;
  if (bValue !== null) return 1;
  return 0;
}

function normalizeOfferIds(value: string[] | null | undefined): string[] {
  if (!Array.isArray(value)) return [];
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}
