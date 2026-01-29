"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

type ProcessKey = "cnc" | "3dp" | "sheet" | "injection";

const PROCESS_OPTIONS: Array<{ key: ProcessKey; label: string }> = [
  { key: "cnc", label: "CNC" },
  { key: "3dp", label: "3DP" },
  { key: "sheet", label: "Sheet Metal" },
  { key: "injection", label: "Injection Molding" },
];

type QuickSpecsPanelProps = {
  quoteId: string;
  intakeKey: string;
  primaryFileName?: string | null;
  initial: {
    manufacturingProcesses: ProcessKey[];
    targetDate: string | null;
    quantity: number | null;
  };
};

type SaveState = "idle" | "saving" | "saved" | "error";

function normalizeIsoDate(value: string): string {
  return value.trim();
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return Number.isFinite(dt.getTime()) && dt.toISOString().slice(0, 10) === value;
}

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 100000;

function clampQuantity(value: number): number {
  if (!Number.isFinite(value)) return MIN_QUANTITY;
  return Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, Math.round(value)));
}

function looksLikeProductionFile(fileName: string | null | undefined): boolean {
  const normalized = typeof fileName === "string" ? fileName.trim().toLowerCase() : "";
  if (!normalized) return false;
  return normalized.includes("assy") || normalized.includes("batch");
}

