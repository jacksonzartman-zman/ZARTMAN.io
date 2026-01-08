"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import { OrderSummaryModal } from "./OrderSummaryModal";

export type CustomerCheckoutScaffoldCardProps = {
  partName: string;
  supplierName?: string | null;
  priceLabel: string;
  quantity?: number;
  canOpenOrderSummary?: boolean;
  onOpenOrderSummary?: () => void;
  className?: string;
};

export function CustomerCheckoutScaffoldCard({
  partName,
  supplierName,
  priceLabel,
  quantity: quantityProp,
  canOpenOrderSummary = true,
  onOpenOrderSummary,
  className,
}: CustomerCheckoutScaffoldCardProps) {
  const [open, setOpen] = useState(false);

  const quantity = useMemo(() => {
    const normalized =
      typeof quantityProp === "number" && Number.isFinite(quantityProp) ? quantityProp : 10;
    // TODO(checkout): replace with real quantity selection from parts.
    return normalized;
  }, [quantityProp]);

  const handleOpenOrderSummary = () => {
    if (!canOpenOrderSummary) return;
    if (onOpenOrderSummary) {
      onOpenOrderSummary();
      return;
    }
    setOpen(true);
  };

  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-800 bg-slate-950/60 px-5 py-4",
        className,
      )}
    >
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Checkout
        </p>
        <h2 className="text-lg font-semibold text-white">Next step: order</h2>
        <p className="text-sm text-slate-300">
          Review how ordering will work for this quote.
        </p>
      </header>

      <dl className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Part</dt>
          <dd className="truncate font-medium text-slate-100">{partName}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Quantity</dt>
          <dd className="font-medium text-slate-100">{quantity}</dd>
        </div>
        <div className="rounded-xl border border-slate-900/60 bg-slate-950/40 px-3 py-2">
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">Price</dt>
          <dd className="font-medium text-slate-100">{priceLabel}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-400">
          {/* TODO(checkout): show real order totals and shipping. */}
          Ordering isn’t available in this portal.
        </p>
        <button
          type="button"
          onClick={handleOpenOrderSummary}
          disabled={!canOpenOrderSummary}
          className={clsx(
            "inline-flex items-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2",
            canOpenOrderSummary
              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100 hover:border-emerald-300 hover:text-white focus-visible:outline-emerald-400"
              : "border-slate-800 bg-slate-950/40 text-slate-500 opacity-70 cursor-not-allowed",
          )}
        >
          View order summary
        </button>
      </div>

      {!onOpenOrderSummary ? (
        <OrderSummaryModal
          open={open}
          onClose={() => setOpen(false)}
          partName={partName}
          quantity={quantity}
          priceLabel={priceLabel}
          supplierName={supplierName}
        />
      ) : null}
    </section>
  );
}

