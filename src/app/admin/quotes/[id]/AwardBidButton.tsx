"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

type AwardBidButtonProps = {
  quoteId: string;
  bidId: string;
  supplierName?: string | null;
  className?: string;
};

export function AwardBidButton({
  quoteId,
  bidId,
  supplierName,
  className,
}: AwardBidButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const label = useMemo(() => {
    const trimmed = typeof supplierName === "string" ? supplierName.trim() : "";
    return trimmed.length > 0 ? trimmed : "this supplier";
  }, [supplierName]);

  const onConfirmAward = useCallback(async () => {
    setPending(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/quotes/${quoteId}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidId,
          awardNotes: notes.trim().length > 0 ? notes.trim() : undefined,
        }),
      });

      if (res.status === 409) {
        setError("This quote was already awarded. Refresh to see the latest state.");
        return;
      }

      if (!res.ok) {
        setError("Unable to award right now. Please try again.");
        return;
      }

      setConfirming(false);
      router.refresh();
      const kickoff = document.getElementById("kickoff");
      kickoff?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }, [bidId, notes, quoteId, router]);

  return (
    <div className={clsx("flex flex-col items-end gap-1", className)}>
      {!confirming ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className={clsx(
            "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition",
            pending
              ? "cursor-not-allowed opacity-70"
              : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
          )}
        >
          Award
        </button>
      ) : (
        <div className="w-[18rem] space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-left">
          <p className="text-xs font-semibold text-slate-100">Confirm award</p>
          <p className="text-[11px] text-slate-400">
            Award this RFQ to <span className="font-semibold text-slate-200">{label}</span>?
          </p>
          <label className="block space-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Notes (optional)
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Internal notes (optional)…"
              className="w-full resize-none rounded-lg border border-slate-800 bg-slate-950/40 px-2 py-1.5 text-xs text-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (pending) return;
                setConfirming(false);
              }}
              className={clsx(
                "rounded-full border border-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 transition",
                pending
                  ? "cursor-not-allowed opacity-60"
                  : "hover:border-slate-700 hover:text-white",
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={onConfirmAward}
              className={clsx(
                "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition",
                pending
                  ? "cursor-not-allowed opacity-70"
                  : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
              )}
            >
              {pending ? "Awarding..." : "Confirm award"}
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="text-[11px] text-amber-300" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

