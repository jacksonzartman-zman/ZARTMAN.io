import clsx from "clsx";
import type { PortalRole } from "@/types/portal";

type SystemStatusBarProps = {
  role: PortalRole;
  statusMessage?: string;
  syncedLabel?: string | null;
};

const ROLE_STATUS_DOT: Record<PortalRole, string> = {
  customer: "bg-emerald-300/80",
  supplier: "bg-blue-300/80",
};

export function SystemStatusBar({
  role,
  statusMessage = "All systems operational",
  syncedLabel,
}: SystemStatusBarProps) {
  const normalizedSyncedLabel = normalizeSyncedLabel(syncedLabel);

  return (
    <section
      className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-900/70 bg-slate-950/70 px-6 py-4 text-sm text-slate-300"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-2 font-semibold text-white">
        <span
          className={clsx("h-2.5 w-2.5 rounded-full", ROLE_STATUS_DOT[role])}
          aria-hidden="true"
        />
        {statusMessage}
      </span>
      <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">
        Last synced {normalizedSyncedLabel}
      </span>
    </section>
  );
}

function normalizeSyncedLabel(label?: string | null): string {
  if (!label) {
    return "Just now";
  }
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    return "Just now";
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
