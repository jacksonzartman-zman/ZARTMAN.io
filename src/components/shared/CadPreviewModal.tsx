"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import {
  ThreeCadViewer,
  type CadKind,
  type ViewerStatus,
} from "@/components/ThreeCadViewer";

export type CadPreviewModalProps = {
  fileId: string;
  onClose: () => void;
  title?: string | null;
  filename?: string | null;
  cadKind: CadKind;
};

export function CadPreviewModal({
  fileId,
  onClose,
  title,
  filename,
  cadKind,
}: CadPreviewModalProps) {
  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "3D Preview";

  const [viewerStatus, setViewerStatus] = useState<ViewerStatus>("idle");
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [viewerCadKind, setViewerCadKind] = useState<CadKind | null>(null);
  useEffect(() => {
    setViewerStatus("idle");
    setErrorReason(null);
    setViewerCadKind(null);
  }, [fileId]);

  const downloadUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(
    fileId,
  )}&disposition=attachment`;

  const isStep = cadKind === "step" || viewerCadKind === "step";
  const showStepFallback =
    isStep && (viewerStatus === "error" || viewerStatus === "unsupported");

  const isSupportedCadKind =
    cadKind === "stl" || cadKind === "step" || cadKind === "obj" || cadKind === "glb";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={safeTitle}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-900 px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{safeTitle}</p>
            {filename ? (
              <p className="mt-1 truncate text-xs text-slate-400">{filename}</p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <a
              href={downloadUrl}
              className={clsx(
                "rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600",
              )}
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className={clsx(
                "rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600",
              )}
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-6">
          {!isSupportedCadKind ? (
            <div className="flex h-[70vh] min-h-[380px] items-center justify-center rounded-xl border border-slate-800 bg-black px-6 text-center">
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-100">
                  Preview is not available for this file type yet
                </p>
                <p className="max-w-lg text-sm text-slate-300">
                  You can still download the file.
                </p>
                <a
                  href={downloadUrl}
                  className={clsx(
                    "inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600",
                  )}
                >
                  Download file
                </a>
              </div>
            </div>
          ) : (
            <div className="relative">
              {showStepFallback ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border border-slate-800 bg-black/70 px-6 text-center">
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-100">
                      STEP preview is not available for this file yet
                    </p>
                    {errorReason ? (
                      <p className="max-w-lg text-sm text-slate-300">Reason: {errorReason}</p>
                    ) : (
                      <p className="max-w-lg text-sm text-slate-300">
                        STEP preview is not available for this file in the browser yet.
                      </p>
                    )}
                    <a
                      href={downloadUrl}
                      className={clsx(
                        "inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600",
                      )}
                    >
                      Download file
                    </a>
                  </div>
                </div>
              ) : null}
            <ThreeCadViewer
              fileId={fileId}
              filenameHint={filename ?? null}
              cadKind={cadKind}
              onStatusChange={(report) => {
                setViewerStatus(report.status);
                setErrorReason(report.errorReason ?? null);
                setViewerCadKind(report.cadKind ?? null);
              }}
            />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

