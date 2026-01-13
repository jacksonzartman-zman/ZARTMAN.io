"use client";

import clsx from "clsx";
import { useCallback } from "react";

export function ReplyNowButton({
  quoteId,
  className,
}: {
  quoteId: string;
  className?: string;
}) {
  const onClick = useCallback(() => {
    if (typeof window === "undefined") return;
    if (typeof document === "undefined") return;

    try {
      // Ensure the Messages disclosure opens (DisclosureSection listens to hash changes).
      window.location.hash = "#messages";

      const textareaId = `quote-message-body-${quoteId}`;
      const section = document.getElementById("messages");

      // Best-effort: scroll to the composer and focus. We retry briefly in case the
      // disclosure is still opening / mounting the composer.
      const tryFocus = (attempt: number) => {
        const textarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
        if (textarea) {
          textarea.scrollIntoView({ behavior: "smooth", block: "center" });
          textarea.focus();
          return;
        }

        if (attempt === 0) {
          section?.scrollIntoView({ behavior: "smooth", block: "start" });
        }

        if (attempt >= 12) return;
        window.requestAnimationFrame(() => tryFocus(attempt + 1));
      };

      window.requestAnimationFrame(() => tryFocus(0));
    } catch {
      // Fail silently (best-effort UI enhancement).
    }
  }, [quoteId]);

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center rounded-full bg-emerald-400 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-950 transition hover:bg-emerald-300",
        className,
      )}
    >
      Reply now
    </button>
  );
}

