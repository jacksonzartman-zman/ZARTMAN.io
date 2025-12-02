"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import type { QuoteProjectRow } from "@/server/quotes/projects";
import {
  submitAdminQuoteProjectAction,
  type AdminProjectFormState,
} from "./actions";
import { formatDateTime } from "@/lib/formatDate";

type AdminQuoteProjectCardProps = {
  quoteId: string;
  project: QuoteProjectRow | null;
  projectUnavailable?: boolean;
  className?: string;
};

const INITIAL_STATE: AdminProjectFormState = { ok: true };

type NormalizedAdminProjectFormState = AdminProjectFormState & {
  message: string;
  error: string;
  fieldErrors: NonNullable<AdminProjectFormState["fieldErrors"]>;
};

export function AdminQuoteProjectCard({
  quoteId,
  project,
  projectUnavailable = false,
  className,
}: AdminQuoteProjectCardProps) {
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const action = useMemo(
    () => submitAdminQuoteProjectAction.bind(null, quoteId),
    [quoteId],
  );
  const [rawState, formAction] = useFormState<AdminProjectFormState, FormData>(
    action,
    INITIAL_STATE,
  );
  const state = useMemo(() => normalizeState(rawState), [rawState]);
  const showError = hasSubmitted && !state.ok && Boolean(state.error);
  const showSuccess = hasSubmitted && state.ok && Boolean(state.message);
  const showFieldErrors = hasSubmitted && !state.ok;
  const targetShipDateValue = project?.target_ship_date
    ? project.target_ship_date.slice(0, 10)
    : "";
  const targetShipDateLabel = project?.target_ship_date
    ? formatDateTime(project.target_ship_date) ?? project.target_ship_date
    : "";
  const formDisabled = projectUnavailable;
  const notesValue = project?.notes ?? "";
  const showEmptyState = !project && !projectUnavailable;

  const handleSubmit = (formData: FormData) => {
    setHasSubmitted(true);
    return formAction(formData);
  };

  return (
    <section className={clsx(className, "space-y-4")}>
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Project kickoff
        </p>
        <h2 className="text-lg font-semibold text-slate-100">
          Customer PO + target ship date
        </h2>
        <p className="text-sm text-slate-400">
          Capture the handoff metadata the moment a quote is marked Won. The customer and
          winning supplier see these details.
        </p>
      </header>

      {projectUnavailable ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-100">
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
          value={targetShipDateLabel || null}
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

      <form action={handleSubmit} className="space-y-3">
        {showEmptyState ? (
          <p className="text-xs text-slate-400">
            No kickoff details saved yet. Capture the PO number, target ship date, and any
            notes as soon as the quote is awarded.
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
            htmlFor="admin-project-po"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            PO number
          </label>
          <input
            id="admin-project-po"
            name="poNumber"
            type="text"
            maxLength={100}
            defaultValue={project?.po_number ?? ""}
            disabled={formDisabled}
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
            htmlFor="admin-project-target-date"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Target ship date
          </label>
          <input
            id="admin-project-target-date"
            name="targetShipDate"
            type="date"
            defaultValue={targetShipDateValue}
            disabled={formDisabled}
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
            htmlFor="admin-project-notes"
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Kickoff notes
          </label>
          <textarea
            id="admin-project-notes"
            name="notes"
            rows={4}
            defaultValue={notesValue}
            maxLength={2000}
            disabled={formDisabled}
            className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            placeholder="Share packaging, address, or handoff context customers and suppliers should remember."
          />
          <p className="text-xs text-slate-500">
            Customers can edit these details, and the winning supplier sees them in read-only mode.
          </p>
          {showFieldErrors && state.fieldErrors.notes ? (
            <p className="text-sm text-red-300" role="alert">
              {state.fieldErrors.notes}
            </p>
          ) : null}
        </div>
        <ProjectSubmitButton disabled={formDisabled} />
      </form>
    </section>
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
      className={`${primaryCtaClasses} ${ctaSizeClasses.sm}`}
    >
      {pending ? "Saving..." : "Save project details"}
    </button>
  );
}

function normalizeState(
  state: AdminProjectFormState | null,
): NormalizedAdminProjectFormState {
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
