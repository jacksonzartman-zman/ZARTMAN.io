"use client";

import { useRouter } from "next/navigation";

export default function TryAgainButton({ label = "Try again" }: { label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-700 hover:bg-slate-900/30"
      onClick={() => router.refresh()}
    >
      {label}
    </button>
  );
}

