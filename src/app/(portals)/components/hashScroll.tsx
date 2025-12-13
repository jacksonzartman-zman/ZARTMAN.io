"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { useCallback, useEffect } from "react";

type UseHashScrollOptions = {
  /**
   * Element id to scroll to (without the leading '#').
   * Defaults to the same value as `hash`.
   */
  targetId?: string;
  /**
   * Hash (without the leading '#') that should be set in the URL.
   * Defaults to "kickoff".
   */
  hash?: string;
};

export function useHashScroll({
  targetId,
  hash = "kickoff",
}: UseHashScrollOptions = {}) {
  const resolvedTargetId = targetId ?? hash;
  const resolvedHash = hash;

  const scrollToTarget = useCallback(
    (options?: { updateHash?: boolean }) => {
      if (typeof window === "undefined") {
        return false;
      }
      const element = window.document.getElementById(resolvedTargetId);
      if (!element) {
        return false;
      }
      if (options?.updateHash !== false) {
        const nextHash = `#${resolvedHash}`;
        if (window.location.hash !== nextHash) {
          window.history.replaceState(null, "", nextHash);
          // `replaceState` doesn't emit `hashchange`, but some components (e.g.
          // collapsible panels) may rely on it to react to deep links.
          window.dispatchEvent(new Event("hashchange"));
        }
      }
      element.scrollIntoView({ behavior: "smooth", block: "start" });
      return true;
    },
    [resolvedHash, resolvedTargetId],
  );

  const onClick: MouseEventHandler<HTMLAnchorElement> = useCallback(
    (event) => {
      if (event.defaultPrevented) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      scrollToTarget({ updateHash: true });
    },
    [scrollToTarget],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const expectedHash = `#${resolvedHash}`;
    if (window.location.hash !== expectedHash) {
      return;
    }

    let tries = 0;
    const attempt = () => {
      tries += 1;
      const element = window.document.getElementById(resolvedTargetId);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (tries < 12) {
        window.requestAnimationFrame(attempt);
      }
    };

    window.requestAnimationFrame(attempt);
  }, [resolvedHash, resolvedTargetId]);

  return { onClick, scrollToTarget };
}

type HashScrollLinkProps = {
  children: ReactNode;
  className?: string;
  hash?: string;
  targetId?: string;
};

export function HashScrollLink({
  children,
  className,
  hash = "kickoff",
  targetId,
}: HashScrollLinkProps) {
  const { onClick } = useHashScroll({ hash, targetId });
  return (
    <a href={`#${hash}`} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

