"use client";

import clsx from "clsx";
import { ThreeCadViewer } from "@/components/ThreeCadViewer";

export type CadPreviewModalProps = {
  fileId: string;
  onClose: () => void;
  title?: string | null;
  filename?: string | null;
};

export function CadPreviewModal({ fileId, onClose, title, filename }: CadPreviewModalProps) {
  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "3D Preview";

  const downloadUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(
    fileId,
  )}&disposition=attachment`;

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
          <ThreeCadViewer fileId={fileId} filenameHint={filename ?? null} />
        </div>
      </div>
    </div>
  );
}

