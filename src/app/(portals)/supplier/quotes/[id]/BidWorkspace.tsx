"use client";

import clsx from "clsx";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import type { QuotePartWithFiles, QuoteWorkspaceQuote } from "@/app/(portals)/quotes/workspaceData";
import {
  saveSupplierBidDraftAction,
  submitSupplierBidFromWorkspace,
  getUploadTargetsForSupplierQuote,
  registerUploadedFilesForSupplierQuote,
  ensureCadMetricsForSupplierQuoteAction,
  type SupplierUploadTarget,
  type SupplierUploadsFormState,
} from "./actions";
import type { SupplierBidDraft } from "@/server/suppliers/bidLines";
import type { CadFeatureSummary } from "@/server/quotes/cadFeatures";
import { suggestLeadTimeDays, suggestUnitPriceRange } from "@/lib/quote/partPricing";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatMaxUploadSize, isFileTooLarge } from "@/lib/uploads/uploadLimits";
import { supabaseBrowser } from "@/lib/supabase.client";
import { classifyCadFileType } from "@/lib/cadRendering";
import { ThreeCadViewer } from "@/components/ThreeCadViewer";

const UPLOAD_ACCEPT = ".pdf,.dwg,.dxf,.step,.stp,.igs,.iges,.sldprt,.prt,.stl,.zip";

type BidWorkspaceProps = {
  quote: QuoteWorkspaceQuote;
  parts: QuotePartWithFiles[];
  initialDraft: SupplierBidDraft | null;
  cadFeaturesByFileId?: Record<string, CadFeatureSummary>;
  uploadTargets?: {
    accept?: string;
  };
};

type LineInputState = {
  quantity: string;
  unitPrice: string;
  leadTimeDays: string;
};

type PreviewModalState =
  | { open: false }
  | {
      open: true;
      partId: string;
      title: string;
      files: Array<{ fileId: string; filename: string; extension: string | null }>;
      activeFileId: string;
    };

function normalizeNumberInput(raw: string): string {
  return raw.replace(/[\s,]/g, "");
}

function parsePositiveNumber(raw: string): number | null {
  const trimmed = normalizeNumberInput(raw).trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return null;
  if (value <= 0) return null;
  return value;
}

function countRole(part: QuotePartWithFiles, role: "cad" | "drawing"): number {
  return (part.files ?? []).filter((f) => f.role === role).length;
}

function buildInitialLineState(part: QuotePartWithFiles, draft: SupplierBidDraft | null): LineInputState {
  const draftLine =
    draft?.bidLines?.find((l) => typeof l?.partId === "string" && l.partId.trim() === part.id) ?? null;

  const defaultLeadTime = suggestLeadTimeDays(part);

  const quantity =
    typeof draftLine?.quantity === "number" && Number.isFinite(draftLine.quantity)
      ? String(draftLine.quantity)
      : "1";

  const unitPrice =
    typeof draftLine?.unitPrice === "number" && Number.isFinite(draftLine.unitPrice)
      ? String(draftLine.unitPrice)
      : "";

  const leadTimeDays =
    typeof draftLine?.leadTimeDays === "number" && Number.isFinite(draftLine.leadTimeDays)
      ? String(draftLine.leadTimeDays)
      : String(defaultLeadTime);

  return { quantity, unitPrice, leadTimeDays };
}

function toDraft(
  parts: QuotePartWithFiles[],
  linesByPartId: Record<string, LineInputState>,
  notes: string,
): SupplierBidDraft {
  return {
    bidLines: parts.map((part) => {
      const state = linesByPartId[part.id];
      const quantity = state ? parsePositiveNumber(state.quantity) : null;
      const unitPrice = state ? parsePositiveNumber(state.unitPrice) : null;
      const leadTimeDays = state ? parsePositiveNumber(state.leadTimeDays) : null;

      return {
        partId: part.id,
        quantity,
        unitPrice,
        leadTimeDays,
      };
    }),
    notes: notes.trim().length > 0 ? notes.trim() : null,
  };
}

