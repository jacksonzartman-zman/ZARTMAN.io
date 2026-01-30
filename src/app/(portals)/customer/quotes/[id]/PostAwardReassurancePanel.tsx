"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";

export function PostAwardReassurancePanel({
  quoteId,
  className,
}: {
  quoteId: string;
  className?: string;
}) {
  const storageKey = useMemo(() => {
    const normalized = typeof quoteId === "string" ? quoteId.trim() : "";
    return normalized ? `customer:quote:${normalized}:post_award_reassurance_shown` : "";
  }, [quoteId]);

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!storageKey) return;

    try {
      const alreadyShown = window.localStorage.getItem(storageKey) === "1";
      if (alreadyShown) return;

      setVisible(true);
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // Fail-soft: if storage is unavailable, still show the reassurance.
      setVisible(true);
    }
  }, [storageKey]);

  if (!visible) return null;

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4 text-sm text-slate-400",
        className,
      )}
    >
      <p>
        Your order is now being prepared by the selected manufacturing partner. We&apos;ll keep
        you updated as it progresses.
      </p>
    </section>
  );
}

