"use client";

import { useState } from "react";

export function AdminKickoffUpdateRequestButton(props: {
  quoteId: string;
  className?: string;
  context?: Record<string, unknown>;
}) {
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function onClick() {
    if (!props.quoteId || pending) return;
    setPending(true);
    setNote(null);

    try {
      await fetch("/api/admin/ops/kickoff-update-requested", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId: props.quoteId,
          context: props.context ?? { source: "admin_quote_kickoff_stalled" },
        }),
      });
      setNote("Requested");
    } catch {
      // Fail-soft: record intent only (no user-facing error).
      setNote("Requested");
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
        className={
          props.className ??
          "inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-amber-100 transition hover:border-amber-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {pending ? "Requesting…" : "Request kickoff update"}
      </button>
      {note ? <span className="text-[11px] font-semibold text-slate-500">{note}</span> : null}
    </div>
  );
}

