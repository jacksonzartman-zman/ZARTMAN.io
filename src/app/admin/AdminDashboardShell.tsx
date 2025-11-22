import type { ReactNode } from "react";
import clsx from "clsx";

type AdminDashboardShellProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export default function AdminDashboardShell({
  title,
  description,
  eyebrow = "Admin",
  actions,
  children,
  className,
}: AdminDashboardShellProps) {
  return (
    <main className={clsx("mx-auto max-w-6xl px-4 py-10 space-y-6", className)}>
      <header className="space-y-3">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-400">
            {eyebrow}
          </p>
        ) : null}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-white">{title}</h1>
            {description ? (
              <p className="text-sm text-slate-400">{description}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-3">{actions}</div>
          ) : null}
        </div>
      </header>
      {children}
    </main>
  );
}
