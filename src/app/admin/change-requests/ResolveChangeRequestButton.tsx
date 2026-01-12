"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import clsx from "clsx";

import { ctaSizeClasses, secondaryCtaClasses } from "@/lib/ctas";

export default function ResolveChangeRequestButton({
  changeRequestId,
  className,
}: {
  changeRequestId: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function onClick() {
    if (!changeRequestId || pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/admin/change-requests/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ changeRequestId }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: unknown } | null;
      if (!res.ok || !json || json.ok !== true) {
        console.error("[change-requests] resolve failed", {
          status: res.status,
          changeRequestId,
          body: json,
        });
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={clsx(
        secondaryCtaClasses,
        ctaSizeClasses.sm,
        "border-slate-700 text-slate-100 hover:border-slate-500 hover:bg-slate-900/40",
        className,
      )}
    >
      {pending ? "Resolving..." : "Mark resolved"}
    </button>
  );
}

