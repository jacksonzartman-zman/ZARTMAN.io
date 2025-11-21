// src/app/admin/constants.ts

// Cookie name for the simple admin gate
export const ADMIN_COOKIE_NAME = "zartman_admin";

// For now, just hard-code the admin password so it matches
// locally and in production without needing env vars.
export const ADMIN_PASSWORD = "X<wfhURR7s?1x7pv";

const UPLOAD_STATUSES = [
  "submitted",
  "in_review",
  "quoted",
  "approved",
  "rejected",
] as const;

const LEGACY_STATUS_FALLBACKS: Record<string, UploadStatus> = {
  new: "submitted",
  on_hold: "in_review",
  closed_lost: "rejected",
  draft: "submitted",
};

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

export const DEFAULT_UPLOAD_STATUS: UploadStatus = "submitted";

export function isUploadStatus(value: unknown): value is UploadStatus {
  return (
    typeof value === "string" &&
    (UPLOAD_STATUSES as readonly string[]).includes(value)
  );
}

export function normalizeUploadStatus(
  value: unknown,
  fallback: UploadStatus = DEFAULT_UPLOAD_STATUS,
): UploadStatus {
  if (isUploadStatus(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (LEGACY_STATUS_FALLBACKS[normalized]) {
      return LEGACY_STATUS_FALLBACKS[normalized];
    }
  }

  return fallback;
}

export function parseUploadStatusInput(value: unknown): UploadStatus | null {
  if (isUploadStatus(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isUploadStatus(normalized)) {
      return normalized;
    }
  }

  return null;
}

export const UPLOAD_STATUS_LABELS: Record<UploadStatus, string> = {
  submitted: "Submitted",
  in_review: "In review",
  quoted: "Quoted",
  approved: "Approved",
  rejected: "Rejected",
};

export const UPLOAD_STATUS_OPTIONS: UploadStatus[] = [...UPLOAD_STATUSES];
