"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { TagPill } from "@/components/shared/primitives/TagPill";
import { formatDateTime } from "@/lib/formatDate";
import {
  confirmSelectionAction,
  type ConfirmSelectionActionResult,
} from "./actions";

type CustomerQuoteOrderConfirmationProps = {
  quoteId: string;
  selectionConfirmedAt: string | null;
  poNumber: string | null;
  shipTo: string | null;
  readOnly?: boolean;
};

type FeedbackState = {
  tone: "success" | "error";
  message: string;
};

export function CustomerQuoteOrderConfirmation({
  quoteId,
  selectionConfirmedAt,
  poNumber,
  shipTo,
  readOnly = false,
}: CustomerQuoteOrderConfirmationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const confirmedAtLabel = selectionConfirmedAt
    ? formatDateTime(selectionConfirmedAt, { includeTime: true }) ?? selectionConfirmedAt
    : null;
  const showConfirmStatus = Boolean(selectionConfirmedAt);
  const buttonDisabled = pending || readOnly;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    const poValue = normalizeOptionalText(formData.get("poNumber"));
    const shipToValue = normalizeOptionalText(formData.get("shipTo"));

    startTransition(async () => {
      const result: ConfirmSelectionActionResult = await confirmSelectionAction({
        quoteId,
        poNumber: poValue,
        shipTo: shipToValue,
        inspectionRequirements: null,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: "Order details confirmed." });
        router.refresh();
        return;
      }
      setFeedback({ tone: "error", message: result.error });
    });
  };

  return (
    <section className="space-y-5 rounded-2xl border border-slate-900 bg-slate-950/40 px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionHeader
          variant="card"
          kicker="Order confirmation"
          title="Confirm order details"
          subtitle="Optionally share a PO number and ship-to address. This does not place an order or payment."
        />
        <TagPill size="md" tone={showConfirmStatus ? "emerald" : "slate"}>
          {showConfirmStatus ? "Confirmed" : "Pending"}
        </TagPill>
      </div>

      {feedback ? (
        <p
          className={clsx(
            "rounded-xl border px-4 py-3 text-sm",
            feedback.tone === "success"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
              : "border-red-500/30 bg-red-500/10 text-red-100",
          )}
        >
          {feedback.message}
        </p>
      ) : null}

      {readOnly && !selectionConfirmedAt ? (
        <p className="rounded-xl border border-dashed border-slate-800/70 bg-black/40 px-4 py-3 text-xs text-slate-400">
          Read-only preview. Switch back to your primary email to confirm order details.
        </p>
      ) : null}

      {selectionConfirmedAt ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          <p className="font-semibold text-white">Order details confirmed</p>
          <p className="mt-1 text-xs text-emerald-200">
            {confirmedAtLabel ? `Confirmed ${confirmedAtLabel}.` : "Confirmation recorded."}
          </p>
          {poNumber || shipTo ? (
            <div className="mt-4 space-y-3 rounded-xl border border-emerald-500/20 bg-emerald-950/20 px-4 py-3">
              {poNumber ? <DetailRow label="PO number" value={poNumber} /> : null}
              {shipTo ? <DetailRow label="Ship-to" value={shipTo} /> : null}
            </div>
          ) : null}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            <FieldInput
              id="selection-po-number"
              name="poNumber"
              label="PO number"
              placeholder="PO-12345"
              defaultValue={poNumber ?? ""}
              maxLength={100}
              disabled={buttonDisabled}
            />
            <FieldTextarea
              id="selection-ship-to"
              name="shipTo"
              label="Ship-to name / address"
              placeholder="Receiving name, street, city, state, postal code"
              defaultValue={shipTo ?? ""}
              rows={3}
              maxLength={2000}
              disabled={buttonDisabled}
              className="lg:col-span-2"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={buttonDisabled}
              className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Confirming..." : "Confirm order details"}
            </button>
            <p className="text-xs text-slate-400">
              Confirmation locks these details for the awarded quote.
            </p>
          </div>
        </form>
      )}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </p>
      <p className="whitespace-pre-line text-sm text-slate-100">{value}</p>
    </div>
  );
}

function FieldInput({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  maxLength,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  maxLength: number;
  disabled: boolean;
}) {
  return (
    <label className="space-y-1 text-sm text-slate-200" htmlFor={id}>
      <span className="font-medium">{label}</span>
      <input
        id={id}
        name={name}
        type="text"
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function FieldTextarea({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  rows,
  maxLength,
  disabled,
  className,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue: string;
  placeholder: string;
  rows: number;
  maxLength: number;
  disabled: boolean;
  className?: string;
}) {
  return (
    <label className={clsx("space-y-1 text-sm text-slate-200", className)} htmlFor={id}>
      <span className="font-medium">{label}</span>
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
      />
    </label>
  );
}

function normalizeOptionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
