"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { CopyTextButton } from "@/components/CopyTextButton";
import PortalCard from "../../../PortalCard";

type Status =
  | { kind: "disabled"; reason?: string }
  | { kind: "not_configured"; reason?: string }
  | { kind: "enabled" }
  | { kind: "disabled_opted_out" };

export function CustomerEmailRepliesCard(props: {
  quoteId: string;
  initialOptedIn: boolean;
  bridgeEnabled: boolean;
  replyToAddress: string;
}) {
  const [optedIn, setOptedIn] = useState(Boolean(props.initialOptedIn));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status: Status = useMemo(() => {
    if (!props.bridgeEnabled) {
      return { kind: "disabled", reason: "Email replies aren’t available right now." };
    }
    if (!props.replyToAddress) {
      return { kind: "not_configured", reason: "Email replies aren’t available yet." };
    }
    return optedIn ? { kind: "enabled" } : { kind: "disabled_opted_out" };
  }, [optedIn, props.bridgeEnabled, props.replyToAddress]);

  const statusLabel =
    status.kind === "enabled"
      ? "Enabled"
      : status.kind === "disabled_opted_out"
        ? "Disabled"
        : status.kind === "not_configured"
          ? "Not configured"
          : "Disabled";

  const helper =
    status.kind === "enabled"
      ? "Replies you send from email will appear in this thread."
      : status.kind === "disabled_opted_out"
        ? "Email replies are off by default. Enable to reply via email."
        : status.reason ?? "Email replies are not available.";

  const canToggle = props.bridgeEnabled && Boolean(props.replyToAddress);

  return (
    <PortalCard
      title="Email replies"
      description={helper}
      action={
        <span
          className={clsx(
            "rounded-full border px-3 py-1 text-[11px] font-semibold",
            status.kind === "enabled"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
              : "border-slate-800 bg-slate-950/30 text-slate-300",
          )}
        >
          {statusLabel}
        </span>
      }
    >
      <div className="space-y-3">

        {props.replyToAddress ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Reply-to address</p>
              <CopyTextButton
                text={props.replyToAddress}
                idleLabel="Copy"
                logPrefix="[email_bridge]"
              />
            </div>
            <p className="break-anywhere mt-2 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 text-xs text-slate-100">
              {props.replyToAddress}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
            {error}
          </p>
        ) : null}

        {canToggle ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              className={clsx(
                "inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-60",
                optedIn
                  ? "border-slate-800 text-slate-200 hover:border-slate-600 hover:text-white"
                  : "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:text-white",
              )}
              onClick={async () => {
                if (!props.quoteId) return;
                setBusy(true);
                setError(null);
                const nextEnabled = !optedIn;
                try {
                  const res = await fetch(`/api/customer/quotes/${props.quoteId}/email-prefs`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: nextEnabled }),
                  });
                  const payload = (await res.json().catch(() => null)) as any;
                  if (!payload || payload.ok !== true) {
                    const err = typeof payload?.error === "string" ? payload.error : "unknown";
                    const message =
                      err === "unsupported"
                        ? "Email replies aren’t supported on this environment yet."
                        : err === "disabled"
                          ? "Email replies are disabled."
                          : "Could not update this setting. Try again.";
                    setError(message);
                    setBusy(false);
                    return;
                  }
                  setOptedIn(nextEnabled);
                } catch {
                  setError("Could not update this setting. Try again.");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Saving…" : optedIn ? "Disable email replies" : "Enable email replies"}
            </button>
          </div>
        ) : null}
      </div>
    </PortalCard>
  );
}

