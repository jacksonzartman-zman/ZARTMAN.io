"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatCurrency } from "@/lib/formatCurrency";
import { NotifyMePanel } from "./NotifyMePanel";
import { RfqJourneyStepper } from "./RfqJourneyStepper";
import { RfqNextStepsPanel } from "./RfqNextStepsPanel";
import { PublicOfferCard } from "./PublicOfferCard";
import type { RfqPerformanceFeedback } from "@/server/rfqs/performanceFeedback";
import type { PublicRfqOfferCardDto } from "@/types/rfqPublicOffer";
import type { ManufacturingProcessKey } from "@/lib/rfq/manufacturingProcesses";

type OfferCardDto = PublicRfqOfferCardDto;

type OffersCountApiResponse =
  | { ok: false; error?: string }
  | {
      ok: true;
      quoteId: string;
      quoteStatus: string | null;
      normalizedStatus: string;
      offersCount: number;
      offers: OfferCardDto[];
      suppliersReviewing?: boolean;
      projectStatus?: string | null;
      performance?: RfqPerformanceFeedback;
    };

type PublicOffersSectionProps = {
  quoteId: string;
  quoteStatus: string | null;
  normalizedStatus: string;
  intakeKey: string;
  quoteCreatedAt: string | null;
  primaryFileName: string | null;
  manufacturingProcesses: ManufacturingProcessKey[];
  initialOffersCount: number;
  initialOffers: OfferCardDto[];
  initialProjectStatus?: string | null;
  initialPerformance?: RfqPerformanceFeedback;
  initialSuppliersReviewing?: boolean;
  claimState: "anon" | "no_customer_profile" | "can_claim" | "already_saved_to_you" | "already_saved_elsewhere";
  loginNextPath: string;
};

const POLL_INTERVAL_MS = 8000;
const POLL_FAST_INTERVAL_MS = 2000;
const POLL_FAST_PHASE_MS = 60 * 1000;
const POLL_MAX_MS = 10 * 60 * 1000;
const TERMINAL_STATUSES = new Set(["won", "lost", "cancelled"]);
const IDLE_NUDGE_AFTER_MS = 30 * 60 * 1000;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(Boolean(media.matches));
    onChange();
    try {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    } catch {
      // Safari fallback.
      media.addListener(onChange);
      return () => media.removeListener(onChange);
    }
  }, []);
  return reduced;
}

