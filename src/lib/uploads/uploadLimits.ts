export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export function formatMaxUploadSize(): string {
  return "50 MB";
}

export function isFileTooLarge(file: File | { size: number }): boolean {
  return file.size > MAX_UPLOAD_BYTES;
}