export function BidWorkspace({
  quote,
  parts,
  initialDraft,
  cadFeaturesByFileId,
  uploadTargets,
}: BidWorkspaceProps) {
  const router = useRouter();
  const partsList = useMemo(() => (Array.isArray(parts) ? parts : []), [parts]);

  const [notes, setNotes] = useState<string>(initialDraft?.notes ?? "");
  const [linesByPartId, setLinesByPartId] = useState<Record<string, LineInputState>>(() => {
    const initial: Record<string, LineInputState> = {};
    for (const part of partsList) {
      initial[part.id] = buildInitialLineState(part, initialDraft);
    }
    return initial;
  });

  // Keep state in sync if the server sends a different set of parts.
  useEffect(() => {
    setLinesByPartId((prev) => {
      const next: Record<string, LineInputState> = { ...prev };
      for (const part of partsList) {
        if (!next[part.id]) {
          next[part.id] = buildInitialLineState(part, initialDraft);
        }
      }
      // Drop stale part ids.
      for (const key of Object.keys(next)) {
        if (!partsList.some((p) => p.id === key)) {
          delete next[key];
        }
      }
      return next;
    });
  }, [initialDraft, partsList]);

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [previewModal, setPreviewModal] = useState<PreviewModalState>({ open: false });

  const validation = useMemo(() => {
    const perPart = partsList.map((part) => {
      const state = linesByPartId[part.id];
      const qty = state ? parsePositiveNumber(state.quantity) : null;
      const unit = state ? parsePositiveNumber(state.unitPrice) : null;
      const lead = state ? parsePositiveNumber(state.leadTimeDays) : null;

      const cadCount = countRole(part, "cad");
      const drawingCount = countRole(part, "drawing");

      const errors: string[] = [];
      if (qty === null) errors.push("Quantity required");
      if (unit === null) errors.push("Unit price required");
      if (lead === null) errors.push("Lead time required");

      // Non-numeric / negative / zero already collapse to null above.

      return {
        partId: part.id,
        qty,
        unit,
        lead,
        cadCount,
        drawingCount,
        missingDrawings: drawingCount === 0,
        errors,
        ok: errors.length === 0,
      };
    });

    const allValid = perPart.every((p) => p.ok);

    const totalAmount = perPart.reduce((sum, row) => {
      if (typeof row.qty === "number" && typeof row.unit === "number") {
        return sum + row.qty * row.unit;
      }
      return sum;
    }, 0);

    const leadTimeDays = perPart.reduce((max, row) => {
      if (typeof row.lead === "number") {
        return Math.max(max, row.lead);
      }
      return max;
    }, 0);

    const missingDrawingsCount = perPart.filter((p) => p.missingDrawings).length;

    return {
      perPart,
      allValid,
      totalAmount,
      leadTimeDays,
      missingDrawingsCount,
    };
  }, [linesByPartId, partsList]);

  async function handleSaveDraft() {
    if (partsList.length === 0) return;

    setSaveStatus("saving");
    setSaveError(null);
    try {
      const draft = toDraft(partsList, linesByPartId, notes);
      const result = await saveSupplierBidDraftAction(quote.id, draft);
      if (!result.ok) {
        setSaveStatus("error");
        setSaveError(result.error);
        return;
      }
      setSaveStatus("saved");
      window.setTimeout(() => {
        setSaveStatus("idle");
      }, 1500);
    } catch (e) {
      console.error("[bid workspace] save draft failed", e);
      setSaveStatus("error");
      setSaveError("Could not save draft. Please try again.");
    }
  }

  async function handleSubmitBid() {
    setSubmitStatus("submitting");
    setSubmitError(null);

    if (!validation.allValid) {
      setSubmitStatus("error");
      setSubmitError("Complete all required fields before submitting.");
      return;
    }

    if (!Number.isFinite(validation.totalAmount) || validation.totalAmount <= 0) {
      setSubmitStatus("error");
      setSubmitError("Total bid amount must be greater than zero.");
      return;
    }

    if (!Number.isFinite(validation.leadTimeDays) || validation.leadTimeDays <= 0) {
      setSubmitStatus("error");
      setSubmitError("Lead time must be greater than zero.");
      return;
    }

    try {
      // Best-effort: save draft before submit so refresh keeps your work.
      await handleSaveDraft();

      const result = await submitSupplierBidFromWorkspace({
        quoteId: quote.id,
        amount: Math.round(validation.totalAmount * 100) / 100,
        leadTimeDays: Math.round(validation.leadTimeDays),
        notes: notes.trim().length > 0 ? notes.trim() : null,
      });

      if (!result.ok) {
        setSubmitStatus("error");
        setSubmitError(result.error || "We couldn't submit your bid. Please try again.");
        return;
      }

      setSubmitStatus("success");
      router.refresh();
    } catch (e) {
      console.error("[bid workspace] submit failed", e);
      setSubmitStatus("error");
      setSubmitError("We couldn't submit your bid. Please try again.");
    }
  }

  if (partsList.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <p className="text-sm text-slate-200">
          Bid workspace available once this search request has parts.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <PartBidTable
        parts={partsList}
        linesByPartId={linesByPartId}
        onChange={(partId, patch) =>
          setLinesByPartId((prev) => ({
            ...prev,
            [partId]: { ...prev[partId], ...patch },
          }))
        }
        validation={validation.perPart}
        onPreview={(part, kind) => {
          const files = (part.files ?? [])
            .filter((f) => f.role === kind)
            .map((f) => ({
              fileId: f.quoteUploadFileId,
              filename: f.filename,
              extension: f.extension,
            }));
          if (files.length === 0) return;

          setPreviewModal({
            open: true,
            partId: part.id,
            title: kind === "cad" ? `CAD · ${part.partLabel}` : `Drawings · ${part.partLabel}`,
            files,
            activeFileId: files[0]!.fileId,
          });
        }}
      />

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Notes
            </p>
            <p className="mt-1 text-sm text-slate-300">
              Optional clarifications, certifications, or assumptions.
            </p>
          </div>
        </div>

        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          className="mt-4 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none"
          placeholder="Examples: material assumptions, inspection plan, certs, MOQ, packaging, etc."
        />
      </section>

      <SupplierAttachmentsForm
        quoteId={quote.id}
        accept={uploadTargets?.accept ?? UPLOAD_ACCEPT}
      />

      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold text-white">Summary</p>
            <p className="text-xs text-slate-400">
              Total: <span className="font-semibold text-slate-200">${validation.totalAmount.toFixed(2)}</span> · Lead time:{" "}
              <span className="font-semibold text-slate-200">{Math.round(validation.leadTimeDays)} days</span>
              {validation.missingDrawingsCount > 0 ? (
                <span className="ml-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-100">
                  {validation.missingDrawingsCount} part{validation.missingDrawingsCount === 1 ? "" : "s"} missing drawings
                </span>
              ) : null}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saveStatus === "saving"}
              className={clsx(
                `${ctaSizeClasses.md} rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600`,
                saveStatus === "saving" ? "opacity-60" : "",
              )}
            >
              {saveStatus === "saving" ? "Saving…" : "Save draft"}
            </button>
            <button
              type="button"
              onClick={handleSubmitBid}
              disabled={submitStatus === "submitting" || !validation.allValid}
              className={clsx(
                primaryCtaClasses,
                ctaSizeClasses.md,
                submitStatus === "submitting" || !validation.allValid ? "opacity-60" : "",
              )}
            >
              {submitStatus === "submitting" ? "Submitting…" : "Submit bid"}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {saveStatus === "saved" ? (
            <p className="text-sm text-emerald-200" role="status">
              Draft saved.
            </p>
          ) : null}
          {saveStatus === "error" ? (
            <p className="text-sm text-red-200" role="alert">
              {saveError ?? "Could not save draft."}
            </p>
          ) : null}

          {submitStatus === "success" ? (
            <p className="text-sm text-emerald-200" role="status">
              Bid submitted.
            </p>
          ) : null}
          {submitStatus === "error" ? (
            <p className="text-sm text-red-200" role="alert">
              {submitError ?? "Could not submit bid."}
            </p>
          ) : null}

          {!validation.allValid ? (
            <p className="text-[11px] text-slate-500">
              Submit is disabled until all parts have quantity, unit price, and lead time.
            </p>
          ) : null}
        </div>
      </section>

      <CadDrawingPreviewModal
        quoteId={quote.id}
        state={previewModal}
        cadFeaturesByFileId={cadFeaturesByFileId ?? {}}
        onClose={() => setPreviewModal({ open: false })}
        onSwitchFile={(fileId) => {
          if (!previewModal.open) return;
          setPreviewModal({ ...previewModal, activeFileId: fileId });
        }}
      />
    </div>
  );
}

