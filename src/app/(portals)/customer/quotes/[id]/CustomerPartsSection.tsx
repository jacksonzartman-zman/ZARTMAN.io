"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFormState } from "react-dom";
import { computePartsCoverage } from "@/lib/quote/partsCoverage";
import { classifyUploadFileType } from "@/lib/uploads/classifyFileType";
import { classifyCadFileType } from "@/lib/cadRendering";
import { inferProtoParts } from "@/lib/quote/partsInference";
import {
  scoreFilesForPart,
  sortFilesByPartSuggestion,
} from "@/lib/uploads/suggestPartFiles";
import type { QuotePartWithFiles } from "@/app/(portals)/quotes/workspaceData";
import type { QuoteUploadFileEntry, QuoteUploadGroup } from "@/server/quotes/uploadFiles";
import type { AiPartSuggestion } from "@/server/quotes/aiPartsSuggestions";
import {
  customerCreateQuotePartAction,
  customerUpdateQuotePartFilesAction,
  generateAiPartSuggestionsAction,
  type CustomerPartFormState,
} from "./actions";
import {
  createPartFromSuggestionAction,
  type CreatePartFromSuggestionState,
} from "@/app/quote/actions";
import { CadPreviewModal } from "@/components/shared/CadPreviewModal";
import { EmptyStateCard } from "@/components/EmptyStateCard";

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getKindLabel(kind: ReturnType<typeof classifyUploadFileType>): string {
  if (kind === "cad") return "CAD";
  if (kind === "drawing") return "Drawing";
  return "Other";
}

