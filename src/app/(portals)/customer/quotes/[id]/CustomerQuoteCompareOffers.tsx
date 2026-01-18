"use client";

import clsx from "clsx";
import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { TagPill } from "@/components/shared/primitives/TagPill";
import { decorateOffersForCompare, type DecoratedRfqOffer } from "@/lib/aggregator/scoring";
import type { RfqOffer } from "@/server/rfqs/offers";
import { selectOfferAction, type SelectOfferActionState } from "./actions";

type SortKey = "bestValue" | "fastest" | "lowestPrice" | "lowestRisk";
type SortDirection = "asc" | "desc";

type CustomerQuoteCompareOffersProps = {
  quoteId: string;
  offers: RfqOffer[];
  selectedOfferId?: string | null;
};

const INITIAL_SELECT_STATE: SelectOfferActionState = {
  ok: true,
  message: null,
};

const BADGE_TONE: Record<string, "emerald" | "blue" | "amber"> = {
  "Best Value": "emerald",
  Fastest: "blue",
  "Lowest Risk": "amber",
};

const SORT_PARAM_KEY = "sort";
const SORT_KEYS: SortKey[] = ["bestValue", "fastest", "lowestPrice", "lowestRisk"];
const DEFAULT_SORT_KEY: SortKey = "bestValue";

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "bestValue", label: "Best Value" },
  { value: "fastest", label: "Fastest" },
  { value: "lowestPrice", label: "Lowest Price" },
  { value: "lowestRisk", label: "Lowest Risk" },
];

const RANK_REASON_BY_BADGE: Record<string, string> = {
  "Best Value": "Best Value",
  Fastest: "Fastest",
  "Lowest Risk": "Lowest Risk",
};

function parseSortKey(value: string | null): SortKey | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return SORT_KEYS.includes(trimmed as SortKey) ? (trimmed as SortKey) : null;
}

function resolveSortKey(value: string | null): SortKey {
  return parseSortKey(value) ?? DEFAULT_SORT_KEY;
}

