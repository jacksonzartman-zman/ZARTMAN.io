import clsx from "clsx";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";

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

export const PORTAL_SURFACE_CARD =
  "rounded-2xl border border-slate-800/60 bg-slate-950/45 shadow-[0_8px_24px_rgba(2,6,23,0.28)]";

export const PORTAL_SURFACE_CARD_INTERACTIVE = clsx(
  PORTAL_SURFACE_CARD,
  "transition duration-200 ease-out motion-reduce:transition-none",
  "hover:border-slate-700/70 hover:bg-slate-950/55 hover:shadow-[0_10px_30px_rgba(2,6,23,0.34)]",
);

export const PORTAL_SURFACE_HEADER =
  "rounded-3xl border border-slate-800/60 bg-slate-950/60 shadow-[0_18px_40px_rgba(2,6,23,0.6)]";

const PORTAL_STACK_PAGE = "space-y-8 sm:space-y-10";
const PORTAL_STACK_SECTIONS = "space-y-7 sm:space-y-8";

const WORKSPACE_ACCENTS: Record<PortalShellProps["workspace"], string> = {
  customer: "text-emerald-200",
  supplier: "text-sky-200",
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
    <div className={clsx(PORTAL_STACK_PAGE, className)}>
      <PageHeader
        eyebrow={workspaceLabel}
        eyebrowClassName={WORKSPACE_ACCENTS[workspace]}
        title={title}
        description={subtitle}
        actions={actions}
        className={PORTAL_SURFACE_HEADER}
      >
        {headerContent}
      </PageHeader>
      <div className={clsx(PORTAL_STACK_SECTIONS, bodyClassName)}>{children}</div>
    </div>
  );
}
