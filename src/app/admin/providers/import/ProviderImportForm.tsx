"use client";

import clsx from "clsx";
import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import AdminTableShell, { adminTableCellClass } from "@/app/admin/AdminTableShell";
import { ctaSizeClasses, primaryCtaClasses, secondaryCtaClasses } from "@/lib/ctas";
import {
  PROVIDER_IMPORT_TYPES,
  parseProviderImportCsv,
  type ProviderImportRow,
} from "@/lib/providerImport";
import { importProvidersAction, type ProviderImportActionState } from "./actions";

const INITIAL_STATE: ProviderImportActionState = {
  ok: true,
  message: "",
  createdCount: 0,
};

export default function ProviderImportForm() {
  const [csvText, setCsvText] = useState("");
  const [state, formAction] = useFormState<ProviderImportActionState, FormData>(
    importProvidersAction,
    INITIAL_STATE,
  );

  const preview = useMemo(() => parseProviderImportCsv(csvText), [csvText]);
  const errorRows = preview.rows.filter((row) => row.errors.length > 0).length;
  const validRows = preview.validRows.length;
  const totalRows = preview.rows.length;
  const canSubmit = validRows > 0 && errorRows === 0;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-900 bg-slate-950/40 p-6">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            CSV format
          </p>
          <p className="text-sm text-slate-300">
            Paste CSV rows with columns in this order: name, website, email, provider_type, rfq_url
            (optional). Provider types: {PROVIDER_IMPORT_TYPES.join(", ")}.
          </p>
          <p className="text-xs text-slate-500">
            Providers are created inactive and default to email dispatch. Include rfq_url to set
            web-form dispatch.
          </p>
          <div className="rounded-xl border border-slate-900 bg-slate-950/70 px-4 py-3 text-xs text-slate-400">
            <p className="font-mono">name,website,email,provider_type,rfq_url</p>
            <p className="font-mono">
              Acme Precision,https://acmeprecision.com,rfq@acme.com,factory,https://acmeprecision.com/rfq
            </p>
          </div>
        </div>

        <form action={formAction} className="mt-6 space-y-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Provider CSV
            </span>
            <textarea
              name="csv-input"
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
              rows={9}
              spellCheck={false}
              placeholder="Acme Precision,https://acmeprecision.com,rfq@acme.com,factory,https://acmeprecision.com/rfq"
              className="w-full rounded-xl border border-slate-900 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-400 focus:outline-none"
            />
          </label>
          <input type="hidden" name="csv" value={csvText} />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-500">
              {preview.headerDetected ? "Header row detected and skipped." : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCsvText("")}
                className={clsx(secondaryCtaClasses, ctaSizeClasses.sm)}
              >
                Clear
              </button>
              <SubmitButton canSubmit={canSubmit} />
            </div>
          </div>

          {!state.ok && state.error ? (
            <p className="text-sm text-amber-200" role="alert">
              {state.error}
            </p>
          ) : null}
          {state.ok && state.message ? (
            <p className="text-sm text-emerald-300" role="status">
              {state.message}
            </p>
          ) : null}
        </form>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-slate-100">Validation preview</h2>
            <p className="text-sm text-slate-400">
              {totalRows === 0
                ? "Paste CSV data to see a preview."
                : `${validRows} valid row${validRows === 1 ? "" : "s"}, ${errorRows} error${errorRows === 1 ? "" : "s"}.`}
            </p>
          </div>
        </div>

        <AdminTableShell
          head={
            <tr>
              <th className="px-4 py-3">Line</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Website</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">RFQ URL</th>
              <th className="px-4 py-3">Provider type</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          }
          body={
            totalRows === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-10 text-center text-sm text-slate-400">
                  No rows to preview yet.
                </td>
              </tr>
            ) : (
              preview.rows.map((row, index) => (
                <PreviewRow key={`${row.line}-${index}`} row={row} />
              ))
            )
          }
        />
      </section>
    </div>
  );
}

function PreviewRow({ row }: { row: ProviderImportRow }) {
  const statusLabel = row.errors.length === 0 ? "Ready" : "Fix errors";
  return (
    <tr className="border-t border-slate-900/60 bg-slate-950/30">
      <td className={clsx(adminTableCellClass, "px-4 py-3 text-slate-500")}>
        {row.line}
      </td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>{row.name || "—"}</td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>{row.website || "—"}</td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>{row.email || "—"}</td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>{row.rfqUrl || "—"}</td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>
        {row.providerType || "—"}
      </td>
      <td className={clsx(adminTableCellClass, "px-4 py-3")}>
        <div className="space-y-1">
          <span
            className={clsx(
              "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              row.errors.length === 0
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                : "border-amber-500/40 bg-amber-500/10 text-amber-200",
            )}
          >
            {statusLabel}
          </span>
          {row.errors.length > 0 ? (
            <ul className="space-y-1 text-xs text-amber-200">
              {row.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function SubmitButton({ canSubmit }: { canSubmit: boolean }) {
  const { pending } = useFormStatus();
  const disabled = pending || !canSubmit;

  return (
    <button
      type="submit"
      disabled={disabled}
      className={clsx(
        primaryCtaClasses,
        ctaSizeClasses.sm,
        disabled ? "cursor-not-allowed opacity-70" : null,
      )}
    >
      {pending ? "Importing..." : "Import providers"}
    </button>
  );
}
