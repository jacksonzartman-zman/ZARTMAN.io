"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ADMIN_COOKIE_NAME = "admin-auth";

export async function authenticate(formData: FormData) {
  const password = (formData.get("password") ?? "").toString();
  const expected = process.env.ADMIN_DASH_PASSWORD;

  if (expected && password === expected) {
    cookies().set(ADMIN_COOKIE_NAME, "ok", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 8, // 8 hours
      path: "/",
    });
  }

  // Always go back to /admin (success or failure)
  redirect("/admin");
}
