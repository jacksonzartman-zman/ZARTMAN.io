"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import type { QuoteFileItem } from "@/app/admin/quotes/[id]/QuoteFilesCard";
import type { QuoteFileMeta } from "@/server/quotes/types";
import { CustomerQuotePartPanel } from "./CustomerQuotePartPanel";
import { CustomerCheckoutScaffoldCard } from "./CustomerCheckoutScaffoldCard";
import { OrderSummaryModal } from "./OrderSummaryModal";
import type { QuoteWorkspaceStatus } from "@/lib/quote/workspaceStatus";

export type CustomerQuoteOrderWorkspaceProps = {
  files: QuoteFileMeta[];
  previews: QuoteFileItem[];
  partName: string;
  supplierName?: string | null;
  priceLabel: string;
  targetDate?: string | null;
  hasWinner: boolean;
  workspaceStatus: QuoteWorkspaceStatus;
};

export function CustomerQuoteOrderWorkspace({
  files,
  previews,
  partName,
  supplierName,
  priceLabel,
  targetDate,
  hasWinner,
  workspaceStatus,
}: CustomerQuoteOrderWorkspaceProps) {
  const [open, setOpen] = useState(false);

  const quantity = useMemo(() => {
    // TODO(checkout): replace with real quantity selection from parts.
    return 10;
  }, []);

  const openOrderSummary = useCallback(() => {
    setOpen(true);
    // Best-effort: keep checkout context visible behind the modal.
    requestAnimationFrame(() => {
      document.getElementById("checkout")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const proceedHandler = hasWinner ? openOrderSummary : undefined;

  return (
    <div className="space-y-6">
      <CustomerQuotePartPanel
        files={files}
        previews={previews}
        workspaceStatus={workspaceStatus}
        targetDate={targetDate ?? null}
        onProceedToOrder={proceedHandler}
      />

      {!hasWinner ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-950/50 px-5 py-4 text-sm text-slate-200">
          <p className="font-semibold text-white">Checkout unlocks after you choose a supplier</p>
          <p className="mt-1 text-xs text-slate-400">
            Next, once you select a winning supplier in Decision, checkout will reflect the awarded price and lead time.
          </p>
          <div className="mt-3">
            <Link
              href="#decision"
              className="inline-flex items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-black transition hover:bg-emerald-400"
            >
              Choose a supplier
            </Link>
          </div>
        </div>
      ) : null}

      <div id="checkout" className="scroll-mt-24">
        <CustomerCheckoutScaffoldCard
          partName={partName}
          supplierName={supplierName}
          priceLabel={priceLabel}
          quantity={quantity}
          canOpenOrderSummary={hasWinner}
          onOpenOrderSummary={openOrderSummary}
        />
      </div>

      <OrderSummaryModal
        open={open}
        onClose={() => setOpen(false)}
        partName={partName}
        quantity={quantity}
        priceLabel={priceLabel}
        supplierName={supplierName}
      />
    </div>
  );
}

