"use client";

import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import { CadViewerPanel } from "@/app/(portals)/components/CadViewerPanel";
import { PartDfMPanel } from "@/app/(portals)/components/PartDfMPanel";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";

type CustomerQuotePartPanelProps = {
  files: QuoteFileItem[];
  processHint?: string | null;
  quantityHint?: string | number | null;
  targetDate?: string | null;
  className?: string;
};

export function CustomerQuotePartPanel({
  files,
  processHint,
  quantityHint,
  targetDate,
  className,
}: CustomerQuotePartPanelProps) {
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    files[0]?.id ?? null,
  );
  const [geometryStatsMap, setGeometryStatsMap] = useState<
    Record<string, GeometryStats | null>
  >({});

  const selectedFile = useMemo(() => {
    if (!files || files.length === 0) {
      return null;
    }
    if (!selectedFileId) {
      return files[0];
    }
    return files.find((file) => file.id === selectedFileId) ?? files[0];
  }, [files, selectedFileId]);

  const selectedGeometry = selectedFile
    ? geometryStatsMap[selectedFile.id] ?? null
    : null;

  const handleGeometryStats = useCallback(
    (stats: GeometryStats | null) => {
      if (!selectedFile) {
        return;
      }
      setGeometryStatsMap((prev) => {
        if (prev[selectedFile.id] === stats) {
          return prev;
        }
        return { ...prev, [selectedFile.id]: stats };
      });
    },
    [selectedFile],
  );

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
            RFQ parts
          </p>
          <p className="text-sm text-slate-300">
            {files.length === 0
              ? "No files attached yet."
              : "Review every CAD file tied to this RFQ and run instant DFM."}
          </p>
        </div>
        <span className="rounded-full border border-slate-800 bg-slate-900/60 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
          {files.length} file{files.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="space-y-2 rounded-2xl border border-slate-900 bg-slate-950/40 p-3 lg:col-span-2">
          {files.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-900/60 bg-slate-950/20 px-4 py-3 text-sm text-slate-400">
              Files attached to your RFQ will appear here for quick previewing.
            </p>
          ) : (
            files.map((file, index) => {
              const isSelected = selectedFile?.id === file.id;
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setSelectedFileId(file.id)}
                  className={clsx(
                    "w-full rounded-xl border px-4 py-3 text-left transition",
                    isSelected
                      ? "border-emerald-400/40 bg-emerald-400/5"
                      : "border-slate-900/60 bg-slate-950/30 hover:border-slate-800",
                  )}
                >
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{`Part ${index + 1}`}</p>
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {file.fileName ?? file.label}
                  </p>
                  <p className="text-xs text-slate-400">
                    {file.signedUrl
                      ? "STL preview ready"
                      : file.fallbackMessage ?? "Preview unavailable"}
                  </p>
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-4 lg:col-span-3">
          <CadViewerPanel
            fileUrl={selectedFile?.signedUrl ?? null}
            fileName={selectedFile?.fileName ?? selectedFile?.label}
            fallbackMessage="Select a CAD file or ask the admin team to attach an STL."
            onGeometryStats={handleGeometryStats}
          />
          <PartDfMPanel
            geometryStats={selectedGeometry}
            process={processHint}
            quantityHint={quantityHint}
            targetDate={targetDate}
          />
        </div>
      </div>
    </section>
  );
}
