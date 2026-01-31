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

/**
 * Secondary / supporting portal panels.
 * Intentionally quieter than the primary surface to reinforce hierarchy.
 *
 * NOTE: `PortalCard` applies `PORTAL_SURFACE_CARD_INTERACTIVE` by default, so this token is
 * designed to be passed via `className` to override the heavier background + shadow.
 */
export const PORTAL_SURFACE_CARD_INTERACTIVE_QUIET =
  "border-slate-900/40 bg-slate-950/18 shadow-[0_4px_14px_rgba(2,6,23,0.14)] hover:border-slate-900/50 hover:bg-slate-950/22 hover:shadow-[0_6px_18px_rgba(2,6,23,0.16)]";

export const PORTAL_SURFACE_HEADER =
  "rounded-3xl border border-slate-900/60 bg-slate-950/35 shadow-[0_10px_24px_rgba(2,6,23,0.35)]";

const PORTAL_STACK_PAGE = "space-y-6 sm:space-y-8";
const PORTAL_STACK_SECTIONS = "space-y-6 sm:space-y-7";

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
