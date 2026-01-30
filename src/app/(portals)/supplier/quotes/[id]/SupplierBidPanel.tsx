"use client";

/**
 * Phase 1 Polish checklist
 * - Done: Confirmation feedback on submit/update (banner + refresh header data)
 * - Done: Error surfaces stay actionable (no scary copy)
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import type { BidRow } from "@/server/bids";
import { submitSupplierBid } from "./actions";
import type { SupplierBidFormState } from "@/server/quotes/supplierQuoteServer";
import { ctaSizeClasses, primaryCtaClasses } from "@/lib/ctas";
import { formatDateTime } from "@/lib/formatDate";
import { formatCurrency } from "@/lib/formatCurrency";
import { SupplierDeclineRfqModal } from "./SupplierDeclineRfqModal";

const INITIAL_SUPPLIER_BID_STATE: SupplierBidFormState = {
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
  bidLocked?: boolean;
  showDecline?: boolean;
};

export function SupplierBidPanel({
  quoteId,
  initialBid,
  approvalsOn,
  approved,
  bidsUnavailableMessage,
  bidLocked = false,
  showDecline = false,
}: SupplierBidPanelProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [optimisticBid, setOptimisticBid] = useState<{
    amount: number | null;
    leadTimeDays: number | null;
    submittedAt: string;
  } | null>(null);
  const [rawState, formAction] = useFormState<
    SupplierBidFormState,
    FormData
  >(submitSupplierBid, INITIAL_SUPPLIER_BID_STATE);
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
    const normalizedAmount = normalizeBidAmountInput(formData.get("amount"));
    formData.set("amount", normalizedAmount);
    const parsedAmount = normalizedAmount ? Number(normalizedAmount) : Number.NaN;
    const rawLeadTime = formData.get("leadTimeDays");
    const leadTimeDays =
      typeof rawLeadTime === "string" && rawLeadTime.trim().length > 0
        ? Number.parseInt(rawLeadTime.trim(), 10)
        : null;
    setOptimisticBid({
      amount: Number.isFinite(parsedAmount) ? parsedAmount : null,
      leadTimeDays: Number.isFinite(leadTimeDays ?? Number.NaN)
        ? leadTimeDays
        : null,
      submittedAt: new Date().toISOString(),
    });
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
      // Re-fetch server-rendered pills/status so the workspace feels "done".
      router.refresh();
    }
  }, [router, showLiveSuccess]);

  useEffect(() => {
    if (!showLiveSuccess) return;
    const delayMs = prefersReducedMotion ? 120 : 900;
    const timeout = window.setTimeout(() => {
      try {
        router.push("/supplier?offer=sent");
      } catch (error) {
        console.warn("[supplier bid] redirect failed", error);
      }
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [prefersReducedMotion, router, showLiveSuccess]);

  const baseDisabled =
    (approvalsOn && !approved) || Boolean(bidsUnavailableMessage);
  const inputsDisabled = baseDisabled || bidLocked;
  const hasBidForCta = Boolean(initialBid) || showLiveSuccess;
  const buttonLabel = hasBidForCta ? "Update offer" : "Send offer";
  const lastSubmittedAt = initialBid?.updated_at ?? initialBid?.created_at ?? null;
  const bidSummary =
    showLiveSuccess && optimisticBid
      ? optimisticBid
      : initialBid
        ? {
            amount:
              typeof initialBid.amount === "number" ? initialBid.amount : null,
            leadTimeDays:
              typeof initialBid.lead_time_days === "number"
                ? initialBid.lead_time_days
                : null,
            submittedAt: lastSubmittedAt ?? new Date().toISOString(),
          }
        : null;
  const showBidRow = Boolean(bidSummary);
  const bidStatusLabel = resolveBidStatusLabel(initialBid?.status, showLiveSuccess);

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

      {showBidRow && bidSummary ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-emerald-100">Offer</p>
            <span className="pill pill-info px-3 py-1 text-[11px]">
              {bidStatusLabel}
            </span>
          </div>
          <dl className="mt-2 grid gap-3 text-xs text-slate-200 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Price
              </dt>
              <dd className="font-medium text-slate-100">
                {bidSummary.amount !== null
                  ? formatCurrency(bidSummary.amount, initialBid?.currency ?? "USD")
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Lead time
              </dt>
              <dd className="font-medium text-slate-100">
                {typeof bidSummary.leadTimeDays === "number"
                  ? `${bidSummary.leadTimeDays} day${
                      bidSummary.leadTimeDays === 1 ? "" : "s"
                    }`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Submitted
              </dt>
              <dd className="font-medium text-slate-100">
                {bidSummary.submittedAt
                  ? formatDateTime(bidSummary.submittedAt)
                  : "—"}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {showLiveSuccess ? (
        <section
          className={[
            "rounded-2xl border border-emerald-500/25 bg-emerald-500/10 px-6 py-5",
            prefersReducedMotion ? "" : "transition-opacity duration-300",
          ].join(" ")}
          role="status"
          aria-live="polite"
        >
          <h3 className="text-lg font-semibold text-white">Offer sent</h3>
          <p className="mt-1 text-sm text-emerald-50/80">
            We’ll notify you if the customer has questions.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => router.push("/supplier?offer=sent")}
              className={`${primaryCtaClasses} ${ctaSizeClasses.md}`}
            >
              Back to dashboard
            </button>
          </div>
        </section>
      ) : (
        <form ref={formRef} action={handleSubmit} className="space-y-4">
          <input type="hidden" name="quoteId" value={quoteId} />
          <input type="hidden" name="currency" value="USD" />
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label="Price (USD)"
              name="amount"
              type="text"
              inputMode="decimal"
              placeholder="15000"
              defaultValue={initialBid?.amount ?? undefined}
              disabled={inputsDisabled}
              prefix="$"
              autoComplete="off"
              autoFocus
              size="lg"
              error={hasSubmitted && !state.ok ? state.fieldErrors.price : undefined}
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
              disabled={inputsDisabled}
              min="1"
              step="1"
              inputMode="numeric"
              size="lg"
              error={
                hasSubmitted && !state.ok ? state.fieldErrors.leadTimeDays : undefined
              }
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes (optional)
            </label>
            <textarea
              name="notes"
              defaultValue={initialBid?.notes ?? ""}
              rows={4}
              disabled={inputsDisabled}
              className="mt-2 w-full rounded-2xl border border-slate-800 bg-black/40 px-4 py-3 text-base text-slate-100 placeholder:text-slate-500 focus:border-blue-400 focus:outline-none disabled:opacity-60"
              placeholder="Optional details (certifications, MOQ, inspection plan, assumptions)."
            />
          </div>

          {hasSubmitted && !state.ok ? (
            <p className="text-sm text-red-300" role="alert">
              {state.error}
            </p>
          ) : null}

          {showPersistedSuccess && successMessage ? (
            <p
              className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-3 text-base text-emerald-100"
              role="status"
            >
              {successMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton label={buttonLabel} disabled={inputsDisabled} />
            {showDecline && !inputsDisabled ? (
              <button
                type="button"
                onClick={() => setDeclineOpen(true)}
                className={`${ctaSizeClasses.md} rounded-full border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-red-100 transition hover:border-red-400 hover:text-white`}
              >
                Decline RFQ
              </button>
            ) : null}
          </div>
        </form>
      )}

      <SupplierDeclineRfqModal
        quoteId={quoteId}
        open={declineOpen}
        onClose={() => setDeclineOpen(false)}
      />

      {initialBid ? (
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/30 px-6 py-4 text-sm text-slate-200">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Last submitted
          </p>
          <dl className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-slate-500">
                Price
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

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", update);
      return () => mediaQuery.removeEventListener("change", update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return prefersReducedMotion;
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
  autoFocus,
  min,
  size = "md",
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
  autoFocus?: boolean;
  min?: ComponentProps<"input">["min"];
  size?: "md" | "lg";
}) {
  const inputTextClass = size === "lg" ? "text-2xl" : "text-sm";
  const inputPaddingClass = size === "lg" ? "py-3" : "py-2";
  const labelClass = size === "lg"
    ? "text-xs font-semibold uppercase tracking-wide text-slate-400"
    : "text-xs font-semibold uppercase tracking-wide text-slate-500";

  return (
    <div>
      <label className={labelClass}>
        {label}
      </label>
      <div
        className={`mt-2 flex items-center rounded-2xl border border-slate-800 bg-black/40 px-4 ${inputPaddingClass} text-slate-100 focus-within:border-blue-400`}
      >
        {prefix ? <span className={`mr-2 ${inputTextClass} text-slate-500`}>{prefix}</span> : null}
        <input
          type={type}
          name={name}
          placeholder={placeholder}
          defaultValue={defaultValue}
          disabled={disabled}
          step={step}
          min={min}
          inputMode={inputMode}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          className={`w-full bg-transparent ${inputTextClass} text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60`}
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

type NormalizedSupplierBidState =
  | { ok: true; message: string }
  | { ok: false; error: string; fieldErrors: Record<string, string> };

function normalizeSupplierBidState(
  value: SupplierBidFormState | null | undefined,
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
    return `Offer sent (${formattedAmount}, ${submittedLabel}).`;
  }

  if (formattedAmount) {
    return `Offer sent (${formattedAmount}).`;
  }

  if (submittedLabel) {
    return `Offer sent (${submittedLabel}).`;
  }

  return "Offer sent.";
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
      {pending ? "Sending..." : label}
    </button>
  );
}

function resolveBidStatusLabel(
  rawStatus: string | null | undefined,
  optimisticSubmitted: boolean,
): string {
  const normalized =
    typeof rawStatus === "string" ? rawStatus.trim().toLowerCase() : "";
  if (!normalized && optimisticSubmitted) {
    return "Offer sent";
  }
  if (normalized === "submitted" || normalized === "pending" || !normalized) {
    return "Offer sent";
  }
  if (normalized === "accepted" || normalized === "won" || normalized === "winner") {
    return "Winner";
  }
  return `Status: ${rawStatus ?? normalized ?? "—"}`;
}
