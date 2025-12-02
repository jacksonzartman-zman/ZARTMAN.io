import clsx from "clsx";
import type { ReactNode } from "react";

type PortalShellProps = {
  workspace: "customer" | "supplier";
  title: string;
  subtitle?: string;
  label?: string;
  actions?: ReactNode;
  headerContent?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

const WORKSPACE_ACCENTS: Record<PortalShellProps["workspace"], string> = {
  customer: "text-emerald-300",
  supplier: "text-blue-300",
};

export function PortalShell({
  workspace,
  title,
  subtitle,
  label,
  actions,
  headerContent,
  children,
  className,
  bodyClassName,
}: PortalShellProps) {
  const workspaceLabel =
    label ??
    (workspace === "customer"
      ? "Customer workspace"
      : "Supplier workspace");

  return (
    <div className={clsx("space-y-8", className)}>
      <section className="rounded-3xl border border-slate-900/70 bg-slate-950/70 p-6 shadow-[0_18px_40px_rgba(2,6,23,0.6)]">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="space-y-2">
            <p
              className={clsx(
                "text-xs font-semibold uppercase tracking-[0.3em]",
                WORKSPACE_ACCENTS[workspace],
              )}
            >
              {workspaceLabel}
            </p>
            <h1 className="text-3xl font-semibold text-white">{title}</h1>
            {subtitle ? (
              <p className="max-w-2xl text-sm text-slate-400">{subtitle}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex flex-col items-start gap-3 text-sm sm:items-end sm:text-right">
              {actions}
            </div>
          ) : null}
        </div>
        {headerContent ? (
          <div className="mt-6 space-y-4">{headerContent}</div>
        ) : null}
      </section>
      <div className={clsx("space-y-6", bodyClassName)}>{children}</div>
    </div>
  );
}
