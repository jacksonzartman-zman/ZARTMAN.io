"use server";

import { cookies } from "next/headers";
import { ADMIN_COOKIE_NAME, ADMIN_PASSWORD } from "./constants";
import { debugOnce } from "@/server/db/schemaErrors";
import { shouldLogAdminDebug } from "@/server/admin/adminDebug";

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

function resolveAdminCookieSecure(): boolean {
  const vercelEnvRaw = process.env.VERCEL_ENV ?? "";
  const vercelEnv = vercelEnvRaw.trim().toLowerCase();
  // Preview/prod on Vercel are HTTPS.
  if (vercelEnv === "production" || vercelEnv === "preview") return true;
  // Local dev / non-vercel.
  return process.env.NODE_ENV === "production";
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
  const secure = resolveAdminCookieSecure();
  const maxAge = 60 * 60 * 8; // 8 hours
  cookieStore.set(ADMIN_COOKIE_NAME, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });

  if (shouldLogAdminDebug()) {
    debugOnce(
      `admin_unlock:action_set_cookie:${ADMIN_COOKIE_NAME}:${secure}:${maxAge}`,
      "[admin unlock] set admin cookie with",
      {
        name: ADMIN_COOKIE_NAME,
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge,
      },
    );
  }

  return { ok: true };
}

export async function lockAdminGateAction(): Promise<void> {
  const cookieStore = await cookies();
  const secure = resolveAdminCookieSecure();
  cookieStore.set(ADMIN_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
}

