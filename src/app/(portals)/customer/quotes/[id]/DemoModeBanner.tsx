"use client";

import { useCallback, useState } from "react";

type DemoModeBannerProps = {
  className?: string;
};

export function DemoModeBanner({ className }: DemoModeBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  const jumpTo = useCallback((targetId: string) => {
    if (typeof window === "undefined") return;

    const hash = `#${targetId}`;
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }

    requestAnimationFrame(() => {
      document
        .getElementById(targetId)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  if (dismissed) return null;

  return (
    <section
      role="region"
      aria-label="Demo mode"
      className={
        className ??
        "rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-slate-200"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Demo mode</p>
          <p className="mt-1 text-xs text-slate-400">
            This view highlights the intended workflow and may show placeholder
            guidance.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="rounded-full border border-slate-800 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300 transition hover:border-slate-600 hover:text-white"
          aria-label="Dismiss demo mode banner"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => jumpTo("decision")}
          className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
        >
          Jump to Decision
        </button>
        <button
          type="button"
          onClick={() => jumpTo("messages")}
          className="inline-flex items-center justify-center rounded-full border border-slate-800 bg-black/20 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white"
        >
          Jump to Messages
        </button>
      </div>
    </section>
  );
}

