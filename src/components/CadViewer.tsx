"use client";

import nextDynamic from "next/dynamic";
import type { CadViewerProps } from "./CadViewerRenderer";

const CadViewerRenderer = nextDynamic<CadViewerProps>(
  () => import("./CadViewerRenderer"),
  {
    ssr: false,
    loading: () => <CadViewerSkeleton />,
  },
);

export type { CadViewerProps };

export default function CadViewer(props: CadViewerProps) {
  return <CadViewerRenderer {...props} />;
}

function CadViewerSkeleton({
  height,
  fileName,
}: Partial<Pick<CadViewerProps, "height" | "fileName">> = {}) {
  const fallbackHeight =
    typeof height === "number" && Number.isFinite(height) && height > 0
      ? height
      : 320;

  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60"
        style={{ height: fallbackHeight }}
      >
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="text-sm text-slate-500">Preparing 3D preview…</p>
        </div>
      </div>
      {fileName && (
        <p className="mt-3 text-center text-xs uppercase tracking-wide text-slate-500">
          {fileName}
        </p>
      )}
    </div>
  );
}
