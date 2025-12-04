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
    <div className={clsx("space-y-8 lg:space-y-10", className)}>
      <PageHeader
        eyebrow={workspaceLabel}
        eyebrowClassName={WORKSPACE_ACCENTS[workspace]}
        title={title}
        description={subtitle}
        actions={actions}
      >
        {headerContent}
      </PageHeader>
      <div className={clsx("space-y-8", bodyClassName)}>{children}</div>
    </div>
  );
}
