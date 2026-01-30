"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import PortalCard from "../../PortalCard";

type Availability =
  | { kind: "ready" }
  | { kind: "disabled"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "missing_profile"; message: string };

export function CustomerEmailRepliesDefaultsCard(props: {
  initialEnabled: boolean;
  availability: Availability;
}) {
  const [enabled, setEnabled] = useState(Boolean(props.initialEnabled));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canToggle = props.availability.kind === "ready";

  const helperText =
    "Suppliers will reply via masked email addresses. You can turn this off per quote.";

  const status = useMemo(() => {
    if (props.availability.kind !== "ready") return props.availability.message;
    return enabled ? "Enabled for new search requests" : "Off by default";
  }, [enabled, props.availability]);

  return (
    <PortalCard title="Email replies" description={helperText}>
      <div className="space-y-4">

        {props.availability.kind !== "ready" ? (
          <p className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-200">
            {status}
          </p>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </p>
        ) : null}

        <label
          className={clsx(
            "flex items-start gap-4 rounded-2xl border px-6 py-4",
            canToggle
              ? "border-slate-900/60 bg-slate-950/30"
              : "border-slate-900/40 bg-slate-950/20 opacity-70",
          )}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canToggle || busy}
            onChange={async () => {
              if (!canToggle) return;
              const next = !enabled;
              setBusy(true);
              setError(null);
              try {
                const res = await fetch("/api/portal/customer/email-default", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ enabled: next }),
                });
                const payload = (await res.json().catch(() => null)) as any;
                if (!payload || payload.ok !== true) {
                  const err = typeof payload?.error === "string" ? payload.error : "unknown";
                  const message =
                    err === "disabled"
                      ? "Email bridge not configured."
                      : err === "unsupported"
                        ? "Not available on this deployment."
                        : "Could not update this setting. Try again.";
                  setError(message);
                  return;
                }
                setEnabled(Boolean(payload.enabled));
              } catch {
                setError("Could not update this setting. Try again.");
              } finally {
                setBusy(false);
              }
            }}
            className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-400 focus:ring-emerald-300"
          />
          <span className="space-y-1">
            <span className="text-sm font-semibold text-white">
              Enable email replies by default for new search requests
            </span>
            <p className="text-xs text-slate-400">
              {busy ? "Saving…" : enabled ? "On" : "Off"}
            </p>
          </span>
        </label>

        <p className="text-xs text-slate-500">
          Per-quote email reply controls remain the source of truth for existing search requests.
        </p>
      </div>
    </PortalCard>
  );
}

