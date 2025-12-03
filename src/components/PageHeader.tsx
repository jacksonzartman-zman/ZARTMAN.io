import type { ReactNode } from "react";
import clsx from "clsx";

type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  eyebrowClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  eyebrowClassName,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <section
      className={clsx(
        "rounded-3xl border border-slate-900/70 bg-slate-950/70 p-6 shadow-[0_18px_40px_rgba(2,6,23,0.6)]",
        className,
      )}
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          {eyebrow ? (
            <p
              className={clsx(
                "text-[11px] font-semibold uppercase tracking-[0.3em] text-slate-400",
                eyebrowClassName,
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white heading-tight">{title}</h1>
            {description ? (
              <p className="text-sm text-slate-400 heading-snug">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-col gap-3 text-sm lg:items-end lg:text-right">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-6 space-y-4">{children}</div> : null}
    </section>
  );
}
