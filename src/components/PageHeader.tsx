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
        "rounded-3xl p-5 sm:p-6",
        className,
      )}
    >
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          {eyebrow ? (
            <p
              className={clsx(
                "text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500",
                eyebrowClassName,
              )}
            >
              {eyebrow}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <h1 className="text-2xl font-semibold text-white heading-tight sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="max-w-[72ch] truncate text-sm text-slate-400 heading-snug">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-col gap-2 text-sm lg:items-end lg:text-right">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-4 space-y-4">{children}</div> : null}
    </section>
  );
}
