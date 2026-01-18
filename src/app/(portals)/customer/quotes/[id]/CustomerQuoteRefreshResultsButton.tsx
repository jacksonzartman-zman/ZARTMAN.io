"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_COOLDOWN_MS = 10_000;
const STORAGE_KEY_PREFIX = "customer-quote-refresh-results";

type CustomerQuoteRefreshResultsButtonProps = {
  quoteId: string;
};

type StoredRefreshState = {
  lastRefreshAt: number;
  cooldownUntil: number;
};

function readStoredState(storageKey: string): StoredRefreshState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredRefreshState> | null;
    if (
      !parsed ||
      typeof parsed.lastRefreshAt !== "number" ||
      typeof parsed.cooldownUntil !== "number"
    ) {
      return null;
    }
    if (!Number.isFinite(parsed.lastRefreshAt) || !Number.isFinite(parsed.cooldownUntil)) {
      return null;
    }
    return {
      lastRefreshAt: parsed.lastRefreshAt,
      cooldownUntil: parsed.cooldownUntil,
    };
  } catch {
    return null;
  }
}

function writeStoredState(storageKey: string, state: StoredRefreshState | null) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!state) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // Ignore storage errors and rely on in-memory state.
  }
}

export function CustomerQuoteRefreshResultsButton({
  quoteId,
}: CustomerQuoteRefreshResultsButtonProps) {
  const router = useRouter();
  const storageKey = `${STORAGE_KEY_PREFIX}:${quoteId}`;
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const cooldownRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = readStoredState(storageKey);
    if (!stored) {
      return;
    }
    if (stored.cooldownUntil <= Date.now()) {
      writeStoredState(storageKey, null);
      return;
    }
    setLastRefreshAt(stored.lastRefreshAt);
    setCooldownUntil(stored.cooldownUntil);
    cooldownRef.current = stored.cooldownUntil;
  }, [storageKey]);

  useEffect(() => {
    if (cooldownUntil === null) {
      return;
    }
    const remainingMs = cooldownUntil - Date.now();
    if (remainingMs <= 0) {
      setCooldownUntil(null);
      cooldownRef.current = null;
      writeStoredState(storageKey, null);
      return;
    }
    const timeout = window.setTimeout(() => {
      setCooldownUntil(null);
      cooldownRef.current = null;
      writeStoredState(storageKey, null);
    }, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [cooldownUntil, storageKey]);

  const isCooling = typeof cooldownUntil === "number" && cooldownUntil > Date.now();
  const updatedLabel = useMemo(() => {
    if (!lastRefreshAt || !isCooling) {
      return null;
    }
    return "Updated just now";
  }, [isCooling, lastRefreshAt]);

  const handleRefresh = useCallback(() => {
    const now = Date.now();
    if (cooldownRef.current && cooldownRef.current > now) {
      return;
    }
    const nextCooldownUntil = now + REFRESH_COOLDOWN_MS;
    setLastRefreshAt(now);
    setCooldownUntil(nextCooldownUntil);
    cooldownRef.current = nextCooldownUntil;
    writeStoredState(storageKey, {
      lastRefreshAt: now,
      cooldownUntil: nextCooldownUntil,
    });
    router.refresh();
  }, [router, storageKey]);

  return (
    <div className="flex flex-col items-end gap-1 text-right">
      <button
        type="button"
        onClick={handleRefresh}
        disabled={isCooling}
        className={clsx(
          "inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition",
          isCooling
            ? "cursor-not-allowed border-slate-800/80 bg-slate-950/40 text-slate-500"
            : "border-slate-700/70 bg-slate-950/40 text-slate-200 hover:border-slate-500 hover:text-white",
        )}
      >
        Refresh results
      </button>
      {updatedLabel ? (
        <span className="text-[11px] font-semibold text-slate-500">{updatedLabel}</span>
      ) : null}
    </div>
  );
}
