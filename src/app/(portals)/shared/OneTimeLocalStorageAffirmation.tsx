"use client";

import type { ElementType, ReactNode } from "react";
import { useEffect, useState } from "react";

type OneTimeLocalStorageAffirmationProps<TAs extends ElementType> = {
  storageKey: string;
  enabled?: boolean;
  as?: TAs;
  className?: string;
  children: ReactNode;
};

export function OneTimeLocalStorageAffirmation<TAs extends ElementType = "p">({
  storageKey,
  enabled = true,
  as,
  className,
  children,
}: OneTimeLocalStorageAffirmationProps<TAs>) {
  const [visible, setVisible] = useState(false);
  const Component = (as ?? "p") as ElementType;

  useEffect(() => {
    setVisible(false);
    if (!enabled) return;
    if (typeof window === "undefined") return;

    try {
      const existing = window.localStorage.getItem(storageKey);
      if (existing) return;
      setVisible(true);
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Fail-soft: if storage isn't available, do not show a one-time affirmation.
      setVisible(false);
    }
  }, [enabled, storageKey]);

  if (!visible) return null;

  return (
    <Component className={className}>
      {children}
    </Component>
  );
}

