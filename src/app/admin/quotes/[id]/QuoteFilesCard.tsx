"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { QuoteFileViewer } from "../QuoteFileViewer";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

export type QuoteFileItem = {
  id: string;
  label: string;
  fileName?: string | null;
  signedUrl: string | null;
  fallbackMessage?: string;
};

type QuoteFilesCardProps = {
  files: QuoteFileItem[];
  id?: string;
  className?: string;
};

export function QuoteFilesCard({ files, id, className }: QuoteFilesCardProps) {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [activeFileId, files],
  );

  const closeModal = useCallback(() => {
    setActiveFileId(null);
  }, []);

  useEffect(() => {
    if (activeFileId && !files.some((file) => file.id === activeFileId)) {
      setActiveFileId(null);
    }
  }, [activeFileId, files]);

    return (
      <section
        id={id}
        className={clsx(
          "rounded-2xl border border-slate-800 bg-slate-950/60 px-6 py-5",
          className,
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Files
            </p>
            <p className="text-sm text-slate-400">
              Click a file to open the 3D preview modal.
            </p>
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {files.length} attached
          </span>
        </div>

        <div className="mt-4 space-y-2">
          {files.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-900/70 bg-black/20 px-6 py-5 text-sm text-slate-500">
              No files listed.
            </p>
          ) : (
              files.map((file) => (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => setActiveFileId(file.id)}
                  className="group flex w-full items-center justify-between rounded-xl border border-slate-900/60 bg-slate-950/20 px-6 py-4 text-left transition hover:border-slate-800 hover:bg-slate-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {file.label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {file.signedUrl
                        ? "Interactive STL available"
                        : file.fallbackMessage ?? "Preview not available yet"}
                    </p>
                  </div>
                  <span
                    className={clsx(
                      secondaryCtaClasses,
                      ctaSizeClasses.sm,
                      "whitespace-nowrap",
                      !file.signedUrl && "opacity-70",
                    )}
                  >
                    View model
                  </span>
                </button>
              ))
          )}
        </div>

        {activeFile && (
          <QuoteFileViewerModal file={activeFile} onClose={closeModal} />
        )}
      </section>
    );
}

type QuoteFileViewerModalProps = {
  file: QuoteFileItem;
  onClose: () => void;
};

function QuoteFileViewerModal({ file, onClose }: QuoteFileViewerModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedElement.current =
      (document.activeElement as HTMLElement | null) ?? null;
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedElement.current?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview for ${file.label}`}
        tabIndex={-1}
        className="relative z-10 w-full max-w-3xl rounded-3xl border border-slate-800 bg-slate-950/95 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between border-b border-slate-900 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              File preview
            </p>
            <h3 className="mt-1 text-lg font-semibold text-slate-50">
              {file.label}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-900/70 p-2 text-slate-400 transition hover:text-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70"
            aria-label="Close preview"
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
            >
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className="px-6 py-6">
          <QuoteFileViewer
            fileName={file.fileName ?? file.label}
            fileUrl={file.signedUrl}
            fallbackMessage={file.fallbackMessage}
          />
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-900 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className={clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
