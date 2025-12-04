import type { ReactNode } from "react";
import clsx from "clsx";
import { PageHeader } from "@/components/PageHeader";

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
    <main className={clsx("mx-auto max-w-6xl space-y-8 px-4 py-10", className)}>
      <PageHeader
        eyebrow={eyebrow}
        eyebrowClassName="text-emerald-400"
        title={title}
        description={description}
        actions={actions}
      />
      {children}
    </main>
  );
}
