import clsx from "clsx";
import type { ReactNode } from "react";

type AdminTableShellProps = {
  head: ReactNode;
  body: ReactNode;
  className?: string;
  tableClassName?: string;
};

export const adminTableCellClass =
  "px-3 py-2 text-left align-middle text-sm text-slate-200";

export default function AdminTableShell({
  head,
  body,
  className,
  tableClassName,
}: AdminTableShellProps) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/50 shadow-sm",
        className,
      )}
    >
      <table
        className={clsx("text-left text-sm", tableClassName ?? "min-w-full")}
      >
        <thead className="border-b border-slate-800 bg-slate-900/60 text-xs font-semibold uppercase tracking-wide text-slate-400">
          {head}
        </thead>
        <tbody className="divide-y divide-slate-900/70">{body}</tbody>
      </table>
    </div>
  );
}
