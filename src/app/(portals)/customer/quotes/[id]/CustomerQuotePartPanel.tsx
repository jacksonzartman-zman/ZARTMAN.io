"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import clsx from "clsx";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import type { CadViewerPanelProps } from "@/app/(portals)/components/CadViewerPanel";
import { PartDfMPanel } from "@/app/(portals)/components/PartDfMPanel";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";
import type { QuoteFileMeta } from "@/server/quotes/types";
import {
  formatQuoteWorkspaceStatusLabel,
  type QuoteWorkspaceStatus,
} from "@/lib/quote/workspaceStatus";
import { classifyCadFileType } from "@/lib/cadRendering";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { StatusPill } from "@/components/shared/primitives/StatusPill";
import { TagPill } from "@/components/shared/primitives/TagPill";

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
  workspaceStatus: QuoteWorkspaceStatus;
  processHint?: string | null;
  quantityHint?: string | number | null;
  targetDate?: string | null;
  className?: string;
  onProceedToOrder?: () => void;
};

export function CustomerQuotePartPanel({
  files,
  previews,
  workspaceStatus,
  processHint,
  quantityHint,
  targetDate,
  className,
  onProceedToOrder,
}: CustomerQuotePartPanelProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [geometryStatsMap, setGeometryStatsMap] = useState<
    Record<number, GeometryStats | null>
  >({});
  const hasCadPreviewFiles = previews.some(
    (file) => file.storageSource?.bucket === "cad_previews",
  );

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
  const selectedFileLabel =
    selectedPreview?.fileName ??
    selectedPreview?.label ??
    selectedFileMeta?.filename ??
    null;

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
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <SectionHeader
            kicker="Quote workspace"
            title="CAD preview"
            subtitle={
              <>
                <p>
                  {files.length === 0
                    ? "No files attached yet."
                    : "Preview files and run instant DFM checks."}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Preview renders may be simplified. The original upload is the source of truth.
                </p>
              </>
            }
          />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <TagPill tone="slate" size="md" className="border-slate-800 bg-slate-900/60 text-slate-300">
            {files.length} file{files.length === 1 ? "" : "s"}
          </TagPill>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Quote status:
            </span>
            <StatusPill status={workspaceStatus} />
          </div>
        </div>
      </header>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <CadViewerPanel
            className="p-5"
            height={520}
            fileUrl={selectedPreview?.signedUrl ?? null}
            fileName={selectedFileLabel}
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

        <aside className="space-y-4">
          {onProceedToOrder ? (
            <button
              type="button"
              onClick={onProceedToOrder}
              data-proceed-to-order="true"
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 shadow-sm transition hover:bg-emerald-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            >
              Proceed to order
            </button>
          ) : null}

          <section className="rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Quote info
            </p>
            <dl className="mt-3 grid gap-3 text-sm text-slate-200">
              <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  Part name
                </dt>
                <dd
                  className="whitespace-normal break-words [overflow-wrap:anywhere] overflow-hidden font-medium text-slate-100"
                  title={selectedFileLabel ?? undefined}
                >
                  {selectedFileLabel ?? "—"}
                </dd>
              </div>
              <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  Upload date
                </dt>
                <dd className="font-medium text-slate-100">—</dd>
              </div>
              {processHint ? (
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Process
                  </dt>
                  <dd className="font-medium text-slate-100">{processHint}</dd>
                </div>
              ) : null}
              {quantityHint != null && `${quantityHint}`.trim() ? (
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Quantity
                  </dt>
                  <dd className="font-medium text-slate-100">{quantityHint}</dd>
                </div>
              ) : null}
              {targetDate ? (
                <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                  <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                    Target date
                  </dt>
                  <dd className="font-medium text-slate-100">{targetDate}</dd>
                </div>
              ) : null}
            </dl>
            <p className="mt-3 text-xs text-slate-500">
              Material will appear here when it’s provided.
            </p>
          </section>

          <section className="rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                Files
              </p>
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                {files.length}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {files.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-900/60 bg-slate-950/20 px-4 py-3 text-sm text-slate-400">
                  Files attached to your RFQ will appear here for quick previewing.
                </p>
              ) : (
                files.map((file, index) => {
                  const preview = previews[index] ?? null;
                  const isSelected = selectedIndex === index;
                  const displayName =
                    preview?.fileName ?? preview?.label ?? file.filename;
                  const previewStatus = preview?.signedUrl
                    ? "Preview ready"
                    : preview?.fallbackMessage ?? "Preview not available";
                  const classified = classifyCadFileType({
                    filename: displayName,
                    extension: null,
                  });
                  const cadKind =
                    preview?.cadKind ?? (classified.ok ? classified.type : null);
                  const bucket = preview?.storageSource?.bucket ?? null;
                  const isAutoPreviewFile = bucket === "cad_previews";
                  const isStep = cadKind === "step";
                  const isOriginalStepWithoutPreviewFile =
                    isStep && !isAutoPreviewFile && !hasCadPreviewFiles;
                  const kindLabel = isStep
                    ? "STEP"
                    : cadKind === "stl"
                      ? "STL"
                      : cadKind === "obj"
                        ? "OBJ"
                        : cadKind === "glb"
                          ? "GLB"
                          : "file";
                  const primaryTag = isAutoPreviewFile
                    ? `Preview ${kindLabel} (auto-generated)`
                    : `Original ${kindLabel}`;
                  const helperLine = isOriginalStepWithoutPreviewFile
                    ? preview?.signedUrl
                      ? "Preview will be generated when viewed."
                      : "Preview unavailable (re-upload may be required)."
                    : isStep
                      ? "Preview is for viewing only. Download retains the original file."
                      : null;

                  return (
                    <button
                      key={preview?.id ?? `${file.filename}-${index}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={clsx(
                        "w-full rounded-xl border px-4 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70",
                        isSelected
                          ? "border-emerald-400/40 bg-emerald-400/5"
                          : "border-slate-900/60 bg-slate-950/30 hover:border-slate-800",
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500">{`Part ${index + 1}`}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <TagPill tone="slate">{primaryTag}</TagPill>
                        </div>
                      </div>
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {displayName}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">{previewStatus}</p>
                      {helperLine ? (
                        <p className="mt-1 text-[11px] text-slate-500">{helperLine}</p>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
