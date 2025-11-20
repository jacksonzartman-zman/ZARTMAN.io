// src/app/admin/constants.ts

// Cookie name for the simple admin gate
export const ADMIN_COOKIE_NAME = "zartman_admin";

// For now, just hard-code the admin password so it matches
// locally and in production without needing env vars.
export const ADMIN_PASSWORD = "X<wfhURR7s?1x7pv";

// src/app/admin/constants.ts
export type UploadStatus =
  | "new"
  | "in_review"
  | "quoted"
  | "on_hold"
  | "closed_lost";

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  new: "New",
  in_review: "In review",
  quoted: "Quoted",
  on_hold: "On hold",
  closed_lost: "Closed lost",
};