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
        "rounded-2xl border border-slate-800/80 bg-slate-950/60 px-6 py-5 shadow-[0_10px_30px_rgba(2,6,23,0.35)]",
        "transition duration-200 ease-out motion-reduce:transition-none",
        "hover:-translate-y-0.5 hover:border-slate-700/80 hover:bg-slate-950/65 hover:shadow-[0_14px_40px_rgba(2,6,23,0.45)] motion-reduce:hover:translate-y-0",
        className,
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white heading-tight">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-slate-400 heading-snug">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      {children ? <div className="mt-4 text-sm text-slate-200">{children}</div> : null}
    </section>
  );
}
