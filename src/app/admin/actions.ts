"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const ADMIN_COOKIE_NAME = "admin-auth";

export async function authenticate(formData: FormData) {
  const password = (formData.get("password") ?? "").toString();

  if (!password || password !== process.env.ADMIN_DASH_PASSWORD) {
    return { success: false, error: "Incorrect password." };
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  });

  redirect("/admin");
}