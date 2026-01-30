"use client";

import clsx from "clsx";
import { useMemo, useState, type ReactNode } from "react";
import { formatCurrency } from "@/lib/formatCurrency";
import { formatMatchedForText, type ManufacturingProcessKey } from "@/lib/rfq/manufacturingProcesses";
import type { PublicRfqOfferCardDto } from "@/types/rfqPublicOffer";

type PublicOfferCardProps = {
  offer: PublicRfqOfferCardDto;
  offers: PublicRfqOfferCardDto[];
  optionNumber: number;
  manufacturingProcesses?: ManufacturingProcessKey[];
  className?: string;
};

const NOTE_CLAMP_THRESHOLD = 140;

export function PublicOfferCard({
  offer,
  offers,
  optionNumber,
  manufacturingProcesses,
  className,
}: PublicOfferCardProps) {
  const [notesExpanded, setNotesExpanded] = useState(false);

  const supplierLabel = useMemo(() => {
    const sourceName = typeof offer.sourceName === "string" ? offer.sourceName.trim() : "";
    if (sourceName) return sourceName;
    return `Marketplace partner · Option ${optionNumber}`;
  }, [offer.sourceName, optionNumber]);

  const matchedForText = useMemo(() => formatMatchedForText(manufacturingProcesses), [manufacturingProcesses]);

  const priceLabel = formatOfferTotalPrice(offer.totalPrice, offer.currency);
  const leadTimeValue = formatLeadTimeValue(offer.leadTimeDaysMin, offer.leadTimeDaysMax);

  const comparisons = useMemo(() => {
    const allOffers = Array.isArray(offers) ? offers : [];
    if (allOffers.length < 2) return { fasterThanMedian: false, cheaperThanMedian: false };

    const offerLead = leadTimeComparableDays(offer);
    const leadTimes = allOffers.map(leadTimeComparableDays).filter((v): v is number => typeof v === "number");
    const medianLeadTime = median(leadTimes);

    const offerPrice = priceComparableNumber(offer);
    const prices = allOffers
      .filter((o) => (o.currency ?? "").trim().toUpperCase() === (offer.currency ?? "").trim().toUpperCase())
      .map(priceComparableNumber)
      .filter((v): v is number => typeof v === "number");
    const medianPrice = median(prices);

    return {
      fasterThanMedian:
        typeof offerLead === "number" && typeof medianLeadTime === "number" ? offerLead < medianLeadTime : false,
      cheaperThanMedian:
        typeof offerPrice === "number" && typeof medianPrice === "number" ? offerPrice < medianPrice : false,
    };
  }, [offer, offers]);

  const notes = typeof offer.notes === "string" ? offer.notes.trim() : "";
  const shouldClampNotes = notes.length > NOTE_CLAMP_THRESHOLD;
  const showClampedNotes = shouldClampNotes && !notesExpanded;

  const subtleInsights = useMemo(() => {
    const insights: string[] = [];
    if (comparisons.fasterThanMedian) insights.push("Faster than most responses");
    if (comparisons.cheaperThanMedian) insights.push("Below typical market range");
    return insights;
  }, [comparisons.cheaperThanMedian, comparisons.fasterThanMedian]);

  return (
    <article
      className={clsx(
        "rounded-3xl border border-slate-900/60 bg-slate-950/35 p-5",
        "transition duration-200 ease-out motion-reduce:transition-none",
        "hover:-translate-y-0.5 hover:border-slate-700/70 hover:bg-slate-950/45 hover:shadow-[0_18px_55px_rgba(2,6,23,0.45)] motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-ink-soft" title={supplierLabel}>
            {supplierLabel}
          </p>
          {matchedForText ? (
            <p className="mt-1 text-[11px] text-ink-muted" title={matchedForText}>
              {matchedForText}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {offer.isBestValue ? <HighlightPill tone="emerald">Best value</HighlightPill> : null}
            {offer.isFastest ? <HighlightPill tone="blue">Fastest</HighlightPill> : null}
          </div>
          {offer.isBestValue || offer.isFastest ? (
            <p className="mt-2 text-[11px] text-ink-muted">
              {offer.isBestValue ? "Lowest total price" : null}
              {offer.isBestValue && offer.isFastest ? " · " : null}
              {offer.isFastest ? "Shortest lead time" : null}
            </p>
          ) : null}
          {subtleInsights.length ? (
            <p className="mt-2 text-[11px] text-ink-muted">{subtleInsights.join(" · ")}</p>
          ) : null}
        </div>

        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
            Total price
          </p>
          <p className="mt-1 tabular-nums text-2xl font-semibold text-ink">{priceLabel}</p>
          <div className="mt-2 flex justify-end">
            <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-ink">
              Lead time: {leadTimeValue}
            </span>
          </div>
        </div>
      </div>

      {notes ? (
        <div className="mt-4 border-t border-slate-900/60 pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
            Notes
          </p>
          <p
            className="mt-2 whitespace-pre-line text-sm text-ink-muted"
            style={
              showClampedNotes
                ? ({
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  } as const)
                : undefined
            }
          >
            {notes}
          </p>
          {shouldClampNotes ? (
            <button
              type="button"
              className="mt-2 text-xs font-semibold text-ink underline-offset-4 hover:underline"
              aria-expanded={notesExpanded}
              onClick={() => setNotesExpanded((prev) => !prev)}
            >
              {notesExpanded ? "Show less" : "Show more"}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function HighlightPill({
  tone,
  children,
}: {
  tone: "emerald" | "blue";
  children: ReactNode;
}) {
  const classes =
    tone === "emerald"
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
      : "border-blue-300/25 bg-blue-500/10 text-blue-100";

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide",
        classes,
      )}
    >
      {children}
    </span>
  );
}

function formatOfferTotalPrice(value: number | string | null, currency: string): string {
  if (typeof value === "number") {
    return formatCurrency(value, currency, { maximumFractionDigits: 0 });
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "—";
}

function formatLeadTimeValue(minDays: number | null, maxDays: number | null): string {
  const min = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const max = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;

  if (min !== null && max !== null) {
    if (min === max) return `${min} day${min === 1 ? "" : "s"}`;
    return `${min}–${max} days`;
  }
  if (min !== null) return `${min} day${min === 1 ? "" : "s"}`;
  if (max !== null) return `${max} day${max === 1 ? "" : "s"}`;
  return "—";
}

function leadTimeComparableDays(offer: PublicRfqOfferCardDto): number | null {
  const minRaw = offer.leadTimeDaysMin;
  const maxRaw = offer.leadTimeDaysMax;

  const min = typeof minRaw === "number" && Number.isFinite(minRaw) && minRaw > 0 ? minRaw : null;
  const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : null;

  if (min !== null && max !== null) return (min + max) / 2;
  if (min !== null) return min;
  if (max !== null) return max;
  return null;
}

function priceComparableNumber(offer: PublicRfqOfferCardDto): number | null {
  const v = offer.totalPrice;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

function median(values: number[]): number | null {
  const cleaned = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (cleaned.length === 0) return null;
  const sorted = [...cleaned].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (typeof left !== "number" || typeof right !== "number") return null;
  return (left + right) / 2;
}

