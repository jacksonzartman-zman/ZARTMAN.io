"use client";

import clsx from "clsx";
import { useActionState, useMemo, useRef, useState, type ChangeEvent } from "react";
import type {
  QuotePartWithFiles,
  QuotePartFileRole,
} from "@/app/(portals)/quotes/workspaceData";
import type { QuoteUploadFileEntry, QuoteUploadGroup } from "@/server/quotes/uploadFiles";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";
import {
  scoreFilesForPart,
  sortFilesByPartSuggestion,
} from "@/lib/uploads/suggestPartFiles";
import type { AdminQuotePartActionState } from "./actions";
import { adminUploadPartDrawingsAction } from "./actions";
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";

type PartsSectionProps = {
  quoteId: string;
  parts: QuotePartWithFiles[];
  uploadGroups: QuoteUploadGroup[];
  createPartAction: (
    prev: AdminQuotePartActionState,
    formData: FormData,
  ) => Promise<AdminQuotePartActionState>;
  updatePartFilesAction: (
    prev: AdminQuotePartActionState,
    formData: FormData,
  ) => Promise<AdminQuotePartActionState>;
};

const initialState: AdminQuotePartActionState = { ok: true, message: "" };

export function AdminPartsFilesSection({
  quoteId,
  parts,
  uploadGroups,
  createPartAction,
  updatePartFilesAction,
}: PartsSectionProps) {
  const [createState, createAction, createPending] = useActionState(
    createPartAction,
    initialState,
  );

  return (
    <div className="space-y-5">
      {createState.ok && createState.message ? (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {createState.message}
        </p>
      ) : !createState.ok ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          {createState.error}
        </p>
      ) : null}

      <div className="space-y-3">
        {parts.length === 0 ? (
          <p className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-4 text-sm text-slate-300">
            No parts yet. Add a part, then attach CAD and drawing files.
          </p>
        ) : (
          parts.map((part, index) => (
            <PartCard
              key={part.id}
              quoteId={quoteId}
              part={part}
              partIndex={index}
              uploadGroups={uploadGroups}
              updateAction={updatePartFilesAction}
            />
          ))
        )}
      </div>

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Add part
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Create a part label, then assign files below.
            </p>
          </div>
        </div>

        <form action={createAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-1">
            <label className="text-xs font-semibold text-slate-200" htmlFor="partLabel">
              Part name
            </label>
            <input
              id="partLabel"
              name="label"
              required
              className={clsx(
                "mt-1 w-full rounded-xl border bg-slate-950/30 px-3 py-2 text-sm text-slate-100",
                !createState.ok && createState.fieldErrors?.label
                  ? "border-red-500/40"
                  : "border-slate-800",
              )}
              placeholder="e.g. Housing, Bracket, Cover plate"
            />
            {!createState.ok && createState.fieldErrors?.label ? (
              <p className="mt-1 text-xs text-red-200">{createState.fieldErrors.label}</p>
            ) : null}
          </div>

          <div className="sm:col-span-1">
            <label className="text-xs font-semibold text-slate-200" htmlFor="partNotes">
              Notes (optional)
            </label>
            <input
              id="partNotes"
              name="notes"
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-100"
              placeholder="e.g. Rev B, critical surfaces called out"
            />
          </div>

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createPending}
              className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
            >
              {createPending ? "Adding…" : "Add part"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function PartCard({
  quoteId,
  part,
  partIndex,
  uploadGroups,
  updateAction,
}: {
  quoteId: string;
  part: QuotePartWithFiles;
  partIndex: number;
  uploadGroups: QuoteUploadGroup[];
  updateAction?: (
    prev: AdminQuotePartActionState,
    formData: FormData,
  ) => Promise<AdminQuotePartActionState>;
}) {
  const [open, setOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const assigned = useMemo(() => new Set(part.files.map((f) => f.quoteUploadFileId)), [part.files]);

  const cadCount = part.files.filter((f) => f.role === "cad").length;
  const drawingCount = part.files.filter((f) => f.role === "drawing").length;
  const otherCount = part.files.filter((f) => f.role === "other").length;

  const [state, action, pending] = useActionState(updateAction ?? (async () => initialState), initialState);
  const [uploadState, uploadAction, uploadPending] = useActionState(
    (prev: AdminQuotePartActionState, formData: FormData) =>
      adminUploadPartDrawingsAction(quoteId, part.id, prev, formData),
    initialState,
  );
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const maxLabel = formatMaxUploadSize();

  const uploadGroupsSafe = Array.isArray(uploadGroups) ? uploadGroups : [];
  const drawingAccept =
    ".pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.sldprt,.prt,.stl,.zip";

  function handleAdminFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const tooLarge = files.filter((f) => isFileTooLarge(f));
    if (tooLarge.length > 0) {
      setUploadError(
        `One or more files exceed the ${maxLabel} limit. Try splitting large PDFs or ZIPs.`,
      );
    } else {
      setUploadError(null);
    }
  }

  const uploadFiles = useMemo(() => {
    const out: QuoteUploadFileEntry[] = [];
    const seen = new Set<string>();
    for (const group of uploadGroupsSafe) {
      for (const entry of group.entries ?? []) {
        const id = typeof entry?.id === "string" ? entry.id.trim() : "";
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(entry);
      }
    }
    return out;
  }, [uploadGroupsSafe]);

  const { sortedFiles, suggestionScoreById } = useMemo(() => {
    const suggestions = scoreFilesForPart({
      partLabel: part.partLabel ?? "",
      partIndex,
      files: uploadFiles,
    });
    const sortedFiles = sortFilesByPartSuggestion(uploadFiles, suggestions);
    const suggestionScoreById = new Map(suggestions.map((s) => [s.fileId, s.score] as const));
    return { sortedFiles, suggestionScoreById };
  }, [part.partLabel, partIndex, uploadFiles]);

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-100">{part.partLabel}</p>
          {part.notes ? (
            <p className="mt-1 whitespace-pre-line text-sm text-slate-300">{part.notes}</p>
          ) : (
            <p className="mt-1 text-sm text-slate-500">No notes</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CountPill label="CAD" count={cadCount} tone="blue" />
          <CountPill label="Drawing" count={drawingCount} tone="purple" />
          <CountPill label="Other" count={otherCount} tone="slate" />
          <button
            type="button"
            className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
            onClick={() => setUploadOpen((v) => !v)}
          >
            {uploadOpen ? "Hide upload" : "Add drawing"}
          </button>
        </div>
      </div>

      {state.ok && state.message ? (
        <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
          {state.message}
        </p>
      ) : !state.ok ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100">
          {state.error}
        </p>
      ) : null}

      {uploadOpen ? (
        <form
          action={uploadAction}
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            const files = Array.from(uploadInputRef.current?.files ?? []);
            const tooLarge = files.filter((f) => isFileTooLarge(f));
            if (tooLarge.length > 0) {
              e.preventDefault();
              setUploadError(
                `One or more files exceed the ${maxLabel} limit. Try splitting large PDFs or ZIPs.`,
              );
            }
          }}
        >
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Add drawing(s) to this part
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Upload new drawings and attach them immediately to this part.
            </p>
            <p className="mt-1 text-[11px] text-slate-500">
              Max {maxLabel} per file. For very large drawings, consider splitting or providing a compressed version.
            </p>
            <input
              type="file"
              name="files"
              multiple
              accept={drawingAccept}
              ref={uploadInputRef}
              onChange={handleAdminFileChange}
              className="mt-3 block w-full text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
            />
            {uploadError ? (
              <p className="mt-2 text-xs text-red-200" role="alert">
                {uploadError}
              </p>
            ) : null}
            {!uploadState.ok && uploadState.fieldErrors?.files ? (
              <p className="mt-2 text-xs text-red-200">{uploadState.fieldErrors.files}</p>
            ) : null}
          </div>

          {uploadState.ok && uploadState.message ? (
            <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100">
              {uploadState.message}
            </p>
          ) : !uploadState.ok ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-100">
              {uploadState.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={uploadPending}
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
          >
            {uploadPending ? "Uploading…" : "Upload drawings"}
          </button>
        </form>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          className={clsx(secondaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Assign files"}
        </button>
      </div>

      {open ? (
        <form action={action} className="mt-4 space-y-3">
          <input type="hidden" name="quotePartId" value={part.id} />
          <div className="rounded-xl border border-slate-900/60 bg-slate-950/30">
            {uploadGroupsSafe.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400">
                No enumerated upload files found for this quote yet.
              </div>
            ) : (
              <div className="px-4 py-3">
                <p className="text-xs text-slate-400">
                  Most likely matches appear first. You can adjust selections as needed.
                </p>

                <ul className="mt-3 space-y-2">
                  {sortedFiles.map((entry, idx) => {
                    const kind = classifyUploadFileType({
                      filename: entry.filename,
                      extension: entry.extension ?? null,
                    });
                    const suggestionScore = suggestionScoreById.get(entry.id) ?? 0;
                    return (
                      <li key={`${entry.id}-${idx}`} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          name="fileIds"
                          value={entry.id}
                          defaultChecked={assigned.has(entry.id)}
                          className="mt-1 h-4 w-4 rounded border-slate-700 bg-slate-950/30"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm text-slate-100">{entry.filename}</span>
                            {suggestionScore > 0 ? (
                              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
                                Suggested
                              </span>
                            ) : null}
                            <FileKindPill kind={kind} />
                            {entry.is_from_archive ? (
                              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300">
                                ZIP
                              </span>
                            ) : null}
                          </div>
                          {entry.path && entry.path !== entry.filename ? (
                            <p className="mt-0.5 truncate font-mono text-[11px] text-slate-600">
                              {entry.path}
                            </p>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={pending || !updateAction}
            className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
          >
            {pending ? "Saving…" : "Save file assignments"}
          </button>
        </form>
      ) : null}
    </section>
  );
}

function FileKindPill({ kind }: { kind: QuotePartFileRole }) {
  const label = kind === "cad" ? "CAD" : kind === "drawing" ? "Drawing" : "Other";
  const classes =
    kind === "cad"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : kind === "drawing"
        ? "border-purple-500/30 bg-purple-500/10 text-purple-100"
        : "border-slate-700 bg-slate-900/30 text-slate-300";
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${classes}`}>
      {label}
    </span>
  );
}

function CountPill({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "blue" | "purple" | "slate";
}) {
  const classes =
    tone === "blue"
      ? "border-blue-500/30 bg-blue-500/10 text-blue-100"
      : tone === "purple"
        ? "border-purple-500/30 bg-purple-500/10 text-purple-100"
        : "border-slate-800 bg-slate-950/50 text-slate-200";
  return (
    <span
      className={clsx(
        "rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide",
        classes,
      )}
    >
      {label}: {count}
    </span>
  );
}

