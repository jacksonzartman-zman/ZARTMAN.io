import type { ReactNode } from "react";
import PortalLayout from "../PortalLayout";
import { PortalLoginPanel } from "../PortalLoginPanel";
import { getCurrentSession } from "@/server/auth";

export default async function SupplierPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <PortalLayout role="supplier">
        <PortalLoginPanel role="supplier" fallbackRedirect="/supplier" />
      </PortalLayout>
    );
  }

  const displayName =
    session.user.user_metadata?.company ??
    session.user.user_metadata?.full_name ??
    session.user.email ??
    session.user.phone ??
    "Supplier user";

  return (
    <PortalLayout role="supplier" userName={displayName}>
      {children}
    </PortalLayout>
  );
}