export function CustomerQuoteCompareOffers({
  quoteId,
  offers,
  selectedOfferId,
}: CustomerQuoteCompareOffersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, formAction] = useFormState<SelectOfferActionState, FormData>(
    selectOfferAction,
    INITIAL_SELECT_STATE,
  );
  const [sortKey, setSortKey] = useState<SortKey>(() =>
    resolveSortKey(searchParams.get(SORT_PARAM_KEY)),
  );
  const [showBadgeWinnersOnly, setShowBadgeWinnersOnly] = useState(false);
  const [showLowRiskOnly, setShowLowRiskOnly] = useState(false);
  const [expandedOfferId, setExpandedOfferId] = useState<string | null>(null);

  const decoratedOffers = useMemo(
    () => decorateOffersForCompare(offers),
    [offers],
  );

  const resolvedSelectedOfferId = state.selectedOfferId ?? selectedOfferId ?? null;
  const selectionLocked = Boolean(resolvedSelectedOfferId);
  const hasQuickFilters = showBadgeWinnersOnly || showLowRiskOnly;

  useEffect(() => {
    if (!state.ok || !state.selectedOfferId) return;
    router.refresh();
  }, [router, state.ok, state.selectedOfferId]);

  useEffect(() => {
    const nextSortKey = resolveSortKey(searchParams.get(SORT_PARAM_KEY));
    setSortKey((current) => (current === nextSortKey ? current : nextSortKey));
  }, [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get(SORT_PARAM_KEY) === sortKey) return;
    params.set(SORT_PARAM_KEY, sortKey);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams, sortKey]);

  const filteredOffers = useMemo(() => {
    let next = decoratedOffers;
    if (showBadgeWinnersOnly) {
      next = next.filter((offer) => offer.badges.length > 0);
    }
    if (showLowRiskOnly) {
      next = next.filter((offer) => offer.riskFlagCount === 0);
    }
    return next;
  }, [decoratedOffers, showBadgeWinnersOnly, showLowRiskOnly]);

  const sortedOffers = useMemo(() => {
    const sorted = [...filteredOffers];
    sorted.sort((a, b) => compareOffers(a, b, sortKey));
    return sorted;
  }, [filteredOffers, sortKey]);

  if (offers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {state.ok && state.message ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : null}
      {!state.ok && state.error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {state.error}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
        <div className="border-b border-slate-900/60 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Compare offers
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Compare pricing, lead time, and fit. Select the provider you want to proceed with.
          </p>
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
              <button
                type="button"
                onClick={() => setShowLowRiskOnly((prev) => !prev)}
                aria-pressed={showLowRiskOnly}
                className={clsx(
                  "inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide transition",
                  showLowRiskOnly
                    ? "bg-slate-900 text-white"
                    : "text-slate-400 hover:text-white",
                )}
              >
                No risk flags
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead className="border-b border-slate-900/60 bg-slate-950/70">
              <tr className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                <th className="px-5 py-3">Provider</th>
                <th className="px-5 py-3">Total price</th>
                <th className="px-5 py-3">Lead time</th>
                <th className="px-5 py-3">Confidence</th>
                <th className="px-5 py-3">Risk flags</th>
                <th className="px-5 py-3">Badges</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900/60">
              {sortedOffers.length === 0 && hasQuickFilters ? (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-sm text-slate-400">
                    No offers match these quick filters.{" "}
                    <button
                      type="button"
                      onClick={() => {
                        setShowBadgeWinnersOnly(false);
                        setShowLowRiskOnly(false);
                      }}
                      className="text-xs font-semibold text-slate-300 underline-offset-4 hover:underline"
                    >
                      Clear filters
                    </button>
                  </td>
                </tr>
              ) : (
                sortedOffers.map((offer, index) => {
                  const isSelected = resolvedSelectedOfferId === offer.id;
                  const dimNonWinner = selectionLocked && !isSelected;
                  const providerType = formatEnumLabel(offer.provider?.provider_type);
                  const providerMode = formatEnumLabel(offer.provider?.quoting_mode);
                  const providerSourceLabel = providerType || "Unknown";
                  const providerModeLabel = providerMode ? `Mode: ${providerMode}` : null;
                  const hasAssumptions = Boolean(offer.assumptions?.trim());
                  const confidenceLabel =
                    typeof offer.confidenceValue === "number" ? offer.confidenceValue : "-";
                  const showRankReason = index < 3;
                  const rankReason = showRankReason ? buildRankReason(offer) : null;

                  return (
                    <Fragment key={offer.id}>
                      <tr
                        className={clsx(
                          isSelected
                            ? "bg-emerald-500/10"
                            : dimNonWinner
                              ? "opacity-70"
                              : "bg-transparent",
                        )}
                      >
                        <td className="px-5 py-4 align-top">
                          <div className="min-w-0">
                            <p className="truncate text-base font-semibold text-white" title={offer.providerName}>
                              {offer.providerName}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              Source: {providerSourceLabel}
                            </p>
                            {providerModeLabel ? (
                              <p className="mt-1 text-xs text-slate-500">{providerModeLabel}</p>
                            ) : null}
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedOfferId((prev) => (prev === offer.id ? null : offer.id))
                              }
                              className="mt-2 text-xs font-semibold text-slate-300 hover:text-white"
                            >
                              {expandedOfferId === offer.id ? "Hide details" : "Details"}
                            </button>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-100">
                          <span className="font-semibold text-white">{offer.priceDisplay}</span>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-100">
                          <span className="font-semibold text-white">{offer.leadTimeDisplay}</span>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-100">
                          <span className="tabular-nums text-white">{confidenceLabel}</span>
                        </td>
                        <td className="px-5 py-4 align-top">
                          {offer.quality_risk_flags.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
                              {offer.quality_risk_flags.map((flag, index) => (
                                <TagPill key={`${offer.id}-risk-${index}`} size="sm" tone="amber">
                                  {flag}
                                </TagPill>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">None</span>
                          )}
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-2">
                            {offer.badges.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {offer.badges.map((badge) => (
                                  <TagPill
                                    key={badge}
                                    size="sm"
                                    tone={BADGE_TONE[badge] ?? "slate"}
                                  >
                                    {badge}
                                  </TagPill>
                                ))}
                              </div>
                            ) : null}
                            {rankReason ? (
                              <p className="text-[11px] text-slate-500">
                                Why this is ranked here: {rankReason}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-right">
                          <form action={formAction}>
                            <input type="hidden" name="quoteId" value={quoteId} />
                            <input type="hidden" name="offerId" value={offer.id} />
                            <SelectOfferButton
                              disabled={selectionLocked && !isSelected}
                              selected={isSelected}
                            />
                          </form>
                        </td>
                      </tr>
                      {expandedOfferId === offer.id ? (
                        <tr className="bg-slate-950/40">
                          <td colSpan={7} className="px-5 pb-4 pt-0">
                            <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                Assumptions
                              </p>
                              <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
                                {hasAssumptions ? offer.assumptions : "No assumptions provided."}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SelectOfferButton({
  disabled,
  selected,
}: {
  disabled: boolean;
  selected: boolean;
}) {
  const { pending } = useFormStatus();
  const isDisabled = disabled || pending;
  const label = pending ? "Selecting..." : selected ? "Selected" : disabled ? "Locked" : "Select";

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={clsx(
        "inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
        selected
          ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-100"
          : disabled
            ? "border-slate-800/80 text-slate-400 opacity-70"
            : "border-emerald-400/50 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20",
      )}
    >
      {label}
    </button>
  );
}

function compareOffers(a: DecoratedRfqOffer, b: DecoratedRfqOffer, sortKey: SortKey): number {
  switch (sortKey) {
    case "lowestPrice": {
      return compareBy(
        compareNullableNumber(a.totalPriceValue, b.totalPriceValue, "asc"),
        compareNullableNumber(a.leadTimeDaysAverage, b.leadTimeDaysAverage, "asc"),
        compareNullableNumber(a.rankScore, b.rankScore, "desc"),
        compareProviderName(a, b),
      );
    }
    case "fastest": {
      return compareBy(
        compareNullableNumber(a.leadTimeDaysAverage, b.leadTimeDaysAverage, "asc"),
        compareNullableNumber(a.totalPriceValue, b.totalPriceValue, "asc"),
        compareNullableNumber(a.rankScore, b.rankScore, "desc"),
        compareProviderName(a, b),
      );
    }
    case "lowestRisk": {
      return compareBy(
        compareNullableNumber(a.riskFlagCount, b.riskFlagCount, "asc"),
        compareNullableNumber(a.confidenceValue, b.confidenceValue, "desc"),
        compareNullableNumber(a.rankScore, b.rankScore, "desc"),
        compareProviderName(a, b),
      );
    }
    case "bestValue":
    default: {
      return compareBy(
        compareNullableNumber(a.rankScore, b.rankScore, "desc"),
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

function buildRankReason(offer: DecoratedRfqOffer): string {
  for (const badge of offer.badges) {
    const reason = RANK_REASON_BY_BADGE[badge];
    if (reason) return reason;
  }
  return "Ranked by price, lead time, confidence, and risk flags";
}

function compareProviderName(a: DecoratedRfqOffer, b: DecoratedRfqOffer): number {
  const nameCompare = a.providerName.localeCompare(b.providerName);
  if (nameCompare !== 0) return nameCompare;
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

function formatEnumLabel(value?: string | null): string {
  if (!value) return "";
  const collapsed = value.replace(/[_-]+/g, " ").trim();
  if (!collapsed) return "";
  return collapsed
    .split(" ")
    .map((segment) => (segment ? segment[0].toUpperCase() + segment.slice(1) : ""))
    .join(" ");
}
