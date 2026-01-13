"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type SupplierStatus = "active" | "paused" | "pending" | "unknown";

function normalizeSupplierStatus(value: unknown): SupplierStatus {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "paused") return "paused";
  if (raw === "pending") return "pending";
  if (raw === "active") return "active";
  return "unknown";
}

export default function BenchHealthActionsCell(props: {
  supplierId: string;
  supplierStatus: SupplierStatus;
  statusSupported: boolean;
  recommendedQuoteId: string | null;
  supportsQuoteMessages: boolean;
}) {
  const [status, setStatus] = useState<SupplierStatus>(props.supplierStatus);
  const [pending, setPending] = useState<null | "nudge" | "status">(null);
  const [note, setNote] = useState<string | null>(null);

  const threadHref = props.recommendedQuoteId
    ? `/admin/quotes/${props.recommendedQuoteId}#messages`
    : null;

  const statusAction = useMemo<{ next: "active" | "paused"; label: string }>(() => {
    const next = status === "paused" ? "active" : "paused";
    const label = status === "paused" ? "Unpause" : "Pause";
    return { next, label };
  }, [status]);

  async function nudge() {
    if (!props.recommendedQuoteId) return;
    setPending("nudge");
    setNote(null);
    try {
      const res = await fetch(`/api/admin/quotes/${props.recommendedQuoteId}/nudge`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !json?.ok) {
        setNote(json?.error === "unsupported" ? "Nudge unsupported" : "Nudge failed");
        return;
      }
      setNote("Nudged");
    } finally {
      setPending(null);
      window.setTimeout(() => setNote(null), 2500);
    }
  }

  async function toggleStatus() {
    if (!props.statusSupported) return;
    setPending("status");
    setNote(null);
    try {
      const res = await fetch(`/api/admin/suppliers/${props.supplierId}/status`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: statusAction.next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; status?: unknown }
        | null;
      if (!res.ok || !json?.ok) {
        setNote(json?.error === "unsupported" ? "Status unsupported" : "Update failed");
        return;
      }
      const nextStatus = normalizeSupplierStatus(json.status);
      setStatus(nextStatus === "unknown" ? statusAction.next : nextStatus);
      setNote(statusAction.next === "paused" ? "Paused" : "Unpaused");
    } finally {
      setPending(null);
      window.setTimeout(() => setNote(null), 2500);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {threadHref ? (
        <Link
          href={threadHref}
          className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200"
        >
          Open thread
        </Link>
      ) : (
        <span
          title="No inbound thread"
          className="inline-flex cursor-not-allowed items-center justify-center rounded-md border border-slate-900 bg-slate-950/30 px-3 py-1.5 text-xs font-semibold text-slate-500"
        >
          Open thread
        </span>
      )}

      {props.supportsQuoteMessages ? (
        <button
          type="button"
          onClick={nudge}
          disabled={pending !== null || !props.recommendedQuoteId}
          title={!props.recommendedQuoteId ? "No inbound thread" : "Send a system ping into the thread"}
          className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "nudge" ? "Nudging…" : "Nudge"}
        </button>
      ) : null}

      {props.statusSupported ? (
        <button
          type="button"
          onClick={toggleStatus}
          disabled={pending !== null}
          className="inline-flex items-center justify-center rounded-md border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-emerald-500/40 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending === "status" ? "Saving…" : statusAction.label}
        </button>
      ) : null}

      {note ? <span className="text-[11px] font-semibold text-slate-500">{note}</span> : null}
    </div>
  );
}

