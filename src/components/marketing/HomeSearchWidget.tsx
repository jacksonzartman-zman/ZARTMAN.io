"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { primaryCtaClasses } from "@/lib/ctas";
import HomeUploadLauncher from "@/components/marketing/HomeUploadLauncher";

export type HomeSearchProcess = {
  key: string;
  label: string;
  disabled?: boolean;
};

type HomeSearchWidgetProps = {
  isAuthenticated: boolean;
  processes: HomeSearchProcess[];
  initialProcessKey?: string | null;
};

const PROCESS_LABEL_OVERRIDES: Record<string, string> = {
  cnc: "CNC machining",
  "3dp": "3D printing",
  "sheet-metal": "Sheet metal",
  injection: "Injection molding",
  "ai-mode": "Not sure yet",
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function getTodayLocalISODate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isValidIsoDate(isoDate: string): boolean {
  if (!ISO_DATE_REGEX.test(isoDate)) return false;
  const [y, m, d] = isoDate.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (!Number.isFinite(dt.getTime())) return false;
  return dt.toISOString().slice(0, 10) === isoDate;
}

function isIsoDateInPast(isoDate: string): boolean {
  if (!isValidIsoDate(isoDate)) return false;
  return isoDate < getTodayLocalISODate();
}

export default function HomeSearchWidget({
  isAuthenticated,
  processes,
  initialProcessKey,
}: HomeSearchWidgetProps) {
  const firstEnabledKey = useMemo(() => {
    const firstEnabled = processes.find((process) => !process.disabled)?.key;
    return firstEnabled ?? processes[0]?.key ?? "";
  }, [processes]);

  const resolvedInitialKey = useMemo(() => {
    if (initialProcessKey && processes.some((process) => process.key === initialProcessKey)) {
      return initialProcessKey;
    }
    return firstEnabledKey;
  }, [firstEnabledKey, initialProcessKey, processes]);

  const [activeKey, setActiveKey] = useState(resolvedInitialKey);

  const activeProcess = useMemo(
    () => processes.find((process) => process.key === activeKey) ?? processes[0],
    [activeKey, processes],
  );

  const [quantity, setQuantity] = useState<number | undefined>(undefined);
  const [quantityText, setQuantityText] = useState<string>("");
  const [targetDate, setTargetDate] = useState<string | undefined>(undefined);
  const [qtyTouched, setQtyTouched] = useState(false);
  const [targetDateTouched, setTargetDateTouched] = useState(false);

  const manufacturingProcess = useMemo(() => {
    const raw = activeProcess?.key ? PROCESS_LABEL_OVERRIDES[activeProcess.key] : "";
    return raw ?? activeProcess?.label ?? "";
  }, [activeProcess?.key, activeProcess?.label]);

  const quoteHref = useMemo(() => {
    const params = new URLSearchParams();
    if (manufacturingProcess) {
      params.set("process", manufacturingProcess);
    }
    params.set("source", "home");
    return `/quote?${params.toString()}`;
  }, [manufacturingProcess]);

  const todayMin = useMemo(() => getTodayLocalISODate(), []);

  const qtyIsValid = useMemo(() => {
    if (!quantityText.trim()) return true;
    return typeof quantity === "number" && Number.isFinite(quantity) && quantity >= 1;
  }, [quantity, quantityText]);

  const targetDateIsValid = useMemo(() => {
    if (!targetDate) return true;
    return isValidIsoDate(targetDate) && !isIsoDateInPast(targetDate);
  }, [targetDate]);

  const shouldBlockNav = !qtyIsValid || !targetDateIsValid;

  const [uploadOpen, setUploadOpen] = useState(false);

  const handleOpenUpload = () => {
    if (!shouldBlockNav) {
      setUploadOpen(true);
      return;
    }
    setQtyTouched(true);
    setTargetDateTouched(true);
  };

  return (
    <div className="w-full">
      <div className="relative">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-5 rounded-[34px] bg-gradient-to-br from-slate-950/85 via-slate-900/75 to-slate-800/55 blur-2xl"
        />
        <div className="relative rounded-[28px] bg-white shadow-[0_40px_110px_rgba(2,6,23,0.38)] ring-1 ring-slate-900/10">
          <div className="border-b border-slate-200/70 px-5 py-5 sm:px-6">
            <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Processes">
              {processes.map((process) => {
                const isActive = process.key === activeProcess?.key;
                const isDisabled = Boolean(process.disabled);
                return (
                  <button
                    key={process.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    disabled={isDisabled}
                    onClick={() => setActiveKey(process.key)}
                    className={clsx(
                      "rounded-full px-4 py-2 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
                      isActive
                        ? "bg-slate-900 text-white"
                        : "bg-slate-100 text-slate-800 hover:bg-slate-200",
                      isDisabled && "cursor-not-allowed opacity-50 hover:bg-slate-100",
                    )}
                    title={isDisabled ? "Coming soon" : undefined}
                  >
                    {process.label}
                    {isDisabled ? <span className="ml-2 text-[10px] font-semibold">Coming soon</span> : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="px-5 pb-6 sm:px-6 sm:pb-7">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_120px_190px_auto] lg:items-end">
              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  CAD / ZIP
                </div>
                <button
                  type="button"
                  onClick={handleOpenUpload}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-left text-sm text-slate-900 shadow-sm transition hover:border-slate-300",
                  )}
                >
                  <span className="font-medium">Upload CAD/ZIP</span>
                  <span className="text-xs text-slate-500">STEP, IGES, STL, ZIP</span>
                </button>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Qty
                </div>
                <div
                  className={clsx(
                    "h-12 w-full rounded-xl border bg-white px-3 shadow-sm transition focus-within:border-slate-400",
                    qtyTouched && !qtyIsValid ? "border-rose-300 ring-1 ring-rose-100" : "border-slate-200",
                  )}
                >
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={quantityText}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setQuantityText(raw);
                      if (!raw.trim()) {
                        setQuantity(undefined);
                        return;
                      }
                      const parsed = Number(raw);
                      setQuantity(Number.isFinite(parsed) ? parsed : undefined);
                    }}
                    onBlur={() => setQtyTouched(true)}
                    placeholder="Qty"
                    aria-label="Quantity"
                    className="h-full w-full bg-transparent text-center text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Need-by
                </div>
                <div
                  className={clsx(
                    "h-12 w-full rounded-xl border bg-white px-3 shadow-sm transition focus-within:border-slate-400",
                    targetDateTouched && !targetDateIsValid
                      ? "border-rose-300 ring-1 ring-rose-100"
                      : "border-slate-200",
                  )}
                >
                  <input
                    type="date"
                    min={todayMin}
                    value={targetDate ?? ""}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setTargetDate(raw ? raw : undefined);
                    }}
                    onBlur={() => setTargetDateTouched(true)}
                    aria-label="Need-by date"
                    className="h-full w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  &nbsp;
                </div>
                <button
                  type="button"
                  onClick={handleOpenUpload}
                  className={clsx(primaryCtaClasses, "h-12 w-full rounded-xl px-7 text-base")}
                >
                  Upload CAD to compare offers
                </button>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-slate-600">
              <Link
                href={quoteHref}
                className="text-slate-500 transition hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
              >
                Advanced options
              </Link>
            </div>

            <div className="mt-5 rounded-xl bg-slate-50 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px] font-medium text-slate-700">
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Verified suppliers
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Privacy-first
                </span>
                <span className="inline-flex items-center gap-2">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Introductions on request
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <HomeUploadLauncher
        isAuthenticated={isAuthenticated}
        manufacturingProcess={manufacturingProcess}
        processLabel={activeProcess?.label}
        processKey={activeProcess?.key}
        isOpen={uploadOpen}
        onOpenChange={setUploadOpen}
        hideTrigger
        prefillQuantity={quantityText}
        prefillNeedByDate={targetDate}
      />
    </div>
  );
}

