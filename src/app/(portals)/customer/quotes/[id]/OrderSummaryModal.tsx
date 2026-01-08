"use client";

import clsx from "clsx";

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

  // TODO(checkout): add keyboard escape handler + focus trap for accessibility.

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
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
        <div className="flex items-start justify-between gap-3 border-b border-slate-900 px-6 py-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">Order summary</p>
            <p className="mt-1 text-xs text-slate-400">
              Review items and payment options (checkout coming soon).
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-700 bg-slate-900/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-100 transition hover:border-slate-600"
          >
            Close
          </button>
        </div>

        <div className="space-y-6 p-6">
          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Items
            </p>
            <div className="overflow-hidden rounded-2xl border border-slate-900/60 bg-slate-950/30">
              <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_120px_160px]">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
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
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Quantity</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{quantity}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {/* TODO(checkout): replace placeholder with real per-part quantity. */}
                    Placeholder
                  </p>
                </div>

                <div>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">Price</p>
                  <p className="mt-1 text-sm font-semibold text-slate-100">{priceLabel}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {/* TODO(checkout): compute taxes, shipping, and totals. */}
                    Total pricing coming soon
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Payment method
            </p>
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
                <p className="mt-1 text-xs text-slate-400">Coming soon</p>
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
                <p className="mt-1 text-xs text-slate-400">Coming soon</p>
                {/* TODO(payments): add PO upload flow + approval states. */}
              </button>
            </div>
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
              Checkout will be enabled soon
            </p>
            {/* TODO(checkout): wire up submission once payments + order APIs exist. */}
            {/* NOTE: no API calls / no form submission logic in this scaffold. */}
          </section>
        </div>
      </div>
    </div>
  );
}

