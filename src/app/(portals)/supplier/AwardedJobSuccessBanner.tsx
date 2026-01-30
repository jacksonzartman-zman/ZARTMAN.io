"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const AUTO_DISMISS_MS = 5000;
const STORAGE_KEY_PREFIX = "supplier_awarded_job_success_banner_seen_v1:";

function safeReadSeen(id: string): boolean {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${id}`) === "1";
  } catch {
    return false;
  }
}

function safeWriteSeen(id: string) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}${id}`, "1");
  } catch {
    // ignore
  }
}

export function AwardedJobSuccessBanner(props: { awardedQuoteIds: string[] }) {
  const awardedQuoteIds = useMemo(() => {
    const ids = Array.isArray(props.awardedQuoteIds) ? props.awardedQuoteIds : [];
    return ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean);
  }, [props.awardedQuoteIds]);

  const [sessionSeen, setSessionSeen] = useState<Set<string>>(() => new Set());
  const [currentQuoteId, setCurrentQuoteId] = useState<string | null>(null);
  const currentQuoteIdRef = useRef<string | null>(null);

  const unseenQueue = useMemo(() => {
    return awardedQuoteIds.filter((id) => !sessionSeen.has(id) && !safeReadSeen(id));
  }, [awardedQuoteIds, sessionSeen]);

  useEffect(() => {
    const next = unseenQueue[0] ?? null;
    const stillValid =
      currentQuoteIdRef.current &&
      awardedQuoteIds.includes(currentQuoteIdRef.current) &&
      !sessionSeen.has(currentQuoteIdRef.current) &&
      !safeReadSeen(currentQuoteIdRef.current);

    if (stillValid) return;
    setCurrentQuoteId(next);
    currentQuoteIdRef.current = next;
  }, [awardedQuoteIds, sessionSeen, unseenQueue]);

  useEffect(() => {
    if (!currentQuoteId) return;
    const handle = window.setTimeout(() => {
      safeWriteSeen(currentQuoteId);
      setSessionSeen((prev) => new Set(prev).add(currentQuoteId));
      setCurrentQuoteId(null);
      currentQuoteIdRef.current = null;
    }, AUTO_DISMISS_MS);

    return () => window.clearTimeout(handle);
  }, [currentQuoteId]);

  if (!currentQuoteId) return null;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-slate-100">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-slate-100">
          Nice work — you’ve been selected for a new project.
        </p>
        <button
          type="button"
          onClick={() => {
            safeWriteSeen(currentQuoteId);
            setSessionSeen((prev) => new Set(prev).add(currentQuoteId));
            setCurrentQuoteId(null);
            currentQuoteIdRef.current = null;
          }}
          className="rounded-lg border border-emerald-500/20 bg-black/20 px-2 py-1 text-xs font-semibold text-slate-100/90 transition hover:border-emerald-400/40 hover:text-white"
          aria-label="Dismiss awarded project banner"
        >
          Close
        </button>
      </div>
    </div>
  );
}

