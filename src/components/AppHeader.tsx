import AppHeaderClient from "./AppHeaderClient";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { redirect } from "next/navigation";
import { loadNotificationsForUser } from "@/server/notifications";

export type HeaderUser = {
  email: string | null;
  displayName: string | null;
};

export default async function AppHeader() {
  const { user } = await getServerAuthUser();
  const notifications = user
    ? await loadNotificationsForUser({
        userId: user.id,
        email: user.email ?? null,
      })
    : [];

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
      notifications={notifications}
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
