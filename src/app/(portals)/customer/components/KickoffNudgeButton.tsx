"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Confirmation feedback (nudge sent)
 * - Done: Cooldown disables button + shows "Next nudge in X"
 * - Done: Error copy is calm + actionable
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import { nudgeSupplierKickoffAction } from "@/app/(portals)/customer/actions/kickoffNudge";

const NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function KickoffNudgeButton({
  quoteId,
  supplierId,
  className,
  latestNudgedAt,
  variant = "button",
}: {
  quoteId: string;
  supplierId: string;
  className?: string;
  latestNudgedAt?: string | null;
  variant?: "button" | "link";
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [cooldownUntilMs, setCooldownUntilMs] = useState<number | null>(null);
  const action = useMemo(() => {
    const q = quoteId;
    const s = supplierId;
    return async () => nudgeSupplierKickoffAction({ quoteId: q, supplierId: s });
  }, [quoteId, supplierId]);

  useEffect(() => {
    if (!latestNudgedAt) return;
    const parsed = Date.parse(latestNudgedAt);
    if (!Number.isFinite(parsed)) return;
    setCooldownUntilMs(parsed + NUDGE_COOLDOWN_MS);
  }, [latestNudgedAt]);

  const nowMs = Date.now();
  const cooldownActive =
    typeof cooldownUntilMs === "number" && Number.isFinite(cooldownUntilMs) && nowMs < cooldownUntilMs;
  const remainingMs = cooldownActive && cooldownUntilMs ? cooldownUntilMs - nowMs : 0;
  const remainingLabel = cooldownActive ? formatDurationCompact(remainingMs) : null;

  const buttonLabel = pending
    ? "Nudging..."
    : cooldownActive
      ? "Nudge on cooldown"
      : "Nudge supplier";

  const handleClick = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        setMessage("Nudge sent.");
        setCooldownUntilMs(Date.now() + NUDGE_COOLDOWN_MS);
        return;
      }
      if (result.reason === "recent_nudge") {
        setMessage(
          remainingLabel ? `Next nudge available in ${remainingLabel}.` : "Next nudge available later.",
        );
        setCooldownUntilMs(Date.now() + NUDGE_COOLDOWN_MS);
        return;
      }
      setMessage("We couldn’t send a nudge right now. Please try again.");
    });
  };

  return (
    <div className={clsx("flex flex-col items-end gap-1", className)}>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending || cooldownActive}
        className={
          variant === "link"
            ? clsx(
                "bg-transparent px-0 py-0 text-xs font-semibold underline-offset-4 transition",
                pending || cooldownActive
                  ? "cursor-not-allowed text-slate-500"
                  : "text-slate-300 hover:text-white hover:underline",
              )
            : clsx(
                "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition",
                pending || cooldownActive
                  ? "cursor-not-allowed border-slate-800 bg-slate-950/40 text-slate-500"
                  : "border-slate-700 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
              )
        }
      >
        {buttonLabel}
      </button>
      {cooldownActive && remainingLabel ? (
        <p className="text-[11px] text-slate-500">Next nudge in {remainingLabel}.</p>
      ) : null}
      {message ? <p className="text-[11px] text-slate-400">{message}</p> : null}
    </div>
  );
}

function formatDurationCompact(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const totalMinutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes <= 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

