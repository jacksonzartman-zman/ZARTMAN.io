"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";
import { CadPreviewModal } from "@/components/shared/CadPreviewModal";
import type { CadKind } from "@/components/ThreeCadViewer";
import { classifyCadFileType } from "@/lib/cadRendering";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { TagPill } from "@/components/shared/primitives/TagPill";

export type QuoteFileItem = {
  id: string;
  label: string;
  fileName?: string | null;
  signedUrl: string | null;
  cadKind?: CadKind | null;
  storageSource?: { bucket: string; path: string; token?: string | null } | null;
  fallbackMessage?: string;
};

type QuoteFilesCardProps = {
  files: QuoteFileItem[];
  id?: string;
  className?: string;
};

export function QuoteFilesCard({ files, id, className }: QuoteFilesCardProps) {
  const [activeFileId, setActiveFileId] = useState<string | null>(null);

  const hasCadPreviewFiles = useMemo(() => {
    return files.some((file) => file.storageSource?.bucket === "cad_previews");
  }, [files]);

  const orderedFiles = useMemo(() => {
    const copy = Array.isArray(files) ? [...files] : [];
    copy.sort((a, b) => {
      const rank = fileSortRank(a) - fileSortRank(b);
      if (rank !== 0) return rank;
      const aName = (a.fileName ?? a.label ?? "").toLowerCase();
      const bName = (b.fileName ?? b.label ?? "").toLowerCase();
      return aName.localeCompare(bName);
    });
    return copy;
  }, [files]);

  const activeFile = useMemo(
    () => files.find((file) => file.id === activeFileId) ?? null,
    [activeFileId, files],
  );
  const activeCadKind = useMemo(() => {
    if (!activeFile) return null;
    if (activeFile.cadKind) return activeFile.cadKind;
    const name = activeFile.fileName ?? activeFile.label;
    const info = classifyCadFileType({ filename: name, extension: null });
    return info.ok ? info.type : null;
  }, [activeFile]);

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
        <SectionHeader
          variant="label"
          title="Files"
          subtitle="Previews are for viewing only. Downloads keep the original upload."
        />
        <TagPill tone="slate" size="md">
          {files.length} attached
        </TagPill>
      </div>

      <div className="mt-4 space-y-2">
        {files.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-900/70 bg-black/20 px-6 py-5 text-sm text-slate-500">
            No files listed.
          </p>
        ) : (
          orderedFiles.map((file) => {
            const name = file.fileName ?? file.label;
            const classified = classifyCadFileType({ filename: name, extension: null });
            const cadKind = file.cadKind ?? (classified.ok ? classified.type : null);
            const canPreview = Boolean(file.storageSource && cadKind && file.signedUrl);

            const bucket = file.storageSource?.bucket ?? null;
            const isAutoPreviewFile = bucket === "cad_previews";
            const isStep = cadKind === "step";
            const isOriginalStepWithoutPreviewFile = isStep && !isAutoPreviewFile && !hasCadPreviewFiles;

            const primaryTag = formatPrimaryTag({ cadKind, isAutoPreviewFile });
            const statusLine = canPreview
              ? "3D preview available"
              : file.fallbackMessage ?? "Preview not available";

            const helperLine = isOriginalStepWithoutPreviewFile
              ? canPreview
                ? "Preview will be generated when viewed."
                : "Preview unavailable (re-upload may be required)."
              : isStep
                ? "Preview is for viewing only. Download retains the original file."
                : null;

            const content = (
              <>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {file.label}
                    </p>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <TagPill tone={isAutoPreviewFile ? "amber" : "slate"}>
                        {primaryTag}
                      </TagPill>
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">{statusLine}</p>
                  {helperLine ? (
                    <p className="mt-1 text-[11px] text-slate-600">{helperLine}</p>
                  ) : null}
                </div>
                {canPreview ? (
                  <span
                    className={clsx(
                      secondaryCtaClasses,
                      ctaSizeClasses.sm,
                      "whitespace-nowrap",
                    )}
                  >
                    View model
                  </span>
                ) : null}
              </>
            );

            return canPreview ? (
              <button
                key={file.id}
                type="button"
                onClick={() => setActiveFileId(file.id)}
                className="group flex w-full items-center justify-between rounded-xl border border-slate-900/60 bg-slate-950/20 px-6 py-4 text-left transition hover:border-slate-800 hover:bg-slate-900/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400/70"
              >
                {content}
              </button>
            ) : (
              <div
                key={file.id}
                className="flex w-full items-center justify-between rounded-xl border border-slate-900/60 bg-slate-950/10 px-6 py-4 text-left opacity-80"
              >
                {content}
              </div>
            );
          })
        )}
      </div>

      {activeFile ? (
        activeFile.storageSource && activeCadKind ? (
          <CadPreviewModal
            storageSource={activeFile.storageSource}
            filename={activeFile.fileName ?? activeFile.label}
            cadKind={activeCadKind}
            title="3D Preview"
            onClose={closeModal}
          />
        ) : (
          <QuoteFileUnsupportedModal file={activeFile} onClose={closeModal} />
        )
      ) : null}
    </section>
  );
}

function fileSortRank(file: QuoteFileItem): number {
  const bucket = file.storageSource?.bucket ?? "";
  if (bucket === "cad_uploads") return 0;
  if (bucket === "cad_previews") return 1;
  return 2;
}

function formatCadKindLabel(cadKind: CadKind | null): string | null {
  if (!cadKind) return null;
  if (cadKind === "step") return "STEP";
  if (cadKind === "stl") return "STL";
  if (cadKind === "obj") return "OBJ";
  if (cadKind === "glb") return "GLB";
  return String(cadKind).toUpperCase();
}

function formatPrimaryTag(input: {
  cadKind: CadKind | null;
  isAutoPreviewFile: boolean;
}): string {
  const kind = formatCadKindLabel(input.cadKind);
  if (input.isAutoPreviewFile) {
    return `Preview ${kind ?? "file"} (auto-generated)`;
  }
  return `Original ${kind ?? "file"}`;
}

type QuoteFileUnsupportedModalProps = {
  file: QuoteFileItem;
  onClose: () => void;
};

function QuoteFileUnsupportedModal({ file, onClose }: QuoteFileUnsupportedModalProps) {
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
        <div className="flex items-start justify-between gap-4 border-b border-slate-900 px-6 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              File preview
            </p>
            <h3 className="break-anywhere mt-1 text-lg font-semibold text-slate-50">
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
          <div className="flex h-[420px] items-center justify-center rounded-2xl border border-slate-800 bg-black/20 px-6 text-center">
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-100">
                Preview is not available for this file
              </p>
              <p className="text-sm text-slate-300">
                {file.fallbackMessage ?? "You can still download the original file."}
              </p>
            </div>
          </div>
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
