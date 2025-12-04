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
      <table className={clsx("min-w-full text-left text-sm", tableClassName)}>
        <thead className="bg-slate-950/70">
          {head}
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
