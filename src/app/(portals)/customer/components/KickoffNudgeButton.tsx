"use client";

import { useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { nudgeSupplierKickoffAction } from "@/app/(portals)/customer/actions/kickoffNudge";

export function KickoffNudgeButton({
  quoteId,
  supplierId,
  className,
}: {
  quoteId: string;
  supplierId: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const action = useMemo(() => {
    const q = quoteId;
    const s = supplierId;
    return async () => nudgeSupplierKickoffAction({ quoteId: q, supplierId: s });
  }, [quoteId, supplierId]);

  const handleClick = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage("Nudge sent.");
        return;
      }
      if (result.reason === "recent_nudge") {
        setMessage("Already nudged today.");
        return;
      }
      setMessage("Unable to nudge right now.");
    });
  };

  return (
    <div className={clsx("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className={clsx(
          "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition",
          pending
            ? "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-500"
            : "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
        )}
      >
        {pending ? "Nudging..." : "Nudge supplier"}
      </button>
      {message ? <p className="text-[11px] text-slate-400">{message}</p> : null}
    </div>
  );
}

