"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import type { CadViewerPanelProps } from "@/app/(portals)/components/CadViewerPanel";
import { PartDfMPanel } from "@/app/(portals)/components/PartDfMPanel";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";
import type { QuoteFileMeta } from "@/server/quotes/types";

const CadViewerPanel = dynamic<CadViewerPanelProps>(
  () =>
    import("@/app/(portals)/components/CadViewerPanel").then(
      (mod) => mod.CadViewerPanel,
    ),
  { ssr: false },
);

type CustomerQuotePartPanelProps = {
  files: QuoteFileMeta[];
  previews: QuoteFileItem[];
  processHint?: string | null;
  quantityHint?: string | number | null;
  targetDate?: string | null;
  className?: string;
};

export function CustomerQuotePartPanel({
  files,
  previews,
  processHint,
  quantityHint,
  targetDate,
  className,
}: CustomerQuotePartPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [geometryStatsMap, setGeometryStatsMap] = useState<
    Record<number, GeometryStats | null>
  >({});

  useEffect(() => {
    if (files.length === 0) {
      if (selectedIndex !== 0) {
        setSelectedIndex(0);
      }
      return;
    }
    if (selectedIndex >= files.length) {
      setSelectedIndex(0);
    }
  }, [files, selectedIndex]);

  const selectedPreview = previews[selectedIndex] ?? null;
  const selectedFileMeta = files[selectedIndex] ?? null;
  const selectedGeometry = geometryStatsMap[selectedIndex] ?? null;

  const handleGeometryStats = useCallback(
    (stats: GeometryStats | null) => {
      if (files.length === 0) {
        return;
      }
      setGeometryStatsMap((prev) => {
        if (prev[selectedIndex] === stats) {
          return prev;
        }
        return { ...prev, [selectedIndex]: stats };
      });
    },
    [files.length, selectedIndex],
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
              const preview = previews[index] ?? null;
              const isSelected = selectedIndex === index;
              const displayName =
                preview?.fileName ??
                preview?.label ??
                file.filename;
              const previewStatus = preview?.signedUrl
                ? "STL preview ready"
                : preview?.fallbackMessage ??
                  "3D preview is coming soon; your file is still included with the RFQ.";
              return (
                <button
                  key={preview?.id ?? `${file.filename}-${index}`}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className={clsx(
                    "w-full rounded-xl border px-4 py-3 text-left transition",
                    isSelected
                      ? "border-emerald-400/40 bg-emerald-400/5"
                      : "border-slate-900/60 bg-slate-950/30 hover:border-slate-800",
                  )}
                >
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{`Part ${index + 1}`}</p>
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {displayName}
                  </p>
                  <p className="text-xs text-slate-400">
                    {previewStatus}
                  </p>
                </button>
              );
            })
          )}
        </div>
        <div className="space-y-4 lg:col-span-3">
          <CadViewerPanel
            fileUrl={selectedPreview?.signedUrl ?? null}
            fileName={
              selectedPreview?.fileName ??
              selectedPreview?.label ??
              selectedFileMeta?.filename ??
              null
            }
            fallbackMessage="Select a CAD file (3D preview may be unavailable for some formats)."
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
