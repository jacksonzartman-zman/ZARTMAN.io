"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_COOKIE_NAME } from "./constants";

export async function authenticate(formData: FormData): Promise<void> {
  const password = (formData.get("password") ?? "").toString();
  const adminPassword = process.env.ADMIN_DASH_PASSWORD ?? "";

  // Wrong or missing password → do nothing (form will stay visible)
  if (!adminPassword || password !== adminPassword) {
    return;
  }

  const cookieStore = await cookies();

  cookieStore.set(ADMIN_COOKIE_NAME, "ok", {
    httpOnly: true,
    path: "/",
    maxAge: 60 * 60 * 24, // 1 day
  });

  redirect("/admin");
}