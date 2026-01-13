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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = useMemo(() => {
    const trimmed = typeof supplierName === "string" ? supplierName.trim() : "";
    return trimmed.length > 0 ? trimmed : "this supplier";
  }, [supplierName]);

  const onClick = useCallback(async () => {
    const confirmed = window.confirm(`Award this RFQ to ${label}?`);
    if (!confirmed) return;

    setPending(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/quotes/${quoteId}/award`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidId }),
      });

      if (res.status === 409) {
        setError("This quote was already awarded. Refresh to see the latest state.");
        return;
      }

      if (!res.ok) {
        setError("Unable to award right now. Please try again.");
        return;
      }

      router.refresh();
      const kickoff = document.getElementById("kickoff");
      kickoff?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPending(false);
    }
  }, [bidId, label, quoteId, router]);

  return (
    <div className={clsx("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        className={clsx(
          "rounded-full border border-emerald-500/60 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-100 transition",
          pending
            ? "cursor-not-allowed opacity-70"
            : "hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
        )}
      >
        {pending ? "Awarding..." : "Award"}
      </button>
      {error ? (
        <p className="text-[11px] text-amber-300" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

