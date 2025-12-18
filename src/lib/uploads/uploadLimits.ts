export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

export function formatMaxUploadSize(): string {
  // Keep it simple for now
  return "25 MB";
}

export function isFileTooLarge(file: File | { size: number }): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}
