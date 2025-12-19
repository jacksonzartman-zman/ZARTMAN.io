import AppHeaderClient from "./AppHeaderClient";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { resolveUserRoles } from "@/server/users/roles";
import { normalizeEmailInput } from "@/app/(portals)/quotes/pageUtils";
import { loadSupplierProfile } from "@/server/suppliers";
import { getSupplierDecisionQueue } from "@/server/rfqs/decisions";

export type HeaderUser = {
  email: string | null;
  displayName: string | null;
};

export default async function AppHeader() {
  const { user } = await getServerAuthUser();
  const roles = user ? await resolveUserRoles(user.id) : null;
  const supplierDecisionCount =
    user && roles?.isSupplier
      ? await resolveSupplierDecisionCount(user.email ?? null)
      : undefined;

  const headerUser: HeaderUser | null = user
    ? {
        email: user.email ?? null,
        displayName:
          (user.user_metadata?.company as string | undefined) ??
          (user.user_metadata?.full_name as string | undefined) ??
          user.email ??
          null,
      }
    : null;

  return (
    <AppHeaderClient
      user={headerUser}
      signOutAction={user ? handleSignOut : undefined}
      supplierDecisionCount={supplierDecisionCount}
    />
  );
}

async function handleSignOut() {
  "use server";

  const supabase = createAuthClient();
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("AppHeader: sign out failed", error);
  }
  redirect("/");
}

async function resolveSupplierDecisionCount(
  userEmail: string | null,
): Promise<number> {
  const supplierEmail = normalizeEmailInput(userEmail);
  if (!supplierEmail) {
    return 0;
  }

  const profile = await loadSupplierProfile(supplierEmail);
  const supplier = profile?.supplier;
  if (!supplier) {
    return 0;
  }

  try {
    const decisions = await getSupplierDecisionQueue({
      supplierId: supplier.id,
      supplierEmail: supplier.primary_email ?? supplierEmail,
      limit: 20,
    });
    return decisions.length;
  } catch (error) {
    console.error("[app header] supplier decision count failed", {
      supplierId: supplier.id,
      error,
    });
    return 0;
  }
}
