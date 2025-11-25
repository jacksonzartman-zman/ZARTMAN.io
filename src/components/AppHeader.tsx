import AppHeaderClient from "./AppHeaderClient";
import { createAuthClient, getCurrentSession } from "@/server/auth";
import { redirect } from "next/navigation";
import { loadNotificationsForUser } from "@/server/notifications";

export type HeaderUser = {
  email: string | null;
  displayName: string | null;
};

export default async function AppHeader() {
  const session = await getCurrentSession();
  const notifications = session
    ? await loadNotificationsForUser({
        userId: session.user.id,
        email: session.user.email ?? null,
      })
    : [];

  const headerUser: HeaderUser | null = session
    ? {
        email: session.user.email ?? null,
        displayName:
          (session.user.user_metadata?.company as string | undefined) ??
          (session.user.user_metadata?.full_name as string | undefined) ??
          session.user.email ??
          null,
      }
    : null;

  return (
    <AppHeaderClient
      user={headerUser}
      signOutAction={session ? handleSignOut : undefined}
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
