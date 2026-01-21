"use client";

import { useEffect, useMemo } from "react";
import clsx from "clsx";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";
import { classifyCadFileType } from "@/lib/cadRendering";
import { ThreeCadViewer } from "@/components/ThreeCadViewer";

export type CadViewerPanelProps = {
  file?: File | null;
  fileName?: string | null;
  fileUrl?: string | null;
  fallbackMessage?: string;
  onGeometryStats?: (stats: GeometryStats | null) => void;
  height?: number;
  className?: string;
};

const DEFAULT_HEIGHT = 260;

export function CadViewerPanel({
  file,
  fileName,
  fileUrl,
  fallbackMessage,
  onGeometryStats,
  height = DEFAULT_HEIGHT,
  className,
}: CadViewerPanelProps) {
  useEffect(() => {
    onGeometryStats?.(null);
  }, [file, fileUrl, onGeometryStats]);

  const localObjectUrl = useMemo(() => {
    if (!file || typeof window === "undefined") return null;
    try {
      return URL.createObjectURL(file);
    } catch {
      return null;
    }
  }, [file]);
  useEffect(() => {
    return () => {
      if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
    };
  }, [localObjectUrl]);

  const effectiveUrl = fileUrl ?? localObjectUrl;
  const hasSource = Boolean(effectiveUrl);
  const displayName =
    (typeof fileName === "string" && fileName.trim() ? fileName.trim() : null) ??
    (file?.name ?? null);
  const cadType = useMemo(
    () => classifyCadFileType({ filename: displayName, extension: null }),
    [displayName],
  );

  const containerClasses = clsx(
    "rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4",
    className,
  );

  return (
    <section className={containerClasses}>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
        CAD preview
      </p>
      {hasSource && effectiveUrl && cadType.ok ? (
        <div className="mt-3">
          <ThreeCadViewer
            fileName={displayName ?? "file"}
            url={effectiveUrl}
            cadKind={cadType.type}
            height={height}
            minHeight={height}
          />
        </div>
      ) : (
        <div
          className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/70 px-6 text-center text-xs text-slate-400"
          style={{ height }}
        >
          <span>
            {hasSource
              ? "Preview is not available for this file type."
              : fallbackMessage ??
                "Upload a CAD file to attach it to your search request."}
          </span>
        </div>
      )}
    </section>
  );
}
