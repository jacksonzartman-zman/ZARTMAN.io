import type { ReactNode } from "react";
import PortalLayout from "../PortalLayout";
import { PortalLoginPanel } from "../PortalLoginPanel";
import { getCurrentSession } from "@/server/auth";

export default async function CustomerPortalLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await getCurrentSession();

  if (!session) {
    return (
      <PortalLayout role="customer">
        <PortalLoginPanel role="customer" fallbackRedirect="/customer" />
      </PortalLayout>
    );
  }

  const displayName =
    session.user.user_metadata?.full_name ??
    session.user.email ??
    session.user.phone ??
    "Signed-in user";

  return (
    <PortalLayout role="customer" userName={displayName}>
      {children}
    </PortalLayout>
  );
}
