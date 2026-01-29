"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const OFFER_SENT_BANNER_DISMISSED_KEY = "supplier_offer_sent_banner_dismissed_v1";

export function SupplierOfferSentBanner({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    try {
      setDismissed(localStorage.getItem(OFFER_SENT_BANNER_DISMISSED_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    const params = new URLSearchParams(searchParams.toString());
    if (params.get("offer") !== "sent") return;

    params.delete("offer");
    const qs = params.toString();
    const url = qs ? `${pathname}?${qs}` : pathname;
    router.replace(url, { scroll: false });
  }, [enabled, pathname, router, searchParams]);

  if (!enabled || dismissed === null || dismissed) {
    return null;
  }

  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-50">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-emerald-50">Offer sent successfully</p>
        <button
          type="button"
          onClick={() => {
            try {
              localStorage.setItem(OFFER_SENT_BANNER_DISMISSED_KEY, "1");
            } catch {
              // ignore
            }
            setDismissed(true);
          }}
          className="rounded-lg border border-emerald-500/30 bg-black/20 px-2 py-1 text-xs font-semibold text-emerald-50/90 transition hover:border-emerald-400/50 hover:text-white"
          aria-label="Dismiss offer sent banner"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

