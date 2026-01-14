"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function InviteEmailThreadButton(props: {
  quoteId: string;
  kind: "supplier" | "customer";
  enabled: boolean;
}) {
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const label = props.kind === "supplier" ? "Invite supplier to email" : "Invite customer to email";
  const route =
    props.kind === "supplier"
      ? `/api/admin/quotes/${props.quoteId}/invite-supplier-email`
      : `/api/admin/quotes/${props.quoteId}/invite-customer-email`;

  const disabledReason = useMemo(() => {
    if (props.enabled) return null;
    return "Email not configured.";
  }, [props.enabled]);

  const statusCopy =
    result.kind === "sent"
      ? "Invite sent."
      : result.kind === "error"
        ? result.message
        : disabledReason;

  const canSend = props.enabled && props.quoteId && result.kind !== "sending";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex whitespace-nowrap")}
        disabled={!canSend}
        onClick={async () => {
          if (!props.quoteId) return;
          if (!props.enabled) return;
          setResult({ kind: "sending" });
          try {
            const res = await fetch(route, { method: "POST" });
            const payload = (await res.json().catch(() => null)) as any;
            if (!payload || payload.ok !== true) {
              const err = typeof payload?.error === "string" ? payload.error : "unknown";
              const message =
                err === "disabled"
                  ? "Email replies are disabled."
                  : err === "unsupported"
                    ? "Email replies aren’t supported for this quote."
                    : err === "not_opted_in"
                      ? "Customer has not enabled email replies for this quote."
                      : err === "missing_recipient"
                        ? "Recipient email not available."
                        : "Could not send invite. Try again.";
              setResult({ kind: "error", message });
              return;
            }
            setResult({ kind: "sent" });
          } catch {
            setResult({ kind: "error", message: "Could not send invite. Try again." });
          }
        }}
      >
        {result.kind === "sending" ? "Sending…" : label}
      </button>
      {statusCopy ? (
        <p
          className={clsx(
            "text-[11px]",
            result.kind === "error"
              ? "text-red-200"
              : result.kind === "sent"
                ? "text-emerald-200"
                : "text-slate-500",
          )}
        >
          {statusCopy}
        </p>
      ) : null}
    </div>
  );
}

