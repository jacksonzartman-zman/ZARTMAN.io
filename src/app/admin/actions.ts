"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE_NAME = "admin-auth";

export async function authenticate(formData: FormData): Promise<void> {
  const password = (formData.get("password") ?? "").toString();
  const adminPassword = process.env.ADMIN_DASH_PASSWORD ?? "";

  // Wrong password → just return (no redirect yet, we can improve UX later)
  if (!adminPassword || password !== adminPassword) {
    // In a future iteration we can redirect with a query param or use useFormState
    // for now we just do nothing so the form stays visible.
    return;
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE_NAME, "ok", {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day
  });

  // On success, go back to /admin which will now see the cookie and show the table
  redirect("/admin");
}