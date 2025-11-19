// src/app/admin/constants.ts

// Cookie name for the simple admin gate
export const ADMIN_COOKIE_NAME = "zartman_admin";

// TODO: in production, set this via an environment variable: ADMIN_PASSWORD=...
export const ADMIN_PASSWORD =
  process.env.ADMIN_PASSWORD ?? "zartman-admin-password";