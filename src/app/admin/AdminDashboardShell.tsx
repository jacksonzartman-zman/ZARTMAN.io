import type { ReactNode } from "react";
import clsx from "clsx";
import { PageHeader } from "@/components/PageHeader";
import { PortalContainer } from "@/app/(portals)/components/PortalContainer";

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
    <main className={clsx("py-10", className)}>
      <PortalContainer className="space-y-8">
        <PageHeader
          eyebrow={eyebrow}
          eyebrowClassName="text-emerald-400"
          title={title}
          description={description}
          actions={actions}
        />
        {children}
      </PortalContainer>
    </main>
  );
}