function PartBidTable({
  parts,
  linesByPartId,
  onChange,
  validation,
  onPreview,
}: {
  parts: QuotePartWithFiles[];
  linesByPartId: Record<string, LineInputState>;
  onChange: (partId: string, patch: Partial<LineInputState>) => void;
  validation: Array<{
    partId: string;
    cadCount: number;
    drawingCount: number;
    missingDrawings: boolean;
    errors: string[];
    ok: boolean;
  }>;
  onPreview: (part: QuotePartWithFiles, kind: "cad" | "drawing") => void;
}) {
  const validationByPartId = useMemo(() => {
    const map: Record<string, (typeof validation)[number]> = {};
    for (const row of validation) map[row.partId] = row;
    return map;
  }, [validation]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-900 bg-slate-950/40">
      <div className="border-b border-slate-900 px-6 py-4">
        <p className="text-sm font-semibold text-white">Per-part bid lines</p>
        <p className="mt-1 text-xs text-slate-400">
          Enter quantity, unit price, and lead time for each part.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full">
          <thead className="bg-slate-950/60">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              <th className="px-6 py-3">Part</th>
              <th className="px-4 py-3">Qty</th>
              <th className="px-4 py-3">Unit price</th>
              <th className="px-4 py-3">Suggested</th>
              <th className="px-4 py-3">Lead time (days)</th>
              <th className="px-4 py-3">Suggested</th>
              <th className="px-4 py-3">Files</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {parts.map((part) => {
              const state = linesByPartId[part.id];
              const v = validationByPartId[part.id];
              const cadCount = v?.cadCount ?? countRole(part, "cad");
              const drawingCount = v?.drawingCount ?? countRole(part, "drawing");
              const missingDrawings = v?.missingDrawings ?? drawingCount === 0;
              const suggestions = suggestUnitPriceRange(part);
              const leadSuggestion = suggestLeadTimeDays(part);

              return (
                <tr
                  key={part.id}
                  className={clsx(
                    "align-top",
                    missingDrawings ? "bg-amber-500/5" : "",
                    v && !v.ok ? "bg-red-500/5" : "",
                  )}
                >
                  <td className="px-6 py-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {part.partNumber ? `${part.partLabel} (${part.partNumber})` : part.partLabel}
                      </p>
                      {missingDrawings ? (
                        <p className="mt-1 text-xs text-amber-200">
                          Missing drawings — please review CAD and confirm tolerances.
                        </p>
                      ) : null}
                      {v && v.errors.length > 0 ? (
                        <p className="mt-1 text-xs text-red-200">
                          {v.errors.join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </td>

                  <td className="px-4 py-4">
                    <input
                      value={state?.quantity ?? ""}
                      onChange={(e) => onChange(part.id, { quantity: e.target.value })}
                      inputMode="numeric"
                      className="w-24 rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                      placeholder="1"
                    />
                  </td>

                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-500">$</span>
                      <input
                        value={state?.unitPrice ?? ""}
                        onChange={(e) => onChange(part.id, { unitPrice: e.target.value })}
                        inputMode="decimal"
                        className="w-32 rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                        placeholder="0"
                      />
                    </div>
                  </td>

                  <td className="px-4 py-4">
                    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                      ${suggestions.low}–${suggestions.high}
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <input
                      value={state?.leadTimeDays ?? ""}
                      onChange={(e) => onChange(part.id, { leadTimeDays: e.target.value })}
                      inputMode="numeric"
                      className="w-32 rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:border-blue-400 focus:outline-none"
                      placeholder={String(leadSuggestion)}
                    />
                  </td>

                  <td className="px-4 py-4">
                    <span className="inline-flex items-center rounded-full border border-slate-800 bg-slate-950/50 px-3 py-1 text-xs font-semibold text-slate-200">
                      {leadSuggestion} days
                    </span>
                  </td>

                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400">
                        CAD: <span className="font-semibold text-slate-200">{cadCount}</span> · Drawings:{" "}
                        <span className="font-semibold text-slate-200">{drawingCount}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {cadCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => onPreview(part, "cad")}
                            className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                          >
                            Preview CAD
                          </button>
                        ) : null}
                        {drawingCount > 0 ? (
                          <button
                            type="button"
                            onClick={() => onPreview(part, "drawing")}
                            className="font-semibold text-blue-200 underline-offset-4 hover:underline"
                          >
                            Preview drawings
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CadDrawingPreviewModal({
  quoteId,
  state,
  cadFeaturesByFileId,
  onClose,
  onSwitchFile,
}: {
  quoteId: string;
  state: PreviewModalState;
  cadFeaturesByFileId: Record<string, CadFeatureSummary>;
  onClose: () => void;
  onSwitchFile: (fileId: string) => void;
}) {
  const router = useRouter();
  const [analysisStatus, setAnalysisStatus] = useState<
    "idle" | "pending" | "done" | "error"
  >("idle");
  const requestedRef = useRef(false);

  const files = state.open ? state.files : [];
  const activeFileId = state.open ? state.activeFileId : null;

  const active =
    files.find((f) => f.fileId === activeFileId) ??
    files[0] ??
    null;
  const extension = (active?.extension ?? "").toLowerCase();
  const isPdf = extension === "pdf";
  const cadType = classifyCadFileType({
    filename: active?.filename ?? "",
    extension: active?.extension ?? null,
  });

  const feature = cadFeaturesByFileId[active?.fileId ?? ""] ?? null;
  const hasFeatureMetrics = Boolean(feature?.bboxMin && feature?.bboxMax);
  const bboxLabel =
    feature?.bboxMin && feature?.bboxMax ? formatBboxLabel(feature.bboxMin, feature.bboxMax) : null;
  const trianglesLabel =
    typeof feature?.triangleCount === "number" && Number.isFinite(feature.triangleCount)
      ? feature.triangleCount.toLocaleString()
      : null;
  const complexity = formatComplexity(feature?.complexityScore ?? null);
  const dfmFlags = Array.isArray(feature?.dfmFlags) ? feature.dfmFlags : [];

  useEffect(() => {
    // Only kick off background analysis for CAD files that don't have cached metrics yet.
    if (!state.open) return;
    if (!cadType.ok) return;
    if (hasFeatureMetrics) return;
    if (requestedRef.current) return;
    requestedRef.current = true;
    setAnalysisStatus("pending");

    void ensureCadMetricsForSupplierQuoteAction(quoteId)
      .then((res) => {
        if (!res.ok) {
          setAnalysisStatus("error");
          return;
        }
        setAnalysisStatus("done");
        router.refresh();
      })
      .catch((error) => {
        console.error("[bid workspace] cad analysis request failed", error);
        setAnalysisStatus("error");
      });
  }, [cadType.ok, hasFeatureMetrics, quoteId, router, state.open]);

  if (!state.open) return null;

  const inlineUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(active?.fileId ?? "")}&disposition=inline`;
  const downloadUrl = `/api/parts-file-preview?fileId=${encodeURIComponent(active?.fileId ?? "")}&disposition=attachment`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-900 px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{state.title}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{active?.filename ?? "File"}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={downloadUrl}
              className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
            >
              Download
            </a>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
            >
              Close
            </button>
          </div>
        </div>

        <div className="grid gap-4 p-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Files
            </p>
            <div className="space-y-1">
              {state.files.map((f) => (
                <button
                  key={f.fileId}
                  type="button"
                  onClick={() => onSwitchFile(f.fileId)}
                  className={clsx(
                    "w-full truncate rounded-lg border px-3 py-2 text-left text-xs",
                    f.fileId === state.activeFileId
                      ? "border-blue-500/40 bg-blue-500/10 text-blue-100"
                      : "border-slate-800 bg-black/20 text-slate-200 hover:border-slate-700",
                  )}
                >
                  {f.filename}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-900 bg-black/30">
            {isPdf ? (
              <iframe
                title="Preview"
                src={inlineUrl}
                className="h-[70vh] w-full"
              />
            ) : cadType.ok ? (
              <div className="p-4 space-y-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/40 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        CAD metrics
                      </p>
                      {hasFeatureMetrics ? (
                        <p className="mt-1 text-sm text-slate-200">
                          Size{" "}
                          <span className="font-semibold text-slate-100">{bboxLabel}</span>
                          {trianglesLabel ? (
                            <span className="ml-2 text-slate-400">
                              • Triangles{" "}
                              <span className="font-semibold text-slate-200">{trianglesLabel}</span>
                            </span>
                          ) : null}
                        </p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-300">
                          {analysisStatus === "pending" || analysisStatus === "idle"
                            ? "Analyzing CAD…"
                            : analysisStatus === "error"
                              ? "Metrics unavailable right now."
                              : "Analyzing CAD…"}
                        </p>
                      )}
                    </div>
                    <span
                      className={clsx(
                        "rounded-full border px-3 py-1 text-[11px] font-semibold",
                        complexity.pillClasses,
                      )}
                    >
                      Complexity: {complexity.label}
                    </span>
                  </div>

                  {dfmFlags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {dfmFlags.slice(0, 6).map((flag) => (
                        <span
                          key={flag}
                          className={clsx(
                            "rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                            dfmFlagPillClasses(flag),
                          )}
                        >
                          {formatDfmFlagLabel(flag)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>

                <ThreeCadViewer
                  fileId={active?.fileId ?? ""}
                  filenameHint={active?.filename ?? null}
                  cadKind={cadType.ok ? cadType.type : null}
                />
              </div>
            ) : (
              <div className="p-6">
                <p className="text-sm text-slate-200">
                  Unable to render this file here. You can still download it.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatBboxLabel(
  min: { x: number; y: number; z: number },
  max: { x: number; y: number; z: number },
): string {
  const dx = Math.abs(max.x - min.x);
  const dy = Math.abs(max.y - min.y);
  const dz = Math.abs(max.z - min.z);
  return `${formatMm(dx)} × ${formatMm(dy)} × ${formatMm(dz)} mm`;
}

function formatMm(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatComplexity(score: number | null): { label: string; pillClasses: string } {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return {
      label: "Unknown",
      pillClasses: "border-slate-800 bg-slate-950/50 text-slate-300",
    };
  }
  const s = Math.max(0, Math.min(100, Math.round(score)));
  if (s <= 33) {
    return {
      label: "Low",
      pillClasses: "border-emerald-500/30 bg-emerald-500/10 text-emerald-100",
    };
  }
  if (s <= 66) {
    return {
      label: "Medium",
      pillClasses: "border-amber-500/30 bg-amber-500/10 text-amber-100",
    };
  }
  return { label: "High", pillClasses: "border-red-500/30 bg-red-500/10 text-red-100" };
}

function formatDfmFlagLabel(flag: string): string {
  const normalized = (flag ?? "").trim().toLowerCase();
  if (normalized === "very_large") return "Very large";
  if (normalized === "very_small") return "Very small";
  if (normalized === "very_complex") return "Very complex";
  if (normalized === "maybe_thin") return "Maybe thin";
  if (normalized === "step_unsupported") return "STEP unsupported";
  return normalized.replace(/[_-]+/g, " ").trim().replace(/^\w/, (m) => m.toUpperCase());
}

function dfmFlagPillClasses(flag: string): string {
  const normalized = (flag ?? "").trim().toLowerCase();
  if (normalized === "very_complex") return "border-red-500/30 bg-red-500/10 text-red-100";
  if (normalized === "very_large") return "border-amber-500/30 bg-amber-500/10 text-amber-100";
  if (normalized === "maybe_thin") return "border-amber-500/30 bg-amber-500/5 text-amber-100";
  if (normalized === "very_small") return "border-blue-500/30 bg-blue-500/10 text-blue-100";
  if (normalized === "step_unsupported") return "border-slate-700 bg-slate-900/30 text-slate-200";
  return "border-slate-800 bg-slate-950/50 text-slate-300";
}

function SupplierAttachmentsForm({ quoteId, accept }: { quoteId: string; accept: string }) {
  const [state, setState] = useState<SupplierUploadsFormState>({ status: "idle" });
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const maxLabel = formatMaxUploadSize();

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    const tooLarge = files.filter((f) => isFileTooLarge(f));
    if (tooLarge.length > 0) {
      setLocalError(
        `One or more files exceed the ${maxLabel} limit. Please upload smaller files or split large ZIPs.`,
      );
    } else {
      setLocalError(null);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Attachments
          </p>
          <p className="mt-1 text-sm text-slate-300">
            Upload supporting documents or clarifications (non-part-specific).
          </p>
        </div>
      </div>

      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const files = Array.from(inputRef.current?.files ?? []);
          const tooLarge = files.filter((f) => isFileTooLarge(f));
          if (tooLarge.length > 0) {
            setLocalError(
              `One or more files exceed the ${maxLabel} limit. Please upload smaller files or split large ZIPs.`,
            );
            return;
          }
          setLocalError(null);
          setState({ status: "idle" });

          if (files.length === 0) {
            setState({ status: "error", message: "Please choose at least one file to upload." });
            return;
          }

          setPending(true);
          try {
            const filesMeta = files.map((file) => ({
              fileName: file.name,
              sizeBytes: file.size,
              mimeType: file.type || null,
            }));

            const prepareData = new FormData();
            prepareData.set("filesMeta", JSON.stringify(filesMeta));

            const prepare = await getUploadTargetsForSupplierQuote(
              quoteId,
              { status: "idle" },
              prepareData,
            );

            if (!("targets" in prepare)) {
              setState(prepare);
              return;
            }

            const targets = prepare.targets;
            if (targets.length !== files.length) {
              setState({ status: "error", message: "Upload preparation failed. Please try again." });
              return;
            }

            const sb = supabaseBrowser();
            for (let i = 0; i < targets.length; i += 1) {
              const target = targets[i] as SupplierUploadTarget;
              const file = files[i]!;

              const { error: storageError } = await sb.storage
                .from(target.bucketId)
                .upload(target.storagePath, file, {
                  cacheControl: "3600",
                  upsert: false,
                  contentType: target.mimeType || file.type || "application/octet-stream",
                });

              if (storageError) {
                console.error("[supplier uploads] storage upload failed", storageError);
                setState({ status: "error", message: "Could not upload files. Please try again." });
                return;
              }
            }

            const registerData = new FormData();
            registerData.set("targets", JSON.stringify(targets));

            const registered = await registerUploadedFilesForSupplierQuote(
              quoteId,
              { status: "idle" },
              registerData,
            );
            setState(registered);

            if (registered.status === "success" && inputRef.current) {
              inputRef.current.value = "";
            }
          } finally {
            setPending(false);
          }
        }}
      >
        <input
          type="file"
          name="files"
          multiple
          accept={accept}
          ref={inputRef}
          onChange={handleFileChange}
          className="block w-full text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-100 hover:file:bg-slate-700"
        />

        {localError ? (
          <p className="text-sm text-red-200" role="alert">
            {localError}
          </p>
        ) : null}

        {state.status === "error" ? (
          <p className="text-sm text-red-200" role="alert">
            {state.message ?? "Could not upload files."}
          </p>
        ) : null}

        {state.status === "success" ? (
          <p className="text-sm text-emerald-200" role="status">
            {state.message ?? "Files uploaded."}
          </p>
        ) : null}

        <p className="text-[11px] text-slate-500">Max {maxLabel} per file.</p>

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className={clsx(primaryCtaClasses, ctaSizeClasses.sm, "inline-flex")}
        >
          {pending ? "Uploading…" : "Upload"}
        </button>
      </form>
    </section>
  );
}
