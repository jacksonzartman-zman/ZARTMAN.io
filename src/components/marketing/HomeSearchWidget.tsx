"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import HomeUploadLauncher from "@/components/marketing/HomeUploadLauncher";
import { primaryCtaClasses } from "@/lib/ctas";

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

function buildLoginHref(input: { processKey?: string; qty?: string; needBy?: string }) {
  const params = new URLSearchParams();
  if (input.processKey) params.set("process", input.processKey);
  if (input.qty?.trim()) params.set("qty", input.qty.trim());
  if (input.needBy?.trim()) params.set("needBy", input.needBy.trim());
  params.set("upload", "1");
  const nextPath = params.toString() ? `/?${params.toString()}` : "/";
  return `/login?next=${encodeURIComponent(nextPath)}`;
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
  const [quantity, setQuantity] = useState("");
  const [needByDate, setNeedByDate] = useState("");
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const activeProcess = useMemo(
    () => processes.find((process) => process.key === activeKey) ?? processes[0],
    [activeKey, processes],
  );

  const manufacturingProcess = useMemo(() => {
    const raw = activeProcess?.key ? PROCESS_LABEL_OVERRIDES[activeProcess.key] : "";
    return raw ?? activeProcess?.label ?? "";
  }, [activeProcess?.key, activeProcess?.label]);

  const loginHref = useMemo(
    () =>
      buildLoginHref({
        processKey: activeProcess?.key,
        qty: quantity,
        needBy: needByDate,
      }),
    [activeProcess?.key, needByDate, quantity],
  );

  const openUpload = () => {
    if (!isAuthenticated) return;
    setIsUploadOpen(true);
  };

  return (
    <div className="w-full">
      <div className="rounded-2xl bg-white/95 shadow-[0_30px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/10 backdrop-blur">
        <div className="border-b border-slate-200/70 px-4 pt-4">
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
          <div className="pb-4" />
        </div>

        <div className="px-4 pb-4">
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_0.8fr_0.9fr_auto] lg:items-end">
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                CAD / ZIP
              </div>
              <button
                type="button"
                onClick={openUpload}
                className={clsx(
                  "flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-900 shadow-sm transition hover:border-slate-300",
                  !isAuthenticated && "opacity-80",
                )}
              >
                <span className="font-medium">Upload CAD/ZIP</span>
                <span className="text-xs text-slate-500">STEP, IGES, STL, ZIP</span>
              </button>
              {!isAuthenticated ? (
                <div className="text-xs text-slate-500">Sign in to upload and start a search.</div>
              ) : null}
            </div>

            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Process
              </div>
              <select
                value={activeProcess?.key ?? ""}
                onChange={(event) => setActiveKey(event.target.value)}
                className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              >
                {processes.map((process) => (
                  <option key={process.key} value={process.key} disabled={Boolean(process.disabled)}>
                    {process.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Qty
              </div>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="50"
                className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              />
            </label>

            <label className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                Need-by
              </div>
              <input
                type="date"
                value={needByDate}
                onChange={(event) => setNeedByDate(event.target.value)}
                className="h-[46px] w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-600/40"
              />
            </label>

            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                &nbsp;
              </div>
              {isAuthenticated ? (
                <button
                  type="button"
                  onClick={openUpload}
                  className={clsx(primaryCtaClasses, "h-[46px] rounded-xl px-5 text-sm")}
                >
                  Compare offers
                </button>
              ) : (
                <Link href={loginHref} className={clsx(primaryCtaClasses, "h-[46px] rounded-xl px-5 text-sm")}>
                  Sign in to start
                </Link>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
            <span>
              You control sharing: we connect you only when you request introductions.
            </span>
            <span className="text-slate-500">Verified suppliers • Customer-safe by default</span>
          </div>
        </div>
      </div>

      {/* Modal + upload flow (existing product UI) */}
      <HomeUploadLauncher
        key={`${activeProcess?.key ?? ""}|${quantity}|${needByDate}`}
        isAuthenticated={isAuthenticated}
        manufacturingProcess={manufacturingProcess}
        processLabel={activeProcess?.label}
        processKey={activeProcess?.key}
        hideTrigger
        isOpen={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        prefillQuantity={quantity}
        prefillNeedByDate={needByDate}
        hideMetaFields
      />
    </div>
  );
}

