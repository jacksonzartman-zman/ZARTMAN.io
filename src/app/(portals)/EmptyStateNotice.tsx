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
    <div className="rounded-2xl border border-dashed border-slate-800/70 bg-slate-950/30 p-4 text-left">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="mt-1 text-sm text-slate-400">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
