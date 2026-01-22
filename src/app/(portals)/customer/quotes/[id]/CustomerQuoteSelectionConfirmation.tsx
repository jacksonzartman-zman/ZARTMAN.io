"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";
import { TagPill } from "@/components/shared/primitives/TagPill";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import type { CustomerCompareOffer } from "@/lib/customerTrustBadges";
import {
  confirmSelectionAction,
  type ConfirmSelectionActionResult,
} from "./actions";

type CustomerQuoteSelectionConfirmationProps = {
  quoteId: string;
  selectedOffer: CustomerCompareOffer | null;
  selectionConfirmedAt: string | null;
  poNumber: string | null;
  shipTo: string | null;
  inspectionRequirements: string | null;
  files: QuoteFileItem[];
  readOnly?: boolean;
};

type FeedbackState = {
  tone: "success" | "error";
  message: string;
};

export function CustomerQuoteSelectionConfirmation({
  quoteId,
  selectedOffer,
  selectionConfirmedAt,
  poNumber,
  shipTo,
  inspectionRequirements,
  files,
  readOnly = false,
}: CustomerQuoteSelectionConfirmationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const providerName = useMemo(() => resolveProviderName(selectedOffer), [selectedOffer]);
  const priceLabel = useMemo(() => formatOfferPrice(selectedOffer), [selectedOffer]);
  const leadTimeLabel = useMemo(() => formatOfferLeadTime(selectedOffer), [selectedOffer]);
  const assumptions = useMemo(
    () => (selectedOffer?.assumptions?.trim() ? selectedOffer.assumptions.trim() : null),
    [selectedOffer],
  );
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
    const inspectionValue = normalizeOptionalText(formData.get("inspectionRequirements"));

    startTransition(async () => {
      const result: ConfirmSelectionActionResult = await confirmSelectionAction({
        quoteId,
        poNumber: poValue,
        shipTo: shipToValue,
        inspectionRequirements: inspectionValue,
      });
      if (result.ok) {
        setFeedback({ tone: "success", message: result.message });
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
          kicker="Selection confirmed"
          title="Confirm supplier details"
          subtitle="Review the chosen supplier, assumptions, and files. Add fulfillment notes if you want them included in the award pack."
        />
        <TagPill size="md" tone={showConfirmStatus ? "emerald" : "slate"}>
          {showConfirmStatus ? "Confirmed" : "Pending confirmation"}
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
          Read-only preview. Switch back to your primary email to confirm selection details.
        </p>
      ) : null}

      <AwardPackPreview
        providerName={providerName}
        priceLabel={priceLabel}
        leadTimeLabel={leadTimeLabel}
        assumptions={assumptions}
        files={files}
        poNumber={poNumber}
        shipTo={shipTo}
        inspectionRequirements={inspectionRequirements}
      />

      {selectionConfirmedAt ? (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          <p className="font-semibold text-white">Selection confirmed</p>
          <p className="mt-1 text-xs text-emerald-200">
            {confirmedAtLabel ? `Confirmed ${confirmedAtLabel}.` : "Confirmation recorded."}
          </p>
          <p className="mt-2 text-xs text-emerald-200">
            This does not place an order or payment automatically.
          </p>
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
          <FieldTextarea
            id="selection-inspection"
            name="inspectionRequirements"
            label="Inspection requirements"
              placeholder="Any inspection or quality requirements for the supplier"
            defaultValue={inspectionRequirements ?? ""}
            rows={3}
            maxLength={2000}
            disabled={buttonDisabled}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={buttonDisabled}
              className="inline-flex items-center rounded-full border border-emerald-400/50 bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? "Confirming..." : "Confirm selection"}
            </button>
            <p className="text-xs text-slate-400">
              Confirmation locks these details and drafts the award pack.
            </p>
          </div>
        </form>
      )}
    </section>
  );
}

function AwardPackPreview({
  providerName,
  priceLabel,
  leadTimeLabel,
  assumptions,
  files,
  poNumber,
  shipTo,
  inspectionRequirements,
}: {
  providerName: string;
  priceLabel: string;
  leadTimeLabel: string;
  assumptions: string | null;
  files: QuoteFileItem[];
  poNumber: string | null;
  shipTo: string | null;
  inspectionRequirements: string | null;
}) {
  const hasFulfillmentFields = Boolean(
    (poNumber && poNumber.trim()) ||
      (shipTo && shipTo.trim()) ||
      (inspectionRequirements && inspectionRequirements.trim()),
  );

  return (
    <div className="space-y-4 rounded-2xl border border-slate-900/60 bg-slate-950/30 px-5 py-4">
      <SectionHeader
        variant="label"
        title="Award pack preview"
        subtitle="What we will share with your supplier after confirmation."
      />

      <dl className="grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
        <SummaryItem label="Supplier" value={providerName} />
        <SummaryItem label="Price" value={priceLabel} />
        <SummaryItem label="Lead time" value={leadTimeLabel} />
      </dl>

      <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Assumptions
        </p>
        <p className="mt-2 whitespace-pre-line text-sm text-slate-200">
          {assumptions ?? "No assumptions provided."}
        </p>
      </div>

      <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Files
        </p>
        {files.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No files attached.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-900/60 bg-slate-950/30 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-slate-100" title={file.fileName ?? file.label}>
                  {file.fileName ?? file.label}
                </span>
                {file.signedUrl ? (
                  <a
                    href={file.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold uppercase tracking-wide text-emerald-200 hover:text-emerald-100"
                  >
                    View
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">Preview unavailable</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {hasFulfillmentFields ? (
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            Fulfillment details
          </p>
          <div className="mt-3 space-y-2 text-sm text-slate-200">
            {poNumber ? <DetailRow label="PO number" value={poNumber} /> : null}
            {shipTo ? <DetailRow label="Ship-to" value={shipTo} /> : null}
            {inspectionRequirements ? (
              <DetailRow label="Inspection requirements" value={inspectionRequirements} />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="break-anywhere text-slate-100">{value}</dd>
    </div>
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

function resolveProviderName(offer: CustomerCompareOffer | null): string {
  if (!offer) return "Supplier details unavailable";
  return offer.providerName?.trim() || offer.provider_id || "Supplier";
}

function formatOfferPrice(offer: CustomerCompareOffer | null): string {
  if (!offer) return "Pending";
  const totalValue = toFiniteNumber(offer.total_price);
  if (typeof totalValue === "number") {
    return formatCurrency(totalValue, offer.currency ?? "USD");
  }
  const unitValue = toFiniteNumber(offer.unit_price);
  if (typeof unitValue === "number") {
    return `${formatCurrency(unitValue, offer.currency ?? "USD")} unit`;
  }
  if (typeof offer.total_price === "string" && offer.total_price.trim()) {
    return offer.total_price.trim();
  }
  return "Pending";
}

function formatOfferLeadTime(offer: CustomerCompareOffer | null): string {
  if (!offer) return "Pending";
  const minDays = offer.lead_time_days_min;
  const maxDays = offer.lead_time_days_max;
  const minValue = typeof minDays === "number" && Number.isFinite(minDays) ? minDays : null;
  const maxValue = typeof maxDays === "number" && Number.isFinite(maxDays) ? maxDays : null;
  if (minValue !== null && maxValue !== null) {
    if (minValue === maxValue) {
      return `${minValue} day${minValue === 1 ? "" : "s"}`;
    }
    return `${minValue}-${maxValue} days`;
  }
  if (minValue !== null) return `${minValue}+ days`;
  if (maxValue !== null) return `Up to ${maxValue} days`;
  return "Pending";
}

function normalizeOptionalText(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toFiniteNumber(value: number | string | null): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
