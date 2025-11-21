// src/app/admin/constants.ts

// Cookie name for the simple admin gate
export const ADMIN_COOKIE_NAME = "zartman_admin";

// For now, just hard-code the admin password so it matches
// locally and in production without needing env vars.
export const ADMIN_PASSWORD = "X<wfhURR7s?1x7pv";

const UPLOAD_STATUSES = [
  "new",
  "in_review",
  "quoted",
  "on_hold",
  "closed_lost",
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const DEFAULT_UPLOAD_STATUS: UploadStatus = "new";

export function isUploadStatus(value: unknown): value is UploadStatus {
  return (
    typeof value === "string" &&
    (UPLOAD_STATUSES as readonly string[]).includes(value)
  );
}

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  new: "New",
  in_review: "In review",
  quoted: "Quoted",
  on_hold: "On hold",
  closed_lost: "Closed lost",
};

export const UPLOAD_STATUS_OPTIONS: UploadStatus[] = [...UPLOAD_STATUSES];