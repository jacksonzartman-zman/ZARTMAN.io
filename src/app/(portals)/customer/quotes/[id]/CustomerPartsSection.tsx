"use client";

import { useFormState } from "react-dom";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";
import type { QuoteUploadGroup } from "@/server/quotes/uploadFiles";
import {
  customerCreateQuotePartAction,
  customerUpdateQuotePartFilesAction,
  type CustomerPartFormState,
} from "./actions";

type FlatUploadFile = {
  id: string;
  filename: string;
  extension: string | null;
};

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getKindLabel(kind: ReturnType<typeof classifyUploadFileType>): string {
  if (kind === "cad") return "CAD";
  if (kind === "drawing") return "Drawing";
  return "Other";
}

function flattenUploadGroups(uploadGroups: QuoteUploadGroup[]): FlatUploadFile[] {
  const out: FlatUploadFile[] = [];
  const seen = new Set<string>();
  for (const group of uploadGroups ?? []) {
    for (const entry of group.entries ?? []) {
      const id = normalizeId(entry?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        filename: entry.filename,
        extension: entry.extension ?? null,
      });
    }
  }
  out.sort((a, b) => a.filename.localeCompare(b.filename));
  return out;
}

const DEFAULT_STATE: CustomerPartFormState = { status: "idle" };

export function CustomerPartsSection({
  quoteId,
  parts,
  uploadGroups,
}: {
  quoteId: string;
  parts: QuotePartWithFiles[];
  uploadGroups: QuoteUploadGroup[];
}) {
  const partsList = Array.isArray(parts) ? parts : [];
  const uploadFiles = flattenUploadGroups(Array.isArray(uploadGroups) ? uploadGroups : []);
  const { perPart, summary } = computePartsCoverage(partsList);
  const perPartById = new Map(perPart.map((row) => [row.partId, row]));

  const [createState, createAction] = useFormState(
    customerCreateQuotePartAction.bind(null, quoteId),
    DEFAULT_STATE,
  );
  const [filesState, filesAction] = useFormState(
    customerUpdateQuotePartFilesAction.bind(null, quoteId),
    DEFAULT_STATE,
  );

  const toneClasses =
    summary.anyParts && summary.allCovered
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : summary.anyParts
        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
        : "border-slate-800 bg-slate-950/50 text-slate-200";

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Parts (optional)
          </p>
          <p className="mt-1 text-sm text-slate-300">
            You can define parts and link CAD/drawings to make kickoff smoother. This is optional.
          </p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClasses}`}>
          Coverage:{" "}
          {summary.anyParts ? (summary.allCovered ? "Good" : "Needs attention") : "Not started"}
        </span>
      </header>

      {filesState.status !== "idle" ? (
        <p
          className={`mt-3 rounded-xl border px-4 py-3 text-xs ${
            filesState.status === "success"
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
              : "border-amber-500/30 bg-amber-500/5 text-amber-100"
          }`}
        >
          {filesState.message ??
            (filesState.status === "success"
              ? "Part files updated."
              : "Could not update part files.")}
        </p>
      ) : null}

      <div className="mt-4 space-y-3">
        {partsList.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/20 px-4 py-3 text-sm text-slate-300">
            No parts yet. Add one below if you want to organize files by part.
          </p>
        ) : null}

        {partsList.map((part) => {
          const coverage = perPartById.get(part.id) ?? null;
          const attached = new Set(
            (part.files ?? []).map((f) => normalizeId(f.quoteUploadFileId)).filter(Boolean),
          );

          return (
            <div key={part.id} className="rounded-2xl border border-slate-900/60 bg-slate-950/30">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-100">
                    {part.partLabel}
                  </p>
                  {part.notes ? (
                    <p className="mt-1 whitespace-pre-line text-xs text-slate-400">{part.notes}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-200">
                  <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                    CAD: {coverage?.cadCount ?? 0}
                  </span>
                  <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                    Drawings: {coverage?.drawingCount ?? 0}
                  </span>
                  <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1">
                    Other: {coverage?.otherCount ?? 0}
                  </span>
                </div>
              </div>

              <details className="border-t border-slate-900/60 px-4 py-3">
                <summary className="cursor-pointer select-none text-sm font-medium text-slate-200">
                  Assign files
                </summary>

                {uploadFiles.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-400">
                    No uploaded files available yet.
                  </p>
                ) : (
                  <form action={filesAction} className="mt-3 space-y-3">
                    <input type="hidden" name="quotePartId" value={part.id} />

                    <div className="max-h-64 overflow-auto rounded-xl border border-slate-900/60 bg-slate-950/40">
                      <ul className="divide-y divide-slate-900/60">
                        {uploadFiles.map((file) => {
                          const kind = classifyUploadFileType({
                            filename: file.filename,
                            extension: file.extension,
                          });
                          const checked = attached.has(file.id);
                          const label = getKindLabel(kind);

                          return (
                            <li key={file.id} className="flex items-center gap-3 px-4 py-2">
                              <input
                                type="checkbox"
                                name={`file-${file.id}`}
                                defaultChecked={checked}
                                className="h-4 w-4"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm text-slate-100">{file.filename}</p>
                                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                                  {label}
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    <div className="flex items-center justify-end">
                      <button
                        type="submit"
                        className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
                      >
                        Save
                      </button>
                    </div>
                  </form>
                )}
              </details>
            </div>
          );
        })}
      </div>

      <div className="mt-5 border-t border-slate-900/60 pt-4">
        {createState.status !== "idle" ? (
          <p
            className={`mb-3 rounded-xl border px-4 py-3 text-xs ${
              createState.status === "success"
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
                : "border-amber-500/30 bg-amber-500/5 text-amber-100"
            }`}
          >
            {createState.message ??
              (createState.status === "success" ? "Part added." : "Could not add part.")}
          </p>
        ) : null}

        <form action={createAction} className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Part name
              </span>
              <input
                name="label"
                required
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                placeholder="e.g. Bracket, Housing, Panel"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Notes (optional)
              </span>
              <input
                name="notes"
                className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
                placeholder="Any context to help kickoff"
              />
            </label>
          </div>

          <div className="flex items-center justify-end">
            <button
              type="submit"
              className="inline-flex items-center rounded-full border border-slate-800 bg-slate-900/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-700 hover:text-white"
            >
              Add part
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

