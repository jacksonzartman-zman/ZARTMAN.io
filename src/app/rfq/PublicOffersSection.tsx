"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatCurrency } from "@/lib/formatCurrency";
import { NotifyMePanel } from "./NotifyMePanel";

type OfferCardDto = {
  id: string;
  providerName: string | null;
  currency: string;
  totalPrice: number | string | null;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  status: string;
  receivedAt: string | null;
};

type OffersCountApiResponse =
  | { ok: false; error?: string }
  | {
      ok: true;
      quoteId: string;
      quoteStatus: string | null;
      normalizedStatus: string;
      offersCount: number;
      offers: OfferCardDto[];
    };

type PublicOffersSectionProps = {
  quoteId: string;
  quoteStatus: string | null;
  normalizedStatus: string;
  intakeKey: string;
  primaryFileName: string | null;
  initialOffersCount: number;
  initialOffers: OfferCardDto[];
};

const POLL_INTERVAL_MS = 8000;
const POLL_MAX_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["won", "lost", "cancelled"]);

export function PublicOffersSection({
  quoteId,
  quoteStatus,
  normalizedStatus,
  intakeKey,
  primaryFileName,
  initialOffersCount,
  initialOffers,
}: PublicOffersSectionProps) {
  const [offersCount, setOffersCount] = useState<number>(() =>
    Number.isFinite(initialOffersCount) ? initialOffersCount : 0,
  );
  const [offers, setOffers] = useState<OfferCardDto[]>(() => initialOffers ?? []);
  const [celebrate, setCelebrate] = useState(false);
  const [checkBackLater, setCheckBackLater] = useState(false);
  const [currentNormalizedStatus, setCurrentNormalizedStatus] = useState(normalizedStatus);
  const previousOffersCountRef = useRef(offersCount);
  const stopPollingRef = useRef(false);

  const isTerminal = TERMINAL_STATUSES.has((currentNormalizedStatus ?? "").trim().toLowerCase());
  const hasOffers = offersCount > 0;

  const headline = hasOffers ? "Your offers are ready" : "Offers are on the way";
  const subhead = hasOffers
    ? "We’ve received supplier offers for your RFQ. Review them below."
    : "We’re processing your files and routing your RFQ to manufacturing providers.";

  const step3Label = hasOffers ? "Offers ready" : "Offers coming";
  const step3Description = hasOffers
    ? "Offers are ready to review below."
    : "We’ll surface offers as providers respond.";

  const badgeLabel = `${offersCount} offer${offersCount === 1 ? "" : "s"} received`;

  const compareCtaVisible = offersCount >= 2;

  const compareRows = useMemo(() => {
    if (!Array.isArray(offers) || offers.length === 0) return [];
    return offers.map((offer) => ({
      id: offer.id,
      providerName: offer.providerName?.trim() || `Provider ${offer.id.slice(0, 6)}`,
      priceLabel: formatOfferTotalPrice(offer),
      leadTimeLabel: formatOfferLeadTime(offer),
    }));
  }, [offers]);

  useEffect(() => {
    previousOffersCountRef.current = offersCount;
  }, [offersCount]);

  useEffect(() => {
    if (stopPollingRef.current) return;
    if (hasOffers) return;
    if (isTerminal) return;
    if (checkBackLater) return;

    const startedAt = Date.now();
    let interval: ReturnType<typeof setInterval> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopPollingRef.current) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_MAX_MS) {
        stopPollingRef.current = true;
        setCheckBackLater(true);
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        return;
      }

      try {
        const res = await fetch(
          `/api/rfq/offers-count?quote=${encodeURIComponent(
            quoteId,
          )}&key=${encodeURIComponent(intakeKey)}`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as OffersCountApiResponse;
        if (!json || json.ok !== true) return;

        setCurrentNormalizedStatus(json.normalizedStatus);

        const nextCount = Number.isFinite(json.offersCount) ? json.offersCount : 0;
        if (nextCount > 0) {
          stopPollingRef.current = true;
          setOffersCount(nextCount);
          setOffers(Array.isArray(json.offers) ? json.offers : []);
          setCelebrate(true);
          setTimeout(() => setCelebrate(false), 4500);
          if (interval) clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          return;
        }

        setOffersCount(0);
      } catch {
        // Fail-soft; try again on next tick.
      }
    };

    interval = setInterval(tick, POLL_INTERVAL_MS);
    timeout = setTimeout(() => {
      stopPollingRef.current = true;
      setCheckBackLater(true);
      if (interval) clearInterval(interval);
    }, POLL_MAX_MS);

    void tick();

    return () => {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [checkBackLater, hasOffers, intakeKey, isTerminal, quoteId]);

  useEffect(() => {
    const prev = previousOffersCountRef.current;
    if (prev === 0 && offersCount > 0) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 4500);
      return () => clearTimeout(t);
    }
    return;
  }, [offersCount]);

  const statusText = (quoteStatus ?? "Submitted").trim() || "Submitted";

  return (
    <>
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
          RFQ status
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink">{headline}</h1>
        <p className="text-sm text-ink-muted">{subhead}</p>
      </header>

      <div className="rounded-3xl border border-slate-900/60 bg-slate-950/55 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-ink">Quote ID</p>
            <p className="text-xs text-ink-soft">{quoteId}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="text-xs font-semibold text-ink-soft">
              Status: <span className="text-ink">{statusText}</span>
            </div>
            {hasOffers ? (
              <span
                className={clsx(
                  "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide",
                  "border-slate-800 bg-slate-950/40 text-ink",
                  celebrate && "border-emerald-400/60 bg-emerald-500/10 text-emerald-100",
                  celebrate && "animate-pulse",
                )}
                aria-live="polite"
              >
                {badgeLabel}
              </span>
            ) : null}
            {compareCtaVisible ? (
              <a
                href="#compare-offers"
                className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink transition hover:border-slate-700"
              >
                Compare offers
              </a>
            ) : null}
          </div>
        </div>

        {primaryFileName ? (
          <p className="mt-3 text-xs text-ink-soft">
            Primary file: <span className="font-semibold text-ink">{primaryFileName}</span>
          </p>
        ) : null}

        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          <li className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
              Step 1
            </p>
            <p className="mt-2 text-sm font-semibold text-ink">Uploading</p>
            <p className="mt-1 text-xs text-ink-soft">Files received and secured.</p>
          </li>
          <li className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
              Step 2
            </p>
            <p className="mt-2 text-sm font-semibold text-ink">Processing</p>
            <p className="mt-1 text-xs text-ink-soft">
              Extracting parts and preparing quotes.
            </p>
          </li>
          <li
            className={clsx(
              "rounded-2xl border px-4 py-4",
              hasOffers
                ? "border-emerald-400/40 bg-emerald-500/10"
                : "border-emerald-400/30 bg-emerald-500/10",
            )}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
              Step 3
            </p>
            <p className="mt-2 text-sm font-semibold text-emerald-100">{step3Label}</p>
            <p className="mt-1 text-xs text-ink-soft">{step3Description}</p>
          </li>
        </ol>

        {checkBackLater && !hasOffers && !isTerminal ? (
          <p className="mt-5 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3 text-xs text-ink-soft">
            Still waiting on supplier offers.{" "}
            <span className="font-semibold text-ink">Check back later</span>.
          </p>
        ) : null}

        {celebrate && hasOffers ? (
          <p className="mt-4 text-xs font-semibold text-emerald-200" aria-live="polite">
            Offer received.
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/"
            className="rounded-full border border-slate-800 bg-slate-950/40 px-4 py-2 text-xs font-semibold text-ink transition hover:border-slate-700"
          >
            Upload another RFQ
          </Link>
          <p className="text-xs text-ink-soft">Keep this page open or bookmark it to check back.</p>
        </div>
      </div>

      {!hasOffers && !isTerminal ? <NotifyMePanel quoteId={quoteId} intakeKey={intakeKey} /> : null}

      {hasOffers ? (
        <section className="space-y-4">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
                Offers
              </p>
              <h2 className="mt-2 text-lg font-semibold text-ink">Offer cards</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Offers are presented as submitted by providers.
              </p>
            </div>
            <span className="text-xs font-semibold text-ink-soft">{badgeLabel}</span>
          </header>

          <div className="grid gap-3">
            {offers.map((offer) => (
              <OfferCard key={offer.id} offer={offer} />
            ))}
          </div>

          {compareCtaVisible ? (
            <section id="compare-offers" className="scroll-mt-24">
              <div className="mt-6 overflow-hidden rounded-3xl border border-slate-900/60 bg-slate-950/40">
                <div className="border-b border-slate-900/60 px-5 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
                    Compare offers
                  </p>
                  <p className="mt-2 text-sm text-ink-muted">
                    Quick side-by-side view of pricing and lead time.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                    <thead className="border-b border-slate-900/60 bg-slate-950/70">
                      <tr className="text-[11px] font-semibold uppercase tracking-[0.18em] text-ink-soft">
                        <th className="px-5 py-3">Supplier</th>
                        <th className="px-5 py-3">Total price</th>
                        <th className="px-5 py-3">Lead time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900/60">
                      {compareRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-5 py-4 font-semibold text-ink">{row.providerName}</td>
                          <td className="px-5 py-4 text-ink">{row.priceLabel}</td>
                          <td className="px-5 py-4 text-ink">{row.leadTimeLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function OfferCard({ offer }: { offer: OfferCardDto }) {
  const providerName = offer.providerName?.trim() || `Provider ${offer.id.slice(0, 6)}`;
  const priceLabel = formatOfferTotalPrice(offer);
  const leadTimeLabel = formatOfferLeadTime(offer);
  const statusLabel = formatOfferStatus(offer.status);

  return (
    <article className="rounded-3xl border border-slate-900/60 bg-slate-950/35 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-ink" title={providerName}>
            {providerName}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            Status: <span className="font-semibold text-ink">{statusLabel}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
            Total
          </p>
          <p className="mt-1 text-base font-semibold text-ink">{priceLabel}</p>
          <p className="mt-1 text-xs text-ink-soft">{leadTimeLabel}</p>
        </div>
      </div>
    </article>
  );
}

function formatOfferTotalPrice(offer: OfferCardDto): string {
  if (typeof offer.totalPrice === "number") {
    return formatCurrency(offer.totalPrice, offer.currency, { maximumFractionDigits: 0 });
  }
  if (typeof offer.totalPrice === "string") {
    const trimmed = offer.totalPrice.trim();
    if (trimmed) return trimmed;
  }
  return "—";
}

function formatOfferLeadTime(offer: OfferCardDto): string {
  const min = offer.leadTimeDaysMin;
  const max = offer.leadTimeDaysMax;
  if (typeof min === "number" && typeof max === "number" && min > 0 && max > 0) {
    if (min === max) return `Lead time: ${min} day${min === 1 ? "" : "s"}`;
    return `Lead time: ${min}–${max} days`;
  }
  if (typeof min === "number" && min > 0) {
    return `Lead time: ${min} day${min === 1 ? "" : "s"}`;
  }
  if (typeof max === "number" && max > 0) {
    return `Lead time: ${max} day${max === 1 ? "" : "s"}`;
  }
  return "Lead time: —";
}

function formatOfferStatus(value: string): string {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) return "Received";
  if (normalized === "received") return "Received";
  if (normalized === "revised") return "Revised";
  if (normalized === "quoted") return "Quoted";
  if (normalized === "withdrawn") return "Withdrawn";
  return normalized.replace(/[_-]+/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}

