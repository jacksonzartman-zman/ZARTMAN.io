"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import PortalCard from "../PortalCard";
import { primaryCtaClasses } from "@/lib/ctas";

const STORAGE_KEY = "supplier_invited_welcome_dismissed_v1";

function safeReadDismissedFlag(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function safeWriteDismissedFlag() {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // ignore
  }
}

export function InvitedSupplierWelcomePanel({ enabled }: { enabled: boolean }) {
  const [hasMounted, setHasMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setHasMounted(true);
    setDismissed(safeReadDismissedFlag());
  }, []);

  const shouldShow = useMemo(() => enabled && hasMounted && !dismissed, [dismissed, enabled, hasMounted]);
  if (!shouldShow) return null;

  const dismiss = () => {
    safeWriteDismissedFlag();
    setDismissed(true);
  };

  return (
    <PortalCard
      title="Welcome"
      description="A quick overview of what you’ll do in this workspace."
      action={
        <button
          type="button"
          onClick={dismiss}
          className="rounded-full border border-slate-800 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-700 hover:text-white"
        >
          Dismiss
        </button>
      }
    >
      <div className="space-y-4">
        <ul className="space-y-2 text-sm text-slate-200">
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" aria-hidden />
            <span>You’ll see matched RFQs here.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" aria-hidden />
            <span>Quote in under 60 seconds.</span>
          </li>
          <li className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-300" aria-hidden />
            <span>You only get matched for processes you select.</span>
          </li>
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/supplier/settings/processes"
            onClick={dismiss}
            className={`${primaryCtaClasses} px-5 py-2.5 text-sm`}
          >
            Update my processes
          </Link>
          <Link
            href="/supplier"
            onClick={dismiss}
            className="text-sm font-semibold text-blue-200 underline-offset-4 hover:underline"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </PortalCard>
  );
}

