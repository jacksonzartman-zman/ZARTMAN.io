"use client";

import dynamic from "next/dynamic";
import type { CadViewerProps } from "./CadViewer";

const LazyCadViewer = dynamic<CadViewerProps>(
  () => import("./CadViewer"),
  {
    ssr: false,
    loading: () => <CadViewerInlineSkeleton />,
  },
);

export default function CadViewerClient(props: CadViewerProps) {
  return <LazyCadViewer {...props} />;
}

function CadViewerInlineSkeleton({ height = 320 }: { height?: number }) {
  const safeHeight =
    typeof height === "number" && Number.isFinite(height) && height > 0
      ? height
      : 320;

  return (
    <div className="w-full">
      <div
        className="relative overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60"
        style={{ height: safeHeight }}
      >
        <div className="flex h-full items-center justify-center px-6 text-center">
          <p className="text-sm text-slate-500">Preparing 3D preview…</p>
        </div>
      </div>
    </div>
  );
}
