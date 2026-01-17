"use client";

import clsx from "clsx";
import { CopyTextButton } from "@/components/CopyTextButton";
import { ctaSizeClasses, dangerCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import type { OfferDraft } from "./destinationHelpers";

type OfferModalProps = {
  isOpen: boolean;
  providerLabel: string;
  offerDraft: OfferDraft;
  offerFieldErrors: Record<string, string>;
  offerError: string | null;
  pending: boolean;
  onClose: () => void;
  onChange: (field: keyof OfferDraft, value: string) => void;
  onSubmit: () => void;
};

type DestinationEmailModalProps = {
  isOpen: boolean;
  providerLabel: string;
  subject: string;
  body: string;
  pending: boolean;
  onClose: () => void;
  onMarkSent: () => void;
};

export type BulkDestinationEmailResult = {
  destinationId: string;
  providerLabel: string;
  status: "success" | "error" | "skipped";
  subject?: string;
  body?: string;
  message: string;
};

type BulkDestinationEmailModalProps = {
  isOpen: boolean;
  results: BulkDestinationEmailResult[];
  pending: boolean;
  onClose: () => void;
};

type DestinationErrorModalProps = {
  isOpen: boolean;
  errorNote: string;
  errorFeedback: string | null;
  pending: boolean;
  onClose: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  title?: string;
  description?: string;
  submitLabel?: string;
};

export function OfferModal({
  isOpen,
  providerLabel,
  offerDraft,
  offerFieldErrors,
  offerError,
  pending,
  onClose,
  onChange,
  onSubmit,
}: OfferModalProps) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add or edit offer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Add offer details</h3>
            <p className="mt-1 text-sm text-slate-300">
              Capture normalized pricing and lead time for{" "}
              <span className="font-semibold text-slate-100">{providerLabel}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Total price
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={offerDraft.totalPrice}
                onChange={(event) => onChange("totalPrice", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.totalPrice ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.totalPrice}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Unit price
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={offerDraft.unitPrice}
                onChange={(event) => onChange("unitPrice", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.unitPrice ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.unitPrice}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Tooling price
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={offerDraft.toolingPrice}
                onChange={(event) => onChange("toolingPrice", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.toolingPrice ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.toolingPrice}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Shipping price
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={offerDraft.shippingPrice}
                onChange={(event) => onChange("shippingPrice", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.shippingPrice ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.shippingPrice}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lead time min days
              </label>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                value={offerDraft.leadTimeDaysMin}
                onChange={(event) => onChange("leadTimeDaysMin", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.leadTimeDaysMin ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.leadTimeDaysMin}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Lead time max days
              </label>
              <input
                type="number"
                inputMode="numeric"
                step={1}
                value={offerDraft.leadTimeDaysMax}
                onChange={(event) => onChange("leadTimeDaysMax", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0"
              />
              {offerFieldErrors.leadTimeDaysMax ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.leadTimeDaysMax}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Confidence score
              </label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={offerDraft.confidenceScore}
                onChange={(event) => onChange("confidenceScore", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="0-100"
              />
              {offerFieldErrors.confidenceScore ? (
                <p className="text-xs text-amber-200">{offerFieldErrors.confidenceScore}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Risk flags
              </label>
              <input
                type="text"
                value={offerDraft.riskFlags}
                onChange={(event) => onChange("riskFlags", event.target.value)}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
                placeholder="comma-separated"
              />
              <p className="text-xs text-slate-500">Use commas to separate multiple flags.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Assumptions
            </label>
            <textarea
              value={offerDraft.assumptions}
              onChange={(event) => onChange("assumptions", event.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
              placeholder="Optional notes about scope, exclusions, or context."
              maxLength={2000}
            />
          </div>

          {offerError ? (
            <p className="text-sm text-amber-200" role="alert">
              {offerError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              className={clsx(
                secondaryCtaClasses,
                ctaSizeClasses.sm,
                pending ? "cursor-not-allowed opacity-60" : null,
              )}
            >
              {pending ? "Saving..." : "Save offer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DestinationEmailModal({
  isOpen,
  providerLabel,
  subject,
  body,
  pending,
  onClose,
  onMarkSent,
}: DestinationEmailModalProps) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Generate RFQ email"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Outbound RFQ email</h3>
            <p className="mt-1 text-sm text-slate-300">
              Draft for <span className="font-semibold text-slate-100">{providerLabel}</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subject
            </label>
            <input
              value={subject}
              readOnly
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
            />
            <CopyTextButton text={subject} idleLabel="Copy subject" />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Body
            </label>
            <textarea
              value={body}
              readOnly
              rows={12}
              className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
            />
            <CopyTextButton text={body} idleLabel="Copy body" />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onMarkSent}
              disabled={pending}
              className={clsx(
                "rounded-full border border-slate-700 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition",
                pending ? "cursor-not-allowed opacity-60" : "hover:border-slate-500 hover:text-white",
              )}
            >
              Mark Sent
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function BulkDestinationEmailModal({
  isOpen,
  results,
  pending,
  onClose,
}: BulkDestinationEmailModalProps) {
  if (!isOpen) return null;
  const successCount = results.filter((result) => result.status === "success").length;
  const errorCount = results.filter((result) => result.status === "error").length;
  const skippedCount = results.filter((result) => result.status === "skipped").length;
  const summaryLabel = `${successCount} generated, ${errorCount} failed, ${skippedCount} skipped`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Bulk RFQ emails"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">Bulk RFQ emails</h3>
            <p className="mt-1 text-sm text-slate-300">{summaryLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] space-y-4 overflow-y-auto pr-2">
          {results.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 px-4 py-3 text-sm text-slate-400">
              No email drafts were generated.
            </p>
          ) : (
            results.map((result) => {
              const statusLabel =
                result.status === "success"
                  ? "Generated"
                  : result.status === "skipped"
                    ? "Skipped"
                    : "Failed";
              const statusClass =
                result.status === "success"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                  : result.status === "skipped"
                    ? "border-slate-700 bg-slate-900/60 text-slate-200"
                    : "border-amber-500/40 bg-amber-500/10 text-amber-100";
              return (
                <div
                  key={result.destinationId}
                  className="rounded-2xl border border-slate-900/60 bg-slate-950/60 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-100">{result.providerLabel}</p>
                      {result.message ? (
                        <p className="mt-1 text-xs text-slate-400">{result.message}</p>
                      ) : null}
                    </div>
                    <span
                      className={clsx(
                        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        statusClass,
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>

                  {result.status === "success" ? (
                    <div className="mt-3 space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Subject
                        </label>
                        <input
                          value={result.subject ?? ""}
                          readOnly
                          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
                        />
                        <CopyTextButton text={result.subject ?? ""} idleLabel="Copy subject" />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Body
                        </label>
                        <textarea
                          value={result.body ?? ""}
                          readOnly
                          rows={8}
                          className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus:outline-none"
                        />
                        <CopyTextButton text={result.body ?? ""} idleLabel="Copy body" />
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={clsx(
              "rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white",
              pending ? "cursor-not-allowed opacity-60" : null,
            )}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function DestinationErrorModal({
  isOpen,
  errorNote,
  errorFeedback,
  pending,
  onClose,
  onChange,
  onSubmit,
  title,
  description,
  submitLabel,
}: DestinationErrorModalProps) {
  if (!isOpen) return null;
  const resolvedTitle = title ?? "Log dispatch error";
  const resolvedDescription =
    description ?? "Add a short note for the error status on this destination.";
  const resolvedSubmitLabel = submitLabel ?? "Save error";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-label={resolvedTitle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-950/95 p-5 text-slate-100 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-white">{resolvedTitle}</h3>
            <p className="mt-1 text-sm text-slate-300">{resolvedDescription}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-800 bg-slate-950/60 px-3 py-1 text-xs font-semibold text-slate-200 hover:border-slate-600 hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Error message
          </label>
          <textarea
            value={errorNote}
            onChange={(event) => onChange(event.target.value)}
            rows={4}
            className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-red-400 focus:outline-none"
            placeholder="Describe what went wrong with this dispatch..."
            maxLength={1000}
          />
          {errorFeedback ? (
            <p className="text-sm text-amber-200" role="alert">
              {errorFeedback}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-800 bg-slate-950/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-slate-600 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={pending}
              className={clsx(
                dangerCtaClasses,
                ctaSizeClasses.sm,
                pending ? "cursor-not-allowed opacity-60" : null,
              )}
            >
              {pending ? "Saving..." : resolvedSubmitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
