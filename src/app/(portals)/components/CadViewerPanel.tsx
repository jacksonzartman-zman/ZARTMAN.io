"use client";

import { useEffect } from "react";
import clsx from "clsx";
import type { GeometryStats } from "@/lib/dfm/basicPartChecks";

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

  const hasSource = Boolean(file || fileUrl);

  const containerClasses = clsx(
    "rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4",
    className,
  );

  return (
    <section className={containerClasses}>
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-500">
        CAD preview
      </p>
      <div
        className="mt-3 flex items-center justify-center rounded-xl border border-dashed border-slate-800/80 bg-slate-950/70 px-6 text-center text-xs text-slate-400"
        style={{ height }}
      >
        {hasSource ? (
          <span>
            CAD 3D preview is coming soon. Your file{" "}
            <span className="font-semibold">
              {fileName ?? "has been attached"}
            </span>{" "}
            is still included with the RFQ.
          </span>
        ) : (
          <span>
            {fallbackMessage ??
              "Upload a CAD file to attach it to your RFQ. Preview will be added in a future update."}
          </span>
        )}
      </div>
    </section>
  );
}
