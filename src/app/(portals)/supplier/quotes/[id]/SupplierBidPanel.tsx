"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import clsx from "clsx";
import { useFormState, useFormStatus } from "react-dom";
import type { BidRow } from "@/server/bids";
import {
  submitSupplierBidAction,
  type SupplierBidActionState,
} from "./actions";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";

const INITIAL_SUPPLIER_BID_STATE: SupplierBidActionState = {
  ok: true,
  message: "",
};

const SUPPLIER_BID_FALLBACK_ERROR =
  "We couldn't submit your bid. Please try again.";

type SupplierBidPanelProps = {
  quoteId: string;
  initialBid: BidRow | null;
  approvalsOn: boolean;
  approved: boolean;
  bidsUnavailableMessage: string | null;
};

export function SupplierBidPanel({
  quoteId,
  initialBid,
  approvalsOn,
  approved,
  bidsUnavailableMessage,
}: SupplierBidPanelProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [rawState, formAction] = useFormState<
    SupplierBidActionState,
    FormData
  >(submitSupplierBidAction, INITIAL_SUPPLIER_BID_STATE);
  const state = useMemo(
    () => normalizeSupplierBidState(rawState),
    [rawState],
  );
  const persistedSuccessMessage = useMemo(
    () => buildPersistedSuccessMessage(initialBid),
    [initialBid],
  );

  const handleSubmit = (formData: FormData) => {
    setHasSubmitted(true);
    formData.set("amount", normalizeBidAmountInput(formData.get("amount")));
    return formAction(formData);
  };

  const showLiveSuccess = hasSubmitted && state.ok && Boolean(state.message);
  const showPersistedSuccess = !hasSubmitted && Boolean(initialBid);
  const successMessage = showLiveSuccess
    ? state.message
    : showPersistedSuccess
      ? persistedSuccessMessage
      : "";

  useEffect(() => {
    if (showLiveSuccess) {
      formRef.current?.reset();
    }
  }, [showLiveSuccess]);

  const formDisabled =
    (approvalsOn && !approved) || Boolean(bidsUnavailableMessage);
  const buttonLabel = initialBid ? "Update bid" : "Submit bid";
  const lastSubmittedAt = initialBid?.updated_at ?? initialBid?.created_at ?? null;

  return (
    <div className="space-y-4">
      {approvalsOn && !approved ? (
        <p className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-100">
          Your profile is pending review. You can edit your profile, but bids will open up once you’re approved.
        </p>
      ) : null}

      {bidsUnavailableMessage ? (
        <p className="rounded-xl border border-slate-800 bg-black/40 px-3 py-2 text-xs text-slate-300">
          {bidsUnavailableMessage}
        </p>
      ) : null}

      <form ref={formRef} action={handleSubmit} className="space-y-4">
        <input type="hidden" name="quoteId" value={quoteId} />
        <div className="grid gap-4 md:grid-cols-3">
          <Field
            label="Amount"
            name="amount"
            type="text"
            inputMode="decimal"
            placeholder="15000"
            defaultValue={initialBid?.amount ?? undefined}
            disabled={formDisabled}
            prefix="$"
            autoComplete="off"
          error={
            hasSubmitted && !state.ok ? state.fieldErrors.amount : undefined
          }
          />
          <Field
            label="Currency"
            name="currency"
            placeholder="USD"
            defaultValue={initialBid?.currency ?? "USD"}
            disabled={formDisabled}
          />
          <Field
            label="Lead time (days)"
            name="leadTimeDays"
            type="number"
            placeholder="14"
            defaultValue={
              typeof initialBid?.lead_time_days === "number"
                ? initialBid.lead_time_days
                : undefined
            }
            disabled={formDisabled}
          error={
            hasSubmitted && !state.ok ? state.fieldErrors.leadTimeDays : undefined
          }
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Notes & certifications
          </label>
          <textarea
            name="notes"
            defaultValue={initialBid?.notes ?? ""}
            rows={4}
            disabled={formDisabled}
            className="mt-1 w-full rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:opacity-60"
            placeholder="Call out certifications, MOQ, inspection plans, or anything the customer should know."
          />
        </div>

        {hasSubmitted && !state.ok ? (
          <p className="text-sm text-red-300" role="alert">
            {state.error}
          </p>
        ) : null}

        {(showLiveSuccess || showPersistedSuccess) && successMessage ? (
          <p className="text-sm text-emerald-300" role="status">
            {successMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton label={buttonLabel} disabled={formDisabled} />
          {initialBid?.status ? (
            <span
              className={clsx(
                "pill px-3 py-1 text-[11px]",
                BID_STATUS_CLASSES[
                  (initialBid.status ?? "submitted").toString().toLowerCase()
                ] ?? "pill-info",
              )}
            >
              Status: {(initialBid.status ?? "submitted").toString()}
            </span>
          ) : null}
        </div>
      </form>

      {initialBid ? (
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-6 py-4 text-sm text-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Last submitted
          </p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Amount
              </dt>
              <dd className="font-medium text-slate-100">
                {typeof initialBid.amount === "number"
                  ? formatCurrency(initialBid.amount, initialBid.currency)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Lead time
              </dt>
              <dd className="font-medium text-slate-100">
                {typeof initialBid.lead_time_days === "number"
                  ? `${initialBid.lead_time_days} day${
                      initialBid.lead_time_days === 1 ? "" : "s"
                    }`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Submitted
              </dt>
              <dd className="font-medium text-slate-100">
                {lastSubmittedAt ? formatDateTime(lastSubmittedAt) : "—"}
              </dd>
            </div>
          </dl>
          {initialBid.notes ? (
            <p className="mt-2 text-xs text-slate-400">
              {initialBid.notes}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  disabled,
  step,
  prefix,
  error,
  inputMode,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  defaultValue?: string | number;
  disabled?: boolean;
  step?: string;
  prefix?: string;
  error?: string;
  inputMode?: ComponentProps<"input">["inputMode"];
  autoComplete?: ComponentProps<"input">["autoComplete"];
}) {
  return (
    <div>
      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-lg border border-slate-800 bg-black/40 px-3 py-2 text-sm text-slate-100 focus-within:border-blue-400">
        {prefix ? <span className="mr-1 text-slate-500">{prefix}</span> : null}
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          disabled={disabled}
          step={step}
          inputMode={inputMode}
          autoComplete={autoComplete}
          className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const BID_STATUS_CLASSES: Record<string, string> = {
  accepted: "pill-success",
  won: "pill-success",
  declined: "pill-warning",
  lost: "pill-warning",
  withdrawn: "pill-muted",
  submitted: "pill-info",
  pending: "pill-info",
};

type NormalizedSupplierBidState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

function normalizeSupplierBidState(
  value: SupplierBidActionState | null | undefined,
): NormalizedSupplierBidState {
  if (!value) {
    return {
      ok: true,
      message: "",
    };
  }

  if (value.ok) {
    return {
      ok: true,
      message: value.message ?? "",
    };
  }

  return {
    ok: false,
    error: value.error || SUPPLIER_BID_FALLBACK_ERROR,
    fieldErrors: normalizeFieldErrors(value.fieldErrors),
  };
}

function normalizeFieldErrors(
  rawErrors?: Record<string, unknown>,
): Record<string, string> {
  if (!rawErrors || typeof rawErrors !== "object") {
    return {};
  }

  return Object.entries(rawErrors).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (typeof value === "string" && value.length > 0) {
        acc[key] = value;
      }
      return acc;
    },
    {},
  );
}

function normalizeBidAmountInput(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/[,\s]/g, "");
}

function buildPersistedSuccessMessage(bid: BidRow | null): string {
  if (!bid) {
    return "";
  }

  const formattedAmountValue =
    typeof bid.amount === "number"
      ? formatCurrency(bid.amount, bid.currency, { maximumFractionDigits: 2 })
      : null;
  const formattedAmount =
    formattedAmountValue && formattedAmountValue !== "—"
      ? formattedAmountValue
      : null;
  const submittedAt = bid.updated_at ?? bid.created_at;
  const submittedLabel = submittedAt ? formatDateTime(submittedAt) : null;

  if (formattedAmount && submittedLabel) {
    return `${formattedAmount} bid on file (submitted ${submittedLabel}). Update it anytime.`;
  }

  if (formattedAmount) {
    return `${formattedAmount} bid on file. Update it anytime.`;
  }

  if (submittedLabel) {
    return `Bid submitted ${submittedLabel}. Update it anytime.`;
  }

  return "Your latest bid is on file. Update it anytime.";
}

function SubmitButton({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={`${primaryCtaClasses} ${ctaSizeClasses.md} ${
        pending || disabled ? "opacity-60" : ""
      }`}
    >
      {pending ? "Saving..." : label}
    </button>
  );
}
