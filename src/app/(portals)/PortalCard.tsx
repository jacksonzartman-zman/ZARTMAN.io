import clsx from "clsx";
import type { ReactNode } from "react";

type PortalCardProps = {
  id?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export default function PortalCard({
  id,
  title,
  description,
  children,
  action,
  className,
}: PortalCardProps) {
  return (
    <section
      id={id}
      className={clsx(
        "rounded-2xl border border-slate-800/60 bg-slate-950/45 px-6 py-5 shadow-[0_8px_24px_rgba(2,6,23,0.28)]",
        "transition duration-200 ease-out motion-reduce:transition-none",
        "hover:border-slate-700/70 hover:bg-slate-950/55 hover:shadow-[0_10px_30px_rgba(2,6,23,0.34)]",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 className="text-base font-semibold text-white heading-tight sm:text-lg">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm text-slate-400 heading-snug">{description}</p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      {children ? <div className="mt-5 text-sm text-slate-200">{children}</div> : null}
    </section>
  );
}
