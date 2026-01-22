"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { ProviderContactRow } from "@/server/providers";
import type { RfqOffer } from "@/server/rfqs/offers";
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

  const selectedProviderLabel = useMemo(() => {
    const match = providerOptions.find((p) => p.id === providerId);
    return match?.label ?? "this provider";
  }, [providerId, providerOptions]);

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    setOpen(false);
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
        onClick={() => setOpen(true)}
        className={clsx(
          "rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
          disabled
            ? "cursor-not-allowed border-slate-800 bg-slate-950/60 text-slate-500 opacity-70"
            : "border-emerald-500/60 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
        )}
      >
        Award supplier
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-label="Award supplier"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-white">Award supplier</h3>
                <p className="mt-1 text-sm text-slate-300">
                  Select the winning provider (optionally tie to a specific offer).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
              >
                Close
              </button>
            </div>

            <form
              action={formAction}
              onSubmit={(event) => {
                const confirmed = window.confirm(
                  `Award this RFQ to ${selectedProviderLabel}?`,
                );
                if (!confirmed) event.preventDefault();
              }}
              className="mt-4 space-y-4"
            >
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
                      // Reset offer selection if provider changes.
                      setOfferId("");
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
                    onChange={(e) => setOfferId(e.target.value)}
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
                        {offer.total_price ? ` · ${offer.total_price} ${offer.currency}` : ""}
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
                  onChange={(e) => setNotes(e.target.value)}
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
                <SubmitButton />
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={clsx(
        "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition",
        pending
          ? "cursor-not-allowed opacity-70"
          : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
      )}
    >
      {pending ? "Awarding..." : "Confirm award"}
    </button>
  );
}

