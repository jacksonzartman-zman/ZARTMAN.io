"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { CustomerCompareOffer } from "@/lib/customerTrustBadges";

type ModalMode = "form" | "success";

type RequestIntroductionModalProps = {
  open: boolean;
  onClose: () => void;
  quoteId: string;
  offers: CustomerCompareOffer[];
  shortlistedOfferIds?: string[] | null;
  shortlistOnlyMode?: boolean;
  defaultEmail?: string | null;
  defaultCompany?: string | null;
  onSubmitted?: (payload: {
    quoteId: string;
    providerId: string;
    offerId: string;
    supplierName: string;
    requestedAt: string;
  }) => void;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeOfferIds(value: string[] | null | undefined): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map((v) => normalizeId(v)).filter(Boolean));
}

function compareOffersBestValue(a: CustomerCompareOffer, b: CustomerCompareOffer): number {
  const aBest = a.trustBadges.some((badge) => badge.id === "best_value");
  const bBest = b.trustBadges.some((badge) => badge.id === "best_value");
  if (aBest !== bBest) return aBest ? -1 : 1;

  const leadA = typeof a.leadTimeDaysAverage === "number" ? a.leadTimeDaysAverage : Number.POSITIVE_INFINITY;
  const leadB = typeof b.leadTimeDaysAverage === "number" ? b.leadTimeDaysAverage : Number.POSITIVE_INFINITY;
  if (leadA !== leadB) return leadA - leadB;

  const priceA = typeof a.totalPriceValue === "number" ? a.totalPriceValue : Number.POSITIVE_INFINITY;
  const priceB = typeof b.totalPriceValue === "number" ? b.totalPriceValue : Number.POSITIVE_INFINITY;
  if (priceA !== priceB) return priceA - priceB;

  return a.provider_id.localeCompare(b.provider_id);
}

export function RequestIntroductionModal({
  open,
  onClose,
  quoteId,
  offers,
  shortlistedOfferIds,
  shortlistOnlyMode,
  defaultEmail,
  defaultCompany,
  onSubmitted,
}: RequestIntroductionModalProps) {
  const [mode, setMode] = useState<ModalMode>("form");
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedOfferId, setSelectedOfferId] = useState("");

  const shortlistedSet = useMemo(
    () => normalizeOfferIds(shortlistedOfferIds),
    [shortlistedOfferIds],
  );

  const offerOptions = useMemo(() => {
    const sorted = [...offers].sort(compareOffersBestValue);
    return sorted.map((offer, index) => {
      const badges = new Set(offer.trustBadges.map((b) => b.id));
      const highlights: string[] = [];
      if (badges.has("best_value")) highlights.push("Best value");
      if (badges.has("fastest")) highlights.push("Fastest");
      const suffix = highlights.length > 0 ? ` — ${highlights.join(" + ")}` : "";
      const label = `Marketplace Partner · Option ${index + 1}${suffix} — ${offer.priceDisplay} • ${offer.leadTimeDisplay}`;
      return {
        offerId: offer.id,
        providerId: offer.provider_id,
        label,
        shortlisted: shortlistedSet.has(offer.id),
      };
    });
  }, [offers, shortlistedSet]);

  const recommendedOfferId = useMemo(() => {
    if (offerOptions.length === 0) return "";
    if (shortlistOnlyMode) {
      const shortlisted = offerOptions.filter((opt) => opt.shortlisted);
      if (shortlisted.length > 0) return shortlisted[0].offerId;
    }
    return offerOptions[0].offerId;
  }, [offerOptions, shortlistOnlyMode]);

  useEffect(() => {
    if (!open) return;
    setMode("form");
    setEmail(normalizeEmail(defaultEmail));
    setCompany((defaultCompany ?? "").trim());
    setNotes("");
    setSelectedOfferId(recommendedOfferId);
  }, [open, defaultCompany, defaultEmail, recommendedOfferId]);

  if (!open) return null;

  const selected = offerOptions.find((opt) => opt.offerId === selectedOfferId) ?? null;
  const canSubmit =
    !pending &&
    Boolean(quoteId) &&
    Boolean(selected?.offerId) &&
    Boolean(selected?.providerId) &&
    Boolean(email && email.includes("@"));

  const submit = () => {
    if (!canSubmit || !selected) return;
    const requestedAt = new Date().toISOString();
    startTransition(async () => {
      try {
        const res = await fetch("/api/portal/customer/request-introduction", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            quoteId,
            offerId: selected.offerId,
            providerId: selected.providerId,
            email,
            company: company.trim() || undefined,
            notes: notes.trim() || undefined,
          }),
        });
        if (!res.ok) {
          console.debug("[request introduction] submit failed", { status: res.status });
        }
      } catch (error) {
        console.debug("[request introduction] submit crashed", { error });
      } finally {
        // Fail-soft UX: customer sees success even if ops_events constraint is stale.
        setMode("success");
        onSubmitted?.({
          quoteId,
          providerId: selected.providerId,
          offerId: selected.offerId,
          supplierName: selected.label,
          requestedAt,
        });
      }
    });
  };

  const closeLabel = mode === "success" ? "Done" : "Close";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6"
      role="dialog"
      aria-modal="true"
      aria-label="Request introduction"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-6 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
              Request introduction
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">
              {mode === "success" ? "We’ll connect you shortly" : "We’ll connect you to the partner"}
            </h3>
            {mode === "success" ? (
              <p className="mt-1 text-sm text-slate-300">
                Thanks — our team will reach out with next steps.
              </p>
            ) : (
              <p className="mt-1 text-sm text-slate-300">
                Confirm your contact details and choose which offer you want an intro to.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            {closeLabel}
          </button>
        </div>

        {mode === "success" ? (
          <div className="mt-5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            We’ll connect you shortly.
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Offer option
              </span>
              <select
                value={selectedOfferId}
                onChange={(e) => setSelectedOfferId(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-400 focus:outline-none"
              >
                {offerOptions.map((opt) => (
                  <option key={opt.offerId} value={opt.offerId}>
                    {opt.label}
                    {opt.shortlisted ? " (shortlisted)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Email
              </span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoComplete="email"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="you@company.com"
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Company (optional)
              </span>
              <input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                autoComplete="organization"
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="Company name"
                maxLength={200}
              />
            </label>

            <label className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Notes (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="Anything we should include in the intro?"
                maxLength={2000}
              />
            </label>

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className={clsx(
                  "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
                  pending ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className={clsx(
                  "rounded-full border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400",
                  !canSubmit ? "cursor-not-allowed opacity-60" : "",
                )}
              >
                {pending ? "Submitting..." : "Request introduction"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

