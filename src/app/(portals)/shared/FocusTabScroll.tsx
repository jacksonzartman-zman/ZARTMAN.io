"use client";

import { useEffect } from "react";

export function FocusTabScroll({
  tab,
  when,
  targetId,
}: {
  tab: string | null | undefined;
  when: string;
  targetId: string;
}) {
  const enabled = Boolean(tab && when && tab === when);

  useEffect(() => {
    if (!enabled) return;
    if (!targetId) return;

    const attemptScroll = () => {
      const el = document.getElementById(targetId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    // Defer until layout settles.
    const raf = window.requestAnimationFrame(attemptScroll);
    const timeout = window.setTimeout(attemptScroll, 350);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [enabled, targetId]);

  return null;
}
