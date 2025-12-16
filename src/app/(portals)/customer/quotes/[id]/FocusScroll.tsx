"use client";

import { useEffect } from "react";

export function FocusScroll({
  enabled,
  targetId,
}: {
  enabled: boolean;
  targetId: string;
}) {
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
