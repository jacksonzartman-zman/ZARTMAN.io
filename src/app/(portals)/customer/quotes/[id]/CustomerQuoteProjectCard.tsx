"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import type { QuoteProjectRow } from "@/server/quotes/projects";
import {
  submitCustomerQuoteProjectAction,
  type CustomerProjectFormState,
} from "./actions";
import { formatDateTime } from "@/lib/formatDate";

type CustomerQuoteProjectCardProps = {
  quoteId: string;
  project: QuoteProjectRow | null;
  readOnly?: boolean;
  projectUnavailable?: boolean;
};

const INITIAL_STATE: CustomerProjectFormState = { ok: true };

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
    : "";

  const showSuccess = hasSubmitted && state.ok && Boolean(state.message);
  const showError = hasSubmitted && !state.ok && Boolean(state.error);
  const showFieldErrors = hasSubmitted && !state.ok;
  const disabled = readOnly || projectUnavailable;

  const handleSubmit = (formData: FormData) => {
    setHasSubmitted(true);
    return formAction(formData);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-slate-900 bg-slate-950/40 p-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
          Project kickoff
        </p>
        <h2 className="text-lg font-semibold text-white">
          Next steps for this RFQ
        </h2>
        <p className="text-sm text-slate-300">
          Share your PO number and target ship date so we can kick off production.
        </p>
      </header>

      {projectUnavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
          Project details are temporarily unavailable.
        </p>
      ) : null}

      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
        <SummaryItem label="PO number" value={project?.po_number ?? "Pending"} />
        <SummaryItem
          label="Target ship date"
          value={targetShipDateLabel || "Not set"}
        />
      </dl>

      {readOnly ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/40 px-3 py-2 text-xs text-slate-400">
          Read-only preview. Switch back to your primary email to edit project details.
        </p>
      ) : (
        <form action={handleSubmit} className="space-y-3">
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
          <ProjectSubmitButton disabled={disabled} />
        </form>
      )}
    </section>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="font-medium text-slate-100">{value}</dd>
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
): CustomerProjectFormState & {
  message: string | null;
  error: string | null;
  fieldErrors: NonNullable<CustomerProjectFormState["fieldErrors"]>;
} {
  const base = state ?? INITIAL_STATE;
  return {
    ok: base.ok,
    message: base.message ?? null,
    error: base.error ?? null,
    fieldErrors: {
      poNumber: base.fieldErrors?.poNumber,
      targetShipDate: base.fieldErrors?.targetShipDate,
    },
  };
}