export function PublicOffersSection({
  quoteId,
  quoteStatus,
  normalizedStatus,
  intakeKey,
  quoteCreatedAt,
  primaryFileName,
  manufacturingProcesses,
  initialOffersCount,
  initialOffers,
  initialProjectStatus,
  initialPerformance,
  initialSuppliersReviewing,
  claimState,
  loginNextPath,
}: PublicOffersSectionProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prefersReducedMotion = usePrefersReducedMotion();

  const [offersCount, setOffersCount] = useState<number>(() =>
    Number.isFinite(initialOffersCount) ? initialOffersCount : 0,
  );
  const [offers, setOffers] = useState<OfferCardDto[]>(() => initialOffers ?? []);
  const [firstOfferArrivalActive, setFirstOfferArrivalActive] = useState(false);
  const [checkBackLater, setCheckBackLater] = useState(false);
  const [currentNormalizedStatus, setCurrentNormalizedStatus] = useState(normalizedStatus);
  const [showSubmittedBanner, setShowSubmittedBanner] = useState(false);
  const [submittedCardHighlight, setSubmittedCardHighlight] = useState(false);
  const [overrideStageIndex, setOverrideStageIndex] = useState<number | null>(null);
  const [suppliersReviewing, setSuppliersReviewing] = useState<boolean>(() =>
    Boolean(initialSuppliersReviewing),
  );
  const [projectStatus, setProjectStatus] = useState<string | null>(() => {
    const v = typeof initialProjectStatus === "string" ? initialProjectStatus.trim() : "";
    return v ? v : null;
  });
  const [performance, setPerformance] = useState<RfqPerformanceFeedback | null>(() => initialPerformance ?? null);
  const previousOffersCountRef = useRef(offersCount);
  const stopPollingRef = useRef(false);
  const [claiming, setClaiming] = useState(false);
  const [claimOk, setClaimOk] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const firstOfferArrivalPlayedRef = useRef(false);

  const isTerminal = TERMINAL_STATUSES.has((currentNormalizedStatus ?? "").trim().toLowerCase());
  const hasOffers = offersCount > 0;
  const isLoggedIn = claimState !== "anon";
  const showNotifyRow = !isTerminal && (!hasOffers || isLoggedIn);

  const quoteCreatedAtMs = useMemo(() => {
    const raw = typeof quoteCreatedAt === "string" ? quoteCreatedAt.trim() : "";
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [quoteCreatedAt]);

  const [idleNudgeEligible, setIdleNudgeEligible] = useState(() => {
    if (!quoteCreatedAtMs) return false;
    return Date.now() - quoteCreatedAtMs >= IDLE_NUDGE_AFTER_MS;
  });

  useEffect(() => {
    if (hasOffers) {
      setIdleNudgeEligible(false);
      return;
    }
    if (!quoteCreatedAtMs) return;
    const elapsed = Date.now() - quoteCreatedAtMs;
    if (elapsed >= IDLE_NUDGE_AFTER_MS) {
      setIdleNudgeEligible(true);
      return;
    }

    const remaining = IDLE_NUDGE_AFTER_MS - elapsed;
    const t = window.setTimeout(() => setIdleNudgeEligible(true), remaining);
    return () => window.clearTimeout(t);
  }, [hasOffers, quoteCreatedAtMs]);

  const showIdleNudge = !isTerminal && !hasOffers && idleNudgeEligible;

  const journey = useMemo(() => {
    const normalized = (currentNormalizedStatus ?? "").trim().toLowerCase();
    const project = (projectStatus ?? "").trim().toLowerCase();

    const isProjectInProgress =
      project === "in_progress" ||
      project === "in-progress" ||
      project === "production" ||
      project === "in_production" ||
      project === "in-production" ||
      project === "active";

    // Stages requested: Upload → Processing → Waiting on offers → Offers ready → Awarded → In progress
    // We always treat "Upload" as complete if the viewer can see this page.
    if (isProjectInProgress) {
      return {
        stageIndex: 5,
        headline: "In progress",
        subhead: "Your project is underway. We’ll keep the status up to date here.",
      };
    }
    if (normalized === "won" || normalized === "approved") {
      return {
        stageIndex: 4,
        headline: "Awarded",
        subhead: "A supplier has been selected. Next steps are moving into kickoff.",
      };
    }
    if (hasOffers || normalized === "quoted") {
      return {
        stageIndex: 3,
        headline: "Offers ready",
        subhead: "We’ve received supplier offers for your RFQ. Review them below.",
      };
    }
    if (normalized === "in_review") {
      return {
        stageIndex: 2,
        headline: "Waiting on offers",
        subhead: "Suppliers are reviewing your files. We’ll surface offers as they respond.",
      };
    }
    return {
      stageIndex: 1,
      headline: "Processing",
      subhead: "We’re processing your files and routing your RFQ to manufacturing providers.",
    };
  }, [currentNormalizedStatus, hasOffers, projectStatus]);

  const stageIndex = overrideStageIndex ?? journey.stageIndex;

  const submittedPlayedRef = useRef(false);
  useEffect(() => {
    if (submittedPlayedRef.current) return;
    if (!searchParams) return;

    const submittedRaw = (searchParams.get("submitted") ?? "").trim().toLowerCase();
    const submitted = submittedRaw === "1" || submittedRaw === "true" || submittedRaw === "yes";
    if (!submitted) return;

    submittedPlayedRef.current = true;

    // Clean up URL so the effect doesn't re-run on refresh/share.
    const cleaned = new URLSearchParams(searchParams.toString());
    cleaned.delete("submitted");
    const qs = cleaned.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });

    setShowSubmittedBanner(true);
    const bannerT = window.setTimeout(() => setShowSubmittedBanner(false), 2600);

    if (!prefersReducedMotion) {
      setSubmittedCardHighlight(true);
      const highlightT = window.setTimeout(() => setSubmittedCardHighlight(false), 1200);

      // Smoothly "activate" Processing (stage 1) from Upload (stage 0) on first load.
      if (journey.stageIndex === 1) {
        setOverrideStageIndex(0);
        const kickoff = window.setTimeout(() => setOverrideStageIndex(1), 60);
        const release = window.setTimeout(() => setOverrideStageIndex(null), 950);
        return () => {
          window.clearTimeout(bannerT);
          window.clearTimeout(highlightT);
          window.clearTimeout(kickoff);
          window.clearTimeout(release);
        };
      }

      return () => {
        window.clearTimeout(bannerT);
        window.clearTimeout(highlightT);
      };
    }

    return () => {
      window.clearTimeout(bannerT);
    };
  }, [journey.stageIndex, pathname, prefersReducedMotion, router, searchParams]);

  const badgeLabel = `${offersCount} offer${offersCount === 1 ? "" : "s"} received`;

  const compareCtaVisible = offersCount >= 2;

  const compareRows = useMemo(() => {
    if (!Array.isArray(offers) || offers.length === 0) return [];
    return offers.map((offer, idx) => {
      const supplierLabel = resolveSupplierLabel(offer, idx + 1);
      return {
        id: offer.id,
        providerName: supplierLabel,
        priceLabel: formatOfferTotalPrice(offer),
        leadTimeLabel: formatOfferLeadTime(offer),
      };
    });
  }, [offers]);

  const firstOfferArrivalStorageKey = useMemo(
    () => `rfq:first-offer-arrival:v1:${quoteId}`,
    [quoteId],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      firstOfferArrivalPlayedRef.current = window.localStorage.getItem(firstOfferArrivalStorageKey) === "1";
    } catch {
      // ignore
    }
  }, [firstOfferArrivalStorageKey]);

  useEffect(() => {
    if (stopPollingRef.current) return;
    if (hasOffers) return;
    if (isTerminal) return;
    if (checkBackLater) return;

    const startedAt = Date.now();
    let tickTimeout: ReturnType<typeof setTimeout> | null = null;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (stopPollingRef.current) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= POLL_MAX_MS) {
        stopPollingRef.current = true;
        setCheckBackLater(true);
        if (tickTimeout) clearTimeout(tickTimeout);
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
        setProjectStatus(() => {
          const v = typeof json.projectStatus === "string" ? json.projectStatus.trim() : "";
          return v ? v : null;
        });
        setSuppliersReviewing(Boolean(json.suppliersReviewing));
        if (json.performance) {
          setPerformance(json.performance);
        }

        const nextCount = Number.isFinite(json.offersCount) ? json.offersCount : 0;
        if (nextCount > 0) {
          stopPollingRef.current = true;
          setOffersCount(nextCount);
          setOffers(Array.isArray(json.offers) ? json.offers : []);
          if (tickTimeout) clearTimeout(tickTimeout);
          if (timeout) clearTimeout(timeout);
          return;
        }

        setOffersCount(0);
      } catch {
        // Fail-soft; try again on next tick.
      }

      // Adaptive polling: start fast, then slow down.
      if (!stopPollingRef.current) {
        const intervalMs = elapsed < POLL_FAST_PHASE_MS ? POLL_FAST_INTERVAL_MS : POLL_INTERVAL_MS;
        tickTimeout = setTimeout(() => void tick(), intervalMs);
      }
    };

    timeout = setTimeout(() => {
      stopPollingRef.current = true;
      setCheckBackLater(true);
      if (tickTimeout) clearTimeout(tickTimeout);
    }, POLL_MAX_MS);

    void tick();

    return () => {
      if (tickTimeout) clearTimeout(tickTimeout);
      if (timeout) clearTimeout(timeout);
    };
  }, [checkBackLater, hasOffers, intakeKey, isTerminal, quoteId]);

  useEffect(() => {
    const prev = previousOffersCountRef.current;
    previousOffersCountRef.current = offersCount;

    if (prefersReducedMotion) return;
    if (firstOfferArrivalPlayedRef.current) return;

    if (prev === 0 && offersCount > 0) {
      firstOfferArrivalPlayedRef.current = true;
      try {
        window.localStorage.setItem(firstOfferArrivalStorageKey, "1");
      } catch {
        // ignore
      }

      setFirstOfferArrivalActive(true);
      const t = window.setTimeout(() => setFirstOfferArrivalActive(false), 2600);
      return () => window.clearTimeout(t);
    }
    return;
  }, [firstOfferArrivalStorageKey, offersCount, prefersReducedMotion]);

  const statusText = (quoteStatus ?? "Submitted").trim() || "Submitted";

  const momentumLine =
    offersCount >= 4
      ? "Strong interest from suppliers."
      : offersCount >= 2
        ? "Multiple suppliers are responding to your RFQ."
        : null;

  return (
    <>
      {showSubmittedBanner ? (
        <div
          className={clsx(
            "mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-100",
            "transition-opacity duration-300 motion-reduce:transition-none",
          )}
          role="status"
          aria-live="polite"
        >
          RFQ submitted — matching in progress
        </div>
      ) : null}
      <header className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-soft">
          RFQ status
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-ink">{journey.headline}</h1>
        <p className="text-sm text-ink-muted">{journey.subhead}</p>
        {!hasOffers && !isTerminal && suppliersReviewing ? (
          <p className="text-xs text-ink-soft">Suppliers are reviewing your RFQ.</p>
        ) : null}
        {showIdleNudge ? (
          <p className="text-xs text-ink-soft">
            No offers yet — adjusting specs can improve matching.{" "}
            <a
              href="#quick-specs"
              className="text-ink-muted underline underline-offset-4 hover:text-ink"
              onClick={(e) => {
                // Smooth-scroll to Quick Specs (no navigation / no button styling).
                e.preventDefault();
                const el = document.getElementById("quick-specs");
                if (!el) return;
                el.scrollIntoView({
                  behavior: prefersReducedMotion ? "auto" : "smooth",
                  block: "start",
                });
              }}
            >
              Edit specs
            </a>
          </p>
        ) : null}
      </header>

      <div
        className={clsx(
          "rounded-3xl border border-slate-900/60 bg-slate-950/55 p-6 shadow-[0_20px_60px_rgba(2,6,23,0.45)]",
          "transition duration-200 ease-out motion-reduce:transition-none",
          "hover:-translate-y-0.5 hover:border-slate-700/70 hover:bg-slate-950/60 hover:shadow-[0_24px_75px_rgba(2,6,23,0.55)] motion-reduce:hover:translate-y-0",
          submittedCardHighlight && "rfq-submitted-card",
        )}
      >
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
                )}
                aria-live="polite"
              >
                {badgeLabel}
              </span>
            ) : null}
            {compareCtaVisible ? (
              <a
                href="#compare-offers"
                className={clsx(
                  "inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink transition hover:border-slate-700",
                  firstOfferArrivalActive && "rfq-compare-cta-pulse",
                )}
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

        <div className="mt-5">
          {claimOk || claimState === "already_saved_to_you" ? (
            <div className="rounded-2xl border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-100">
              Saved to your workspace.{" "}
              <Link href="/customer" className="font-semibold underline underline-offset-4">
                Open dashboard
              </Link>
            </div>
          ) : claimState === "can_claim" ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Save to my workspace</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Claim this RFQ so it shows up in your customer portal.
                </p>
              </div>
              <button
                type="button"
                disabled={claiming}
                className="inline-flex items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-500 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70"
                onClick={async () => {
                  setClaimError(null);
                  setClaiming(true);
                  try {
                    const res = await fetch("/api/rfq/claim", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ quoteId, intakeKey }),
                    });
                    const json = (await res.json().catch(() => null)) as
                      | { ok: true }
                      | { ok: false; error?: string };
                    if (!res.ok || !json || json.ok !== true) {
                      setClaimError(
                        (json && "error" in json && json.error) || "Couldn’t save this RFQ. Please retry.",
                      );
                      return;
                    }
                    setClaimOk(true);
                  } catch {
                    setClaimError("Couldn’t save this RFQ. Please retry.");
                  } finally {
                    setClaiming(false);
                  }
                }}
              >
                {claiming ? "Saving…" : "Save to my workspace"}
              </button>
            </div>
          ) : claimState === "anon" ? (
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
              <p className="text-sm font-semibold text-ink">Create account to save and track this RFQ</p>
              <p className="mt-1 text-xs text-ink-soft">
                Log in to claim this RFQ and track offers in your customer workspace.
              </p>
              <div className="mt-3">
                <Link
                  href={`/login?next=${encodeURIComponent(loginNextPath)}`}
                  className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink transition hover:border-slate-700"
                >
                  Log in to save
                </Link>
              </div>
            </div>
          ) : claimState === "no_customer_profile" ? (
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
              <p className="text-sm font-semibold text-ink">Finish your customer profile to save</p>
              <p className="mt-1 text-xs text-ink-soft">
                Your account is signed in, but doesn’t yet have a customer workspace attached.
              </p>
              <div className="mt-3">
                <Link
                  href="/customer"
                  className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-slate-950/40 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-ink transition hover:border-slate-700"
                >
                  Go to customer portal
                </Link>
              </div>
            </div>
          ) : claimState === "already_saved_elsewhere" ? (
            <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4 text-xs text-ink-soft">
              This RFQ has already been saved to a workspace.
            </div>
          ) : null}

          {claimError ? (
            <p className="mt-2 text-xs font-semibold text-rose-200" role="alert">
              {claimError}
            </p>
          ) : null}
        </div>

        <div className="mt-6">
          <RfqJourneyStepper stageIndex={stageIndex} />
          <RfqNextStepsPanel
            className="mt-4"
            matchedCount={performance?.suppliersMatched ?? null}
            typicalFirstOfferMins={performance?.firstOfferMinutes ?? null}
            showNotifyRow={showNotifyRow}
          />
          <PerformanceStatsRow visible={hasOffers} performance={performance} />
        </div>

        {checkBackLater && !hasOffers && !isTerminal ? (
          <p className="mt-5 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3 text-xs text-ink-soft">
            Still waiting on supplier offers.{" "}
            <span className="font-semibold text-ink">Check back later</span>.
          </p>
        ) : null}

        {firstOfferArrivalActive && hasOffers ? (
          <p className="mt-4 text-xs font-semibold text-emerald-200" aria-live="polite" role="status">
            Your first offer just arrived.
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

          {momentumLine ? <p className="text-xs text-ink-soft">{momentumLine}</p> : null}

          <div className="grid gap-4">
            {offers.map((offer, idx) => (
              <PublicOfferCard
                key={offer.id}
                offer={offer}
                offers={offers}
                optionNumber={idx + 1}
                manufacturingProcesses={manufacturingProcesses}
                className={clsx(idx === 0 && firstOfferArrivalActive && "rfq-first-offer-card")}
              />
            ))}
          </div>

          {compareCtaVisible ? (
            <section id="compare-offers" className="scroll-mt-24">
              <div className="mt-6 overflow-hidden rounded-3xl border border-slate-900/60 bg-slate-950/40 shadow-[0_18px_50px_rgba(2,6,23,0.35)]">
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
                        <tr
                          key={row.id}
                          className="transition-colors duration-200 hover:bg-slate-950/50"
                        >
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

function PerformanceStatsRow({
  visible,
  performance,
}: {
  visible: boolean;
  performance: RfqPerformanceFeedback | null;
}) {
  if (!visible) return null;
  if (!performance) return null;

  const suppliersMatched =
    typeof performance.suppliersMatched === "number" && Number.isFinite(performance.suppliersMatched)
      ? Math.max(0, Math.floor(performance.suppliersMatched))
      : null;

  const firstOfferMinutes =
    typeof performance.firstOfferMinutes === "number" && Number.isFinite(performance.firstOfferMinutes)
      ? Math.max(0, Math.floor(performance.firstOfferMinutes))
      : null;

  // Only display once we can compute the "supplier_notified -> offer_created" interval.
  if (firstOfferMinutes === null) return null;

  const firstOfferLabel = firstOfferMinutes <= 0 ? "<1 min" : `${firstOfferMinutes} min`;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-ink-soft">
        Performance
      </p>
      <div className="h-4 w-px bg-slate-900/70" aria-hidden="true" />
      <p className="text-xs text-ink-muted">
        First offer in:{" "}
        <span className="font-semibold text-ink tabular-nums">{firstOfferLabel}</span>
      </p>
      <div className="h-4 w-px bg-slate-900/70" aria-hidden="true" />
      <p className="text-xs text-ink-muted">
        Suppliers matched:{" "}
        <span className="font-semibold text-ink tabular-nums">
          {suppliersMatched === null ? "—" : suppliersMatched}
        </span>
      </p>
    </div>
  );
}

function resolveSupplierLabel(offer: OfferCardDto, optionNumber: number): string {
  const sourceName = typeof offer.sourceName === "string" ? offer.sourceName.trim() : "";
  if (sourceName) return sourceName;
  return `Marketplace partner · Option ${optionNumber}`;
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
    if (min === max) return `${min} day${min === 1 ? "" : "s"}`;
    return `${min}–${max} days`;
  }
  if (typeof min === "number" && min > 0) {
    return `${min} day${min === 1 ? "" : "s"}`;
  }
  if (typeof max === "number" && max > 0) {
    return `${max} day${max === 1 ? "" : "s"}`;
  }
  return "—";
}

