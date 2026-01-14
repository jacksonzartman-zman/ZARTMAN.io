import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getServerAuthUser } from "@/server/auth";
import { resolveUserRoles } from "@/server/users/roles";
import { ADMIN_COOKIE_NAME } from "@/app/admin/constants";

export const dynamic = "force-dynamic";

export default async function AccountSettingsRoleRouterPage() {
  const { user } = await getServerAuthUser();

  if (!user) {
    redirect("/login?next=/account/settings");
  }

  const cookieStore = await cookies();
  const isAdminUnlocked = cookieStore.get(ADMIN_COOKIE_NAME)?.value === "1";
  if (isAdminUnlocked) {
    redirect("/admin/settings");
  }

  const roles = await resolveUserRoles(user.id);
  if (roles.primaryRole === "customer") {
    redirect("/customer/settings");
  }
  if (roles.primaryRole === "supplier") {
    redirect("/supplier/settings");
  }

  // Fail closed if we cannot safely resolve a single portal role.
  redirect("/login?next=/account/settings");
}

