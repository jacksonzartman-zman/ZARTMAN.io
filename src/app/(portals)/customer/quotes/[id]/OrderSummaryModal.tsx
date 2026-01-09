"use client";

import clsx from "clsx";
import { useEffect, useRef } from "react";
import { SectionHeader } from "@/components/shared/primitives/SectionHeader";

export type OrderSummaryModalProps = {
  open: boolean;
  onClose: () => void;
  partName: string;
  quantity: number;
  priceLabel: string;
  supplierName?: string | null;
};

export function OrderSummaryModal({
  open,
  onClose,
  partName,
  quantity,
  priceLabel,
  supplierName,
}: OrderSummaryModalProps) {
  if (!open) return null;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusableSelector =
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';
    const raf = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const firstFocusable = dialog?.querySelector<HTMLElement>(focusableSelector) ?? null;
      (firstFocusable ?? dialog)?.focus?.();
    });

    return () => {
      window.cancelAnimationFrame(raf);
      const previous = previouslyFocusedRef.current;
      if (previous && document.contains(previous)) {
        previous.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Order summary"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-900 px-6 py-4">
          <SectionHeader
            variant="label"
            title="Order summary"
            subtitle="Review the order steps and details before placing anything."
            titleClassName="truncate text-sm font-semibold text-white"
            subtitleClassName="text-xs text-slate-400"
            className="min-w-0"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order summary dialog"
            className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
          >
            Close
          </button>
        </div>

        <div className="space-y-6 p-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-slate-200">
            <p className="flex items-start gap-2">
              <InlineInfoMark className="mt-0.5" />
              <span className="font-semibold text-slate-100">Preview only.</span>
              <span className="text-slate-300">
                No order or payment is placed from this screen.
              </span>
            </p>
          </div>

          <section className="space-y-3">
            <SectionHeader variant="label" title="Items" />
            <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_160px]">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Part name
                  </p>
                  <p className="mt-1 truncate text-sm font-semibold text-white">{partName}</p>
                  {supplierName ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Supplier:{" "}
                      <span className="font-semibold text-slate-200">{supplierName}</span>
                    </p>
                  ) : null}
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Quantity</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{quantity}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {/* TODO(checkout): replace placeholder with real per-part quantity. */}
                    Sample quantity
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Price</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{priceLabel}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {/* TODO(checkout): compute taxes, shipping, and totals. */}
                    Taxes, shipping, and totals are finalized when an order is placed.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeader variant="label" title="Payment method" />
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled
                className={clsx(
                  "rounded-2xl border px-4 py-4 text-left transition",
                  "border-slate-900/60 bg-slate-950/30 opacity-60",
                )}
              >
                <p className="text-sm font-semibold text-slate-100">Credit Card</p>
                <p className="mt-1 text-xs text-slate-400">Not available in this portal</p>
                {/* TODO(payments): integrate card payments (no Stripe yet). */}
              </button>
              <button
                type="button"
                disabled
                className={clsx(
                  "rounded-2xl border px-4 py-4 text-left transition",
                  "border-slate-900/60 bg-slate-950/30 opacity-60",
                )}
              >
                <p className="text-sm font-semibold text-slate-100">PO Upload</p>
                <p className="mt-1 text-xs text-slate-400">Not available in this portal</p>
                {/* TODO(payments): add PO upload flow + approval states. */}
              </button>
            </div>
          </section>

          <section className="space-y-3">
            <SectionHeader variant="label" title="What happens next" />
            <p className="text-xs text-slate-400">In the order step, you’ll:</p>
            <ol className="space-y-2">
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-900/60 bg-slate-950/30 text-xs font-semibold text-slate-200">
                  1
                </span>
                <p className="text-sm text-slate-200">
                  Confirm quantities, shipping details, and totals.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-900/60 bg-slate-950/30 text-xs font-semibold text-slate-200">
                  2
                </span>
                <p className="text-sm text-slate-200">Choose a payment method (card or PO).</p>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-900/60 bg-slate-950/30 text-xs font-semibold text-slate-200">
                  3
                </span>
                <p className="text-sm text-slate-200">
                  Place the order to lock in the supplier and schedule.
                </p>
              </li>
              <li className="flex gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-900/60 bg-slate-950/30 text-xs font-semibold text-slate-200">
                  4
                </span>
                <p className="text-sm text-slate-200">
                  Track production and delivery updates here.
                </p>
              </li>
            </ol>
          </section>

          <section className="rounded-2xl border border-slate-900/60 bg-slate-950/30 p-4">
            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 opacity-50"
            >
              Place Order
            </button>
            <p className="mt-2 text-center text-xs text-slate-400">
              Preview only — ordering isn’t available in this portal.
            </p>
            {/* TODO(checkout): wire up submission once payments + order APIs exist. */}
            {/* NOTE: no API calls / no form submission logic in this scaffold. */}
          </section>
        </div>
      </div>
    </div>
  );
}

function InlineInfoMark({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={clsx("shrink-0 text-slate-300", className)}
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="2" />
      <path
        d="M10 9v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10 6.5h.01"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