function flattenUploadGroups(uploadGroups: QuoteUploadGroup[]): QuoteUploadFileEntry[] {
  const out: QuoteUploadFileEntry[] = [];
  const seen = new Set<string>();
  for (const group of uploadGroups ?? []) {
    for (const entry of group.entries ?? []) {
      const id = normalizeId(entry?.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(entry);
    }
  }
  return out;
}

const DEFAULT_STATE: CustomerPartFormState = { status: "idle" };
const DEFAULT_SUGGESTION_STATE: CreatePartFromSuggestionState = {
  ok: false,
  error: "",
  suggestionKey: "",
};

export function CustomerPartsSection({
  quoteId,
  parts,
  uploadGroups,
  aiSuggestions,
  aiModelVersion,
}: {
  quoteId: string;
  parts: QuotePartWithFiles[];
  uploadGroups: QuoteUploadGroup[];
  aiSuggestions?: AiPartSuggestion[] | null;
  aiModelVersion?: string | null;
}) {
  const partsList = useMemo(() => (Array.isArray(parts) ? parts : []), [parts]);
  const uploadFiles = flattenUploadGroups(Array.isArray(uploadGroups) ? uploadGroups : []);
  const hasAnyFiles = uploadFiles.length > 0;
  const { perPart, summary } = computePartsCoverage(partsList);
  const perPartById = new Map(perPart.map((row) => [row.partId, row]));
  const [cadPreview, setCadPreview] = useState<{
    fileId: string;
    filename: string;
    cadKind: "stl" | "obj" | "glb" | "step";
  } | null>(null);

  const [createState, createAction] = useFormState(
    customerCreateQuotePartAction.bind(null, quoteId),
    DEFAULT_STATE,
  );
  const [filesState, filesAction] = useFormState(
    customerUpdateQuotePartFilesAction.bind(null, quoteId),
    DEFAULT_STATE,
  );
  const [aiState, aiAction] = useFormState(
    generateAiPartSuggestionsAction.bind(null, quoteId),
    DEFAULT_STATE,
  );

  const [showAddPartForm, setShowAddPartForm] = useState(partsList.length === 0);
  const addPartRef = useRef<HTMLDivElement | null>(null);
  const addPartLabelRef = useRef<HTMLInputElement | null>(null);
  const partsTopRef = useRef<HTMLDivElement | null>(null);
  const [dismissedSuggestionKeys, setDismissedSuggestionKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const assignedFileIds = useMemo(() => {
    const ids = new Set<string>();
    for (const part of partsList) {
      for (const f of part.files ?? []) {
        const id = normalizeId(f?.quoteUploadFileId);
        if (id) ids.add(id);
      }
    }
    return ids;
  }, [partsList]);

  const filesById = useMemo(() => {
    const map = new Map<string, QuoteUploadFileEntry>();
    for (const file of uploadFiles) {
      const id = normalizeId(file?.id);
      if (!id) continue;
      map.set(id, file);
    }
    return map;
  }, [uploadFiles]);

  type SuggestedPart = {
    source: "ai" | "heuristic";
    label: string;
    partNumber?: string | null;
    fileIds: string[];
    confidence: number;
    rationale?: string;
  };

  const heuristicSuggestions = useMemo<SuggestedPart[]>(() => {
    const inferred = inferProtoParts(uploadFiles);
    return inferred
      .filter((p) => {
        if (!p.fileIds || p.fileIds.length === 0) return false;
        // If any file is already attached to an existing part, suppress this suggestion.
        if (p.fileIds.some((id) => assignedFileIds.has(id))) return false;
        const key = buildSuggestionKey(p.fileIds ?? []);
        if (dismissedSuggestionKeys.has(key)) return false;
        return true;
      })
      .map((p) => ({
        source: "heuristic" as const,
        label: p.label,
        fileIds: p.fileIds ?? [],
        confidence: typeof p.confidence === "number" ? p.confidence : 0,
      }));
  }, [uploadFiles, assignedFileIds, dismissedSuggestionKeys]);

  const aiSuggestionsNormalized = useMemo<SuggestedPart[]>(() => {
    const incoming = Array.isArray(aiSuggestions) ? aiSuggestions : [];
    return incoming
      .filter((s) => {
        const fileIds = Array.isArray(s?.fileIds) ? s.fileIds : [];
        if (fileIds.length === 0) return false;
        if (fileIds.some((id) => assignedFileIds.has(id))) return false;
        const key = buildSuggestionKey(fileIds);
        if (dismissedSuggestionKeys.has(key)) return false;
        return true;
      })
      .map((s) => ({
        source: "ai" as const,
        label: s.label,
        partNumber: typeof s.partNumber === "string" ? s.partNumber : s.partNumber ?? null,
        fileIds: Array.isArray(s.fileIds) ? s.fileIds : [],
        confidence: typeof s.confidence === "number" ? s.confidence : 0,
        rationale: typeof s.rationale === "string" ? s.rationale : undefined,
      }));
  }, [aiSuggestions, assignedFileIds, dismissedSuggestionKeys]);

  const usingAiSuggestions = aiSuggestionsNormalized.length > 0;
  const suggestedParts = usingAiSuggestions ? aiSuggestionsNormalized : heuristicSuggestions;

  useEffect(() => {
    if (!showAddPartForm) return;
    // Best-effort focus once visible.
    addPartLabelRef.current?.focus();
  }, [showAddPartForm]);

  const toneClasses =
    summary.anyParts && summary.allCovered
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : summary.anyParts
        ? "border-amber-500/40 bg-amber-500/10 text-amber-100"
        : "border-slate-800 bg-slate-950/50 text-slate-200";

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-5 py-4">
      <div ref={partsTopRef} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Parts (optional)
          </p>
          {hasAnyFiles ? (
            <p className="mt-1 text-sm text-slate-300">
              Define parts and link CAD/drawings to make kickoff and quoting clearer. Upload new files in
              the Uploads section above.
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-300">
              Upload CAD and drawings in the Uploads section above, then come back here to link them to
              parts.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-700 hover:text-white"
            onClick={() => {
              setShowAddPartForm(true);
              // Best-effort scroll + focus.
              requestAnimationFrame(() => {
                addPartRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                addPartLabelRef.current?.focus();
              });
            }}
          >
            Add part
          </button>
          <span className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${toneClasses}`}>
            Coverage:{" "}
            {summary.anyParts ? (summary.allCovered ? "Good" : "Needs attention") : "Not started"}
          </span>
        </div>
      </header>

      {!hasAnyFiles ? (
        <div className="mt-4">
          <EmptyStateCard
            title="Upload files to start"
            description="Once files are uploaded, you’ll be able to assign them to parts for clearer kickoff and quoting."
            className="px-4 py-3"
          />
        </div>
      ) : null}

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

      {hasAnyFiles ? (
        <div className="mt-4 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Suggested parts
              </p>
              <p className="mt-1 text-sm text-slate-300">
                {usingAiSuggestions
                  ? "These part groupings were suggested using AI based on filenames and drawing text. Review before adding."
                  : "These part groupings are based on filenames and folders. Review before adding."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <form action={aiAction}>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-700 hover:text-white"
                >
                  {usingAiSuggestions ? "Refresh AI suggestions" : "Use AI to suggest parts"}
                </button>
              </form>
              <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                {usingAiSuggestions ? "AI-suggested" : "Suggested"}
              </span>
            </div>
          </div>

          {aiState.status !== "idle" ? (
            <p
              className={`mt-3 rounded-xl border px-4 py-3 text-xs ${
                aiState.status === "success"
                  ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-100"
                  : "border-amber-500/30 bg-amber-500/5 text-amber-100"
              }`}
            >
              {aiState.message ??
                (aiState.status === "success"
                  ? "AI suggestions updated."
                  : "Could not generate AI suggestions.")}
              {usingAiSuggestions && aiModelVersion ? (
                <span className="ml-2 text-slate-300">Model: {aiModelVersion}</span>
              ) : null}
            </p>
          ) : usingAiSuggestions && aiModelVersion ? (
            <p className="mt-3 text-xs text-slate-500">Model: {aiModelVersion}</p>
          ) : null}

          {suggestedParts.length > 0 ? (
            <div className="mt-4 space-y-3">
              {suggestedParts.map((suggestion) => (
                <SuggestedPartRow
                  key={buildSuggestionKey(suggestion.fileIds)}
                  quoteId={quoteId}
                  suggestion={suggestion}
                  filesById={filesById}
                  onAdded={(key) => {
                    setDismissedSuggestionKeys((prev) => {
                      const next = new Set(prev);
                      next.add(key);
                      return next;
                    });
                    // Best-effort: keep user in the Parts section.
                    requestAnimationFrame(() => {
                      partsTopRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4">
              <EmptyStateCard
                title="No suggested parts yet"
                description="You can still add parts manually, or use AI to suggest parts."
                className="px-4 py-3"
              />
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {partsList.length === 0 ? (
          <EmptyStateCard
            title="No parts yet"
            description="Add a part below if you want to organize files by part."
            className="px-4 py-3"
          />
        ) : null}

        {partsList.map((part, index) => {
          const coverage = perPartById.get(part.id) ?? null;
          const attached = new Set(
            (part.files ?? []).map((f) => normalizeId(f.quoteUploadFileId)).filter(Boolean),
          );
          const suggestions = scoreFilesForPart({
            partLabel: part.partLabel ?? "",
            partIndex: index,
            files: uploadFiles,
          });
          const sortedFiles = sortFilesByPartSuggestion(uploadFiles, suggestions);
          const suggestionScoreById = new Map(
            suggestions.map((s) => [s.fileId, s.score] as const),
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

              {hasAnyFiles ? (
                <details className="border-t border-slate-900/60 px-4 py-3">
                  <summary className="cursor-pointer select-none text-xs font-semibold text-slate-300">
                    <span className="inline-flex items-center gap-2">
                      <span className="text-slate-400">Assign files</span>
                      <span className="text-slate-600">▾</span>
                    </span>
                  </summary>

                  <form action={filesAction} className="mt-3 space-y-3">
                    <input type="hidden" name="quotePartId" value={part.id} />

                    <p className="text-xs text-slate-400">
                      Suggested matches are shown first.
                    </p>

                    <div className="max-h-64 overflow-auto rounded-xl border border-slate-900/60 bg-slate-950/40">
                      <ul className="divide-y divide-slate-900/60">
                        {sortedFiles.map((file) => {
                          const kind = classifyUploadFileType({
                            filename: file.filename,
                            extension: file.extension,
                          });
                          const cadType = classifyCadFileType({
                            filename: file.filename,
                            extension: file.extension,
                          });
                          const checked = attached.has(file.id);
                          const label = getKindLabel(kind);
                          const suggestionScore = suggestionScoreById.get(file.id) ?? 0;

                          return (
                            <li key={file.id} className="flex items-center gap-3 px-4 py-2">
                              <input
                                type="checkbox"
                                name={`file-${file.id}`}
                                defaultChecked={checked}
                                className="h-4 w-4"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2 truncate text-sm text-slate-100">
                                  <span className="truncate">{file.filename}</span>
                                  {suggestionScore > 0 ? (
                                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
                                      Suggested
                                    </span>
                                  ) : null}
                                  {cadType.ok ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCadPreview({
                                          fileId: file.id,
                                          filename: file.filename,
                                          cadKind: cadType.type,
                                        })
                                      }
                                      className="text-xs font-semibold text-blue-200 underline-offset-4 hover:underline"
                                    >
                                      Preview 3D
                                    </button>
                                  ) : null}
                                </p>
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
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      {cadPreview ? (
        <CadPreviewModal
          fileId={cadPreview.fileId}
          filename={cadPreview.filename}
          cadKind={cadPreview.cadKind}
          title="3D Preview"
          onClose={() => setCadPreview(null)}
        />
      ) : null}

      <div ref={addPartRef} className="mt-5 border-t border-slate-900/60 pt-4">
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

        {showAddPartForm ? (
          <div className="rounded-2xl border border-slate-900/60 bg-slate-950/30 px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  Add part
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  Create a part label, then assign files once uploads are available.
                </p>
              </div>
              {partsList.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:border-slate-700 hover:text-white"
                  onClick={() => setShowAddPartForm(false)}
                >
                  Hide
                </button>
              ) : null}
            </div>

            <form action={createAction} className="mt-4 space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Part name
                  </span>
                  <input
                    ref={addPartLabelRef}
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
        ) : null}
      </div>
    </section>
  );
}

function buildSuggestionKey(fileIds: string[]): string {
  const ids = Array.isArray(fileIds) ? [...fileIds] : [];
  ids.sort();
  return ids.join(",");
}

function countKinds(fileIds: string[], filesById: Map<string, QuoteUploadFileEntry>) {
  let cad = 0;
  let drawing = 0;
  let other = 0;

  for (const id of fileIds) {
    const file = filesById.get(id);
    if (!file) continue;
    const kind = classifyUploadFileType({
      filename: file.filename,
      extension: file.extension,
    });
    if (kind === "cad") cad += 1;
    else if (kind === "drawing") drawing += 1;
    else other += 1;
  }

  return { cad, drawing, other };
}

function SuggestedPartRow({
  quoteId,
  suggestion,
  filesById,
  onAdded,
}: {
  quoteId: string;
  suggestion: {
    source: "ai" | "heuristic";
    label: string;
    partNumber?: string | null;
    fileIds: string[];
    confidence: number;
    rationale?: string;
  };
  filesById: Map<string, QuoteUploadFileEntry>;
  onAdded: (suggestionKey: string) => void;
}) {
  const suggestionKey = buildSuggestionKey(suggestion.fileIds ?? []);
  const [label, setLabel] = useState(suggestion.label);
  const [state, action] = useFormState<CreatePartFromSuggestionState, FormData>(
    createPartFromSuggestionAction,
    DEFAULT_SUGGESTION_STATE,
  );

  const counts = useMemo(
    () => countKinds(suggestion.fileIds ?? [], filesById),
    [suggestion.fileIds, filesById],
  );

  useEffect(() => {
    if (state.ok && state.suggestionKey === suggestionKey) {
      onAdded(suggestionKey);
    }
  }, [onAdded, state, suggestionKey]);

  const confidence = typeof suggestion.confidence === "number" ? suggestion.confidence : 0;
  const confidenceLabel =
    confidence < 30 ? "Low confidence" : confidence > 70 ? "High confidence match" : null;
  const confidenceClasses =
    confidence < 30
      ? "border-amber-500/30 bg-amber-500/10 text-amber-100"
      : confidence > 70
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
        : "border-slate-800 bg-slate-950/50 text-slate-300";

  return (
    <div className="rounded-2xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Part name
            </span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />
          </label>
          {suggestion.partNumber ? (
            <p className="mt-2 text-xs text-slate-400">
              Part #: <span className="font-semibold text-slate-200">{suggestion.partNumber}</span>
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-200">
            <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              CAD: {counts.cad}
            </span>
            <span className="rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-300">
              Drawings: {counts.drawing}
            </span>
            {suggestion.source === "ai" ? (
              <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-100">
                AI-suggested
              </span>
            ) : null}
            {confidenceLabel ? (
              <span
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${confidenceClasses}`}
              >
                {confidenceLabel}
              </span>
            ) : null}
          </div>
          {suggestion.source === "ai" && suggestion.rationale ? (
            <p className="mt-2 text-xs text-slate-400">{suggestion.rationale}</p>
          ) : null}
          {!state.ok && state.suggestionKey === suggestionKey && state.error ? (
            <p className="mt-2 text-xs text-amber-200" role="alert">
              {state.error}
            </p>
          ) : null}
        </div>

        <form
          action={(formData) => {
            formData.set("quoteId", quoteId);
            formData.set("label", label);
            if (suggestion.partNumber) {
              formData.set("partNumber", suggestion.partNumber);
            }
            formData.set("fileIds", (suggestion.fileIds ?? []).join(","));
            formData.set("suggestionKey", suggestionKey);
            return action(formData);
          }}
          className="flex items-center gap-2"
        >
          <button
            type="submit"
            className="inline-flex items-center rounded-full border border-emerald-400/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-100 transition hover:border-emerald-300 hover:text-white"
          >
            Add part
          </button>
        </form>
      </div>
    </div>
  );
}

