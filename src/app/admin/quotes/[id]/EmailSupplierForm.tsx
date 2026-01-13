"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";

import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

type Result =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; threadStored: boolean; attachmentsSent: number }
  | { kind: "error"; message: string };

export function EmailSupplierForm(props: { quoteId: string; enabled: boolean }) {
  const [draft, setDraft] = useState("");
  const [includeLatestAttachments, setIncludeLatestAttachments] = useState(false);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const helpCopy = useMemo(() => {
    if (!props.enabled) {
      return "Email not configured. Add EMAIL_PROVIDER + EMAIL_FROM + EMAIL_REPLY_DOMAIN + EMAIL_BRIDGE_SECRET.";
    }
    return "Send an email to the awarded supplier. They can reply directly via email to respond.";
  }, [props.enabled]);

  const canSend = props.enabled && draft.trim().length > 0 && draft.trim().length <= 5000 && result.kind !== "sending";

  const statusCopy =
    result.kind === "sent"
      ? result.threadStored
        ? result.attachmentsSent > 0
          ? `Sent (${result.attachmentsSent} attachment${result.attachmentsSent === 1 ? "" : "s"}).`
          : "Sent."
        : result.attachmentsSent > 0
          ? `Sent (${result.attachmentsSent} attachment${result.attachmentsSent === 1 ? "" : "s"}, thread storage unavailable).`
          : "Sent (thread storage unavailable)."
      : result.kind === "error"
        ? result.message
        : null;

  return (
    <div className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Email supplier
          </p>
          <p className="mt-1 text-xs text-slate-400">{helpCopy}</p>
        </div>
        <button
          type="button"
          onClick={() => setDraft("")}
          className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
          disabled={result.kind === "sending" || draft.trim().length === 0}
        >
          Clear
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a quick update or question…"
          className={clsx(
            "min-h-[96px] w-full resize-y rounded-xl border bg-slate-950/30 px-3 py-2 text-sm text-slate-100 outline-none",
            props.enabled ? "border-slate-900/60 focus:border-slate-700" : "border-slate-900/60 opacity-70",
          )}
          disabled={!props.enabled || result.kind === "sending"}
          maxLength={5000}
        />

        <label className={clsx("flex items-center gap-2 text-xs text-slate-400", !props.enabled && "opacity-70")}>
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={includeLatestAttachments}
            disabled={!props.enabled || result.kind === "sending"}
            onChange={(e) => setIncludeLatestAttachments(e.target.checked)}
          />
          Include latest email attachments (up to 5)
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={clsx(
              "text-xs",
              statusCopy
                ? result.kind === "error"
                  ? "text-red-200"
                  : "text-emerald-200"
                : "text-slate-500",
            )}
          >
            {statusCopy ?? `${draft.trim().length}/5000`}
          </p>
          <button
            type="button"
            onClick={async () => {
              const message = draft.trim();
              if (!message || message.length > 5000) return;
              setResult({ kind: "sending" });
              try {
                const res = await fetch(`/api/admin/quotes/${props.quoteId}/email-supplier`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(includeLatestAttachments ? { message, attachmentFileIds: [] } : { message }),
                });
                const payload = (await res.json().catch(() => null)) as any;
                if (!payload || payload.ok !== true) {
                  const error = typeof payload?.error === "string" ? payload.error : "unknown";
                  const message =
                    error === "disabled"
                      ? "Email not configured."
                      : error === "missing_recipient"
                        ? "Supplier email not available."
                        : error === "unsupported"
                          ? "Email delivery not supported on this environment."
                          : "Could not send email. Try again.";
                  setResult({ kind: "error", message });
                  return;
                }
                setDraft("");
                setResult({
                  kind: "sent",
                  threadStored: Boolean(payload?.threadStored),
                  attachmentsSent: typeof payload?.attachmentsSent === "number" ? payload.attachmentsSent : 0,
                });
              } catch {
                setResult({ kind: "error", message: "Could not send email. Try again." });
              }
            }}
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
            disabled={!canSend}
          >
            {result.kind === "sending" ? "Sending…" : "Send email"}
          </button>
        </div>
      </div>
    </div>
  );
}

