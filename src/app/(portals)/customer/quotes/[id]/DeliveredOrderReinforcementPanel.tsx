"use client";

import clsx from "clsx";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export function DeliveredOrderReinforcementPanel({
  quoteId,
  className,
}: {
  quoteId: string;
  className?: string;
}) {
  const storageKey = useMemo(() => {
    const normalized = typeof quoteId === "string" ? quoteId.trim() : "";
    return normalized ? `customer:quote:${normalized}:delivered_reinforcement_shown:v1` : "";
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
      // Fail-soft: if storage is unavailable, still show the reinforcement.
      setVisible(true);
    }
  }, [storageKey]);

  if (!visible) return null;

  return (
    <section
      className={clsx(
        "rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-5 py-4",
        className,
      )}
      aria-label="Delivered order reinforcement"
    >
      <p className="text-sm font-semibold text-white">Your order was completed successfully.</p>
      <p className="mt-1 text-sm text-emerald-100/80">Ready for the next part?</p>
      <div className="mt-4">
        <Link
          href="/"
          className="inline-flex items-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
        >
          Upload another part
        </Link>
      </div>
    </section>
  );
}