function ProcessIcon({ processKey }: { processKey: ProcessKey }) {
  const base = "h-4 w-4 text-current opacity-80";
  // Minimal inline icons to avoid extra deps.
  switch (processKey) {
    case "cnc":
      return (
        <svg className={base} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2.75a1 1 0 0 1 1 1v1.08a6.1 6.1 0 0 1 1.7.71l.77-.77a1 1 0 0 1 1.42 0l.84.84a1 1 0 0 1 0 1.42l-.77.77c.3.54.53 1.11.7 1.7H17.25a1 1 0 0 1 1 1v1.18a1 1 0 0 1-1 1h-1.08a6.1 6.1 0 0 1-.71 1.7l.77.77a1 1 0 0 1 0 1.42l-.84.84a1 1 0 0 1-1.42 0l-.77-.77a6.1 6.1 0 0 1-1.7.71v1.08a1 1 0 0 1-1 1H8.82a1 1 0 0 1-1-1v-1.08a6.1 6.1 0 0 1-1.7-.71l-.77.77a1 1 0 0 1-1.42 0l-.84-.84a1 1 0 0 1 0-1.42l.77-.77a6.1 6.1 0 0 1-.71-1.7H2.75a1 1 0 0 1-1-1V9.75a1 1 0 0 1 1-1h1.08c.17-.59.4-1.16.71-1.7l-.77-.77a1 1 0 0 1 0-1.42l.84-.84a1 1 0 0 1 1.42 0l.77.77c.54-.3 1.11-.53 1.7-.71V3.75a1 1 0 0 1 1-1H10Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M10 12.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      );
    case "3dp":
      return (
        <svg className={base} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M4.5 6.6 10 3.5l5.5 3.1v6.8L10 16.5l-5.5-3.1V6.6Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M10 3.6v12.8" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4.7 6.7 10 9.7l5.3-3" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      );
    case "sheet":
      return (
        <svg className={base} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M5 3.75h7l3 3v9.5a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 16.25V5.25A1.5 1.5 0 0 1 5 3.75Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M12 3.75v3a1 1 0 0 0 1 1h2" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case "injection":
      return (
        <svg className={base} viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M10 2.8c2.1 3 4.4 5.3 4.4 8.1a4.4 4.4 0 1 1-8.8 0c0-2.8 2.3-5.1 4.4-8.1Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <path d="M8.2 11.2c.2 1.6 1.4 2.7 3.1 2.9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    default:
      return null;
  }
}

export function QuickSpecsPanel({ quoteId, intakeKey, primaryFileName, initial }: QuickSpecsPanelProps) {
  const [processes, setProcesses] = useState<ProcessKey[]>(initial.manufacturingProcesses ?? []);
  const [targetDate, setTargetDate] = useState<string>(initial.targetDate ?? "");
  const [quantityInput, setQuantityInput] = useState<string>(
    typeof initial.quantity === "number" && Number.isFinite(initial.quantity) && initial.quantity > 0
      ? String(Math.round(initial.quantity))
      : "1",
  );
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState<string>("");

  const didHydrateRef = useRef(false);
  const pendingTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const showNoProcessNudge = processes.length === 0;
  const showProductionQtyNudge = useMemo(() => {
    const current = clampQuantity(parseQuantityOrDefault(quantityInput, MIN_QUANTITY));
    return current === 1 && looksLikeProductionFile(primaryFileName);
  }, [primaryFileName, quantityInput]);

  const normalizedPayload = useMemo(() => {
    const qty = Number.parseInt(quantityInput, 10);
    const quantity = Number.isFinite(qty) && qty >= MIN_QUANTITY ? clampQuantity(qty) : null;
    const normalizedDate = normalizeIsoDate(targetDate);
    const date = normalizedDate ? normalizedDate : null;
    return {
      processes,
      needByDate: date,
      quantity,
    };
  }, [processes, quantityInput, targetDate]);

  const isDirty = useMemo(() => {
    const initialQty =
      typeof initial.quantity === "number" && Number.isFinite(initial.quantity) && initial.quantity > 0
        ? Math.round(initial.quantity)
        : null;
    const initialDate = initial.targetDate ?? null;
    const initialProcesses = Array.isArray(initial.manufacturingProcesses)
      ? [...initial.manufacturingProcesses].sort()
      : ([] as ProcessKey[]);

    const currentProcesses = [...(processes ?? [])].sort();
    const currentQtyParsed = Number.parseInt(quantityInput, 10);
    const currentQty =
      Number.isFinite(currentQtyParsed) && currentQtyParsed >= MIN_QUANTITY ? clampQuantity(currentQtyParsed) : null;
    const currentDate = normalizeIsoDate(targetDate) ? normalizeIsoDate(targetDate) : null;

    return (
      initialQty !== currentQty ||
      initialDate !== currentDate ||
      initialProcesses.join("|") !== currentProcesses.join("|")
    );
  }, [initial.manufacturingProcesses, initial.quantity, initial.targetDate, processes, quantityInput, targetDate]);

  async function saveNow(payload: { processes: ProcessKey[]; needByDate: string | null; quantity: number | null }) {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setSaveState("saving");
    setSaveMessage("");

    const resolvedNeedByDate =
      payload.needByDate && isValidIsoDate(payload.needByDate) ? payload.needByDate : null;

    try {
      const res = await fetch("/api/rfq/quick-specs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId,
          intakeKey,
          processes: payload.processes,
          needByDate: resolvedNeedByDate,
          quantity: payload.quantity,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Save failed (${res.status})`);
      }

      setSaveState("saved");
      setSaveMessage("Saved");
      window.setTimeout(() => {
        setSaveState("idle");
        setSaveMessage("");
      }, 1200);
    } catch (err) {
      if (String(err).toLowerCase().includes("aborterror")) {
        return;
      }
      setSaveState("error");
      setSaveMessage("Couldn’t save");
      window.setTimeout(() => {
        setSaveState("idle");
        setSaveMessage("");
      }, 2000);
    }
  }

  useEffect(() => {
    if (!didHydrateRef.current) {
      didHydrateRef.current = true;
      return;
    }
    if (!isDirty) {
      return;
    }

    if (pendingTimerRef.current) {
      window.clearTimeout(pendingTimerRef.current);
    }

    pendingTimerRef.current = window.setTimeout(() => {
      void saveNow(normalizedPayload);
    }, 450);

    return () => {
      if (pendingTimerRef.current) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalizedPayload, isDirty]);

  function toggleProcess(key: ProcessKey) {
    setProcesses((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return Array.from(next);
    });
  }

  function setQuantityFromNumber(nextValue: number) {
    setQuantityInput(String(clampQuantity(nextValue)));
  }

  function parseQuantityOrDefault(value: string, fallback: number) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return (
    <section className="rounded-3xl border border-slate-900/50 bg-slate-950/35 p-5 shadow-[0_18px_50px_rgba(2,6,23,0.28)]">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-soft/90">
            Quick specs (optional)
          </p>
          <p className="text-sm font-medium text-ink-muted">Optional — improves matching accuracy.</p>
          <p className="text-xs text-ink-soft">
            These never block you from viewing status or offers.
          </p>
        </div>
        <div className="pt-0.5 text-xs font-semibold">
          <span
            className={clsx(
              "rounded-full border px-3 py-1",
              saveState === "saving"
                ? "border-slate-700 bg-slate-950/40 text-ink-soft"
                : saveState === "saved"
                  ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-100"
                  : saveState === "error"
                    ? "border-red-400/30 bg-red-500/10 text-red-100"
                    : "border-transparent text-transparent",
            )}
          >
            {saveMessage || "Saved"}
          </span>
        </div>
      </header>

      <div className="mt-4 grid gap-6 md:grid-cols-2 md:items-center">
        <div className="min-w-0 space-y-2">
          <div className="space-y-1">
            <p className="text-xs font-semibold text-ink">Process</p>
            <p className="text-xs text-ink-soft">Pick one or more (optional).</p>
          </div>
          {showNoProcessNudge ? (
            <p className="text-xs text-amber-100/90">Pick a process to get faster matching</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {PROCESS_OPTIONS.map((option) => {
              const active = processes.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleProcess(option.key)}
                  aria-pressed={active}
                  className={clsx(
                    "group inline-flex h-10 items-center justify-start gap-2 rounded-2xl border px-3 text-sm font-semibold transition",
                    active
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-50"
                      : "border-slate-800/90 bg-slate-950/30 text-ink hover:border-slate-700/90",
                  )}
                >
                  <ProcessIcon processKey={option.key} />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-w-0 space-y-5 md:self-center">
          <div className="grid gap-2">
            <label className="block text-xs font-semibold text-ink" htmlFor="quick-specs-needby">
              Need-by date <span className="text-ink-soft font-normal">(optional)</span>
            </label>
            <input
              id="quick-specs-needby"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="h-10 w-full rounded-2xl border border-slate-800/90 bg-slate-950/30 px-3 text-sm text-ink outline-none focus:border-slate-600"
            />
            {targetDate && !isValidIsoDate(normalizeIsoDate(targetDate)) ? (
              <p className="text-xs text-red-200">Enter a valid date.</p>
            ) : null}
          </div>

          <div className="grid gap-2">
            <label className="block text-xs font-semibold text-ink" htmlFor="quick-specs-qty">
              Quantity
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease quantity"
                onClick={() => {
                  const current = clampQuantity(parseQuantityOrDefault(quantityInput, MIN_QUANTITY));
                  setQuantityFromNumber(current - 1);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-950/30 text-sm font-semibold text-ink transition hover:border-slate-700/90 disabled:opacity-40"
                disabled={clampQuantity(parseQuantityOrDefault(quantityInput, MIN_QUANTITY)) <= MIN_QUANTITY}
              >
                −
              </button>
              <input
                id="quick-specs-qty"
                inputMode="numeric"
                value={quantityInput}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, "");
                  // Keep quantity always defined so debounced saves never emit `null` due to transient empty input.
                  setQuantityInput(raw ? raw.slice(0, 6) : String(MIN_QUANTITY));
                }}
                onBlur={() => {
                  const parsed = Number.parseInt(quantityInput, 10);
                  setQuantityFromNumber(Number.isFinite(parsed) ? parsed : MIN_QUANTITY);
                }}
                className="h-10 w-full rounded-2xl border border-slate-800/90 bg-slate-950/30 px-3 text-center text-sm font-semibold text-ink outline-none focus:border-slate-600"
                aria-label="Quantity"
              />
              <button
                type="button"
                aria-label="Increase quantity"
                onClick={() => {
                  const current = clampQuantity(parseQuantityOrDefault(quantityInput, MIN_QUANTITY));
                  setQuantityFromNumber(current + 1);
                }}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-800/90 bg-slate-950/30 text-sm font-semibold text-ink transition hover:border-slate-700/90 disabled:opacity-40"
                disabled={clampQuantity(parseQuantityOrDefault(quantityInput, MIN_QUANTITY)) >= MAX_QUANTITY}
              >
                +
              </button>
            </div>
            {showProductionQtyNudge ? (
              <p className="text-xs text-amber-100/90">Qty 1? This looks like production — want more?</p>
            ) : null}
            <p className="text-xs text-ink-soft">
              Min {MIN_QUANTITY.toLocaleString()}, max {MAX_QUANTITY.toLocaleString()}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

