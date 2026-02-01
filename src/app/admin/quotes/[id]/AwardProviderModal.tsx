"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ProviderContactRow } from "@/server/providers";
import type { RfqOffer } from "@/server/rfqs/offers";
import { formatCurrency } from "@/lib/formatCurrency";
import {
  awardProviderForQuoteAction,
  type AwardProviderFormState,
} from "./actions";

const INITIAL_STATE: AwardProviderFormState = { status: "idle" };

type AwardProviderModalProps = {
  quoteId: string;
  providers: ProviderContactRow[];
  offers: RfqOffer[];
  disabled?: boolean;
  initialProviderId?: string | null;
  initialOfferId?: string | null;
};

export function AwardProviderModal({
  quoteId,
  providers,
  offers,
  disabled,
  initialProviderId,
  initialOfferId,
}: AwardProviderModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [providerId, setProviderId] = useState<string>(
    typeof initialProviderId === "string" ? initialProviderId : "",
  );
  const [offerId, setOfferId] = useState<string>(
    typeof initialOfferId === "string" ? initialOfferId : "",
  );
  const [notes, setNotes] = useState("");

  const action = useMemo(
    () => awardProviderForQuoteAction.bind(null, quoteId),
    [quoteId],
  );
  const [state, formAction] = useFormState<AwardProviderFormState, FormData>(
    action,
    INITIAL_STATE,
  );

  const providerOptions = useMemo(() => {
    return [...providers]
      .map((p) => ({
        id: p.id,
        label: p.name ?? p.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [providers]);

  const offersForProvider = useMemo(() => {
    if (!providerId) return [];
    return offers.filter((offer) => offer.provider_id === providerId);
  }, [offers, providerId]);

  const formatOfferFinancialSummary = (offer: RfqOffer): string => {
    const currency = offer.currency ?? "USD";
    const total = toFiniteNumber(offer.total_price);
    const internalCost = toFiniteNumber((offer as any)?.internal_cost);
    const internalShipping = toFiniteNumber((offer as any)?.internal_shipping_cost);
    const internalTotal =
      internalCost === null && internalShipping === null
        ? null
        : (internalCost ?? 0) + (internalShipping ?? 0);
    const parts: string[] = [];
    if (typeof total === "number") {
      parts.push(`Customer ${formatCurrency(total, currency)}`);
    }
    if (typeof internalTotal === "number" && Number.isFinite(internalTotal)) {
      parts.push(`Internal ${formatCurrency(internalTotal, currency)}`);
      if (typeof total === "number" && Number.isFinite(total)) {
        parts.push(`Margin ${formatCurrency(total - internalTotal, currency)}`);
      }
    }
    return parts.length > 0 ? parts.join(" · ") : "";
  };

  const selectedProviderLabel = useMemo(() => {
    const match = providerOptions.find((p) => p.id === providerId);
    return match?.label ?? "this provider";
  }, [providerId, providerOptions]);

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    setOpen(false);
    setConfirmed(false);
  }, [router, state.status]);

  const fieldErrorProvider =
    state.status === "error" ? state.fieldErrors?.providerId ?? null : null;
  const fieldErrorOffer =
    state.status === "error" ? state.fieldErrors?.offerId ?? null : null;
  const fieldErrorNotes =
    state.status === "error" ? state.fieldErrors?.awardNotes ?? null : null;

  return (
    <>
      <button
        type="button"
        disabled={Boolean(disabled)}
        onClick={() => {
          setOpen((v) => !v);
          setConfirmed(false);
        }}
        className={clsx(
          "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
          disabled
            ? "cursor-not-allowed border-slate-800 bg-slate-950/60 text-slate-500 opacity-70"
            : "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
        )}
      >
        {open ? "Close award" : "Award supplier"}
      </button>

      {open ? (
        <div className="mt-3 rounded-2xl border border-slate-900 bg-slate-950/40 p-4 text-slate-100">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-white">Award supplier (provider offer)</h3>
              <p className="mt-1 text-xs text-slate-400">
                Select the winning provider (optionally tie to a specific offer). Then confirm.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirmed(false);
              }}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Close
            </button>
          </div>

          <form action={formAction} className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Provider (required)
                </span>
                <select
                  name="providerId"
                  required
                  value={providerId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setProviderId(next);
                    setOfferId("");
                    setConfirmed(false);
                  }}
                  className={clsx(
                    "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    fieldErrorProvider ? "border-amber-500/50" : "border-slate-800",
                  )}
                >
                  <option value="" disabled>
                    Select a provider…
                  </option>
                  {providerOptions.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {fieldErrorProvider ? (
                  <p className="text-xs text-amber-300" aria-live="polite">
                    {fieldErrorProvider}
                  </p>
                ) : null}
              </label>

              <label className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Offer (optional)
                </span>
                <select
                  name="offerId"
                  value={offerId}
                  onChange={(e) => {
                    setOfferId(e.target.value);
                    setConfirmed(false);
                  }}
                  disabled={!providerId}
                  className={clsx(
                    "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                    !providerId ? "cursor-not-allowed opacity-70" : null,
                    fieldErrorOffer ? "border-amber-500/50" : "border-slate-800",
                  )}
                >
                  <option value="">—</option>
                  {offersForProvider.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.id.slice(0, 8).toUpperCase()}
                      {(() => {
                        const financial = formatOfferFinancialSummary(offer);
                        return financial ? ` · ${financial}` : "";
                      })()}
                      {offer.lead_time_days_min || offer.lead_time_days_max
                        ? ` · ${offer.lead_time_days_min ?? "?"}-${offer.lead_time_days_max ?? "?"}d`
                        : ""}
                    </option>
                  ))}
                </select>
                {fieldErrorOffer ? (
                  <p className="text-xs text-amber-300" aria-live="polite">
                    {fieldErrorOffer}
                  </p>
                ) : null}
              </label>
            </div>

            <label className="space-y-1 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Award notes (optional)
              </span>
              <textarea
                name="awardNotes"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  setConfirmed(false);
                }}
                rows={3}
                maxLength={2000}
                placeholder="Optional internal notes (why this provider won, any caveats, etc.)"
                className={clsx(
                  "w-full resize-none rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                  fieldErrorNotes ? "border-amber-500/50" : "border-slate-800",
                )}
              />
              {fieldErrorNotes ? (
                <p className="text-xs text-amber-300" aria-live="polite">
                  {fieldErrorNotes}
                </p>
              ) : null}
            </label>

            <label className="flex items-start gap-2 rounded-xl border border-slate-900/60 bg-black/20 px-4 py-3 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I confirm awarding this RFQ to{" "}
                <span className="font-semibold text-slate-100">
                  {selectedProviderLabel}
                </span>
                .
              </span>
            </label>

            <div className="flex flex-wrap items-center justify-end gap-3">
              {state.status === "error" && state.error ? (
                <span className="text-xs text-amber-300" aria-live="polite">
                  {state.error}
                </span>
              ) : null}
              {state.status === "success" && state.message ? (
                <span className="text-xs text-emerald-300" aria-live="polite">
                  {state.message}
                </span>
              ) : null}
              <SubmitButton disabled={!confirmed} />
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || Boolean(disabled);
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={clsx(
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition",
        isDisabled
          ? "cursor-not-allowed opacity-70"
          : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
      )}
    >
      {pending ? "Awarding..." : "Confirm award"}
    </button>
  );
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

