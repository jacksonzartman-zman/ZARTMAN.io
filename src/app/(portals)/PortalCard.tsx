import clsx from "clsx";
import type { ReactNode } from "react";

type PortalCardProps = {
  title: string;
  description?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function PortalCard({
  title,
  description,
  children,
  action,
  className,
}: PortalCardProps) {
  return (
    <section
      className={clsx(
        "rounded-2xl border border-slate-900 bg-slate-950/70 p-6 shadow-sm shadow-slate-950/40",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-slate-400">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      {children ? <div className="mt-4 text-sm text-slate-200">{children}</div> : null}
    </section>
  );
}
