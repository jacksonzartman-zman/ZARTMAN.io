"use client";

import { useMemo, useState } from "react";
import HomeProcessTabs, { type ProcessItem } from "@/components/marketing/HomeProcessTabs";
import HomeUploadLauncher from "@/components/marketing/HomeUploadLauncher";

type HomeHeroUploadPanelProps = {
  processes: ProcessItem[];
  isAuthenticated: boolean;
};

const PROCESS_LABEL_OVERRIDES: Record<string, string> = {
  cnc: "CNC machining",
  "3dp": "3D printing",
  "sheet-metal": "Sheet metal",
  injection: "Injection molding",
  assembly: "Assembly",
  "ai-mode": "Not sure yet",
};

export default function HomeHeroUploadPanel({
  processes,
  isAuthenticated,
}: HomeHeroUploadPanelProps) {
  const [activeKey, setActiveKey] = useState(processes[0]?.key ?? "");
  const activeProcess = useMemo(
    () => processes.find((process) => process.key === activeKey) ?? processes[0],
    [activeKey, processes],
  );
  const manufacturingProcess = activeProcess
    ? PROCESS_LABEL_OVERRIDES[activeProcess.key] ?? activeProcess.label
    : "";

  return (
    <div className="space-y-4">
      <HomeProcessTabs
        processes={processes}
        activeKey={activeProcess?.key ?? ""}
        onProcessChange={setActiveKey}
      />
      <div className="rounded-2xl border border-slate-900/70 bg-slate-950/80 p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-ink-soft">
            Pick a process, upload your CAD, and we&apos;ll start the search.
          </div>
          <div className="sm:min-w-[220px]">
            <HomeUploadLauncher
              isAuthenticated={isAuthenticated}
              manufacturingProcess={manufacturingProcess}
              processLabel={activeProcess?.label}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
