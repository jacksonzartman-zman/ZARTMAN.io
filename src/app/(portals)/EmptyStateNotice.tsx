import type { ReactNode } from "react";

type EmptyStateNoticeProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyStateNotice({
  title,
  description,
  action,
}: EmptyStateNoticeProps) {
  return (
    <div
      className="rounded-2xl border border-dashed border-slate-800/70 bg-slate-950/40 px-4 py-5 text-left"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-600/70" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-2 text-sm text-slate-400">{description}</p>
      {action ? <div className="mt-3 text-sm text-slate-200">{action}</div> : null}
    </div>
  );
}
