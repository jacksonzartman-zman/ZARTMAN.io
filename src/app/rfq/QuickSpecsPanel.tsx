"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";

type ProcessKey = "cnc" | "3dp" | "sheet" | "injection";

const PROCESS_OPTIONS: Array<{ key: ProcessKey; label: string; hint: string }> = [
  { key: "cnc", label: "CNC", hint: "Machining" },
  { key: "3dp", label: "3DP", hint: "3D printing" },
  { key: "sheet", label: "Sheet Metal", hint: "Laser / bend" },
  { key: "injection", label: "Injection Molding", hint: "Tooling + parts" },
];

type QuickSpecsPanelProps = {
  quoteId: string;
  intakeKey: string;
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

export function QuickSpecsPanel({ quoteId, intakeKey, initial }: QuickSpecsPanelProps) {
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

  const normalizedPayload = useMemo(() => {
    const qty = Number.parseInt(quantityInput, 10);
    const quantity = Number.isFinite(qty) && qty > 0 ? qty : null;
    const normalizedDate = normalizeIsoDate(targetDate);
    const date = normalizedDate ? normalizedDate : null;
    return {
      manufacturingProcesses: processes,
      targetDate: date,
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
    const currentQty = Number.isFinite(currentQtyParsed) && currentQtyParsed > 0 ? currentQtyParsed : null;
    const currentDate = normalizeIsoDate(targetDate) ? normalizeIsoDate(targetDate) : null;

    return (
      initialQty !== currentQty ||
      initialDate !== currentDate ||
      initialProcesses.join("|") !== currentProcesses.join("|")
    );
  }, [initial.manufacturingProcesses, initial.quantity, initial.targetDate, processes, quantityInput, targetDate]);

  async function saveNow(payload: {
    manufacturingProcesses: ProcessKey[];
    targetDate: string | null;
    quantity: number | null;
  }) {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setSaveState("saving");
    setSaveMessage("");

    const resolvedTargetDate =
      payload.targetDate && isValidIsoDate(payload.targetDate) ? payload.targetDate : null;

    try {
      const res = await fetch("/api/rfq/quick-specs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          quoteId,
          intakeKey,
          manufacturingProcesses: payload.manufacturingProcesses,
          targetDate: resolvedTargetDate,
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

  return (
    <section className="rounded-3xl border border-slate-900/60 bg-slate-950/40 p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ink-soft">
            Quick specs (optional)
          </p>
          <h2 className="text-lg font-semibold text-ink">Help us route this faster</h2>
          <p className="text-sm text-ink-muted">
            These are optional and won’t block you from viewing status or offers.
          </p>
        </div>
        <div className="pt-1 text-xs font-semibold">
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

      <div className="mt-5 grid gap-5 md:grid-cols-3">
        <div className="md:col-span-2">
          <p className="text-xs font-semibold text-ink">Manufacturing process</p>
          <p className="mt-1 text-xs text-ink-soft">Pick one or more. Leave blank if unsure.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PROCESS_OPTIONS.map((option) => {
              const active = processes.includes(option.key);
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleProcess(option.key)}
                  className={clsx(
                    "group inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition",
                    active
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
                      : "border-slate-800 bg-slate-950/40 text-ink hover:border-slate-700",
                  )}
                >
                  <span>{option.label}</span>
                  <span
                    className={clsx(
                      "text-[11px] font-semibold",
                      active ? "text-emerald-200/90" : "text-ink-soft group-hover:text-ink-muted",
                    )}
                  >
                    {option.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-ink" htmlFor="quick-specs-needby">
              Need-by date <span className="text-ink-soft font-normal">(optional)</span>
            </label>
            <input
              id="quick-specs-needby"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-ink outline-none focus:border-slate-600"
            />
            {targetDate && !isValidIsoDate(normalizeIsoDate(targetDate)) ? (
              <p className="mt-1 text-xs text-red-200">Enter a valid date.</p>
            ) : null}
          </div>

          <div>
            <label className="block text-xs font-semibold text-ink" htmlFor="quick-specs-qty">
              Quantity
            </label>
            <input
              id="quick-specs-qty"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={quantityInput}
              onChange={(e) => setQuantityInput(e.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-2 text-sm text-ink outline-none focus:border-slate-600"
            />
            <p className="mt-1 text-xs text-ink-soft">Defaults to 1 if you leave it as-is.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

