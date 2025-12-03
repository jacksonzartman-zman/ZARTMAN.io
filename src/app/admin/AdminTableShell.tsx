import clsx from "clsx";
import type { ReactNode } from "react";

type AdminTableShellProps = {
  head: ReactNode;
  body: ReactNode;
  className?: string;
};

export const adminTableCellClass = "px-5 py-4 align-top text-sm";

export default function AdminTableShell({
  head,
  body,
  className,
}: AdminTableShellProps) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 shadow-sm",
        className,
      )}
    >
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-900/70">{body}</tbody>
      </table>
    </div>
  );
}
