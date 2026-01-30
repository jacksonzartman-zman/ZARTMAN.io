"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import type { QuoteProjectRecord } from "@/server/quotes/projects";
import PortalCard from "../../../PortalCard";
import {
  submitCustomerQuoteProjectAction,
  type CustomerProjectFormState,
} from "./actions";
import { formatDateTime } from "@/lib/formatDate";

type CustomerQuoteProjectCardProps = {
  quoteId: string;
  project: QuoteProjectRecord | null;
  readOnly?: boolean;
  projectUnavailable?: boolean;
};

const INITIAL_STATE: CustomerProjectFormState = { ok: true };

type NormalizedCustomerProjectFormState = CustomerProjectFormState & {
  message: string;
  error: string;
  fieldErrors: NonNullable<CustomerProjectFormState["fieldErrors"]>;
};

export function CustomerQuoteProjectCard({
  quoteId,
  project,
  readOnly = false,
  projectUnavailable = false,
}: CustomerQuoteProjectCardProps) {
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const action = useMemo(
    () => submitCustomerQuoteProjectAction.bind(null, quoteId),
    [quoteId],
  );
  const [rawState, formAction] = useFormState<CustomerProjectFormState, FormData>(
    action,
    INITIAL_STATE,
  );
  const state = useMemo(() => normalizeState(rawState), [rawState]);
  const targetShipDateValue = project?.target_ship_date
    ? project.target_ship_date.slice(0, 10)
    : "";
  const targetShipDateLabel = project?.target_ship_date
    ? formatDateTime(project.target_ship_date) ?? project.target_ship_date
    : null;
  const notesValue = project?.notes ?? "";
  const showEmptyState = !project && !projectUnavailable;

  const showSuccess = hasSubmitted && state.ok && Boolean(state.message);
  const showError = hasSubmitted && !state.ok && Boolean(state.error);
  const showFieldErrors = hasSubmitted && !state.ok;
  const disabled = readOnly || projectUnavailable;

  const handleSubmit = (formData: FormData) => {
    setHasSubmitted(true);
    return formAction(formData);
  };

  return (
    <PortalCard
      title="PO details & target dates"
      description="Share your PO number, target ship date, and kickoff notes once this search request is awarded."
    >
      <div className="space-y-4">

        {projectUnavailable ? (
          <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
            Project details are temporarily unavailable.
          </p>
        ) : null}

        <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
          <SummaryItem
            label="PO number"
            value={project?.po_number ?? null}
            placeholder="Pending"
          />
          <SummaryItem
            label="Target ship date"
            value={targetShipDateLabel}
            placeholder="Not set"
          />
          <SummaryItem
            label="Kickoff notes"
            value={project?.notes ?? null}
            placeholder="No kickoff notes yet."
            multiline
            className="sm:col-span-2"
          />
        </dl>

        {readOnly ? (
          <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/40 px-3 py-2 text-xs text-slate-400">
            Read-only preview. Switch back to your primary email to edit project details.
          </p>
        ) : (
          <form action={handleSubmit} className="space-y-3">
            {showEmptyState ? (
              <p className="text-xs text-slate-400">
                No project kickoff details saved yet. Add your PO number, target ship date,
                and any handoff notes when you are ready.
              </p>
            ) : null}
            {showSuccess && state.message ? (
              <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                {state.message}
              </p>
            ) : null}
            {showError && state.error ? (
              <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {state.error}
              </p>
            ) : null}
            <div className="space-y-1">
              <label
                htmlFor="customer-project-po"
                className="text-sm font-medium text-slate-200"
              >
                Purchase order number
              </label>
              <input
                id="customer-project-po"
                name="poNumber"
                type="text"
                maxLength={100}
                defaultValue={project?.po_number ?? ""}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="PO-12345"
              />
              {showFieldErrors && state.fieldErrors.poNumber ? (
                <p className="text-sm text-red-300" role="alert">
                  {state.fieldErrors.poNumber}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label
                htmlFor="customer-project-target-date"
                className="text-sm font-medium text-slate-200"
              >
                Target ship date
              </label>
              <input
                id="customer-project-target-date"
                name="targetShipDate"
                type="date"
                defaultValue={targetShipDateValue}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
              {showFieldErrors && state.fieldErrors.targetShipDate ? (
                <p className="text-sm text-red-300" role="alert">
                  {state.fieldErrors.targetShipDate}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label
                htmlFor="customer-project-notes"
                className="text-sm font-medium text-slate-200"
              >
                Kickoff notes
              </label>
              <textarea
                id="customer-project-notes"
                name="notes"
                rows={4}
                defaultValue={notesValue}
                maxLength={2000}
                disabled={disabled}
                className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                placeholder="Share packaging, address, or special handling notes."
              />
              <p className="text-xs text-slate-500">
                Shared with your Zartman team and the winning supplier.
              </p>
              {showFieldErrors && state.fieldErrors.notes ? (
                <p className="text-sm text-red-300" role="alert">
                  {state.fieldErrors.notes}
                </p>
              ) : null}
            </div>
            <ProjectSubmitButton disabled={disabled} />
          </form>
        )}
      </div>
    </PortalCard>
  );
}

function SummaryItem({
  label,
  value,
  placeholder = "—",
  multiline = false,
  className = "",
}: {
  label: string;
  value?: string | null;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const display =
    typeof value === "string" && value.trim().length > 0 ? value : placeholder;
  const valueClasses = [
    multiline ? "whitespace-pre-line text-sm font-normal" : "font-medium",
    "text-slate-100",
  ].join(" ");
  return (
    <div
      className={`rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2 ${className}`.trim()}
    >
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className={valueClasses}>{display}</dd>
    </div>
  );
}

function ProjectSubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  const isDisabled = pending || disabled;
  return (
    <button
      type="submit"
      disabled={isDisabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} w-full sm:w-auto`}
    >
      {pending ? "Saving..." : "Save project details"}
    </button>
  );
}

function normalizeState(
  state: CustomerProjectFormState | null,
): NormalizedCustomerProjectFormState {
  const base = state ?? INITIAL_STATE;
  return {
    ok: base.ok,
    message: base.message ?? "",
    error: base.error ?? "",
    fieldErrors: {
      poNumber: base.fieldErrors?.poNumber,
      targetShipDate: base.fieldErrors?.targetShipDate,
      notes: base.fieldErrors?.notes,
    },
  };
}
