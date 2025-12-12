"use server";

import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./constants";

export type AdminGateState =
  | { ok: true; error?: undefined }
  | { ok: false; error: string };

function resolveAdminPassword(): string {
  const fromEnv = process.env.ZARTMAN_ADMIN_PASSWORD;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return ADMIN_PASSWORD;
}

export async function unlockAdminGateAction(
  _prevState: AdminGateState,
  formData: FormData,
): Promise<AdminGateState> {
  const passwordRaw = formData.get("password");
  const password = typeof passwordRaw === "string" ? passwordRaw : "";
  const expected = resolveAdminPassword();

  if (!password || password !== expected) {
    return { ok: false, error: "Not authorized." };
  }

  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return { ok: true };
}

export async function lockAdminGateAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

