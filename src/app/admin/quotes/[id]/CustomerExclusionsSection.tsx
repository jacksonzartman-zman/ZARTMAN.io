"use client";

import clsx from "clsx";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addCustomerExclusionAction,
  removeCustomerExclusionAction,
  type CustomerExclusionRow,
  type CustomerExclusionActionResult,
} from "./actions";

type ProviderOption = { id: string; name: string | null };

export function CustomerExclusionsSection(props: {
  quoteId: string;
  customerId: string;
  providers: ProviderOption[];
  exclusions: CustomerExclusionRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<CustomerExclusionActionResult | null>(null);
  const [providerId, setProviderId] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [reason, setReason] = useState("");

  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};
  const errorMessage = state && !state.ok ? state.error : null;

  const normalizedSourceName = sourceName.trim();
  const normalizedReason = reason.trim();

  const canSubmit = useMemo(() => {
    if (pending) return false;
    if (!props.customerId || !props.quoteId) return false;
    const hasProvider = providerId.trim().length > 0;
    const hasSource = normalizedSourceName.length > 0;
    return hasProvider || hasSource;
  }, [normalizedSourceName.length, pending, props.customerId, props.quoteId, providerId]);

  const onAdd = () => {
    if (!canSubmit) return;
    startTransition(async () => {
      const result = await addCustomerExclusionAction({
        quoteId: props.quoteId,
        customerId: props.customerId,
        excludedProviderId: providerId.trim() || null,
        excludedSourceName: normalizedSourceName || null,
        reason: normalizedReason || null,
      });
      setState(result);
      if (result.ok) {
        setProviderId("");
        setSourceName("");
        setReason("");
        router.refresh();
      }
    });
  };

  const onRemove = (exclusionId: string) => {
    if (pending) return;
    startTransition(async () => {
      const result = await removeCustomerExclusionAction({
        quoteId: props.quoteId,
        customerId: props.customerId,
        exclusionId,
      });
      setState(result);
      if (result.ok) {
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
        <p className="text-sm font-semibold text-white">Add exclusion</p>
        <p className="mt-1 text-xs text-slate-400">
          Blocks future offers from the selected provider and/or external source label for this customer.
        </p>

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,0.35fr)_minmax(0,0.2fr)]">
          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Provider (optional)
            </span>
            <select
              value={providerId}
              onChange={(e) => setProviderId(e.target.value)}
              className={clsx(
                "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                fieldErrors.excludedProviderId ? "border-amber-500/50" : "border-slate-800",
              )}
            >
              <option value="">—</option>
              {props.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name?.trim() ? p.name.trim() : p.id}
                </option>
              ))}
            </select>
            {fieldErrors.excludedProviderId ? (
              <p className="text-xs text-amber-300" aria-live="polite">
                {fieldErrors.excludedProviderId}
              </p>
            ) : null}
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Source name (optional)
            </span>
            <input
              value={sourceName}
              onChange={(e) => setSourceName(e.target.value)}
              maxLength={200}
              className={clsx(
                "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                fieldErrors.excludedSourceName ? "border-amber-500/50" : "border-slate-800",
              )}
              placeholder='e.g. “Xometry”, “Protolabs”'
            />
            {fieldErrors.excludedSourceName ? (
              <p className="text-xs text-amber-300" aria-live="polite">
                {fieldErrors.excludedSourceName}
              </p>
            ) : null}
          </label>

          <label className="space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Reason (optional)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              className={clsx(
                "w-full rounded-xl border bg-slate-950/40 px-3 py-2 text-sm text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
                fieldErrors.reason ? "border-amber-500/50" : "border-slate-800",
              )}
              placeholder="Internal note"
            />
            {fieldErrors.reason ? (
              <p className="text-xs text-amber-300" aria-live="polite">
                {fieldErrors.reason}
              </p>
            ) : null}
          </label>
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm text-amber-200" role="alert" aria-live="polite">
            {errorMessage}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onAdd}
            disabled={!canSubmit}
            className={clsx(
              "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:bg-emerald-500/20",
              !canSubmit ? "cursor-not-allowed opacity-60" : "",
            )}
          >
            {pending ? "Saving..." : "Add exclusion"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30">
        <div className="flex items-center justify-between gap-3 border-b border-slate-900/60 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-white">Current exclusions</p>
            <p className="text-xs text-slate-400">
              {props.exclusions.length === 0
                ? "None configured."
                : `${props.exclusions.length} configured.`}
            </p>
          </div>
        </div>

        {props.exclusions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-300">No exclusions for this customer.</p>
        ) : (
          <ul className="divide-y divide-slate-900/60">
            {props.exclusions.map((ex) => {
              const providerLabel = ex.excluded_provider_id
                ? props.providers.find((p) => p.id === ex.excluded_provider_id)?.name ??
                  ex.excluded_provider_id
                : null;
              const sourceLabel = ex.excluded_source_name?.trim() ? ex.excluded_source_name.trim() : null;
              const reasonLabel = ex.reason?.trim() ? ex.reason.trim() : null;

              return (
                <li key={ex.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">
                      {providerLabel ? `Provider: ${providerLabel}` : null}
                      {providerLabel && sourceLabel ? " · " : null}
                      {sourceLabel ? `Source: ${sourceLabel}` : null}
                    </p>
                    {reasonLabel ? (
                      <p className="mt-1 text-xs text-slate-400">Reason: {reasonLabel}</p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">No reason recorded.</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(ex.id)}
                    disabled={pending}
                    className={clsx(
                      "rounded-full border border-slate-800 bg-slate-950/40 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white",
                      pending ? "cursor-not-allowed opacity-60" : "",
                    )}
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

