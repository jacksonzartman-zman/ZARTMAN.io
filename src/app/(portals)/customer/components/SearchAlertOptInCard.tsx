"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import PortalCard from "../../PortalCard";

type SearchAlertOptInCardProps = {
  quoteId: string;
  initialEnabled: boolean;
  quoteLabel?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
};

const STATUS_PILL_CLASSES =
  "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide";
const STATUS_ENABLED_CLASSES = "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
const STATUS_DISABLED_CLASSES = "border-slate-800 bg-slate-950/30 text-slate-300";
const STATUS_BUSY_CLASSES = "border-slate-700 bg-slate-950/40 text-slate-300";

export function SearchAlertOptInCard({
  quoteId,
  initialEnabled,
  quoteLabel,
  disabled = false,
  disabledReason,
}: SearchAlertOptInCardProps) {
  const [enabled, setEnabled] = useState(Boolean(initialEnabled));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (busy) return "Saving";
    return enabled ? "Enabled" : "Off";
  }, [busy, enabled]);

  const statusClasses = useMemo(() => {
    if (busy) return STATUS_BUSY_CLASSES;
    return enabled ? STATUS_ENABLED_CLASSES : STATUS_DISABLED_CLASSES;
  }, [busy, enabled]);

  const helper =
    "Turn this on and we will email you when new offers arrive for this search.";
  const confirmationMessage =
    message ??
    (enabled
      ? "Search alerts are enabled."
      : disabled
        ? "Search alerts are off for this search."
        : "Search alerts are off. You can enable them anytime.");

  return (
    <PortalCard
      title="Search alerts"
      description={helper}
      action={<span className={clsx(STATUS_PILL_CLASSES, statusClasses)}>{statusLabel}</span>}
    >
      <label className="flex items-start gap-3 text-sm text-slate-200">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-400 focus:ring-emerald-300"
          checked={enabled}
          disabled={disabled || busy}
          onChange={async (event) => {
            if (!quoteId || disabled || busy) {
              return;
            }
            const previous = enabled;
            const nextEnabled = event.target.checked;
            setBusy(true);
            setError(null);
            setMessage(null);
            setEnabled(nextEnabled);
            try {
              const normalizedLabel =
                typeof quoteLabel === "string" ? quoteLabel.trim() : "";
              const payload = {
                quoteId,
                enabled: nextEnabled,
                label: normalizedLabel || undefined,
              };
              const res = await fetch("/api/portal/customer/search-alerts", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const data = (await res.json().catch(() => null)) as
                | { ok?: boolean; error?: string }
                | null;
              if (!data || data.ok !== true) {
                const code = typeof data?.error === "string" ? data.error : "unknown";
                setError(
                  code === "unsupported"
                    ? "Search alerts are not available on this deployment yet."
                    : "Could not update search alerts. Try again.",
                );
                setEnabled(previous);
                return;
              }
              setMessage(
                nextEnabled
                  ? "Alerts enabled — we'll email you when new offers arrive."
                  : "Alerts disabled — you will not receive new-offer emails.",
              );
            } catch {
              setError("Could not update search alerts. Try again.");
              setEnabled(previous);
            } finally {
              setBusy(false);
            }
          }}
        />
        <span className="space-y-1">
          <span className="text-sm font-semibold text-white">
            Email me when new offers arrive
          </span>
          <p className="text-xs text-slate-400">
            We&apos;ll only email when new offers show up for this search.
          </p>
        </span>
      </label>

      {disabled && (disabledReason ?? "") ? (
        <p className="mt-3 text-xs text-slate-500">
          {disabledReason}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-100">
          {error}
        </p>
      ) : null}

      {!error ? (
        <p className="mt-3 text-xs text-slate-400" aria-live="polite">
          {confirmationMessage}
        </p>
      ) : null}
    </PortalCard>
  );
}
