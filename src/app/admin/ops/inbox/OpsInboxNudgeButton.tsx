"use client";

import { useState } from "react";

export function OpsInboxNudgeButton(props: {
  quoteId: string;
  owedBy: "customer" | "supplier" | null;
  actionClassName: string;
}) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function logFallback() {
    try {
      await fetch("/api/admin/ops/message-nudge-requested", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: props.quoteId,
          owedBy: props.owedBy,
          context: { source: "ops_inbox_reply_queue" },
        }),
      });
    } catch {
      // Fail-soft: no-op.
    }
  }

  async function onClick() {
    if (!props.quoteId || pending) return;
    setPending(true);
    setNote(null);

    try {
      // If the supplier owes the reply, try the existing nudge flow first.
      if (props.owedBy === "supplier") {
        try {
          const res = await fetch(`/api/admin/quotes/${props.quoteId}/nudge`, { method: "POST" });
          const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
          if (res.ok && json?.ok) {
            setNote("Nudged supplier");
            return;
          }
          // Fall back to an ops_event when the nudge flow is unavailable/unsupported.
          await logFallback();
          setNote(json?.error === "unsupported" ? "Nudge requested" : "Nudge requested");
          return;
        } catch {
          await logFallback();
          setNote("Nudge requested");
          return;
        }
      }

      // Customer owes reply (or unknown): record a fail-soft ops event only.
      await logFallback();
      setNote("Nudge requested");
    } finally {
      setPending(false);
      window.setTimeout(() => setNote(null), 2500);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || !props.quoteId}
        title={
          props.owedBy === "supplier"
            ? "Send a system ping into the thread (or record a nudge request)"
            : "Record a nudge request for ops follow-up"
        }
        className={`${props.actionClassName} disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {pending ? "Nudging…" : "Nudge"}
      </button>
      {note ? <span className="text-[11px] font-semibold text-slate-500">{note}</span> : null}
    </div>
  );
}

