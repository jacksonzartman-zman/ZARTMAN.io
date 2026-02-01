import clsx from "clsx";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PORTAL_SURFACE_HEADER } from "./portalSurfaceTokens";

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

export {
  PORTAL_SURFACE_CARD,
  PORTAL_SURFACE_CARD_INTERACTIVE,
  PORTAL_SURFACE_CARD_INTERACTIVE_QUIET,
  PORTAL_SURFACE_HEADER,
} from "./portalSurfaceTokens";

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
