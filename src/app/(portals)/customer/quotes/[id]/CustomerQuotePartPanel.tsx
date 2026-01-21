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
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

const CadViewerPanel = dynamic<CadViewerPanelProps>(
  () =>
    import("@/app/(portals)/components/CadViewerPanel").then(
      (mod) => mod.CadViewerPanel,
    ),
  {
    ssr: false,
    loading: () => <CadViewerPanelLoading height={520} />,
  },
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
  const PREVIEW_DISCLAIMER =
    "Preview renders may be simplified. The original upload is the source of truth.";
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

  const selectedCadInfo = classifyCadFileType({
    filename: selectedFileLabel ?? "",
    extension: null,
  });
  const canRenderViewer = Boolean(selectedPreview?.signedUrl && selectedCadInfo.ok);

  const downloadOriginalUrl = (() => {
    // Prefer reusing the signed viewer URL when possible (swap disposition to attachment).
    const signed = typeof selectedPreview?.signedUrl === "string" ? selectedPreview.signedUrl : "";
    if (signed.trim().length > 0 && signed.startsWith("/api/")) {
      try {
        const url = new URL(signed, "http://local");
        url.searchParams.set("disposition", "attachment");
        const qs = url.searchParams.toString();
        return qs ? `${url.pathname}?${qs}` : url.pathname;
      } catch {
        // Ignore and fall back to storageSource.
      }
    }

    const source = selectedPreview?.storageSource ?? null;
    const kind =
      selectedPreview?.cadKind ?? (selectedCadInfo.ok ? selectedCadInfo.type : null);
    if (!source || !kind) return null;

    if (source.token) {
      return `/api/cad-preview?token=${encodeURIComponent(source.token)}&kind=${encodeURIComponent(kind)}&disposition=attachment`;
    }
    if (source.bucket && source.path) {
      return `/api/cad-preview?bucket=${encodeURIComponent(source.bucket)}&path=${encodeURIComponent(source.path)}&kind=${encodeURIComponent(kind)}&disposition=attachment`;
    }
    return null;
  })();

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
        "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4 sm:px-6 sm:py-5",
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
                <p className="text-sm text-slate-300">
                  {files.length === 0
                    ? "No files attached yet."
                    : "Preview files and run instant DFM checks."}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {PREVIEW_DISCLAIMER}
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
          {canRenderViewer ? (
            <CadViewerPanel
              className="p-4 sm:p-5"
              height={520}
              fileUrl={selectedPreview?.signedUrl ?? null}
              fileName={selectedFileLabel}
              fallbackMessage={
                selectedPreview?.fallbackMessage ??
                "Preview isn’t available for this file right now."
              }
              onGeometryStats={handleGeometryStats}
            />
          ) : (
            <CadPreviewEmptyState
              height={520}
              title={files.length === 0 ? "No CAD files yet" : "Preview unavailable"}
              description={
                files.length === 0
                  ? "Upload CAD in the Uploads section to view it here."
                  : selectedPreview?.fallbackMessage ??
                    "We couldn’t load a 3D preview for this file. You can still download the original."
              }
              downloadUrl={downloadOriginalUrl}
            />
          )}
          <PartDfMPanel
            geometryStats={selectedGeometry}
            process={processHint}
            quantityHint={quantityHint}
            targetDate={targetDate}
          />
        </div>

        <aside className="min-w-0 space-y-4">
          {onProceedToOrder ? (
            <button
              type="button"
              onClick={onProceedToOrder}
              data-proceed-to-order="true"
              className={clsx(
                primaryCtaClasses,
                "w-full rounded-2xl px-4 py-3 text-sm",
              )}
            >
              Proceed to order
            </button>
          ) : null}

          <section className="rounded-2xl border border-slate-900/60 bg-slate-950/40 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Quote info
            </p>
            <dl className="mt-3 grid min-w-0 gap-3 text-sm text-slate-200">
              <div className="min-w-0 rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
                <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                  Part name
                </dt>
                <dd
                  className="truncate font-medium text-slate-100"
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
              <TagPill
                tone="slate"
                size="sm"
                className="border-slate-800 bg-slate-950/50 text-slate-300"
              >
                {files.length}
              </TagPill>
            </div>

            <div className="mt-3 space-y-2">
              {files.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-900/60 bg-slate-950/20 px-4 py-3 text-sm text-slate-400">
                  Files attached to your search request will appear here for quick previewing.
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
                      <p
                        className="truncate text-sm font-semibold text-slate-100"
                        title={displayName}
                      >
                        {displayName}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-400">{previewStatus}</p>
                      {isOriginalStepWithoutPreviewFile ? (
                        <p className="mt-1 text-[11px] text-slate-500">
                          STEP previews may take longer to appear.
                        </p>
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

function CadViewerPanelLoading({ height }: { height: number }) {
  return (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
        CAD preview
      </p>
      <div
        className="mt-3 flex animate-pulse items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/70 px-6 text-center text-xs text-slate-400"
        style={{ height }}
      >
        Loading viewer…
      </div>
    </section>
  );
}

function CadPreviewEmptyState({
  height,
  title,
  description,
  downloadUrl,
}: {
  height: number;
  title: string;
  description: string;
  downloadUrl: string | null;
}) {
  return (
    <section className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
        CAD preview
      </p>
      <div
        className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/70 px-6"
        style={{ height }}
      >
        <div className="w-full max-w-md text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 text-slate-400"
              aria-hidden="true"
            >
              <path
                d="M12 2.75l8.5 4.9v8.7l-8.5 4.9-8.5-4.9v-8.7L12 2.75Z"
                stroke="currentColor"
                strokeWidth={1.5}
              />
              <path
                d="M8.25 11.5l3.25 1.9 4.25-2.45"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p className="mt-4 text-sm font-semibold text-slate-100">{title}</p>
          <p className="mt-1 text-sm text-slate-300">{description}</p>

          <div className="mt-5 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">
            {downloadUrl ? (
              <a
                href={downloadUrl}
                className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "w-full sm:w-auto")}
              >
                Download original
              </a>
            ) : (
              <button
                type="button"
                disabled
                className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "w-full sm:w-auto")}
              >
                Download original
              </button>
            )}
            <button
              type="button"
              disabled
              className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "w-full sm:w-auto")}
            >
              Regenerate preview
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Preview regeneration isn’t available yet.
          </p>
        </div>
      </div>
    </section>
  );
}
