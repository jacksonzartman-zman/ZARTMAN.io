import AdminNavClient, { type AdminHeaderUser } from "./AdminNavClient";
import { createAuthClient, getServerAuthUser } from "@/server/auth";
import { redirect } from "next/navigation";

export default async function AdminNav() {
  const { user } = await getServerAuthUser();

  const headerUser: AdminHeaderUser | null = user
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
    <AdminNavClient user={headerUser} signOutAction={user ? handleSignOut : undefined} />
  );
}

async function handleSignOut() {
  "use server";

  const supabase = createAuthClient();
  try {
    await supabase.auth.signOut();
  } catch (error) {
    console.error("AdminNav: sign out failed", error);
  }
  redirect("/");
}
